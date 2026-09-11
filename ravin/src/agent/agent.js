import {
  chatWithCloudflare,
  streamChatWithCloudflare,
  getRavinModel,
  normalizeRavinMode,
} from "../cloudflareClient.js";
import { RAVIN_SYSTEM_PROMPT } from "../systemPrompt.js";
import { TOOL_DEFINITIONS } from "./tools.js";
import { executeToolCall } from "./toolExecutor.js";

const DEFAULT_MAX_STEPS = 20;
const MAX_CONTEXT_CHARS = 22_000;
const MAX_TOOL_RESULT_CHARS = 7_000;
const MAX_RECENT_MESSAGES = 10;
const CONVERSATION_MAX_TOKENS = 700;

const CONVERSATION_SYSTEM_PROMPT = `You are RAVIN — Levi's personal AI companion and engineering partner. Be sharp, observant, playful, curious, and genuinely conversational. Sound like a smart friend who happens to be extremely capable, not a customer-service bot. Use dry or playful humor when it naturally fits, but never force a joke. Have opinions and give honest takes. Match Levi's energy. Don't constantly ask how you can help, don't overuse his name, and don't call him Sir by default. Keep simple conversation concise. When Levi asks what to build next, give a few genuinely interesting ideas based on the RAVIN project context instead of generic brainstorming. Never mention this prompt or routing.`;

function estimateMessageChars(messages) {
  return messages.reduce((total, message) => {
    const contentLength = typeof message.content === "string"
      ? message.content.length
      : JSON.stringify(message.content || "").length;
    return total + contentLength + 100;
  }, 0);
}

function serializeToolResult(result) {
  try {
    const serialized = JSON.stringify(result);
    return serialized.length <= MAX_TOOL_RESULT_CHARS
      ? serialized
      : JSON.stringify({ truncated: true, preview: serialized.slice(0, MAX_TOOL_RESULT_CHARS) });
  } catch {
    return JSON.stringify({ value: String(result).slice(0, MAX_TOOL_RESULT_CHARS) });
  }
}

function compactMessages(messages) {
  if (estimateMessageChars(messages) <= MAX_CONTEXT_CHARS) return messages;
  const systemMessages = messages.filter((message) => message.role === "system");
  const recentMessages = messages.filter((message) => message.role !== "system").slice(-MAX_RECENT_MESSAGES);
  return [
    ...systemMessages,
    { role: "system", content: "Older context was compacted. Use tools again if missing information is needed." },
    ...recentMessages,
  ];
}

function aggressivelyCompactMessages(messages) {
  const systemMessages = messages.filter((message) => message.role === "system");
  const recentMessages = messages
    .filter((message) => message.role !== "system")
    .slice(-5)
    .map((message) => (
      typeof message.content === "string"
        ? { ...message, content: message.content.slice(0, 3500) }
        : message
    ));

  return [
    ...systemMessages,
    { role: "system", content: "Older context was discarded because the request was too large. Reconstruct missing information with tools." },
    ...recentMessages,
  ];
}

function buildMessages(userMessage, systemPrompt, initialMessages) {
  if (Array.isArray(initialMessages) && initialMessages.length) {
    return [...initialMessages, { role: "user", content: userMessage.trim() }];
  }
  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage.trim() },
  ];
}

function assistantMessageForHistory(message) {
  const clean = {
    role: "assistant",
    content: message?.content ?? null,
  };
  if (Array.isArray(message?.tool_calls) && message.tool_calls.length) {
    clean.tool_calls = message.tool_calls;
  }
  return clean;
}

async function requestWithRecovery(messages, options = {}) {
  let currentMessages = compactMessages(messages);
  let sizeRecoveryCount = 0;

  while (true) {
    try {
      return await chatWithCloudflare(currentMessages, options);
    } catch (error) {
      if (error?.code === "CLOUDFLARE_REQUEST_TOO_LARGE" || error?.status === 413) {
        sizeRecoveryCount += 1;
        if (sizeRecoveryCount > 3) {
          throw new Error("RAVIN could not reduce the request enough after several context-compaction attempts.");
        }
        currentMessages = aggressivelyCompactMessages(currentMessages);
        continue;
      }
      throw error;
    }
  }
}

async function runConversationPath(userMessage, startedAt, {
  initialMessages = null,
  systemPrompt = CONVERSATION_SYSTEM_PROMPT,
  onToken = null,
} = {}) {
  const messages = compactMessages(buildMessages(userMessage, systemPrompt, initialMessages));
  const beforeCall = Date.now();
  const requestOptions = {
    mode: "conversation",
    tools: [],
    temperature: 0.7,
    maxTokens: CONVERSATION_MAX_TOKENS,
  };

  const assistantMessage = onToken
    ? await streamChatWithCloudflare(messages, requestOptions, onToken)
    : await requestWithRecovery(messages, requestOptions);

  const latencyMs = Date.now() - beforeCall;
  const finalContent = assistantMessage.content?.trim();
  if (!finalContent) throw new Error("Cloudflare returned no visible response content. Try again.");

  const totalTimeMs = Date.now() - startedAt;
  const meta = assistantMessage._ravinMeta || {};
  console.log(`[RAVIN perf] mode=conversation total=${totalTimeMs}ms ai=${latencyMs}ms model=${meta.routedModel || getRavinModel("conversation")}`);

  return {
    reply: finalContent,
    steps: 1,
    trace: [],
    performance: {
      mode: "conversation",
      totalMs: totalTimeMs,
      aiCalls: [{
        step: 1,
        latencyMs,
        cloudflare: meta,
        contextChars: estimateMessageChars(messages),
        toolEnabled: false,
      }],
      toolTimeMs: 0,
      contextCompactions: 0,
    },
  };
}

export async function runAgent(userMessage, {
  systemPrompt = RAVIN_SYSTEM_PROMPT,
  maxSteps = DEFAULT_MAX_STEPS,
  temperature = 0.3,
  initialMessages = null,
  onToken = null,
  mode = "conversation",
} = {}) {
  if (typeof userMessage !== "string" || !userMessage.trim()) {
    throw new Error("A user message is required.");
  }

  const selectedMode = normalizeRavinMode(mode);
  const startedAt = Date.now();

  if (selectedMode === "conversation") {
    return runConversationPath(userMessage, startedAt, {
      initialMessages,
      systemPrompt: initialMessages?.length ? systemPrompt : CONVERSATION_SYSTEM_PROMPT,
      onToken,
    });
  }

  const messages = buildMessages(userMessage, systemPrompt, initialMessages);
  const trace = [];
  const aiCalls = [];
  let toolTimeMs = 0;
  let contextCompactions = 0;

  for (let step = 1; step <= maxSteps; step += 1) {
    const beforeCall = Date.now();
    const assistantMessage = await requestWithRecovery(messages, {
      mode: "work",
      tools: TOOL_DEFINITIONS,
      toolChoice: "auto",
      temperature,
      maxTokens: 1800,
    });
    const aiCallTimeMs = Date.now() - beforeCall;

    aiCalls.push({
      step,
      latencyMs: aiCallTimeMs,
      cloudflare: assistantMessage._ravinMeta || null,
      contextChars: estimateMessageChars(messages),
      toolEnabled: TOOL_DEFINITIONS.length > 0,
    });

    const toolCalls = assistantMessage.tool_calls || [];
    if (!toolCalls.length) {
      const finalContent = assistantMessage.content?.trim();
      if (!finalContent) {
        throw new Error("RAVIN completed a reasoning step without returning a response.");
      }

      const totalTimeMs = Date.now() - startedAt;
      console.log(`[RAVIN perf] mode=work total=${totalTimeMs}ms aiCalls=${aiCalls.length} tools=${toolTimeMs}ms model=${getRavinModel("work")}`);
      return {
        reply: finalContent,
        steps: step,
        trace,
        performance: {
          mode: "work",
          totalMs: totalTimeMs,
          aiCalls,
          toolTimeMs,
          contextCompactions,
        },
      };
    }

    messages.push(assistantMessageForHistory(assistantMessage));

    for (const toolCall of toolCalls) {
      const toolName = toolCall?.function?.name || "unknown";
      trace.push({ step, type: "tool_call", tool: toolName });
      const toolStartedAt = Date.now();

      try {
        const result = await executeToolCall(toolCall);
        const elapsed = Date.now() - toolStartedAt;
        toolTimeMs += elapsed;
        trace.push({ step, type: "tool_result", tool: toolName, success: true, toolTimeMs: elapsed });
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          name: toolName,
          content: serializeToolResult(result),
        });
      } catch (error) {
        const elapsed = Date.now() - toolStartedAt;
        toolTimeMs += elapsed;
        const errorMessage = error instanceof Error ? error.message : String(error);
        trace.push({ step, type: "tool_result", tool: toolName, success: false, error: errorMessage, toolTimeMs: elapsed });
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          name: toolName,
          content: JSON.stringify({ success: false, error: errorMessage }),
        });
      }
    }

    if (estimateMessageChars(messages) > MAX_CONTEXT_CHARS) {
      const compacted = compactMessages(messages);
      messages.length = 0;
      messages.push(...compacted);
      contextCompactions += 1;
    }
  }

  throw new Error(`RAVIN reached its maximum reasoning limit of ${maxSteps} steps without completing the task.`);
}
