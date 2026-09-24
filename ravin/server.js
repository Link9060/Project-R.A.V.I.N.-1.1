import "dotenv/config";
import crypto from "node:crypto";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runAgent } from "./src/agent/agent.js";
import { buildFeature } from "./src/self/selfBuilder.js";
import { registerDocumentRoutes } from "./src/files/documentRoutes.js";
import { RAVIN_SYSTEM_PROMPT } from "./src/systemPrompt.js";
import { registerV02Routes } from "./src/v02Routes.js";
import {
  RAVIN_MODELS,
  normalizeRavinMode,
  chatWithCloudflare,
} from "./src/cloudflareClient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const RELEASE = process.env.RAVIN_RELEASE || "0.2.0";
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || "";
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_API_KEY || "";
const FRONTEND_ORIGIN = (process.env.FRONTEND_ORIGIN || "").replace(/\/$/, "");

const allowedOrigins = new Set([
  "https://link9060.github.io",
  "https://ravin-hyeq.onrender.com",
]);
if (FRONTEND_ORIGIN) allowedOrigins.add(FRONTEND_ORIGIN);

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use((req, res, next) => {
  const requestId = String(req.headers["x-request-id"] || crypto.randomUUID()).slice(0, 128);
  req.ravinRequestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "geolocation=(), payment=(), usb=()");
  next();
});

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && !allowedOrigins.has(origin)) {
    if (req.method === "OPTIONS") return res.sendStatus(403);
    return res.status(403).json({ error: "This origin is not allowed to access RAVIN.", request_id: req.ravinRequestId });
  }
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept, X-Request-Id");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Max-Age", "86400");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: "12mb", strict: true }));

app.use((req, res, next) => {
  if (!req.path.startsWith("/api/")) return next();
  const started = Date.now();
  res.on("finish", () => {
    console.log(`[RAVIN HTTP] id=${req.ravinRequestId} method=${req.method} path=${req.path} status=${res.statusCode} duration=${Date.now() - started}ms`);
  });
  next();
});

// Self-development is a privileged developer capability, never a normal customer Work tool.
app.use("/api/build", (_req, res, next) => {
  if (process.env.RAVIN_ENABLE_SELF_BUILD !== "true") {
    return res.status(403).json({ error: "RAVIN self-development is disabled in this environment." });
  }
  next();
});

// Register document-aware uploads before the legacy v0.2 upload handler.
registerDocumentRoutes(app);
registerV02Routes(app);

app.use(express.static(path.join(__dirname, "public"), {
  etag: true,
  maxAge: "1h",
  setHeaders(res, filePath) {
    if (filePath.endsWith("index.html")) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    } else if (/\.(?:js|css|json)$/.test(filePath)) {
      res.setHeader("Cache-Control", "public, max-age=300, must-revalidate");
    }
  },
}));

function requireSupabase() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    const error = new Error("RAVIN backend is missing Supabase configuration.");
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
  const response = await fetch(`${SUPABASE_URL}${pathname}`, {
    method,
    headers,
    signal: AbortSignal.timeout(20000),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
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
  } catch {
    return null;
  }
}

async function requireUser(req, res) {
  const auth = await getAuthenticatedUser(req);
  if (!auth) {
    res.status(401).json({ error: "Please sign in to RAVIN.", request_id: req.ravinRequestId });
    return null;
  }
  return auth;
}

function publicError(error, fallback = "RAVIN could not complete that request.") {
  const status = Number(error?.status || 500);
  if (status >= 400 && status < 500) return error instanceof Error ? error.message : String(error);
  return fallback;
}

async function loadConversationContext(conversationId, userId, token) {
  const rows = await supabaseRequest(
    `/rest/v1/messages?conversation_id=eq.${encodeURIComponent(conversationId)}&user_id=eq.${encodeURIComponent(userId)}&select=role,content,metadata,created_at&order=created_at.desc&limit=50`,
    { token },
  );
  return [
    { role: "system", content: RAVIN_SYSTEM_PROMPT },
    ...(rows || []).reverse()
      .filter((row) => ["user", "assistant"].includes(row.role) && typeof row.content === "string")
      .map((row) => ({ role: row.role, content: row.content })),
  ];
}

// Legacy non-streaming route retained for compatibility. New clients should use /api/v2/chat/stream.
app.post("/api/chat", async (req, res) => {
  const requestStartedAt = Date.now();
  const auth = await requireUser(req, res);
  if (!auth) return;

  const message = req.body?.message;
  const mode = normalizeRavinMode(req.body?.mode);
  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "Message can't be empty.", request_id: req.ravinRequestId });
  }

  try {
    let conversationId = req.body?.conversation_id || null;
    if (conversationId) {
      const rows = await supabaseRequest(
        `/rest/v1/conversations?id=eq.${encodeURIComponent(conversationId)}&user_id=eq.${encodeURIComponent(auth.user.id)}&select=id`,
        { token: auth.token },
      );
      if (!rows?.length) conversationId = null;
    }

    if (!conversationId) {
      const rows = await supabaseRequest("/rest/v1/conversations", {
        method: "POST",
        token: auth.token,
        prefer: "return=representation",
        body: {
          user_id: auth.user.id,
          title: message.trim().slice(0, 80),
          metadata: { mode },
        },
      });
      conversationId = rows?.[0]?.id;
    }
    if (!conversationId) throw new Error("RAVIN could not create a conversation.");

    const contextStartedAt = Date.now();
    const priorMessages = await loadConversationContext(conversationId, auth.user.id, auth.token);
    const contextLoadMs = Date.now() - contextStartedAt;

    const userSaveStartedAt = Date.now();
    await supabaseRequest("/rest/v1/messages", {
      method: "POST",
      token: auth.token,
      prefer: "return=minimal",
      body: {
        user_id: auth.user.id,
        conversation_id: conversationId,
        role: "user",
        content: message.trim(),
        metadata: { mode },
      },
    });
    const userSaveMs = Date.now() - userSaveStartedAt;

    const agentStartedAt = Date.now();
    const result = await runAgent(message.trim(), { initialMessages: priorMessages, mode });
    const agentMs = Date.now() - agentStartedAt;

    const assistantSaveStartedAt = Date.now();
    await supabaseRequest("/rest/v1/messages", {
      method: "POST",
      token: auth.token,
      prefer: "return=minimal",
      body: {
        user_id: auth.user.id,
        conversation_id: conversationId,
        role: "assistant",
        content: result.reply,
        metadata: { mode, steps: result.steps, performance: result.performance },
      },
    });
    const assistantSaveMs = Date.now() - assistantSaveStartedAt;
    const totalMs = Date.now() - requestStartedAt;

    res.json({
      reply: result.reply,
      steps: result.steps,
      mode,
      model: RAVIN_MODELS[mode],
      conversation_id: conversationId,
      request_id: req.ravinRequestId,
      performance: {
        totalMs,
        contextLoadMs,
        userSaveMs,
        agentMs,
        assistantSaveMs,
        agent: result.performance,
      },
    });
  } catch (error) {
    console.error(`[RAVIN chat error] id=${req.ravinRequestId} mode=${mode}`, error);
    const status = Number(error?.status || 500);
    res.status(status).json({
      error: publicError(error, "RAVIN could not complete this chat request."),
      mode,
      request_id: req.ravinRequestId,
    });
  }
});

app.get("/api/memories", async (req, res) => {
  const auth = await requireUser(req, res);
  if (!auth) return;
  try {
    const encodedUser = encodeURIComponent(auth.user.id);
    const [permanent, project, session] = await Promise.all([
      supabaseRequest(`/rest/v1/permanent_memories?user_id=eq.${encodedUser}&select=*&order=created_at.desc&limit=100`, { token: auth.token }),
      supabaseRequest(`/rest/v1/project_memory?user_id=eq.${encodedUser}&select=*&order=created_at.desc&limit=100`, { token: auth.token }),
      supabaseRequest(`/rest/v1/session_summaries?user_id=eq.${encodedUser}&select=*&order=created_at.desc&limit=50`, { token: auth.token }),
    ]);
    res.json({ permanent, project, session, request_id: req.ravinRequestId });
  } catch (error) {
    console.error(`[RAVIN memory read error] id=${req.ravinRequestId}`, error);
    res.status(Number(error?.status || 500)).json({ error: publicError(error), request_id: req.ravinRequestId });
  }
});

app.post("/api/memories", async (req, res) => {
  const auth = await requireUser(req, res);
  if (!auth) return;
  const content = req.body?.content;
  if (!content || typeof content !== "string" || !content.trim()) {
    return res.status(400).json({ error: "Memory content is required.", request_id: req.ravinRequestId });
  }
  try {
    const rows = await supabaseRequest("/rest/v1/permanent_memories", {
      method: "POST",
      token: auth.token,
      prefer: "return=representation",
      body: {
        user_id: auth.user.id,
        content: content.trim().slice(0, 4000),
        category: String(req.body?.category || "fact").slice(0, 40),
        importance: Math.min(5, Math.max(1, Number(req.body?.importance || 3))),
        metadata: req.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata : {},
      },
    });
    res.status(201).json({ memory: rows?.[0] || null, request_id: req.ravinRequestId });
  } catch (error) {
    console.error(`[RAVIN memory write error] id=${req.ravinRequestId}`, error);
    res.status(Number(error?.status || 500)).json({ error: publicError(error), request_id: req.ravinRequestId });
  }
});

app.delete("/api/memories/:id", async (req, res) => {
  const auth = await requireUser(req, res);
  if (!auth) return;
  try {
    await supabaseRequest(
      `/rest/v1/permanent_memories?id=eq.${encodeURIComponent(req.params.id)}&user_id=eq.${encodeURIComponent(auth.user.id)}`,
      { method: "DELETE", token: auth.token },
    );
    res.status(204).end();
  } catch (error) {
    console.error(`[RAVIN memory delete error] id=${req.ravinRequestId}`, error);
    res.status(Number(error?.status || 500)).json({ error: publicError(error), request_id: req.ravinRequestId });
  }
});

app.post("/api/build", async (req, res) => {
  const auth = await requireUser(req, res);
  if (!auth) return;
  const message = req.body?.message;
  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "Build request can't be empty.", request_id: req.ravinRequestId });
  }
  try {
    const result = await buildFeature(message.trim());
    res.json({ reply: result.reply, steps: result.steps, mode: "work", model: RAVIN_MODELS.work, request_id: req.ravinRequestId });
  } catch (error) {
    console.error(`[RAVIN builder error] id=${req.ravinRequestId}`, error);
    res.status(500).json({ error: "RAVIN could not complete the developer build request.", request_id: req.ravinRequestId });
  }
});

app.get("/api/health", (_req, res) => {
  const ready = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && CLOUDFLARE_ACCOUNT_ID && CLOUDFLARE_API_TOKEN);
  res.status(ready ? 200 : 503).json({
    ok: ready,
    service: "ravin-api",
    release: RELEASE,
    timestamp: new Date().toISOString(),
    checks: {
      auth: Boolean(SUPABASE_URL && SUPABASE_ANON_KEY),
      ai: Boolean(CLOUDFLARE_ACCOUNT_ID && CLOUDFLARE_API_TOKEN),
    },
  });
});

app.use("/api", (req, res) => {
  res.status(404).json({ error: "RAVIN API route not found.", request_id: req.ravinRequestId });
});

app.use((error, req, res, _next) => {
  console.error(`[RAVIN server error] id=${req.ravinRequestId || "unknown"}`, error);
  if (res.headersSent) return;
  const status = error?.type === "entity.too.large" ? 413 : Number(error?.status || 500);
  const message = status === 413
    ? "That request is too large."
    : status === 400
      ? "RAVIN could not parse that request."
      : "RAVIN encountered an internal server error.";
  res.status(status).json({ error: message, request_id: req.ravinRequestId });
});

async function runAiSmokeTests() {
  if (process.env.RAVIN_AI_SMOKE_TESTS !== "true") return;
  if (!CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_API_TOKEN) {
    console.warn("[RAVIN AI smoke] skipped: Cloudflare credentials are missing");
    return;
  }
  for (const mode of ["conversation", "work"]) {
    const startedAt = Date.now();
    try {
      const result = await chatWithCloudflare([
        { role: "system", content: "This is a health check. Reply with exactly OK." },
        { role: "user", content: "Reply OK." },
      ], { mode, tools: [], temperature: 0, maxTokens: mode === "work" ? 256 : 32 });
      const reply = String(result?.content || "").trim().slice(0, 80);
      console.log(`[RAVIN AI smoke] mode=${mode} model=${RAVIN_MODELS[mode]} ok=${Boolean(reply)} latency=${Date.now() - startedAt}ms`);
    } catch (error) {
      console.error(`[RAVIN AI smoke] mode=${mode} model=${RAVIN_MODELS[mode]} ok=false`, error);
    }
  }
}

const server = app.listen(PORT, () => {
  console.log(`RAVIN web listening on port ${PORT} release=${RELEASE}`);
  runAiSmokeTests().catch((error) => console.error("[RAVIN AI smoke] unexpected failure", error));
});

function shutdown(signal) {
  console.log(`[RAVIN] ${signal} received; closing HTTP server`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
