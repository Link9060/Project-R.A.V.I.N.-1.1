import { RAVIN_SYSTEM_PROMPT } from "./systemPrompt.js";

const DEFAULT_MAX_TOKENS = 1800;

function getConfig() {
  const baseUrl = process.env.OMNIROUTE_BASE_URL || "http://localhost:20128/v1";
  const apiKey = process.env.OMNIROUTE_API_KEY;
  const model = process.env.OMNIROUTE_MODEL || "auto/best-chat";
  const fastModel = process.env.OMNIROUTE_FAST_MODEL || "hy3-free";
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(baseUrl);
  if (!apiKey && !isLocal) throw new Error("Missing OMNIROUTE_API_KEY. Copy env.example to .env, run OmniRoute, and paste the key from Dashboard → Endpoints.");
  return { baseUrl, apiKey, model, fastModel, isLocal };
}

export async function chatWithOmniRoute(messages, { tools = [], toolChoice = tools.length > 0 ? "auto" : undefined, temperature = 0.3, maxTokens = DEFAULT_MAX_TOKENS, model = null, reasoning = undefined } = {}) {
  const config = getConfig();
  const baseUrl = config.baseUrl;
  const requestedModel = model || config.model;
  const requestStartedAt = performance.now();
  const body = { model: requestedModel, messages, temperature, max_tokens: maxTokens, stream: false };
  if (reasoning !== undefined) body.reasoning = reasoning;
  if (tools.length > 0) { body.tools = tools; body.tool_choice = toolChoice; }
  const headers = { "Content-Type": "application/json" };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

  const fetchStartedAt = performance.now();
  let response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, { method: "POST", headers, body: JSON.stringify(body) });
  } catch (networkErr) {
    throw new Error(`Couldn't reach OmniRoute. Is it running? (${networkErr.message})`);
  }
  const headersReceivedAt = performance.now();

  if (!response.ok) {
    let details = "";
    try { const errBody = await response.json(); details = errBody?.error?.message || JSON.stringify(errBody); }
    catch { details = await response.text().catch(() => ""); }
    if (response.status === 401) throw new Error("OmniRoute rejected the API key (401). Check OMNIROUTE_API_KEY.");
    if (response.status === 429) {
      let retryAfterMs = 10_000;
      const retryMatch = details.match(/try again in\s+([\d.]+)\s*s/i);
      if (retryMatch) { const seconds = Number.parseFloat(retryMatch[1]); if (Number.isFinite(seconds) && seconds >= 0) retryAfterMs = Math.ceil(seconds * 1000) + 500; }
      const error = new Error(`OmniRoute rate limit (429): ${details}`);
      error.code = "OMNIROUTE_RATE_LIMIT"; error.status = 429; error.retryAfterMs = retryAfterMs; throw error;
    }
    if (response.status === 413) { const error = new Error(`OmniRoute request too large (413): ${details}`); error.code = "OMNIROUTE_REQUEST_TOO_LARGE"; error.status = 413; throw error; }
    throw new Error(`OmniRoute API error (${response.status}): ${details}`);
  }

  const jsonStartedAt = performance.now();
  const data = await response.json();
  const bodyReadAt = performance.now();
  if (!data?.choices?.[0]?.message) throw new Error("OmniRoute returned an empty or unexpected response.");

  const message = data.choices[0].message;
  message._ravinMeta = {
    requestedModel,
    routedModel: data.model || null,
    usage: data.usage || null,
    timings: {
      requestMs: Math.round(performance.now() - requestStartedAt),
      fetchMs: Math.round(headersReceivedAt - fetchStartedAt),
      responseBodyMs: Math.round(bodyReadAt - jsonStartedAt),
    },
  };
  return message;
}

export async function askRavin(userMessage) {
  const message = await chatWithOmniRoute([{ role: "system", content: RAVIN_SYSTEM_PROMPT }, { role: "user", content: userMessage }], { temperature: 0.8, maxTokens: 1000 });
  const reply = message?.content;
  if (!reply) throw new Error("OmniRoute returned an empty response.");
  return reply.trim();
}
