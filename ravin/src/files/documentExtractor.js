import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const MAX_COMMAND_BUFFER = 20 * 1024 * 1024;
const DEFAULT_STORED_CHARS = 180_000;

function extension(name = "") {
  return path.extname(String(name).toLowerCase());
}

function xmlDecode(value = "") {
  return String(value)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

export function normalizeExtractedText(value = "") {
  return String(value)
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v]+/g, " ")
    .replace(/[ ]{3,}/g, "  ")
    .replace(/\n[ ]+/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

export function documentKind(name = "", mimeType = "") {
  const ext = extension(name);
  const mime = String(mimeType || "").toLowerCase();
  if (mime === "application/pdf" || ext === ".pdf") return "pdf";
  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || ext === ".docx") return "docx";
  if (mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation" || ext === ".pptx") return "pptx";
  if (
    mime.startsWith("text/") ||
    ["application/json", "application/xml", "application/javascript", "application/x-javascript"].includes(mime) ||
    /\.(txt|md|markdown|json|csv|js|mjs|cjs|ts|tsx|jsx|py|java|c|cpp|h|hpp|html|css|xml|yaml|yml|toml|ini|log|sql|sh)$/i.test(ext)
  ) return "text";
  return "unsupported";
}

async function withTempFile(buffer, suffix, fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ravin-doc-"));
  const input = path.join(dir, `input${suffix || ".bin"}`);
  try {
    await writeFile(input, buffer);
    return await fn({ dir, input });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function command(file, args, options = {}) {
  return execFileAsync(file, args, {
    encoding: "utf8",
    maxBuffer: MAX_COMMAND_BUFFER,
    timeout: 20_000,
    ...options,
  });
}

function pdfInfoFromText(raw = "") {
  const info = {};
  for (const line of String(raw).split(/\r?\n/)) {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;
    info[match[1].trim().toLowerCase().replace(/\s+/g, "_")] = match[2].trim();
  }
  const pages = Number(info.pages || 0);
  return {
    pages: Number.isFinite(pages) && pages > 0 ? pages : null,
    title: info.title || null,
    author: info.author || null,
    creator: info.creator || null,
    producer: info.producer || null,
  };
}

function pageMarkedPdfText(raw = "") {
  const pages = String(raw).replace(/\r\n?/g, "\n").split("\f");
  const parts = [];
  pages.forEach((page, index) => {
    const text = normalizeExtractedText(page);
    if (text) parts.push(`--- Page ${index + 1} ---\n${text}`);
  });
  return normalizeExtractedText(parts.join("\n\n"));
}

async function extractPdf(buffer) {
  return withTempFile(buffer, ".pdf", async ({ input }) => {
    const [textResult, infoResult] = await Promise.allSettled([
      command("pdftotext", ["-layout", "-enc", "UTF-8", input, "-"]),
      command("pdfinfo", [input]),
    ]);

    if (textResult.status === "rejected") throw textResult.reason;
    const text = pageMarkedPdfText(textResult.value.stdout || "");
    const info = infoResult.status === "fulfilled" ? pdfInfoFromText(infoResult.value.stdout) : { pages: null };
    return { text, metadata: info };
  });
}

async function unzipText(input, entry) {
  const result = await command("unzip", ["-p", input, entry]);
  return result.stdout || "";
}

async function extractDocx(buffer) {
  return withTempFile(buffer, ".docx", async ({ input }) => {
    const xml = await unzipText(input, "word/document.xml");
    const text = xmlDecode(xml)
      .replace(/<w:tab\b[^>]*\/>/g, "\t")
      .replace(/<w:br\b[^>]*\/>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<\/w:tr>/g, "\n")
      .replace(/<\/w:tc>/g, "\t")
      .replace(/<[^>]+>/g, "");
    return { text: normalizeExtractedText(text), metadata: {} };
  });
}

function slideNumber(entry) {
  const match = String(entry).match(/slide(\d+)\.xml$/i);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

async function extractPptx(buffer) {
  return withTempFile(buffer, ".pptx", async ({ input }) => {
    const list = await command("unzip", ["-Z1", input]);
    const slides = String(list.stdout || "")
      .split(/\r?\n/)
      .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/i.test(entry))
      .sort((a, b) => slideNumber(a) - slideNumber(b));

    const parts = [];
    for (const entry of slides) {
      const xml = await unzipText(input, entry);
      const chunks = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((match) => xmlDecode(match[1]));
      const text = normalizeExtractedText(chunks.join("\n"));
      if (text) parts.push(`--- Slide ${slideNumber(entry)} ---\n${text}`);
    }
    return { text: normalizeExtractedText(parts.join("\n\n")), metadata: { slides: slides.length } };
  });
}

export async function extractDocument({ buffer, name = "attachment", mimeType = "application/octet-stream", maxChars = DEFAULT_STORED_CHARS }) {
  const kind = documentKind(name, mimeType);
  let result;

  try {
    if (kind === "text") {
      result = { text: normalizeExtractedText(buffer.toString("utf8")), metadata: {} };
    } else if (kind === "pdf") {
      result = await extractPdf(buffer);
    } else if (kind === "docx") {
      result = await extractDocx(buffer);
    } else if (kind === "pptx") {
      result = await extractPptx(buffer);
    } else {
      return { kind, status: "unsupported", text: "", metadata: {}, truncated: false };
    }
  } catch (error) {
    return {
      kind,
      status: "error",
      text: "",
      metadata: { extraction_error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500) },
      truncated: false,
    };
  }

  const fullText = normalizeExtractedText(result.text || "");
  const truncated = fullText.length > maxChars;
  const text = truncated ? fullText.slice(0, maxChars) : fullText;
  return {
    kind,
    status: text.length >= 20 ? "ok" : "empty",
    text,
    metadata: { ...(result.metadata || {}), extracted_chars: text.length, original_extracted_chars: fullText.length },
    truncated,
  };
}

export async function renderPdfPages({ buffer, pageCount = null, maxPages = 3, maxDimension = 1500 }) {
  return withTempFile(buffer, ".pdf", async ({ dir, input }) => {
    const count = Math.max(1, Math.min(maxPages, Number(pageCount || maxPages) || maxPages));
    const images = [];
    for (let page = 1; page <= count; page += 1) {
      const prefix = path.join(dir, `page-${page}`);
      try {
        await command("pdftoppm", [
          "-f", String(page),
          "-l", String(page),
          "-jpeg",
          "-singlefile",
          "-scale-to", String(maxDimension),
          input,
          prefix,
        ]);
        const bytes = await readFile(`${prefix}.jpg`);
        if (bytes.length) images.push({ page, mimeType: "image/jpeg", buffer: bytes });
      } catch {
        break;
      }
    }
    return images;
  });
}
