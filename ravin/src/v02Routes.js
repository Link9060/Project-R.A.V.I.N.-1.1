import crypto from "node:crypto";

import { RAVIN_SYSTEM_PROMPT } from "./systemPrompt.js";
import {
  RAVIN_MODELS,
  normalizeRavinMode,
  chatWithCloudflare,
  streamChatWithCloudflare,
} from "./cloudflareClient.js";
import {
  capabilityContext,
  listCapabilityEnvironments,
  resolveCapabilityEnvironment,
} from "./capabilities/registry.js";

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const FILE_BUCKET = "ravin-files";
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_ATTACHMENTS = 4;
const MAX_TEXT_ATTACHMENT_CHARS = 36_000;
const MEMORY_STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "than", "to", "of", "in", "on", "at", "for", "from",
  "with", "about", "this", "that", "these", "those", "is", "are", "was", "were", "be", "been", "being", "it", "its",
  "i", "me", "my", "mine", "you", "your", "yours", "we", "our", "ours", "they", "their", "them", "do", "does", "did",
  "have", "has", "had", "can", "could", "would", "should", "will", "just", "really", "very", "like", "want", "need",
]);

function requireConfig() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    const error = new Error("RAVIN backend is missing Supabase configuration.");
    error.status = 500;
    throw error;
  }
}

async function supabaseRequest(pathname, { token, method = "GET", body, prefer = "", extraHeaders = {} } = {}) {
  requireConfig();
  const headers = { apikey: SUPABASE_ANON_KEY, Accept: "application/json", ...extraHeaders };
  if (body !== undefined && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  if (prefer) headers.Prefer = prefer;
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${SUPABASE_URL}${pathname}`, {
    method,
    headers,
    body: body === undefined
      ? undefined
      : headers["Content-Type"] === "application/json"
        ? JSON.stringify(body)
        : body,
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    const error = new Error(data?.message || data?.msg || data?.error || `Supabase request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function authenticate(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  try {
    const user = await supabaseRequest("/auth/v1/user", { token });
    return { user, token };
  } catch {
    return null;
  }
}

async function requireUser(req, res) {
  const auth = await authenticate(req);
  if (!auth) {
    res.status(401).json({ error: "Please sign in to RAVIN." });
    return null;
  }
  return auth;
}

function cleanFileName(name) {
  return String(name || "attachment")
    .replace(/[\\/]+/g, "-")
    .replace(/[^a-zA-Z0-9._() -]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "attachment";
}

function isTextLike(name, mimeType) {
  const lower = String(name || "").toLowerCase();
  return String(mimeType || "").startsWith("text/")
    || ["application/json", "application/xml", "application/javascript", "application/x-javascript"].includes(mimeType)
    || /\.(txt|md|markdown|json|csv|js|mjs|cjs|ts|tsx|jsx|py|java|c|cpp|h|hpp|html|css|xml|yaml|yml|toml|ini|log|sql|sh)$/i.test(lower);
}

function isImage(mimeType) {
  return String(mimeType || "").startsWith("image/");
}

function storagePathUrl(pathname, authenticated = false) {
  const encoded = String(pathname).split("/").map(encodeURIComponent).join("/");
  return `${SUPABASE_URL}/storage/v1/object/${authenticated ? "authenticated/" : ""}${FILE_BUCKET}/${encoded}`;
}

async function uploadObject(pathname, buffer, mimeType, token) {
  const response = await fetch(storagePathUrl(pathname), {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": mimeType || "application/octet-stream",
      "x-upsert": "false",
    },
    body: buffer,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`RAVIN couldn't store that file (${response.status}). ${text}`.trim());
  }
}

async function downloadObject(pathname, token) {
  let response = await fetch(storagePathUrl(pathname, true), {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    response = await fetch(storagePathUrl(pathname, false), {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    });
  }
  if (!response.ok) throw new Error(`RAVIN couldn't read attachment data (${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}

function memoryTokens(value) {
  return new Set(
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s_-]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 2 && !MEMORY_STOP_WORDS.has(token))
      .slice(0, 120),
  );
}

function rankMemory(row, queryTokens, kind) {
  const text = kind === "project" ? `${row.key || ""} ${row.value || ""}` : (row.content || row.summary || "");
  const tokens = memoryTokens(text);
  let overlap = 0;
  for (const token of queryTokens) if (tokens.has(token)) overlap += 1;
  const importance = Number(row.importance || 3);
  const created = new Date(row.updated_at || row.created_at || 0).getTime();
  const ageDays = created ? Math.max(0, (Date.now() - created) / 86_400_000) : 365;
  const recency = Math.max(0, 2 - Math.log10(ageDays + 1));
  return overlap * 4 + importance * .55 + recency;
}

async function loadRelevantMemories({ userId, token, query, projectId = null, conversationId = null }) {
  const encodedUser = encodeURIComponent(userId);
  const requests = [
    supabaseRequest(`/rest/v1/permanent_memories?user_id=eq.${encodedUser}&select=id,content,category,importance,metadata,created_at,updated_at&order=updated_at.desc&limit=100`, { token }),
    supabaseRequest(`/rest/v1/project_memory?user_id=eq.${encodedUser}&select=id,project_id,project_name,key,value,category,metadata,created_at,updated_at&order=updated_at.desc&limit=100`, { token }),
    supabaseRequest(`/rest/v1/session_summaries?user_id=eq.${encodedUser}&select=id,conversation_id,project_id,summary,created_at&order=created_at.desc&limit=30`, { token }),
  ];
  const [permanent = [], project = [], session = []] = await Promise.all(requests);
  const queryTokens = memoryTokens(query);
  const score = (row, kind) => rankMemory(row, queryTokens, kind);

  const permanentTop = permanent
    .map((row) => ({ row, score: score(row, "permanent") }))
    .filter((item) => item.score > 1.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((item) => item.row);

  const projectTop = project
    .filter((row) => !projectId || row.project_id === projectId)
    .map((row) => ({ row, score: score(row, "project") + (projectId && row.project_id === projectId ? 6 : 0) }))
    .filter((item) => item.score > 1.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((item) => item.row);

  const sessionTop = session
    .filter((row) => !conversationId || row.conversation_id === conversationId || (projectId && row.project_id === projectId))
    .slice(0, 3);

  return { permanent: permanentTop, project: projectTop, session: sessionTop };
}

function memoryContext(memories) {
  const lines = [];
  for (const memory of memories.permanent || []) lines.push(`- Personal memory: ${memory.content}`);
  for (const memory of memories.project || []) lines.push(`- Project memory (${memory.project_name || "project"}): ${memory.key}: ${memory.value}`);
  for (const summary of memories.session || []) lines.push(`- Recent session summary: ${summary.summary}`);
  if (!lines.length) return "No relevant durable memory was retrieved for this request.";
  return `RELEVANT RAVIN MEMORY:\n${lines.join("\n")}\nUse these only when they are relevant. Do not mention the memory system unless the user asks.`;
}

async function conversationRecord(conversationId, userId, token) {
  if (!conversationId) return null;
  const rows = await supabaseRequest(
    `/rest/v1/conversations?id=eq.${encodeURIComponent(conversationId)}&user_id=eq.${encodeURIComponent(userId)}&select=id,title,project_id,metadata&limit=1`,
    { token },
  );
  return rows?.[0] || null;
}

async function createConversation({ userId, token, title, mode, environment, projectId = null }) {
  const rows = await supabaseRequest("/rest/v1/conversations", {
    method: "POST",
    token,
    prefer: "return=representation",
    body: {
      user_id: userId,
      title: String(title || "New conversation").slice(0, 80),
      project_id: projectId || null,
      metadata: { mode, environment },
    },
  });
  return rows?.[0] || null;
}

async function loadRecentMessages(conversationId, userId, token) {
  return supabaseRequest(
    `/rest/v1/messages?conversation_id=eq.${encodeURIComponent(conversationId)}&user_id=eq.${encodeURIComponent(userId)}&select=role,content,metadata,created_at&order=created_at.asc&limit=40`,
    { token },
  );
}

async function saveMessage({ userId, conversationId, role, content, token, metadata = {} }) {
  await supabaseRequest("/rest/v1/messages", {
    method: "POST",
    token,
    prefer: "return=minimal",
    body: { user_id: userId, conversation_id: conversationId, role, content, metadata },
  });
}

async function getFileRow(id, userId, token) {
  const rows = await supabaseRequest(
    `/rest/v1/files?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}&select=id,file_name,mime_type,size_bytes,storage_path,metadata,project_id,created_at&limit=1`,
    { token },
  );
  return rows?.[0] || null;
}

async function buildAttachmentContext(ids, auth, mode) {
  const attachmentIds = Array.isArray(ids) ? ids.slice(0, MAX_ATTACHMENTS) : [];
  const textParts = [];
  const images = [];
  const files = [];
  let remainingText = MAX_TEXT_ATTACHMENT_CHARS;

  for (const id of attachmentIds) {
    const row = await getFileRow(id, auth.user.id, auth.token);
    if (!row) continue;
    files.push(row);

    if (row.metadata?.text_content && remainingText > 0) {
      const excerpt = String(row.metadata.text_content).slice(0, remainingText);
      textParts.push(`FILE: ${row.file_name}\n${excerpt}`);
      remainingText -= excerpt.length;
      continue;
    }

    if (isImage(row.mime_type)) {
      if (mode !== "work") {
        const error = new Error("Image analysis is currently available in Work mode. Switch to Work and send again.");
        error.status = 400;
        throw error;
      }
      const bytes = await downloadObject(row.storage_path, auth.token);
      images.push({
        name: row.file_name,
        mimeType: row.mime_type,
        dataUrl: `data:${row.mime_type};base64,${bytes.toString("base64")}`,
      });
      continue;
    }

    textParts.push(`ATTACHED FILE: ${row.file_name} (${row.mime_type || "unknown type"}). Its contents are stored securely, but this file type does not have text extraction enabled yet.`);
  }

  return { files, text: textParts.join("\n\n"), images };
}

function buildModelMessages({ priorMessages, userText, memoryText, attachmentText, images, environment, mode }) {
  const modeInstruction = mode === "work"
    ? "WORK MODE: Handle complex reasoning, planning, coding, file/image analysis, and structured tasks carefully. Customer Work mode has no source-code self-modification privileges."
    : "CONVERSATION MODE: Be quick, natural, conversational, and concise unless the user asks for depth.";

  const system = [RAVIN_SYSTEM_PROMPT, modeInstruction, capabilityContext(environment), memoryText];
  if (attachmentText) system.push(`ATTACHMENT CONTEXT:\n${attachmentText}`);

  const messages = [
    { role: "system", content: system.join("\n\n") },
    ...(priorMessages || [])
      .filter((row) => ["user", "assistant"].includes(row.role) && typeof row.content === "string")
      .slice(-24)
      .map((row) => ({ role: row.role, content: row.content })),
  ];

  if (images?.length) {
    messages.push({
      role: "user",
      content: [
        { type: "text", text: userText },
        ...images.map((image) => ({ type: "image_url", image_url: { url: image.dataUrl } })),
      ],
    });
  } else {
    messages.push({ role: "user", content: userText });
  }
  return messages;
}

function sendEvent(res, event, data) {
  if (res.writableEnded || res.destroyed) return;
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function parseJsonArray(value) {
  const cleaned = String(value || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(cleaned);
  return Array.isArray(parsed) ? parsed : [];
}

function looksSecret(value) {
  return /(password|passcode|api\s*key|secret|token|private\s*key|credit\s*card)/i.test(String(value || ""));
}

async function captureDurableMemories({ auth, userMessage }) {
  if (!userMessage || looksSecret(userMessage)) return;
  const extraction = await chatWithCloudflare([
    {
      role: "system",
      content: "Extract at most 2 durable user facts or preferences explicitly stated in the USER message. Ignore temporary details, guesses, sensitive credentials/secrets, and facts stated only by the assistant. Return ONLY a JSON array. Each item must be {\"content\":string,\"category\":\"fact\"|\"preference\"|\"goal\",\"importance\":1|2|3|4|5}. Return [] when nothing is worth remembering.",
    },
    { role: "user", content: userMessage.slice(0, 5000) },
  ], { mode: "conversation", tools: [], temperature: 0, maxTokens: 280 });

  let candidates = [];
  try { candidates = parseJsonArray(extraction.content); } catch { return; }
  if (!candidates.length) return;

  const existing = await supabaseRequest(
    `/rest/v1/permanent_memories?user_id=eq.${encodeURIComponent(auth.user.id)}&select=content&order=updated_at.desc&limit=150`,
    { token: auth.token },
  );
  const normalizedExisting = new Set((existing || []).map((row) => String(row.content || "").toLowerCase().replace(/\s+/g, " ").trim()));

  for (const candidate of candidates.slice(0, 2)) {
    const content = String(candidate?.content || "").replace(/\s+/g, " ").trim().slice(0, 700);
    if (content.length < 5 || looksSecret(content)) continue;
    const normalized = content.toLowerCase();
    if (normalizedExisting.has(normalized)) continue;
    await supabaseRequest("/rest/v1/permanent_memories", {
      method: "POST",
      token: auth.token,
      prefer: "return=minimal",
      body: {
        user_id: auth.user.id,
        content,
        category: ["fact", "preference", "goal"].includes(candidate.category) ? candidate.category : "fact",
        importance: Math.min(5, Math.max(1, Number(candidate.importance || 3))),
        metadata: { source: "automatic_v02" },
      },
    });
    normalizedExisting.add(normalized);
  }
}

async function maybeCreateSessionSummary({ auth, conversationId, projectId }) {
  const rows = await supabaseRequest(
    `/rest/v1/messages?conversation_id=eq.${encodeURIComponent(conversationId)}&user_id=eq.${encodeURIComponent(auth.user.id)}&select=role,content,created_at&order=created_at.asc&limit=500`,
    { token: auth.token },
  );
  const count = rows?.length || 0;
  if (count < 12 || count % 12 !== 0) return;
  const recent = rows.slice(-12).map((row) => `${row.role.toUpperCase()}: ${row.content}`).join("\n").slice(0, 18_000);
  const result = await chatWithCloudflare([
    { role: "system", content: "Summarize this RAVIN conversation segment in at most 120 words. Preserve decisions, goals, preferences, project facts, unresolved questions, and useful context. Do not add facts that were not stated." },
    { role: "user", content: recent },
  ], { mode: "conversation", tools: [], temperature: 0.1, maxTokens: 240 });
  const summary = result.content?.trim();
  if (!summary) return;
  await supabaseRequest("/rest/v1/session_summaries", {
    method: "POST",
    token: auth.token,
    prefer: "return=minimal",
    body: { user_id: auth.user.id, conversation_id: conversationId, project_id: projectId || null, summary },
  });
}

export function registerV02Routes(app) {
  app.get("/api/v2/capabilities", async (req, res) => {
    const auth = await requireUser(req, res);
    if (!auth) return;
    const current = resolveCapabilityEnvironment(req.query.environment);
    res.json({ current, environments: listCapabilityEnvironments() });
  });

  app.post("/api/v2/files", async (req, res) => {
    const auth = await requireUser(req, res);
    if (!auth) return;
    try {
      const file = req.body?.file || {};
      const name = cleanFileName(file.name);
      const mimeType = String(file.type || "application/octet-stream").slice(0, 160);
      const base64 = String(file.data_base64 || "");
      if (!base64) return res.status(400).json({ error: "File data is required." });
      const buffer = Buffer.from(base64, "base64");
      if (!buffer.length) return res.status(400).json({ error: "The uploaded file was empty." });
      if (buffer.length > MAX_FILE_BYTES) return res.status(413).json({ error: "RAVIN attachments are limited to 8 MB each right now." });
      const textLike = isTextLike(name, mimeType);
      const image = isImage(mimeType);
      const storagePath = `${auth.user.id}/${crypto.randomUUID()}-${name}`;
      await uploadObject(storagePath, buffer, mimeType, auth.token);
      const textContent = textLike ? buffer.toString("utf8").slice(0, MAX_TEXT_ATTACHMENT_CHARS) : null;
      const rows = await supabaseRequest("/rest/v1/files", {
        method: "POST",
        token: auth.token,
        prefer: "return=representation",
        body: {
          user_id: auth.user.id,
          project_id: req.body?.project_id || null,
          storage_path: storagePath,
          file_name: name,
          mime_type: mimeType,
          size_bytes: buffer.length,
          metadata: {
            source: "ravin_chat_v02",
            text_like: textLike,
            image,
            text_content: textContent,
          },
        },
      });
      res.status(201).json({ file: rows?.[0] || null });
    } catch (error) {
      console.error("[RAVIN v0.2 file upload]", error);
      res.status(error?.status || 500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/v2/chat/stream", async (req, res) => {
    const auth = await requireUser(req, res);
    if (!auth) return;
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!message) return res.status(400).json({ error: "Message can't be empty." });

    const mode = normalizeRavinMode(req.body?.mode);
    const environment = resolveCapabilityEnvironment(req.body?.environment).id;
    const attachmentIds = Array.isArray(req.body?.attachment_ids) ? req.body.attachment_ids.slice(0, MAX_ATTACHMENTS) : [];

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    try {
      let conversation = await conversationRecord(req.body?.conversation_id, auth.user.id, auth.token);
      if (!conversation) {
        conversation = await createConversation({
          userId: auth.user.id,
          token: auth.token,
          title: message,
          mode,
          environment,
          projectId: req.body?.project_id || null,
        });
      }
      if (!conversation?.id) throw new Error("RAVIN could not create a conversation.");

      const [priorMessages, memories, attachments] = await Promise.all([
        loadRecentMessages(conversation.id, auth.user.id, auth.token),
        loadRelevantMemories({
          userId: auth.user.id,
          token: auth.token,
          query: message,
          projectId: conversation.project_id,
          conversationId: conversation.id,
        }),
        buildAttachmentContext(attachmentIds, auth, mode),
      ]);

      await saveMessage({
        userId: auth.user.id,
        conversationId: conversation.id,
        role: "user",
        content: message,
        token: auth.token,
        metadata: { mode, environment, attachment_ids: attachmentIds },
      });

      sendEvent(res, "meta", {
        conversation_id: conversation.id,
        mode,
        model: RAVIN_MODELS[mode],
        environment,
        attachments: attachments.files.map((file) => ({ id: file.id, name: file.file_name, type: file.mime_type })),
        memory_hits: (memories.permanent?.length || 0) + (memories.project?.length || 0) + (memories.session?.length || 0),
      });

      const modelMessages = buildModelMessages({
        priorMessages,
        userText: message,
        memoryText: memoryContext(memories),
        attachmentText: attachments.text,
        images: attachments.images,
        environment,
        mode,
      });

      const result = await streamChatWithCloudflare(modelMessages, {
        mode,
        tools: [],
        temperature: mode === "work" ? 0.3 : 0.7,
        maxTokens: mode === "work" ? 1900 : 850,
      }, (token) => sendEvent(res, "token", { text: token }));

      const reply = result.content?.trim();
      if (!reply) throw new Error("RAVIN returned no visible response.");

      await saveMessage({
        userId: auth.user.id,
        conversationId: conversation.id,
        role: "assistant",
        content: reply,
        token: auth.token,
        metadata: {
          mode,
          environment,
          model: result?._ravinMeta?.routedModel || RAVIN_MODELS[mode],
          memory_hits: (memories.permanent?.length || 0) + (memories.project?.length || 0) + (memories.session?.length || 0),
        },
      });

      sendEvent(res, "done", {
        reply,
        conversation_id: conversation.id,
        mode,
        model: result?._ravinMeta?.routedModel || RAVIN_MODELS[mode],
      });
      res.end();

      captureDurableMemories({ auth, userMessage: message }).catch((error) => console.warn("[RAVIN v0.2 memory capture]", error?.message || error));
      maybeCreateSessionSummary({ auth, conversationId: conversation.id, projectId: conversation.project_id }).catch((error) => console.warn("[RAVIN v0.2 session summary]", error?.message || error));
    } catch (error) {
      console.error(`[RAVIN v0.2 stream error] mode=${mode}`, error);
      sendEvent(res, "error", { message: error instanceof Error ? error.message : String(error) });
      res.end();
    }
  });
}
