import { RAVIN_SYSTEM_PROMPT } from "./systemPrompt.js";

const GROQ_URL =
  "https://api.groq.com/openai/v1/chat/completions";

const DEFAULT_MAX_TOKENS = 1800;

function getConfig() {
  const apiKey = process.env.GROQ_API_KEY;
  const model =
    process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

  if (!apiKey) {
    throw new Error(
      "Missing GROQ_API_KEY. Copy .env.example to .env and add your Groq API key."
    );
  }

  return { apiKey, model };
}

/**
 * Send a conversation to Groq.
 *
 * This function only handles communication with Groq.
 * Agent/tool logic lives elsewhere.
 */
export async function chatWithGroq(
  messages,
  {
    tools = [],
    toolChoice =
      tools.length > 0 ? "auto" : undefined,
    temperature = 0.3,
    maxTokens = DEFAULT_MAX_TOKENS,
  } = {}
) {
  const { apiKey, model } = getConfig();

  const body = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };

  if (tools.length > 0) {
    body.tools = tools;
    body.tool_choice = toolChoice;
  }

  let response;

  try {
    response = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (networkErr) {
    throw new Error(
      `Couldn't reach Groq's servers. Check your internet connection. (${networkErr.message})`
    );
  }

  if (!response.ok) {
    let details = "";

    try {
      const errBody = await response.json();

      details =
        errBody?.error?.message ||
        JSON.stringify(errBody);
    } catch {
      details =
        await response.text().catch(() => "");
    }

    if (response.status === 401) {
      throw new Error(
        "Groq rejected the API key (401). Double-check GROQ_API_KEY in .env."
      );
    }

    if (response.status === 429) {
      let retryAfterMs = 10_000;

      const retryMatch = details.match(
        /try again in\s+([\d.]+)\s*s/i
      );

      if (retryMatch) {
        const seconds = Number.parseFloat(
          retryMatch[1]
        );

        if (
          Number.isFinite(seconds) &&
          seconds >= 0
        ) {
          retryAfterMs =
            Math.ceil(seconds * 1000) + 500;
        }
      }

      const error = new Error(
        `Groq rate limit (429): ${details}`
      );

      error.code = "GROQ_RATE_LIMIT";
      error.status = 429;
      error.retryAfterMs = retryAfterMs;

      throw error;
    }

    if (response.status === 413) {
      const error = new Error(
        `Groq request too large (413): ${details}`
      );

      error.code = "GROQ_REQUEST_TOO_LARGE";
      error.status = 413;

      throw error;
    }

    throw new Error(
      `Groq API error (${response.status}): ${details}`
    );
  }

  const data = await response.json();

  if (!data?.choices?.[0]?.message) {
    throw new Error(
      "Groq returned an empty or unexpected response."
    );
  }

  return data.choices[0].message;
}

/**
 * Backwards-compatible simple chat helper.
 */
export async function askRavin(userMessage) {
  const message = await chatWithGroq(
    [
      {
        role: "system",
        content: RAVIN_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: userMessage,
      },
    ],
    {
      temperature: 0.8,
      maxTokens: 1000,
    }
  );

  const reply = message?.content;

  if (!reply) {
    throw new Error(
      "Groq returned an empty response."
    );
  }

  return reply.trim();
}