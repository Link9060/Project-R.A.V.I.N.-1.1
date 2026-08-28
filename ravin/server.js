import "dotenv/config";
import express from "express";
import http from "node:http";
import crypto from "node:crypto";
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
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const FRONTEND_ORIGIN = (process.env.FRONTEND_ORIGIN || "https://link9060.github.io").replace(/\/$/, "");
const FRONTEND_APP_URL = (process.env.FRONTEND_APP_URL || "https://link9060.github.io/Project-R.A.V.I.N.-1.1/").replace(/\/$/, "") + "/";
const OAUTH_REDIRECT_BASE = (process.env.OAUTH_REDIRECT_BASE || "https://ravin-hyeq.onrender.com").replace(/\/$/, "");
const EMAIL_TOKEN_ENCRYPTION_KEY = process.env.EMAIL_TOKEN_ENCRYPTION_KEY || "";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID || "";
const MICROSOFT_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET || "";

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

async function adminSupabaseRequest(pathname, { method = "GET", body, prefer = "" } = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    const error = new Error("Email sync is waiting for the Supabase service role key.");
    error.status = 503;
    throw error;
  }
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    Accept: "application/json",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (prefer) headers.Prefer = prefer;
  const response = await fetch(`${SUPABASE_URL}${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    const error = new Error(data?.message || data?.error || `Supabase email storage failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function emailKey() {
  if (!EMAIL_TOKEN_ENCRYPTION_KEY) {
    const error = new Error("Email sync is waiting for its encryption key.");
    error.status = 503;
    throw error;
  }
  return crypto.createHash("sha256").update(EMAIL_TOKEN_ENCRYPTION_KEY).digest();
}

function seal(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", emailKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}

function unseal(value) {
  const packed = Buffer.from(String(value), "base64url");
  const decipher = crypto.createDecipheriv("aes-256-gcm", emailKey(), packed.subarray(0, 12));
  decipher.setAuthTag(packed.subarray(12, 28));
  return Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString("utf8");
}

function createOAuthState(payload) {
  return seal(JSON.stringify({ ...payload, nonce: crypto.randomUUID(), expires: Date.now() + 10 * 60 * 1000 }));
}

function readOAuthState(value) {
  const payload = JSON.parse(unseal(value));
  if (!payload.expires || payload.expires < Date.now()) throw new Error("The email connection request expired. Please try again.");
  return payload;
}

function providerConfig(provider) {
  if (provider === "google") return {
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    scopes: ["openid", "email", "profile", "https://www.googleapis.com/auth/gmail.readonly"],
  };
  if (provider === "microsoft") return {
    clientId: MICROSOFT_CLIENT_ID,
    clientSecret: MICROSOFT_CLIENT_SECRET,
    authorize: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    token: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: ["openid", "profile", "email", "offline_access", "https://graph.microsoft.com/Mail.Read"],
  };
  const error = new Error("Unsupported email provider.");
  error.status = 400;
  throw error;
}

function providerRedirect(provider) {
  return `${OAUTH_REDIRECT_BASE}/api/email/oauth/${provider}/callback`;
}

async function formRequest(url, values) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(values),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error_description || data.error || `OAuth token exchange failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function providerProfile(provider, accessToken) {
  const url = provider === "google"
    ? "https://openidconnect.googleapis.com/v1/userinfo"
    : "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName";
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || data?.error || "Could not read the connected email profile.");
  const email = provider === "google" ? data.email : data.mail || data.userPrincipalName;
  if (!email) throw new Error("The provider did not return an email address.");
  return { email: String(email).toLowerCase(), displayName: data.name || data.displayName || "" };
}

async function getEmailAccount(id, userId) {
  const rows = await adminSupabaseRequest(`/rest/v1/email_connections?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}&select=*`);
  return rows?.[0] || null;
}

async function currentProviderToken(account) {
  if (account.token_expires_at && new Date(account.token_expires_at).getTime() > Date.now() + 60_000) return unseal(account.access_token_encrypted);
  if (!account.refresh_token_encrypted) throw new Error("This email connection needs authorization again.");
  const config = providerConfig(account.provider);
  const values = account.provider === "google"
    ? { client_id: config.clientId, client_secret: config.clientSecret, refresh_token: unseal(account.refresh_token_encrypted), grant_type: "refresh_token" }
    : { client_id: config.clientId, client_secret: config.clientSecret, refresh_token: unseal(account.refresh_token_encrypted), grant_type: "refresh_token", scope: config.scopes.join(" ") };
  const tokens = await formRequest(config.token, values);
  const expiresAt = new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000).toISOString();
  await adminSupabaseRequest(`/rest/v1/email_connections?id=eq.${encodeURIComponent(account.id)}`, {
    method: "PATCH",
    body: {
      access_token_encrypted: seal(tokens.access_token),
      refresh_token_encrypted: tokens.refresh_token ? seal(tokens.refresh_token) : account.refresh_token_encrypted,
      token_expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    },
  });
  return tokens.access_token;
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

app.post("/api/email/connect/:provider", async (req, res) => {
  const auth = await requireUser(req, res); if (!auth) return;
  try {
    const provider = req.params.provider;
    const config = providerConfig(provider);
    if (!config.clientId || !config.clientSecret) return res.status(503).json({ error: `${provider === "google" ? "Google" : "Microsoft"} OAuth credentials are not configured yet.` });
    emailKey();
    const category = req.body?.category === "school" ? "school" : "personal";
    const codeVerifier = crypto.randomBytes(48).toString("base64url");
    const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
    const state = createOAuthState({ provider, userId: auth.user.id, category, codeVerifier });
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: providerRedirect(provider),
      response_type: "code",
      scope: config.scopes.join(" "),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });
    if (provider === "google") {
      params.set("access_type", "offline");
      params.set("include_granted_scopes", "true");
      params.set("prompt", "consent select_account");
    } else {
      params.set("response_mode", "query");
      params.set("prompt", "select_account");
    }
    res.json({ url: `${config.authorize}?${params}` });
  } catch (err) {
    console.error("[RAVIN email connect error]", err);
    res.status(err?.status || 500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/api/email/oauth/:provider/callback", async (req, res) => {
  const provider = req.params.provider;
  const redirectWith = (status, message = "") => {
    const url = new URL(FRONTEND_APP_URL);
    url.searchParams.set("email_connection", status);
    url.searchParams.set("provider", provider);
    if (message) url.searchParams.set("email_error", message.slice(0, 160));
    res.redirect(url.toString());
  };
  try {
    if (req.query.error) return redirectWith("error", String(req.query.error_description || req.query.error));
    if (!req.query.code || !req.query.state) return redirectWith("error", "The provider returned an incomplete authorization response.");
    const state = readOAuthState(String(req.query.state));
    if (state.provider !== provider || !state.userId) throw new Error("Email authorization state did not match.");
    const config = providerConfig(provider);
    const values = {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code: String(req.query.code),
      code_verifier: state.codeVerifier,
      redirect_uri: providerRedirect(provider),
      grant_type: "authorization_code",
    };
    const tokens = await formRequest(config.token, values);
    const profile = await providerProfile(provider, tokens.access_token);
    const existing = await adminSupabaseRequest(`/rest/v1/email_connections?user_id=eq.${encodeURIComponent(state.userId)}&provider=eq.${encodeURIComponent(provider)}&email=eq.${encodeURIComponent(profile.email)}&select=*`);
    const refreshEncrypted = tokens.refresh_token ? seal(tokens.refresh_token) : existing?.[0]?.refresh_token_encrypted || null;
    const rows = await adminSupabaseRequest("/rest/v1/email_connections?on_conflict=user_id,provider,email", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=representation",
      body: {
        user_id: state.userId,
        provider,
        category: state.category === "school" ? "school" : "personal",
        email: profile.email,
        display_name: profile.displayName,
        access_token_encrypted: seal(tokens.access_token),
        refresh_token_encrypted: refreshEncrypted,
        token_expires_at: new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000).toISOString(),
        scope: tokens.scope || config.scopes.join(" "),
        updated_at: new Date().toISOString(),
      },
    });
    if (!rows?.length) throw new Error("The email account could not be saved.");
    redirectWith("success");
  } catch (err) {
    console.error("[RAVIN email callback error]", err);
    redirectWith("error", err instanceof Error ? err.message : String(err));
  }
});

app.get("/api/email/accounts", async (req, res) => {
  const auth = await requireUser(req, res); if (!auth) return;
  try {
    const accounts = await adminSupabaseRequest(`/rest/v1/email_connections?user_id=eq.${encodeURIComponent(auth.user.id)}&select=id,provider,category,email,display_name,created_at,updated_at&order=created_at.asc`);
    res.json({ accounts: accounts || [] });
  } catch (err) {
    console.error("[RAVIN email account read error]", err);
    res.status(err?.status || 500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/api/email/messages", async (req, res) => {
  const auth = await requireUser(req, res); if (!auth) return;
  try {
    const accountId = String(req.query.account_id || "");
    if (!accountId) return res.status(400).json({ error: "Choose an email account first." });
    const account = await getEmailAccount(accountId, auth.user.id);
    if (!account) return res.status(404).json({ error: "Email account not found." });
    const accessToken = await currentProviderToken(account);
    let messages = [];
    if (account.provider === "google") {
      const listResponse = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=15&q=in%3Ainbox", { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
      const list = await listResponse.json().catch(() => ({}));
      if (!listResponse.ok) throw new Error(list?.error?.message || "Gmail inbox request failed.");
      const details = await Promise.all((list.messages || []).map(async ({ id }) => {
        const detailResponse = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
        const detail = await detailResponse.json().catch(() => ({}));
        if (!detailResponse.ok) return null;
        const headers = Object.fromEntries((detail.payload?.headers || []).map((header) => [String(header.name).toLowerCase(), header.value]));
        return { id: detail.id, from: headers.from || "", subject: headers.subject || "", date: headers.date || (detail.internalDate ? new Date(Number(detail.internalDate)).toISOString() : ""), snippet: detail.snippet || "", unread: (detail.labelIds || []).includes("UNREAD") };
      }));
      messages = details.filter(Boolean);
    } else {
      const graphUrl = "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=25&$select=id,subject,from,receivedDateTime,bodyPreview,isRead&$orderby=receivedDateTime%20desc";
      const graphResponse = await fetch(graphUrl, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
      const data = await graphResponse.json().catch(() => ({}));
      if (!graphResponse.ok) throw new Error(data?.error?.message || "Outlook inbox request failed.");
      messages = (data.value || []).map((message) => ({ id: message.id, from: message.from?.emailAddress?.name || message.from?.emailAddress?.address || "", subject: message.subject || "", date: message.receivedDateTime || "", snippet: message.bodyPreview || "", unread: !message.isRead }));
    }
    res.json({ account: { id: account.id, provider: account.provider, email: account.email }, messages });
  } catch (err) {
    console.error("[RAVIN inbox error]", err);
    res.status(err?.status || 500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.delete("/api/email/accounts/:id", async (req, res) => {
  const auth = await requireUser(req, res); if (!auth) return;
  try {
    await adminSupabaseRequest(`/rest/v1/email_connections?id=eq.${encodeURIComponent(req.params.id)}&user_id=eq.${encodeURIComponent(auth.user.id)}`, { method: "DELETE" });
    res.status(204).end();
  } catch (err) {
    console.error("[RAVIN email disconnect error]", err);
    res.status(err?.status || 500).json({ error: err instanceof Error ? err.message : String(err) });
  }
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
  emailStorageConfigured: Boolean(SUPABASE_SERVICE_ROLE_KEY && EMAIL_TOKEN_ENCRYPTION_KEY),
  googleEmailConfigured: Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET),
  microsoftEmailConfigured: Boolean(MICROSOFT_CLIENT_ID && MICROSOFT_CLIENT_SECRET),
  omniRouteConfigured: Boolean(process.env.OMNIROUTE_BASE_URL),
  voiceConfigured: Boolean(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID),
  voiceProvider: "elevenlabs",
  sttModel: process.env.ELEVENLABS_STT_MODEL || "scribe_v2_realtime",
  ttsModel: process.env.ELEVENLABS_MODEL_ID || "eleven_turbo_v2_5",
}));

const server = http.createServer(app);
attachVoiceServer(server, getAuthenticatedUser);
server.listen(PORT, HOST, () => console.log(`RAVIN web is up on ${HOST}:${PORT}`));
