import fs from "node:fs/promises";
import path from "node:path";

const SECRET_PATTERNS = [
  { name: "OpenAI-style secret", re: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: "GitHub token", re: /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/ },
  { name: "Bearer token literal", re: /\bBearer\s+[A-Za-z0-9._~+/=-]{24,}\b/i },
  { name: "private key", re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "JWT-like token", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
];

const HIGH_RISK_ADDED_PATTERNS = [
  { name: "child_process import/use", re: /\bchild_process\b/ },
  { name: "dynamic eval", re: /\beval\s*\(/ },
  { name: "Function constructor", re: /\bnew\s+Function\s*\(|\bFunction\s*\(/ },
  { name: "shell download", re: /\b(?:curl|wget)\s+/ },
  { name: "shell execution", re: /\b(?:exec|execSync|spawn|spawnSync)\s*\(/ },
  { name: "process env enumeration", re: /Object\.(?:keys|entries)\s*\(\s*process\.env\s*\)/ },
];

const SECURITY_MARKERS = [
  "requireUser(",
  "getAuthenticatedUser(",
  "Authorization",
  "SUPABASE_ANON_KEY",
  "CLOUDFLARE_API_TOKEN",
];

function within(root, target) {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export async function createPathResolver(projectRoot) {
  const projectReal = await fs.realpath(projectRoot);

  return async function resolveProjectPath(relativePath, { allowMissingLeaf = true } = {}) {
    if (typeof relativePath !== "string" || !relativePath.trim()) {
      throw new Error("A project-relative path is required.");
    }

    const normalized = relativePath.replace(/\\/g, "/").replace(/^\.\/+/, "");
    const segments = normalized.split("/").filter(Boolean);

    if (segments.some((segment) =>
      segment === ".git" ||
      segment === "node_modules" ||
      segment === ".ravin-backups" ||
      segment === ".github" ||
      segment === ".evolution"
    )) {
      throw new Error("That path is protected from autonomous evolution.");
    }

    if (segments.some((segment) => segment === ".env" || segment.startsWith(".env."))) {
      throw new Error("Environment files are protected from autonomous evolution.");
    }

    let cursor = projectReal;
    for (let i = 0; i < segments.length; i += 1) {
      cursor = path.join(cursor, segments[i]);
      try {
        const stat = await fs.lstat(cursor);
        if (stat.isSymbolicLink()) {
          throw new Error("Symbolic-link paths are not allowed in autonomous evolution.");
        }
        const real = await fs.realpath(cursor);
        if (!within(projectReal, real)) {
          throw new Error("Resolved path escapes the RAVIN project.");
        }
      } catch (error) {
        if (error?.code === "ENOENT" && allowMissingLeaf) {
          const remaining = segments.slice(i).join(path.sep);
          const target = path.resolve(path.dirname(cursor), remaining);
          if (!within(projectReal, target)) throw new Error("Path escapes the RAVIN project.");
          return target;
        }
        throw error;
      }
    }

    const target = path.resolve(projectReal, ...segments);
    if (!within(projectReal, target)) throw new Error("Path escapes the RAVIN project.");
    return target;
  };
}

export function scanTextForSecrets(text) {
  const findings = [];
  for (const item of SECRET_PATTERNS) {
    if (item.re.test(String(text || ""))) findings.push(item.name);
  }
  return [...new Set(findings)];
}

export async function scanFilesForSecrets(projectRoot, relativeFiles) {
  const findings = [];
  for (const rel of relativeFiles) {
    const full = path.join(projectRoot, rel.replace(/^ravin\//, ""));
    try {
      const stat = await fs.lstat(full);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 300_000) continue;
      const content = await fs.readFile(full, "utf8");
      const matches = scanTextForSecrets(content);
      if (matches.length) findings.push({ file: rel, matches });
    } catch {}
  }
  return findings;
}

function extractDiffLines(diff, prefix) {
  return String(diff || "")
    .split(/\r?\n/)
    .filter((line) => line.startsWith(prefix) && !line.startsWith(prefix.repeat(3)))
    .map((line) => line.slice(1))
    .join("\n");
}

export function deterministicDiffGuard(files, diff, {
  maxChangedFiles = 12,
  maxDiffChars = 80_000,
} = {}) {
  const reasons = [];

  if (files.length > maxChangedFiles) {
    reasons.push("Scope too large: " + files.length + " changed files exceeds " + maxChangedFiles + ".");
  }

  if (String(diff || "").length > maxDiffChars) {
    reasons.push("Diff too large for one autonomous iteration.");
  }

  for (const file of files) {
    if (!file.startsWith("ravin/")) reasons.push("Change escaped the RAVIN project: " + file);
    if (/(^|\/)\.env($|\.)/.test(file)) reasons.push("Environment secret file is protected: " + file);
    if (file.includes("node_modules/")) reasons.push("node_modules changes are not allowed.");
  }

  const added = extractDiffLines(diff, "+");
  const deleted = extractDiffLines(diff, "-");

  for (const item of HIGH_RISK_ADDED_PATTERNS) {
    if (item.re.test(added)) reasons.push("Added code matched high-risk pattern: " + item.name + ".");
  }

  const secretFindings = scanTextForSecrets(added);
  for (const finding of secretFindings) reasons.push("Possible secret introduced: " + finding + ".");

  const allowedHosts = new Set([
    "api.cloudflare.com",
    "fonts.googleapis.com",
    "fonts.gstatic.com",
    "cdn.jsdelivr.net",
    "link9060.github.io"
  ]);
  const urls = added.match(/https?:\\/\\/[^\\s"'\\`<>)}]+/g) || [];
  for (const value of urls) {
    try {
      const host = new URL(value).hostname.toLowerCase();
      if (!allowedHosts.has(host)) {
        reasons.push("New external network destination requires human review: " + host + ".");
      }
    } catch {
      reasons.push("Malformed external URL added to code.");
    }
  }

  const deletedSecurity = SECURITY_MARKERS.filter((marker) => deleted.includes(marker));
  const addedSecurity = SECURITY_MARKERS.filter((marker) => added.includes(marker));
  for (const marker of deletedSecurity) {
    if (!addedSecurity.includes(marker)) {
      reasons.push("Security/auth marker removed without replacement in diff: " + marker);
    }
  }

  const packageChanged = files.includes("ravin/package.json");
  const lockChanged = files.includes("ravin/package-lock.json");
  if (packageChanged !== lockChanged) {
    reasons.push("package.json and package-lock.json must change together.");
  }

  return {
    success: reasons.length === 0,
    reasons: [...new Set(reasons)],
  };
}

export function findPromptInjectionSignals(diff) {
  const text = String(diff || "").toLowerCase();
  const signals = [
    "ignore previous instructions",
    "ignore the reviewer",
    "system prompt",
    "you are the reviewer",
    "return only json",
    "mark this change as safe",
  ];
  return signals.filter((signal) => text.includes(signal));
}
