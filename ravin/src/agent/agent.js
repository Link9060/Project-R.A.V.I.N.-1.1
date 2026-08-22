import { chatWithOmniRoute } from "../omniRouteClient.js";
import { RAVIN_SYSTEM_PROMPT } from "../systemPrompt.js";
import { TOOL_DEFINITIONS } from "./tools.js";
import { executeToolCall } from "./toolExecutor.js";

const DEFAULT_MAX_STEPS = 20;
const DEFAULT_RATE_LIMIT_WAIT_MS = 10_000;
const MAX_CONTEXT_CHARS = 22_000;
const MAX_TOOL_RESULT_CHARS = 7_000;
const MAX_RECENT_MESSAGES = 8;

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function serializeToolResult(result) {
  try {
    const serialized = JSON.stringify(result);
    if (serialized.length <= MAX_TOOL_RESULT_CHARS) return serialized;
    return JSON.stringify({ truncated: true, message: "Tool result was truncated to keep the agent context manageable.", preview: serialized.slice(0, MAX_TOOL_RESULT_CHARS) });
  } catch {
    return JSON.stringify({ value: String(result).slice(0, MAX_TOOL_RESULT_CHARS) });
  }
}

function estimateMessageChars(messages) {
  return messages.reduce((total, message) => {
    const content = typeof message.content === "string" ? message.content : JSON.stringify(message.content || "");
    const toolCalls = message.tool_calls ? JSON.stringify(message.tool_calls) : "";
    return total + content.length + toolCalls.length + 100;
  }, 0);
}

function compactMessages(messages) {
  if (!Array.isArray(messages) || estimateMessageChars(messages) <= MAX_CONTEXT_CHARS) return messages;
  const systemMessages = messages.filter((message) => message.role === "system");
  const userMessages = messages.filter((message) => message.role === "user");
  const recentMessages = messages.filter((message) => message.role !== "system" && message.role !== "user").slice(-MAX_RECENT_MESSAGES);
  return [...systemMessages, ...userMessages.slice(0, 1), { role: "system", content: "CONTEXT COMPACTION NOTICE: Older tool outputs were removed because the request context became too large. Continue using preserved context and inspect files again with tools whenever older information is needed." }, ...recentMessages];
}

function aggressivelyCompactMessages(messages) {
  const systemMessages = messages.filter((message) => message.role === "system");
  const firstUserMessage = messages.find((message) => message.role === "user");
  const recentMessages = messages.filter((message) => message.role !== "system" && message.role !== "user").slice(-4).map((message) => typeof message.content === "string" ? { ...message, content: message.content.slice(0, 3500) } : message);
  return [...systemMessages, firstUserMessage, { role: "system", content: "IMPORTANT: The previous context became too large for the model. Older tool output has been discarded. Reconstruct missing information with available tools and continue the user's task." }, ...recentMessages].filter(Boolean);
}

async function requestWithRecovery(messages, options = {}) {
  let currentMessages = compactMessages(messages);
  let rateLimitRetryCount = 0;
  let sizeRecoveryCount = 0;
  while (true) {
    try {
      return await chatWithOmniRoute(currentMessages, options);
    } catch (error) {
      if (error?.code === "OMNIROUTE_RATE_LIMIT" || error?.status === 429) {
        rateLimitRetryCount++;
        const waitMs = Number.isFinite(error.retryAfterMs) && error.retryAfterMs >= 0 ? error.retryAfterMs : DEFAULT_RATE_LIMIT_WAIT_MS;
        console.log(`RAVIN: rate limit reached. Waiting ${Math.ceil(waitMs / 1000)}s (retry #${rateLimitRetryCount})...`);
        await sleep(waitMs);
        continue;
      }
      if (error?.code === "OMNIROUTE_REQUEST_TOO_LARGE" || error?.status === 413) {
        sizeRecoveryCount++;
        if (sizeRecoveryCount > 3) throw new Error("RAVIN could not reduce the request enough after several context-compaction attempts.");
        currentMessages = aggressivelyCompactMessages(currentMessages);
        continue;
      }
      throw error;
    }
  }
}

/**
 * Run RAVIN's existing tool-using agent.
 * `initialMessages` allows the authenticated API layer to provide persisted context.
 */
export async function runAgent(userMessage, { systemPrompt = RAVIN_SYSTEM_PROMPT, maxSteps = DEFAULT_MAX_STEPS, temperature = 0.3, initialMessages = null } = {}) {
  if (typeof userMessage !== "string" || !userMessage.trim()) throw new Error("A user message is required.");

  const startedAt = Date.now();
  const messages = Array.isArray(initialMessages) && initialMessages.length
    ? [...initialMessages, { role: "user", content: userMessage.trim() }]
    : [{ role: "system", content: systemPrompt }, { role: "user", content: userMessage.trim() }];

  const trace = [];
  const aiCalls = [];
  let toolTimeMs = 0;
  let contextCompactions = 0;

  for (let step = 1; step <= maxSteps; step++) {
    const beforeCall = Date.now();
    const assistantMessage = await requestWithRecovery(messages, { tools: TOOL_DEFINITIONS, toolChoice: "auto", temperature, maxTokens: 1400 });
    const aiCallTimeMs = Date.now() - beforeCall;
    aiCalls.push({
      step,
      latencyMs: aiCallTimeMs,
      omniRoute: assistantMessage._ravinMeta || null,
      contextChars: estimateMessageChars(messages),
      toolEnabled: TOOL_DEFINITIONS.length > 0,
    });

    const toolCalls = assistantMessage.tool_calls || [];

    if (toolCalls.length === 0) {
      const finalContent = assistantMessage.content?.trim();
      if (!finalContent) throw new Error("RAVIN completed a reasoning step without returning a response.");
      const totalTimeMs = Date.now() - startedAt;
      console.log(`[RAVIN perf] total=${totalTimeMs}ms aiCalls=${aiCalls.length} ai=${aiCalls.map((call) => call.latencyMs).join(",")}ms tools=${toolTimeMs}ms compactions=${contextCompactions}`);
      return {
        reply: finalContent,
        steps: step,
        trace,
        performance: {
          totalMs: totalTimeMs,
          aiCalls,
          toolTimeMs,
          contextCompactions,
        },
      };
    }

    messages.push(assistantMessage);
    for (const toolCall of toolCalls) {
      const toolName = toolCall?.function?.name || "unknown";
      trace.push({ step, type: "tool_call", tool: toolName });
      const toolStartedAt = Date.now();
      try {
        const result = await executeToolCall(toolCall);
        toolTimeMs += Date.now() - toolStartedAt;
        trace.push({ step, type: "tool_result", tool: toolName, success: true });
        messages.push({ role: "tool", tool_call_id: toolCall.id, name: toolName, content: serializeToolResult(result) });
      } catch (error) {
        toolTimeMs += Date.now() - toolStartedAt;
        const errorMessage = error instanceof Error ? error.message : String(error);
        trace.push({ step, type: "tool_result", tool: toolName, success: false, error: errorMessage });
        messages.push({ role: "tool", tool_call_id: toolCall.id, name: toolName, content: JSON.stringify({ success: false, error: errorMessage }) });
      }
    }

    if (estimateMessageChars(messages) > MAX_CONTEXT_CHARS) {
      const compacted = compactMessages(messages);
      messages.length = 0;
      messages.push(...compacted);
      contextCompactions++;
    }
  }

  throw new Error(`RAVIN reached its maximum reasoning limit of ${maxSteps} steps without completing the task.`);
}
