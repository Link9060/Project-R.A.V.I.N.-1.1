import { chatWithCloudflare, getRavinModel } from "../cloudflareClient.js";
import { DEVELOPER_TOOL_DEFINITIONS } from "./developerTools.js";
import { executeToolCall } from "./toolExecutor.js";

const MAX_TOOL_RESULT_CHARS = 7_000;
const MAX_CONTEXT_CHARS = 26_000;

function messageSize(messages) {
  return messages.reduce((sum, message) => sum + (typeof message.content === "string" ? message.content.length : JSON.stringify(message.content || "").length) + 120, 0);
}

function serializeResult(result) {
  try {
    const value = JSON.stringify(result);
    return value.length <= MAX_TOOL_RESULT_CHARS
      ? value
      : JSON.stringify({ truncated: true, preview: value.slice(0, MAX_TOOL_RESULT_CHARS) });
  } catch {
    return JSON.stringify({ value: String(result).slice(0, MAX_TOOL_RESULT_CHARS) });
  }
}

function compact(messages) {
  if (messageSize(messages) <= MAX_CONTEXT_CHARS) return messages;
  const system = messages.filter((message) => message.role === "system");
  const recent = messages.filter((message) => message.role !== "system").slice(-10);
  return [...system, { role: "system", content: "Older developer-agent context was compacted. Re-read project files when details are needed." }, ...recent];
}

export async function runDeveloperAgent(userMessage, {
  systemPrompt,
  maxSteps = 24,
  temperature = 0.2,
} = {}) {
  if (!userMessage?.trim()) throw new Error("A developer task is required.");
  if (!systemPrompt?.trim()) throw new Error("A developer system prompt is required.");

  const startedAt = Date.now();
  let messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage.trim() },
  ];
  const trace = [];

  for (let step = 1; step <= maxSteps; step += 1) {
    messages = compact(messages);
    const assistant = await chatWithCloudflare(messages, {
      mode: "work",
      tools: DEVELOPER_TOOL_DEFINITIONS,
      toolChoice: "auto",
      temperature,
      maxTokens: 1900,
    });

    const toolCalls = assistant.tool_calls || [];
    if (!toolCalls.length) {
      const reply = assistant.content?.trim();
      if (!reply) throw new Error("Developer agent completed without returning a visible response.");
      return {
        reply,
        steps: step,
        trace,
        performance: {
          mode: "developer",
          model: assistant?._ravinMeta?.routedModel || getRavinModel("work"),
          totalMs: Date.now() - startedAt,
        },
      };
    }

    messages.push({ role: "assistant", content: assistant.content ?? null, tool_calls: toolCalls });

    for (const toolCall of toolCalls) {
      const toolName = toolCall?.function?.name || "unknown";
      trace.push({ step, type: "tool_call", tool: toolName });
      try {
        const result = await executeToolCall(toolCall);
        trace.push({ step, type: "tool_result", tool: toolName, success: true });
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          name: toolName,
          content: serializeResult(result),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        trace.push({ step, type: "tool_result", tool: toolName, success: false, error: message });
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          name: toolName,
          content: JSON.stringify({ success: false, error: message }),
        });
      }
    }
  }

  throw new Error(`RAVIN developer agent reached its ${maxSteps}-step limit without finishing.`);
}
