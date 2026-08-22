import { RAVIN_SYSTEM_PROMPT } from "./systemPrompt.js";

const DEFAULT_MAX_TOKENS = 1800;

function getConfig() {
  const baseUrl = process.env.OMNIROUTE_BASE_URL || "http://localhost:20128/v1";
  const apiKey = process.env.OMNIROUTE_API_KEY;
  const model = process.env.OMNIROUTE_MODEL || "auto/best-chat";

  if (!apiKey) {
    throw new Error(
      "Missing OMNIROUTE_API_KEY. Copy env.example to .env, run OmniRoute, and paste the key from Dashboard → Endpoints."
    );
  }

  return { baseUrl, apiKey, model };
}

/**
 * Send a conversation to OmniRoute (self-hosted, OpenAI-compatible gateway).
 * Agent/tool logic lives elsewhere.
 *
 * The returned assistant message carries non-model metadata under `_ravinMeta`
 * so the agent can measure latency without changing the OpenAI message shape.
 */
export async function chatWithOmniRoute(
  messages,
  {
    tools = [],
    toolChoice = tools.length > 0 ? "auto" : undefined,
    temperature = 0.3,
    maxTokens = DEFAULT_MAX_TOKENS,
  } = {}
) {
  const { baseUrl, apiKey, model } = getConfig();
  const startedAt = Date.now();

  const body = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: false,
  };

  if (tools.length > 0) {
    body.tools = tools;
    body.tool_choice = toolChoice;
  }

  let response;

  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (networkErr) {
    throw new Error(
      `Couldn't reach OmniRoute. Is it running? (npx omniroute or docker run ...) (${networkErr.message})`
    );
  }

  const latencyMs = Date.now() - startedAt;

  if (!response.ok) {
    let details = "";

    try {
      const errBody = await response.json();
      details = errBody?.error?.message || JSON.stringify(errBody);
    } catch {
      details = await response.text().catch(() => "");
    }

    if (response.status === 401) {
      throw new Error(
        "OmniRoute rejected the API key (401). Check OMNIROUTE_API_KEY in .env against Dashboard → Endpoints."
      );
    }

    if (response.status === 429) {
      let retryAfterMs = 10_000;
      const retryMatch = details.match(/try again in\s+([\d.]+)\s*s/i);

      if (retryMatch) {
        const seconds = Number.parseFloat(retryMatch[1]);
        if (Number.isFinite(seconds) && seconds >= 0) retryAfterMs = Math.ceil(seconds * 1000) + 500;
      }

      const error = new Error(`OmniRoute rate limit (429): ${details}`);
      error.code = "OMNIROUTE_RATE_LIMIT";
      error.status = 429;
      error.retryAfterMs = retryAfterMs;
      throw error;
    }

    if (response.status === 413) {
      const error = new Error(`OmniRoute request too large (413): ${details}`);
      error.code = "OMNIROUTE_REQUEST_TOO_LARGE";
      error.status = 413;
      throw error;
    }

    throw new Error(`OmniRoute API error (${response.status}): ${details}`);
  }

  const data = await response.json();

  if (!data?.choices?.[0]?.message) {
    throw new Error("OmniRoute returned an empty or unexpected response.");
  }

  const message = data.choices[0].message;
  message._ravinMeta = {
    latencyMs,
    requestedModel: model,
    routedModel: data.model || null,
    usage: data.usage || null,
  };

  return message;
}

/**
 * Backwards-compatible simple chat helper.
 */
export async function askRavin(userMessage) {
  const message = await chatWithOmniRoute(
    [
      { role: "system", content: RAVIN_SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    { temperature: 0.8, maxTokens: 1000 }
  );

  const reply = message?.content;
  if (!reply) throw new Error("OmniRoute returned an empty response.");
  return reply.trim();
}
