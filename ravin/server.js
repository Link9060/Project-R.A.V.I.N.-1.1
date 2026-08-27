import "dotenv/config";
import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runAgent } from "./src/agent/agent.js";
import { buildFeature } from "./src/self/selfBuilder.js";
import { RAVIN_SYSTEM_PROMPT } from "./src/systemPrompt.js";
import { attachVoiceServer } from "./src/voice/voiceServer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const FRONTEND_ORIGIN = (process.env.FRONTEND_ORIGIN || "https://link9060.github.io").replace(/\/$/, "");

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin || origin === FRONTEND_ORIGIN) {
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

function requireSupabase() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    const error = new Error("RAVIN backend is missing SUPABASE_URL or SUPABASE_ANON_KEY.");
    error.status = 500;
    throw error;
  }
}

async function supabaseRequest(pathname, { token, method = "GET", body, prefer = "" } = {}) {
  requireSupabase();
  const headers = { apikey: SUPABASE_ANON_KEY, Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (prefer) headers.Prefer = prefer;
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${SUPABASE_URL}${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    const message = data?.message || data?.msg || data?.error_description || data?.error || `Supabase request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function getAuthenticatedUser(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;
  try {
    const user = await supabaseRequest("/auth/v1/user", { token });
    return { user, token };
  } catch { return null; }
}

async function requireUser(req, res) {
  const auth = await getAuthenticatedUser(req);
  if (!auth) { res.status(401).json({ error: "Please sign in to RAVIN." }); return null; }
  return auth;
}

async function loadConversationContext(conversationId, userId, token) {
  const rows = await supabaseRequest(`/rest/v1/messages?conversation_id=eq.${encodeURIComponent(conversationId)}&user_id=eq.${encodeURIComponent(userId)}&select=role,content,metadata,created_at&order=created_at.asc&limit=50`, { token });
  return [
    { role: "system", content: RAVIN_SYSTEM_PROMPT },
    ...(rows || []).filter(row => ["user", "assistant"].includes(row.role) && typeof row.content === "string").map(row => ({ role: row.role, content: row.content })),
  ];
}

app.post("/api/chat", async (req, res) => {
  const requestStartedAt = Date.now();
  const auth = await requireUser(req, res); if (!auth) return;
  const message = req.body?.message;
  if (!message || typeof message !== "string" || !message.trim()) return res.status(400).json({ error: "Message can't be empty." });
  try {
    let conversationId = req.body?.conversation_id || null;
    if (conversationId) {
      const rows = await supabaseRequest(`/rest/v1/conversations?id=eq.${encodeURIComponent(conversationId)}&user_id=eq.${encodeURIComponent(auth.user.id)}&select=id`, { token: auth.token });
      if (!rows?.length) conversationId = null;
    }
    if (!conversationId) {
      const rows = await supabaseRequest("/rest/v1/conversations", { method: "POST", token: auth.token, prefer: "return=representation", body: { user_id: auth.user.id, title: message.trim().slice(0, 80), metadata: {} } });
      conversationId = rows?.[0]?.id;
    }
    if (!conversationId) throw new Error("RAVIN could not create a conversation.");
    const contextStartedAt = Date.now();
    const priorMessages = await loadConversationContext(conversationId, auth.user.id, auth.token);
    const contextLoadMs = Date.now() - contextStartedAt;
    const userSaveStartedAt = Date.now();
    await supabaseRequest("/rest/v1/messages", { method: "POST", token: auth.token, prefer: "return=minimal", body: { user_id: auth.user.id, conversation_id: conversationId, role: "user", content: message.trim(), metadata: {} } });
    const userSaveMs = Date.now() - userSaveStartedAt;
    const agentStartedAt = Date.now();
    const result = await runAgent(message.trim(), { initialMessages: priorMessages });
    const agentMs = Date.now() - agentStartedAt;
    const assistantSaveStartedAt = Date.now();
    await supabaseRequest("/rest/v1/messages", { method: "POST", token: auth.token, prefer: "return=minimal", body: { user_id: auth.user.id, conversation_id: conversationId, role: "assistant", content: result.reply, metadata: { steps: result.steps, performance: result.performance } } });
    const assistantSaveMs = Date.now() - assistantSaveStartedAt;
    const totalMs = Date.now() - requestStartedAt;
    console.log(`[RAVIN request perf] total=${totalMs}ms context=${contextLoadMs}ms userSave=${userSaveMs}ms agent=${agentMs}ms assistantSave=${assistantSaveMs}ms`);
    res.json({ reply: result.reply, steps: result.steps, conversation_id: conversationId, performance: { totalMs, contextLoadMs, userSaveMs, agentMs, assistantSaveMs, agent: result.performance } });
  } catch (err) {
    console.error("[RAVIN chat error]", err);
    res.status(err?.status || 500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/api/memories", async (req, res) => {
  const auth = await requireUser(req, res); if (!auth) return;
  try {
    const [permanent, project, session] = await Promise.all([
      supabaseRequest(`/rest/v1/permanent_memories?user_id=eq.${encodeURIComponent(auth.user.id)}&select=*&order=created_at.desc&limit=100`, { token: auth.token }),
      supabaseRequest(`/rest/v1/project_memory?user_id=eq.${encodeURIComponent(auth.user.id)}&select=*&order=created_at.desc&limit=100`, { token: auth.token }),
      supabaseRequest(`/rest/v1/session_summaries?user_id=eq.${encodeURIComponent(auth.user.id)}&select=*&order=created_at.desc&limit=50`, { token: auth.token }),
    ]);
    res.json({ permanent, project, session });
  } catch (err) { console.error("[RAVIN memory read error]", err); res.status(err?.status || 500).json({ error: err instanceof Error ? err.message : String(err) }); }
});

app.post("/api/memories", async (req, res) => {
  const auth = await requireUser(req, res); if (!auth) return;
  const content = req.body?.content;
  if (!content || typeof content !== "string" || !content.trim()) return res.status(400).json({ error: "Memory content is required." });
  try {
    const rows = await supabaseRequest("/rest/v1/permanent_memories", { method: "POST", token: auth.token, prefer: "return=representation", body: { user_id: auth.user.id, content: content.trim(), category: req.body?.category || "fact", importance: Math.min(5, Math.max(1, Number(req.body?.importance || 3))), metadata: req.body?.metadata || {} } });
    res.status(201).json({ memory: rows?.[0] || null });
  } catch (err) { console.error("[RAVIN memory write error]", err); res.status(err?.status || 500).json({ error: err instanceof Error ? err.message : String(err) }); }
});

app.delete("/api/memories/:id", async (req, res) => {
  const auth = await requireUser(req, res); if (!auth) return;
  try {
    await supabaseRequest(`/rest/v1/permanent_memories?id=eq.${encodeURIComponent(req.params.id)}&user_id=eq.${encodeURIComponent(auth.user.id)}`, { method: "DELETE", token: auth.token });
    res.status(204).end();
  } catch (err) { console.error("[RAVIN memory delete error]", err); res.status(err?.status || 500).json({ error: err instanceof Error ? err.message : String(err) }); }
});

app.post("/api/build", async (req, res) => {
  const auth = await requireUser(req, res); if (!auth) return;
  const message = req.body?.message;
  if (!message || typeof message !== "string" || !message.trim()) return res.status(400).json({ error: "Build request can't be empty." });
  try {
    const result = await buildFeature(message.trim());
    res.json({ reply: result.reply, steps: result.steps });
  } catch (err) { console.error("[RAVIN builder error]", err); res.status(500).json({ error: err instanceof Error ? err.message : String(err) }); }
});

app.get("/api/health", (_req, res) => res.json({
  ok: true,
  service: "RAVIN",
  agent: true,
  builder: true,
  auth: Boolean(SUPABASE_URL && SUPABASE_ANON_KEY),
  omniRouteConfigured: Boolean(process.env.OMNIROUTE_BASE_URL),
  voiceConfigured: Boolean(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID),
  voiceProvider: "elevenlabs",
  sttModel: process.env.ELEVENLABS_STT_MODEL || "scribe_v2_realtime",
  ttsModel: process.env.ELEVENLABS_MODEL_ID || "eleven_turbo_v2_5",
}));

const server = http.createServer(app);
attachVoiceServer(server, getAuthenticatedUser);
server.listen(PORT, HOST, () => console.log(`RAVIN web is up on ${HOST}:${PORT}`));
