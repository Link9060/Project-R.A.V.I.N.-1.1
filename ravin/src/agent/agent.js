import { chatWithGroq } from "../groqClient.js";
import { RAVIN_SYSTEM_PROMPT } from "../systemPrompt.js";
import { TOOL_DEFINITIONS } from "./tools.js";
import { executeToolCall } from "./toolExecutor.js";

const DEFAULT_MAX_STEPS = 20;

const DEFAULT_RATE_LIMIT_WAIT_MS = 10_000;

/*
 * These limits are deliberately conservative because
 * the current Groq GPT-OSS 120B tier has an 8,000 TPM
 * limit.
 *
 * We don't want to constantly approach the hard limit.
 */
const MAX_CONTEXT_CHARS = 22_000;

const MAX_TOOL_RESULT_CHARS = 7_000;

const MAX_RECENT_MESSAGES = 8;

function sleep(ms) {
  return new Promise((resolve) =>
    setTimeout(resolve, ms)
  );
}

/**
 * Convert a tool result into a compact string.
 */
function serializeToolResult(result) {
  try {
    const serialized = JSON.stringify(result);

    if (
      serialized.length <=
      MAX_TOOL_RESULT_CHARS
    ) {
      return serialized;
    }

    return JSON.stringify({
      truncated: true,
      message:
        "Tool result was truncated to keep the agent context manageable.",
      preview: serialized.slice(
        0,
        MAX_TOOL_RESULT_CHARS
      ),
    });
  } catch {
    return JSON.stringify({
      value: String(result).slice(
        0,
        MAX_TOOL_RESULT_CHARS
      ),
    });
  }
}

/**
 * Estimate the size of the messages we are about
 * to send.
 *
 * This is intentionally a rough estimate.
 * The actual tokenizer is model-specific.
 */
function estimateMessageChars(messages) {
  return messages.reduce(
    (total, message) => {
      const content =
        typeof message.content === "string"
          ? message.content
          : JSON.stringify(
              message.content || ""
            );

      const toolCalls =
        message.tool_calls
          ? JSON.stringify(
              message.tool_calls
            )
          : "";

      return (
        total +
        content.length +
        toolCalls.length +
        100
      );
    },
    0
  );
}

/**
 * Create a compact version of the conversation.
 *
 * We preserve:
 * - system instructions
 * - original user request
 * - recent agent/tool activity
 *
 * We remove:
 * - very old tool output
 * - duplicated historical context
 * - oversized tool results
 */
function compactMessages(messages) {
  if (!Array.isArray(messages)) {
    return messages;
  }

  if (
    estimateMessageChars(messages) <=
    MAX_CONTEXT_CHARS
  ) {
    return messages;
  }

  const systemMessages = messages.filter(
    (message) =>
      message.role === "system"
  );

  const userMessages = messages.filter(
    (message) =>
      message.role === "user"
  );

  const recentMessages =
    messages
      .filter(
        (message) =>
          message.role !== "system" &&
          message.role !== "user"
      )
      .slice(-MAX_RECENT_MESSAGES);

  const compacted = [
    ...systemMessages,
    ...userMessages.slice(0, 1),
    {
      role: "system",
      content:
        "CONTEXT COMPACTION NOTICE: Older tool outputs were removed because the request context became too large. Continue the task using the preserved recent context and inspect files again with tools whenever older information is needed.",
    },
    ...recentMessages,
  ];

  return compacted;
}

/**
 * If a request is rejected as too large, aggressively
 * compact the conversation.
 */
function aggressivelyCompactMessages(messages) {
  const systemMessages = messages.filter(
    (message) =>
      message.role === "system"
  );

  const firstUserMessage =
    messages.find(
      (message) =>
        message.role === "user"
    );

  const recentMessages =
    messages
      .filter(
        (message) =>
          message.role !== "system" &&
          message.role !== "user"
      )
      .slice(-4)
      .map((message) => {
        if (
          typeof message.content ===
          "string"
        ) {
          return {
            ...message,
            content:
              message.content.slice(
                0,
                3500
              ),
          };
        }

        return message;
      });

  return [
    ...systemMessages,
    firstUserMessage,
    {
      role: "system",
      content:
        "IMPORTANT: The previous context became too large for the model. Older tool output has been discarded. Reconstruct missing information by using the available tools. Continue the user's task; do not restart it unnecessarily.",
    },
    ...recentMessages,
  ].filter(Boolean);
}

/**
 * Make a Groq request with automatic recovery.
 *
 * 429:
 *   Wait and retry.
 *
 * 413:
 *   Compact context and retry.
 */
async function requestGroqWithRecovery(
  messages,
  options = {}
) {
  let currentMessages =
    compactMessages(messages);

  let rateLimitRetryCount = 0;
  let sizeRecoveryCount = 0;

  while (true) {
    try {
      return await chatWithGroq(
        currentMessages,
        options
      );
    } catch (error) {
      /*
       * Temporary Groq rate limit.
       */
      if (
        error?.code ===
          "GROQ_RATE_LIMIT" ||
        error?.status === 429
      ) {
        rateLimitRetryCount++;

        const waitMs =
          Number.isFinite(
            error.retryAfterMs
          ) &&
          error.retryAfterMs >= 0
            ? error.retryAfterMs
            : DEFAULT_RATE_LIMIT_WAIT_MS;

        const waitSeconds = Math.ceil(
          waitMs / 1000
        );

        console.log(
          `\nRAVIN: Groq rate limit reached. Waiting ${waitSeconds}s, then continuing work...`
        );

        console.log(
          `RAVIN: Rate-limit retry #${rateLimitRetryCount}.`
        );

        await sleep(waitMs);

        console.log(
          "RAVIN: Rate-limit wait finished. Continuing...\n"
        );

        continue;
      }

      /*
       * Request too large.
       *
       * Compact the conversation and retry.
       */
      if (
        error?.code ===
          "GROQ_REQUEST_TOO_LARGE" ||
        error?.status === 413
      ) {
        sizeRecoveryCount++;

        if (sizeRecoveryCount > 3) {
          throw new Error(
            "RAVIN could not reduce the Groq request enough after several context-compaction attempts."
          );
        }

        console.log(
          "\nRAVIN: Groq rejected the request because the context is too large."
        );

        console.log(
          "RAVIN: Compacting older context and continuing..."
        );

        currentMessages =
          aggressivelyCompactMessages(
            currentMessages
          );

        continue;
      }

      throw error;
    }
  }
}

export async function runAgent(
  userMessage,
  {
    systemPrompt = RAVIN_SYSTEM_PROMPT,
    maxSteps = DEFAULT_MAX_STEPS,
    temperature = 0.3,
  } = {}
) {
  if (
    typeof userMessage !== "string" ||
    !userMessage.trim()
  ) {
    throw new Error(
      "A user message is required."
    );
  }

  const messages = [
    {
      role: "system",
      content: systemPrompt,
    },
    {
      role: "user",
      content: userMessage.trim(),
    },
  ];

  const trace = [];

  for (
    let step = 1;
    step <= maxSteps;
    step++
  ) {
    /*
     * Make the next reasoning request.
     *
     * Rate limits and oversized contexts are
     * automatically recovered inside this function.
     */
    const assistantMessage =
      await requestGroqWithRecovery(
        messages,
        {
          tools: TOOL_DEFINITIONS,
          toolChoice: "auto",
          temperature,
          maxTokens: 1400,
        }
      );

    const toolCalls =
      assistantMessage.tool_calls || [];

    /*
     * No tools means the model has finished.
     */
    if (toolCalls.length === 0) {
      const finalContent =
        assistantMessage.content?.trim();

      if (!finalContent) {
        throw new Error(
          "RAVIN completed a reasoning step without returning a response."
        );
      }

      return {
        reply: finalContent,
        steps: step,
        trace,
      };
    }

    /*
     * Preserve the assistant's tool call.
     */
    messages.push(
      assistantMessage
    );

    /*
     * Execute every tool requested by the model.
     */
    for (const toolCall of toolCalls) {
      const toolName =
        toolCall?.function?.name ||
        "unknown";

      trace.push({
        step,
        type: "tool_call",
        tool: toolName,
      });

      try {
        const result =
          await executeToolCall(
            toolCall
          );

        trace.push({
          step,
          type: "tool_result",
          tool: toolName,
          success: true,
        });

        messages.push({
          role: "tool",
          tool_call_id:
            toolCall.id,
          name: toolName,
          content:
            serializeToolResult(
              result
            ),
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : String(error);

        trace.push({
          step,
          type: "tool_result",
          tool: toolName,
          success: false,
          error: errorMessage,
        });

        messages.push({
          role: "tool",
          tool_call_id:
            toolCall.id,
          name: toolName,
          content: JSON.stringify({
            success: false,
            error: errorMessage,
          }),
        });
      }
    }

    /*
     * Compact the conversation after tool
     * execution if it has become too large.
     */
    if (
      estimateMessageChars(
        messages
      ) > MAX_CONTEXT_CHARS
    ) {
      const compacted =
        compactMessages(messages);

      messages.length = 0;

      messages.push(...compacted);

      console.log(
        "RAVIN: Older tool context compacted to keep the next reasoning request small."
      );
    }
  }

  throw new Error(
    `RAVIN reached its maximum reasoning limit of ${maxSteps} steps without completing the task.`
  );
}