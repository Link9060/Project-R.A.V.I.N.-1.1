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

function buildRequest(messages, { tools = [], toolChoice = tools.length > 0 ? "auto" : undefined, temperature = 0.3, maxTokens = DEFAULT_MAX_TOKENS, model = null, reasoning = undefined, stream = false } = {}) {
  const config = getConfig();
  const body = { model: model || config.model, messages, temperature, max_tokens: maxTokens, stream };
  if (reasoning !== undefined) body.reasoning = reasoning;
  if (tools.length > 0) { body.tools = tools; body.tool_choice = toolChoice; }
  const headers = { "Content-Type": "application/json", Accept: stream ? "text/event-stream" : "application/json" };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  return { config, body, headers };
}

async function parseError(response) {
  let details = "";
  try { const errBody = await response.json(); details = errBody?.error?.message || JSON.stringify(errBody); }
  catch { details = await response.text().catch(() => ""); }
  if (response.status === 401) throw new Error("OmniRoute rejected the API key (401). Check OMNIROUTE_API_KEY.");
  if (response.status === 429) {
    let retryAfterMs = 10_000;
    const retryMatch = details.match(/try again in\s+([\d.]+)\s*s/i);
    if (retryMatch) { const seconds = Number.parseFloat(retryMatch[1]); if (Number.isFinite(seconds) && seconds >= 0) retryAfterMs = Math.ceil(seconds * 1000) + 500; }
    const error = new Error(`OmniRoute rate limit (429): ${details}`); error.code = "OMNIROUTE_RATE_LIMIT"; error.status = 429; error.retryAfterMs = retryAfterMs; throw error;
  }
  if (response.status === 413) { const error = new Error(`OmniRoute request too large (413): ${details}`); error.code = "OMNIROUTE_REQUEST_TOO_LARGE"; error.status = 413; throw error; }
  throw new Error(`OmniRoute API error (${response.status}): ${details}`);
}

export async function chatWithOmniRoute(messages, options = {}) {
  const { config, body, headers } = buildRequest(messages, options);
  const requestedModel = body.model;
  const requestStartedAt = performance.now();
  let response;
  try { response = await fetch(`${config.baseUrl}/chat/completions`, { method: "POST", headers, body: JSON.stringify(body) }); }
  catch (networkErr) { throw new Error(`Couldn't reach OmniRoute. Is it running? (${networkErr.message})`); }
  const headersReceivedAt = performance.now();
  if (!response.ok) await parseError(response);
  const jsonStartedAt = performance.now();
  const data = await response.json();
  const bodyReadAt = performance.now();
  if (!data?.choices?.[0]?.message) throw new Error("OmniRoute returned an empty or unexpected response.");
  const message = data.choices[0].message;
  message._ravinMeta = { requestedModel, routedModel: data.model || null, usage: data.usage || null, timings: { requestMs: Math.round(performance.now() - requestStartedAt), fetchMs: Math.round(headersReceivedAt - requestStartedAt), responseBodyMs: Math.round(bodyReadAt - jsonStartedAt) } };
  return message;
}

export async function streamChatWithOmniRoute(messages, options = {}, onToken = null) {
  const { config, body, headers } = buildRequest(messages, { ...options, stream: true });
  const requestedModel = body.model;
  const requestStartedAt = performance.now();
  let response;
  try { response = await fetch(`${config.baseUrl}/chat/completions`, { method: "POST", headers, body: JSON.stringify(body) }); }
  catch (networkErr) { throw new Error(`Couldn't reach OmniRoute. Is it running? (${networkErr.message})`); }
  if (!response.ok) await parseError(response);
  if (!response.body) throw new Error("OmniRoute did not return a streaming response body.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", content = "", routedModel = null, usage = null, firstTokenMs = null, streamDone = false;
  const processLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith("data:")) return;
    const payload = trimmed.slice(5).trim();
    if (payload === "[DONE]") { streamDone = true; return; }
    let chunk; try { chunk = JSON.parse(payload); } catch { return; }
    routedModel ||= chunk.model || null; usage ||= chunk.usage || null;
    const token = chunk.choices?.[0]?.delta?.content || "";
    if (token) { if (firstTokenMs === null) firstTokenMs = Math.round(performance.now() - requestStartedAt); content += token; if (onToken) onToken(token); }
  };
  while (!streamDone) {
    const { value, done } = await reader.read();
    if (done) { buffer += decoder.decode(); break; }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/); buffer = lines.pop() || "";
    for (const line of lines) processLine(line);
  }
  if (buffer) processLine(buffer);
  if (!content.trim()) throw new Error("OmniRoute completed a stream without returning content.");
  return { content, _ravinMeta: { requestedModel, routedModel, usage, streaming: true, timings: { totalMs: Math.round(performance.now() - requestStartedAt), firstTokenMs } } };
}

export async function askRavin(userMessage) {
  const message = await chatWithOmniRoute([{ role: "system", content: RAVIN_SYSTEM_PROMPT }, { role: "user", content: userMessage }], { temperature: 0.8, maxTokens: 1000 });
  const reply = message?.content;
  if (!reply) throw new Error("OmniRoute returned an empty response.");
  return reply.trim();
}
