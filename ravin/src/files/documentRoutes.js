import crypto from "node:crypto";

import { documentKind, extractDocument } from "./documentExtractor.js";

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const FILE_BUCKET = "ravin-files";
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_STORED_TEXT_CHARS = 180_000;
const MAX_ATTACHMENTS = 4;

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

function cleanFileName(name) {
  return String(name || "attachment")
    .replace(/[\\/]+/g, "-")
    .replace(/[^a-zA-Z0-9._() -]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "attachment";
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

async function deleteObject(pathname, token) {
  const response = await fetch(storagePathUrl(pathname), {
    method: "DELETE",
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!response.ok && response.status !== 404) {
    const text = await response.text().catch(() => "");
    throw new Error(`RAVIN couldn't delete that stored file (${response.status}). ${text}`.trim());
  }
}

function isImage(mimeType) {
  return String(mimeType || "").startsWith("image/");
}

function publicFileRow(row) {
  const metadata = { ...(row?.metadata || {}) };
  delete metadata.text_content;
  return { ...row, metadata };
}

async function getFileRow(id, auth) {
  const rows = await supabaseRequest(
    `/rest/v1/files?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(auth.user.id)}&select=id,file_name,mime_type,size_bytes,storage_path,metadata,project_id,created_at&limit=1`,
    { token: auth.token },
  );
  return rows?.[0] || null;
}

async function ensureExtracted(row, auth) {
  if (!row || row.metadata?.text_content || isImage(row.mime_type)) return row;
  const kind = documentKind(row.file_name, row.mime_type);
  if (kind === "unsupported") return row;

  try {
    const buffer = await downloadObject(row.storage_path, auth.token);
    const extraction = await extractDocument({
      buffer,
      name: row.file_name,
      mimeType: row.mime_type,
      maxChars: MAX_STORED_TEXT_CHARS,
    });
    const metadata = {
      ...(row.metadata || {}),
      document_kind: extraction.kind,
      extraction_status: extraction.status,
      extraction_truncated: Boolean(extraction.truncated),
      extraction: extraction.metadata || {},
      text_content: extraction.text || null,
      reextracted_at: new Date().toISOString(),
    };
    await supabaseRequest(
      `/rest/v1/files?id=eq.${encodeURIComponent(row.id)}&user_id=eq.${encodeURIComponent(auth.user.id)}`,
      { method: "PATCH", token: auth.token, prefer: "return=minimal", body: { metadata } },
    );
    return { ...row, metadata };
  } catch (error) {
    console.warn(`[RAVIN file re-extract] ${row.file_name}:`, error?.message || error);
    return row;
  }
}

async function recentConversationAttachmentIds(conversationId, auth) {
  if (!conversationId) return [];
  const rows = await supabaseRequest(
    `/rest/v1/messages?conversation_id=eq.${encodeURIComponent(conversationId)}&user_id=eq.${encodeURIComponent(auth.user.id)}&select=metadata,created_at&order=created_at.desc&limit=12`,
    { token: auth.token },
  );
  for (const row of rows || []) {
    const ids = Array.isArray(row?.metadata?.attachment_ids) ? row.metadata.attachment_ids.filter(Boolean) : [];
    if (ids.length) return [...new Set(ids)].slice(0, MAX_ATTACHMENTS);
  }
  return [];
}

const FILE_QUERY_STOP_WORDS = new Set([
  "a", "an", "and", "are", "can", "could", "do", "does", "file", "files", "for", "from", "have", "homework",
  "i", "in", "is", "it", "me", "my", "of", "on", "or", "please", "pull", "read", "recent", "see", "show",
  "that", "the", "this", "to", "up", "upload", "uploaded", "was", "what", "with", "you",
]);

function fileQueryTokens(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,8}\b/g, " ")
    .match(/[a-z]+|\d+(?:\.\d+)?/g)?.filter((token) => token.length > 1 && !FILE_QUERY_STOP_WORDS.has(token)) || [];
}

function fileIntent(value) {
  return /\b(file|files|pdf|document|doc|worksheet|work\s*sheet|ws|homework|assignment|notes?|slides?|presentation|upload(?:ed)?|attachment|image|photo|screenshot)\b/i.test(String(value || ""))
    || /\.(pdf|docx?|pptx?|xlsx?|txt|md|csv|png|jpe?g|webp)\b/i.test(String(value || ""));
}

function fileRelevanceScore(row, query) {
  const queryTokens = fileQueryTokens(query);
  const name = String(row?.file_name || "").toLowerCase();
  const stem = name.replace(/\.[^.]+$/, "");
  const nameTokens = new Set(fileQueryTokens(stem));
  let score = 0;

  for (const token of queryTokens) {
    if (nameTokens.has(token)) score += /^\d/.test(token) ? 7 : 5;
    else if (token.length >= 3 && stem.includes(token)) score += 2.5;
  }

  const compactQuery = queryTokens.join(" ");
  if (compactQuery && stem.includes(compactQuery)) score += 10;

  const created = new Date(row?.created_at || 0).getTime();
  const ageDays = created ? Math.max(0, (Date.now() - created) / 86_400_000) : 365;
  score += Math.max(0, 4 - Math.log2(ageDays + 1));

  if (row?.metadata?.text_content) score += 1.25;
  if (/pdf|text|document/i.test(String(row?.metadata?.document_kind || row?.mime_type || ""))) score += .5;
  return score;
}

async function recentRelevantFileRows(query, auth, limit = MAX_ATTACHMENTS) {
  const rows = await supabaseRequest(
    `/rest/v1/files?user_id=eq.${encodeURIComponent(auth.user.id)}&select=id,file_name,mime_type,size_bytes,storage_path,metadata,project_id,created_at&order=created_at.desc&limit=24`,
    { token: auth.token },
  );
  if (!rows?.length) return [];

  const ranked = rows
    .map((row, index) => ({ row, index, score: fileRelevanceScore(row, query) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const meaningful = ranked.filter((item) => item.score >= 4.5).slice(0, limit);
  // If the request is clearly about a file but naming is vague, inspect the
  // newest few documents rather than making the user remember an exact filename.
  const selected = meaningful.length ? meaningful : ranked.slice(0, Math.min(3, limit));
  return selected.map((item) => item.row);
}

export function registerDocumentRoutes(app) {
  // Keep the most recent attachment set available to follow-up turns. This runs
  // before v0.2 chat, so the stable stream route receives ordinary attachment_ids.
  app.use("/api/v2/chat/stream", async (req, _res, next) => {
    if (req.method !== "POST") return next();
    try {
      const auth = await authenticate(req);
      if (!auth) return next();
      const explicit = Array.isArray(req.body?.attachment_ids)
        ? req.body.attachment_ids.filter(Boolean).slice(0, MAX_ATTACHMENTS)
        : [];
      const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
      const workMode = String(req.body?.mode || "").toLowerCase() === "work";
      const inherited = explicit.length
        ? []
        : await recentConversationAttachmentIds(req.body?.conversation_id, auth);
      const autoRows = (!explicit.length && workMode && fileIntent(message))
        ? await recentRelevantFileRows(message, auth, MAX_ATTACHMENTS)
        : [];
      const autoIds = autoRows.map((row) => row.id).filter(Boolean);
      const ids = explicit.length
        ? explicit
        : [...new Set([...autoIds, ...inherited])].slice(0, MAX_ATTACHMENTS);

      if (ids.length) {
        // Old uploads created before document extraction was enabled are upgraded
        // lazily the first time Work mode needs them.
        for (const id of ids) {
          const row = await getFileRow(id, auth);
          if (row) await ensureExtracted(row, auth);
        }
        req.body.attachment_ids = ids;
      }

      req.body.ravin_file_context = {
        searched_library: Boolean(workMode && fileIntent(message) && !explicit.length),
        source: explicit.length ? "attached_now" : autoIds.length ? "recent_library" : inherited.length ? "conversation" : "none",
        matched_ids: autoIds,
        matched_names: autoRows.map((row) => row.file_name),
      };
    } catch (error) {
      // Attachment carry-forward should never take chat down. The downstream
      // route can still answer without inherited context if this helper fails.
      console.warn("[RAVIN attachment context]", error?.message || error);
    }
    next();
  });

  // Register this BEFORE the legacy v0.2 file route. Express stops at this
  // handler after a response, so the stable chat stream can keep using the
  // existing file rows while uploads gain real document extraction.
  app.post("/api/v2/files", async (req, res) => {
    const auth = await authenticate(req);
    if (!auth) return res.status(401).json({ error: "Please sign in to RAVIN." });

    try {
      const file = req.body?.file || {};
      const name = cleanFileName(file.name);
      const mimeType = String(file.type || "application/octet-stream").slice(0, 160);
      const base64 = String(file.data_base64 || "");
      if (!base64) return res.status(400).json({ error: "File data is required." });

      const buffer = Buffer.from(base64, "base64");
      if (!buffer.length) return res.status(400).json({ error: "The uploaded file was empty." });
      if (buffer.length > MAX_FILE_BYTES) {
        return res.status(413).json({ error: "RAVIN attachments are limited to 8 MB each right now." });
      }

      const kind = documentKind(name, mimeType);
      const image = isImage(mimeType);
      const extraction = image
        ? { kind: "image", status: "image", text: "", metadata: {}, truncated: false }
        : await extractDocument({ buffer, name, mimeType, maxChars: MAX_STORED_TEXT_CHARS });

      const storagePath = `${auth.user.id}/${crypto.randomUUID()}-${name}`;
      await uploadObject(storagePath, buffer, mimeType, auth.token);

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
            text_like: kind === "text",
            image,
            document_kind: extraction.kind,
            extraction_status: extraction.status,
            extraction_truncated: Boolean(extraction.truncated),
            extraction: extraction.metadata || {},
            text_content: extraction.text || null,
          },
        },
      });

      const stored = rows?.[0] || null;
      res.status(201).json({
        file: stored ? publicFileRow(stored) : null,
        extraction: {
          kind: extraction.kind,
          status: extraction.status,
          chars: extraction.text?.length || 0,
          truncated: Boolean(extraction.truncated),
          pages: extraction.metadata?.pages || null,
          slides: extraction.metadata?.slides || null,
        },
      });
    } catch (error) {
      console.error("[RAVIN document upload]", error);
      res.status(error?.status || 500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Private file library for the signed-in user. Extracted document text stays
  // server-side; the browser only receives metadata needed to draw the library.
  app.get("/api/v2/files", async (req, res) => {
    const auth = await authenticate(req);
    if (!auth) return res.status(401).json({ error: "Please sign in to RAVIN." });
    try {
      const rows = await supabaseRequest(
        `/rest/v1/files?user_id=eq.${encodeURIComponent(auth.user.id)}&select=id,file_name,mime_type,size_bytes,metadata,project_id,created_at&order=created_at.desc&limit=100`,
        { token: auth.token },
      );
      res.json({ files: (rows || []).map(publicFileRow) });
    } catch (error) {
      console.error("[RAVIN file library]", error);
      res.status(error?.status || 500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete("/api/v2/files/:id", async (req, res) => {
    const auth = await authenticate(req);
    if (!auth) return res.status(401).json({ error: "Please sign in to RAVIN." });
    try {
      const row = await getFileRow(req.params.id, auth);
      if (!row) return res.status(404).json({ error: "File not found." });
      await deleteObject(row.storage_path, auth.token);
      await supabaseRequest(
        `/rest/v1/files?id=eq.${encodeURIComponent(row.id)}&user_id=eq.${encodeURIComponent(auth.user.id)}`,
        { method: "DELETE", token: auth.token, prefer: "return=minimal" },
      );
      res.status(204).end();
    } catch (error) {
      console.error("[RAVIN file delete]", error);
      res.status(error?.status || 500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
