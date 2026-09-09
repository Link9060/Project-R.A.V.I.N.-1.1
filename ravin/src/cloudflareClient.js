import { RAVIN_SYSTEM_PROMPT } from "./systemPrompt.js";

const DEFAULT_MAX_TOKENS = 1800;
const STREAM_TIMEOUT_MS = 60_000;

export const RAVIN_MODELS = Object.freeze({
  conversation: process.env.CLOUDFLARE_CONVERSATION_MODEL || "@cf/ibm-granite/granite-4.0-h-micro",
  work: process.env.CLOUDFLARE_WORK_MODEL || "@cf/google/gemma-4-26b-a4b-it",
});

export function normalizeRavinMode(mode) {
  return String(mode || "").toLowerCase() === "work" ? "work" : "conversation";
}

export function getRavinModel(mode = "conversation") {
  return RAVIN_MODELS[normalizeRavinMode(mode)];
}

function getConfig() {
  const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  const apiToken = String(process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_API_KEY || "").trim();

  if (!accountId) {
    throw new Error("Missing CLOUDFLARE_ACCOUNT_ID. Add your Cloudflare Account ID to the RAVIN environment variables.");
  }
  if (!apiToken) {
    throw new Error("Missing CLOUDFLARE_API_TOKEN. Create a Workers AI API token and add it to the RAVIN environment variables.");
  }

  return {
    accountId,
    apiToken,
    baseUrl: `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/v1`,
  };
}

function buildRequest(messages, {
  mode = "conversation",
  tools = [],
  toolChoice = tools.length > 0 ? "auto" : undefined,
  temperature = 0.3,
  maxTokens = DEFAULT_MAX_TOKENS,
  model = null,
  stream = false,
} = {}) {
  const config = getConfig();
  const requestedMode = normalizeRavinMode(mode);
  const requestedModel = model || getRavinModel(requestedMode);
  const body = {
    model: requestedModel,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream,
  };

  if (tools.length > 0) {
    body.tools = tools;
    body.tool_choice = toolChoice;
  }

  return {
    config,
    requestedMode,
    requestedModel,
    body,
    headers: {
      Authorization: `Bearer ${config.apiToken}`,
      "Content-Type": "application/json",
      Accept: stream ? "text/event-stream" : "application/json",
    },
  };
}

async function parseError(response) {
  let details = "";
  try {
    const body = await response.json();
    details = body?.errors?.[0]?.message || body?.error?.message || body?.error || JSON.stringify(body);
  } catch {
    details = await response.text().catch(() => "");
  }

  if (response.status === 401) {
    const error = new Error("Cloudflare rejected the Workers AI API token (401). Check CLOUDFLARE_API_TOKEN.");
    error.code = "CLOUDFLARE_AUTH";
    error.status = 401;
    throw error;
  }
  if (response.status === 403) {
    const error = new Error(`Cloudflare denied this Workers AI request (403). Check token permissions and model access. ${details}`.trim());
    error.code = "CLOUDFLARE_FORBIDDEN";
    error.status = 403;
    throw error;
  }
  if (response.status === 429) {
    const retryAfterSeconds = Number(response.headers.get("retry-after") || 0);
    const error = new Error(`Cloudflare Workers AI rate limit (429): ${details}`);
    error.code = "CLOUDFLARE_RATE_LIMIT";
    error.status = 429;
    error.retryAfterMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : 10_000;
    throw error;
  }
  if (response.status === 413) {
    const error = new Error(`Cloudflare Workers AI request too large (413): ${details}`);
    error.code = "CLOUDFLARE_REQUEST_TOO_LARGE";
    error.status = 413;
    throw error;
  }

  const error = new Error(`Cloudflare Workers AI error (${response.status}): ${details}`);
  error.code = "CLOUDFLARE_API_ERROR";
  error.status = response.status;
  throw error;
}

export async function chatWithCloudflare(messages, options = {}) {
  const { config, requestedMode, requestedModel, body, headers } = buildRequest(messages, options);
  const requestStartedAt = performance.now();
  let response;

  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (networkError) {
    throw new Error(`Couldn't reach Cloudflare Workers AI. ${networkError?.message || networkError}`);
  }

  const headersReceivedAt = performance.now();
  if (!response.ok) await parseError(response);

  const bodyStartedAt = performance.now();
  const data = await response.json();
  const bodyReadAt = performance.now();
  const message = data?.choices?.[0]?.message;
  if (!message) throw new Error("Cloudflare Workers AI returned an empty or unexpected response.");

  message._ravinMeta = {
    provider: "cloudflare-workers-ai",
    mode: requestedMode,
    requestedModel,
    routedModel: data.model || requestedModel,
    usage: data.usage || null,
    timings: {
      requestMs: Math.round(performance.now() - requestStartedAt),
      fetchMs: Math.round(headersReceivedAt - requestStartedAt),
      responseBodyMs: Math.round(bodyReadAt - bodyStartedAt),
    },
  };

  return message;
}

export async function streamChatWithCloudflare(messages, options = {}, onToken = null) {
  const { config, requestedMode, requestedModel, body, headers } = buildRequest(messages, { ...options, stream: true });
  const requestStartedAt = performance.now();
  let response;

  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(STREAM_TIMEOUT_MS),
    });
  } catch (networkError) {
    if (networkError?.name === "TimeoutError") {
      throw new Error(`Cloudflare Workers AI streaming timed out after ${STREAM_TIMEOUT_MS / 1000}s.`);
    }
    throw new Error(`Couldn't reach Cloudflare Workers AI. ${networkError?.message || networkError}`);
  }

  if (!response.ok) await parseError(response);
  if (!response.body) throw new Error("Cloudflare Workers AI did not return a streaming response body.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let routedModel = null;
  let usage = null;
  let firstTokenMs = null;
  let streamDone = false;

  const appendContent = (value) => {
    if (!value) return;
    if (firstTokenMs === null) firstTokenMs = Math.round(performance.now() - requestStartedAt);
    content += value;
    if (onToken) onToken(value);
  };

  const processEvent = (event) => {
    const dataLines = event.split(/\r?\n/).filter((line) => line.startsWith("data:"));
    if (!dataLines.length) return;
    const payload = dataLines.map((line) => line.slice(5).trimStart()).join("\n").trim();
    if (!payload) return;
    if (payload === "[DONE]") {
      streamDone = true;
      return;
    }

    let chunk;
    try {
      chunk = JSON.parse(payload);
    } catch {
      return;
    }

    routedModel ||= chunk.model || null;
    usage ||= chunk.usage || null;
    const delta = chunk.choices?.[0]?.delta;
    if (typeof delta?.content === "string") appendContent(delta.content);
  };

  while (!streamDone) {
    const { value, done } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() || "";
    for (const event of events) processEvent(event);
  }
  if (buffer) processEvent(buffer);
  try { reader.releaseLock(); } catch {}

  if (!content.trim()) {
    const fallback = await chatWithCloudflare(messages, options);
    if (!fallback?.content?.trim()) throw new Error("Cloudflare Workers AI returned no visible response content.");
    return fallback;
  }

  return {
    content,
    _ravinMeta: {
      provider: "cloudflare-workers-ai",
      mode: requestedMode,
      requestedModel,
      routedModel: routedModel || requestedModel,
      usage,
      streaming: true,
      timings: {
        totalMs: Math.round(performance.now() - requestStartedAt),
        firstTokenMs,
      },
    },
  };
}

export async function askRavin(userMessage, { mode = "conversation" } = {}) {
  const message = await chatWithCloudflare([
    { role: "system", content: RAVIN_SYSTEM_PROMPT },
    { role: "user", content: userMessage },
  ], { mode, temperature: 0.8, maxTokens: 1000 });

  const reply = message?.content;
  if (!reply) throw new Error("Cloudflare Workers AI returned an empty response.");
  return reply.trim();
}
