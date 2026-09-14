import crypto from "node:crypto";

import { documentKind, extractDocument } from "./documentExtractor.js";

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const FILE_BUCKET = "ravin-files";
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_STORED_TEXT_CHARS = 180_000;

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

function storagePathUrl(pathname) {
  const encoded = String(pathname).split("/").map(encodeURIComponent).join("/");
  return `${SUPABASE_URL}/storage/v1/object/${FILE_BUCKET}/${encoded}`;
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

function isImage(mimeType) {
  return String(mimeType || "").startsWith("image/");
}

export function registerDocumentRoutes(app) {
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
        file: stored,
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
}
