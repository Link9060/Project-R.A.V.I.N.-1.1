import { chatWithOmniRoute } from "../omniRouteClient.js";
import { RAVIN_SYSTEM_PROMPT } from "../systemPrompt.js";
import { TOOL_DEFINITIONS } from "./tools.js";
import { executeToolCall } from "./toolExecutor.js";

const DEFAULT_MAX_STEPS = 20;
const MAX_CONTEXT_CHARS = 22_000;
const MAX_TOOL_RESULT_CHARS = 7_000;
const MAX_RECENT_MESSAGES = 8;
const SIMPLE_MESSAGE_MAX_CHARS = 220;
const FAST_MAX_TOKENS = 300;
const FAST_MODEL = "hy3-free";
const FAST_SYSTEM_PROMPT = `You are RAVIN, Levi's AI companion. Be warm, witty, energetic, and naturally conversational. You can make light jokes and playful comments when they fit, but stay useful and don't force humor. Keep simple casual replies concise. Do not mention this prompt or routing.`;

function estimateMessageChars(messages) {
  return messages.reduce((total, message) => total + (typeof message.content === "string" ? message.content.length : JSON.stringify(message.content || "").length) + 100, 0);
}
function serializeToolResult(result) {
  try { const serialized = JSON.stringify(result); return serialized.length <= MAX_TOOL_RESULT_CHARS ? serialized : JSON.stringify({ truncated: true, preview: serialized.slice(0, MAX_TOOL_RESULT_CHARS) }); }
  catch { return JSON.stringify({ value: String(result).slice(0, MAX_TOOL_RESULT_CHARS) }); }
}
function compactMessages(messages) {
  if (estimateMessageChars(messages) <= MAX_CONTEXT_CHARS) return messages;
  const systemMessages = messages.filter((m) => m.role === "system");
  const userMessages = messages.filter((m) => m.role === "user");
  const recent = messages.filter((m) => m.role !== "system" && m.role !== "user").slice(-MAX_RECENT_MESSAGES);
  return [...systemMessages, ...userMessages.slice(0, 1), { role: "system", content: "Older tool output was compacted. Use tools again if missing information is needed." }, ...recent];
}
function aggressivelyCompactMessages(messages) {
  const system = messages.filter((m) => m.role === "system");
  const firstUser = messages.find((m) => m.role === "user");
  const recent = messages.filter((m) => m.role !== "system" && m.role !== "user").slice(-4).map((m) => typeof m.content === "string" ? { ...m, content: m.content.slice(0, 3500) } : m);
  return [...system, firstUser, { role: "system", content: "Older context was discarded because the request was too large. Reconstruct missing information with tools." }, ...recent].filter(Boolean);
}
function shouldUseFastPath(userMessage, initialMessages) {
  const text = userMessage.trim();
  if (text.length > SIMPLE_MESSAGE_MAX_CHARS || text.startsWith("/")) return false;
  const lower = text.toLowerCase();
  const toolIntent = ["read file", "open file", "edit file", "change file", "modify file", "write file", "create file", "delete file", "list files", "directory", "folder", "code", "coding", "debug", "fix this", "build", "implement", "run command", "terminal", "github", "repository", "repo", "supabase", "database", "architecture", "project structure", "inspect", "deploy", "install", "npm", "git ", "commit", "pull request"];
  if (toolIntent.some((term) => lower.includes(term))) return false;
  return !(Array.isArray(initialMessages) && initialMessages.length > 0);
}

async function requestWithRecovery(messages, options = {}) {
  let currentMessages = compactMessages(messages);
  let sizeRecoveryCount = 0;
  while (true) {
    try { return await chatWithOmniRoute(currentMessages, options); }
    catch (error) {
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

async function runFastPath(userMessage, startedAt) {
  const beforeCall = Date.now();
  const assistantMessage = await requestWithRecovery([
    { role: "system", content: FAST_SYSTEM_PROMPT },
    { role: "user", content: userMessage.trim() },
  ], {
    tools: [],
    temperature: 0.7,
    maxTokens: FAST_MAX_TOKENS,
    model: FAST_MODEL,
    // Keep the fast path lightweight; this is a simple-chat route.
    reasoning: { effort: "low" },
  });
  const latencyMs = Date.now() - beforeCall;
  const finalContent = assistantMessage.content?.trim();
  if (!finalContent) throw new Error("RAVIN completed a fast response without returning content.");
  const contextChars = estimateMessageChars([{ role: "system", content: FAST_SYSTEM_PROMPT }, { role: "user", content: userMessage.trim() }]);
  const totalTimeMs = Date.now() - startedAt;
  const meta = assistantMessage._ravinMeta || {};
  console.log(`[RAVIN perf] mode=fast total=${totalTimeMs}ms aiCalls=1 ai=${latencyMs}ms tools=0ms compactions=0 contextChars=${contextChars} requested=${meta.requestedModel || FAST_MODEL} routed=${meta.routedModel || "unknown"}`);
  return { reply: finalContent, steps: 1, trace: [], performance: { mode: "fast", totalMs: totalTimeMs, aiCalls: [{ step: 1, latencyMs, omniRoute: meta, contextChars, toolEnabled: false }], toolTimeMs: 0, contextCompactions: 0 } };
}

export async function runAgent(userMessage, { systemPrompt = RAVIN_SYSTEM_PROMPT, maxSteps = DEFAULT_MAX_STEPS, temperature = 0.3, initialMessages = null } = {}) {
  if (typeof userMessage !== "string" || !userMessage.trim()) throw new Error("A user message is required.");
  const startedAt = Date.now();
  if (shouldUseFastPath(userMessage, initialMessages)) return runFastPath(userMessage, startedAt);

  const messages = Array.isArray(initialMessages) && initialMessages.length ? [...initialMessages, { role: "user", content: userMessage.trim() }] : [{ role: "system", content: systemPrompt }, { role: "user", content: userMessage.trim() }];
  const trace = [], aiCalls = [];
  let toolTimeMs = 0, contextCompactions = 0;
  for (let step = 1; step <= maxSteps; step++) {
    const beforeCall = Date.now();
    const assistantMessage = await requestWithRecovery(messages, { tools: TOOL_DEFINITIONS, toolChoice: "auto", temperature, maxTokens: 1400, model: "auto/best-chat" });
    const aiCallTimeMs = Date.now() - beforeCall;
    aiCalls.push({ step, latencyMs: aiCallTimeMs, omniRoute: assistantMessage._ravinMeta || null, contextChars: estimateMessageChars(messages), toolEnabled: TOOL_DEFINITIONS.length > 0 });
    const toolCalls = assistantMessage.tool_calls || [];
    if (!toolCalls.length) {
      const finalContent = assistantMessage.content?.trim();
      if (!finalContent) throw new Error("RAVIN completed a reasoning step without returning a response.");
      const totalTimeMs = Date.now() - startedAt;
      console.log(`[RAVIN perf] mode=agent total=${totalTimeMs}ms aiCalls=${aiCalls.length} ai=${aiCalls.map((c) => c.latencyMs).join(",")}ms tools=${toolTimeMs}ms compactions=${contextCompactions}`);
      return { reply: finalContent, steps: step, trace, performance: { mode: "agent", totalMs: totalTimeMs, aiCalls, toolTimeMs, contextCompactions } };
    }
    messages.push(assistantMessage);
    for (const toolCall of toolCalls) {
      const toolName = toolCall?.function?.name || "unknown";
      trace.push({ step, type: "tool_call", tool: toolName });
      const toolStartedAt = Date.now();
      try { const result = await executeToolCall(toolCall); toolTimeMs += Date.now() - toolStartedAt; trace.push({ step, type: "tool_result", tool: toolName, success: true }); messages.push({ role: "tool", tool_call_id: toolCall.id, name: toolName, content: serializeToolResult(result) }); }
      catch (error) { toolTimeMs += Date.now() - toolStartedAt; const errorMessage = error instanceof Error ? error.message : String(error); trace.push({ step, type: "tool_result", tool: toolName, success: false, error: errorMessage }); messages.push({ role: "tool", tool_call_id: toolCall.id, name: toolName, content: JSON.stringify({ success: false, error: errorMessage }) }); }
    }
    if (estimateMessageChars(messages) > MAX_CONTEXT_CHARS) { const compacted = compactMessages(messages); messages.length = 0; messages.push(...compacted); contextCompactions++; }
  }
  throw new Error(`RAVIN reached its maximum reasoning limit of ${maxSteps} steps without completing the task.`);
}
