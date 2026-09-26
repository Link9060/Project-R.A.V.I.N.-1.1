import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const PROJECT_ROOT = path.join(ROOT, "ravin");
const EVO_ROOT = path.join(ROOT, ".evolution");
const STATE_FILE = path.join(EVO_ROOT, "state.json");
const JOURNAL_FILE = path.join(EVO_ROOT, "journal.md");
const CONSTITUTION_FILE = path.join(EVO_ROOT, "CONSTITUTION.md");

const EXPECTED_BRANCH = "evolution";
const MAX_ITERATIONS = Number(process.env.EVOLUTION_MAX_ITERATIONS || 6);
const MAX_RUN_MINUTES = Number(process.env.EVOLUTION_MAX_RUN_MINUTES || 42);
const MAX_AGENT_STEPS = Number(process.env.EVOLUTION_MAX_AGENT_STEPS || 16);
const MODEL = process.env.RAVIN_EVOLUTION_MODEL || process.env.CLOUDFLARE_WORK_MODEL || "@cf/google/gemma-4-26b-a4b-it";
const MAX_TOOL_RESULT_CHARS = 14000;
const MAX_READ_BYTES = 140000;
const MAX_WRITE_BYTES = 250000;
const MAX_CHANGED_FILES = 12;
const MAX_DIFF_CHARS = 60000;

class QuotaPauseError extends Error {
  constructor(message) {
    super(message);
    this.name = "QuotaPauseError";
  }
}

function nowIso() {
  return new Date().toISOString();
}

function gitRaw(args, allowedCodes = [0]) {
  const result = spawnSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  if (!allowedCodes.includes(result.status)) {
    throw new Error("git " + args.join(" ") + " failed: " + (result.stderr || result.stdout || "unknown error").trim());
  }
  return {
    code: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function git(args) {
  return gitRaw(args).stdout.trim();
}

async function readState() {
  return JSON.parse(await fs.readFile(STATE_FILE, "utf8"));
}

async function writeState(state) {
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2) + "\n", "utf8");
}

async function appendJournal(kind, iteration, summary) {
  const clean = String(summary || "").replace(/\s+/g, " ").trim().slice(0, 1200);
  const line = "- " + nowIso() + " | iteration " + iteration + " | " + kind + " | " + clean + "\n";
  await fs.appendFile(JOURNAL_FILE, line, "utf8");
}

function remember(list, entry, limit = 10) {
  const next = Array.isArray(list) ? [...list, entry] : [entry];
  return next.slice(-limit);
}

function currentBranch() {
  return git(["rev-parse", "--abbrev-ref", "HEAD"]);
}

function headSha() {
  return git(["rev-parse", "HEAD"]);
}

function resetProjectTo(sha) {
  git(["reset", "--hard", sha]);
  gitRaw(["clean", "-fd", "--", "ravin"], [0]);
}

function projectRelative(filePath) {
  return path.relative(PROJECT_ROOT, filePath).split(path.sep).join("/");
}

function resolveProjectPath(relativePath) {
  if (typeof relativePath !== "string" || !relativePath.trim()) {
    throw new Error("A project-relative path is required.");
  }

  const normalized = relativePath.replace(/\\/g, "/").replace(/^\.\/+/, "");
  const segments = normalized.split("/").filter(Boolean);
  const blockedSegment = segments.some((segment) =>
    segment === ".git" ||
    segment === "node_modules" ||
    segment === ".ravin-backups" ||
    segment === ".github"
  );
  const blockedEnv = segments.some((segment) => segment === ".env" || segment.startsWith(".env."));

  if (blockedSegment || blockedEnv) {
    throw new Error("That path is protected from autonomous evolution.");
  }

  const resolved = path.resolve(PROJECT_ROOT, normalized);
  const relation = path.relative(PROJECT_ROOT, resolved);

  if (relation.startsWith("..") || path.isAbsolute(relation)) {
    throw new Error("Path is outside the RAVIN project.");
  }

  return resolved;
}

async function walk(directory, recursive = true, depth = 0, output = []) {
  if (output.length >= 500 || depth > 8) return output;
  const entries = await fs.readdir(directory, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (output.length >= 500) break;
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".ravin-backups") continue;

    const full = path.join(directory, entry.name);
    output.push({
      type: entry.isDirectory() ? "directory" : "file",
      path: projectRelative(full),
    });

    if (recursive && entry.isDirectory()) {
      await walk(full, true, depth + 1, output);
    }
  }
  return output;
}

async function listFiles(args = {}) {
  const target = resolveProjectPath(args.directory || ".");
  return {
    directory: projectRelative(target) || ".",
    entries: await walk(target, args.recursive !== false),
  };
}

async function readFile(args = {}) {
  const target = resolveProjectPath(args.path);
  const stat = await fs.stat(target);
  if (!stat.isFile()) throw new Error("Not a file: " + args.path);
  if (stat.size > MAX_READ_BYTES) throw new Error("File is too large to read safely.");

  const raw = await fs.readFile(target, "utf8");
  const lines = raw.split(/\r?\n/);
  const start = Math.max(1, Number(args.line_start || 1));
  const end = Math.min(lines.length, Number(args.line_end || lines.length));

  if (end < start) throw new Error("line_end must be >= line_start.");

  return {
    path: projectRelative(target),
    lineStart: start,
    lineEnd: end,
    totalLines: lines.length,
    content: lines.slice(start - 1, end).join("\n"),
  };
}

async function writeFile(args = {}) {
  if (typeof args.content !== "string") throw new Error("content must be a string");
  if (Buffer.byteLength(args.content, "utf8") > MAX_WRITE_BYTES) {
    throw new Error("File exceeds autonomous write size limit.");
  }
  if (args.content.includes("\u0000")) throw new Error("Null bytes are not allowed.");

  const target = resolveProjectPath(args.path);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, args.content, "utf8");

  return {
    path: projectRelative(target),
    bytes: Buffer.byteLength(args.content, "utf8"),
  };
}

async function inspectProject() {
  let pkg = null;
  try {
    pkg = JSON.parse(await fs.readFile(path.join(PROJECT_ROOT, "package.json"), "utf8"));
  } catch {}

  const entries = await walk(PROJECT_ROOT, true);
  const files = entries.filter((entry) => entry.type === "file").map((entry) => entry.path);

  return {
    name: pkg?.name || "ravin",
    version: pkg?.version || null,
    description: pkg?.description || null,
    scripts: pkg?.scripts || {},
    dependencies: pkg?.dependencies || {},
    fileCount: files.length,
    files: files.slice(0, 350),
  };
}

function collectSourceFiles(directory, output = []) {
  const result = spawnSync("find", [directory, "-type", "f", "(", "-name", "*.js", "-o", "-name", "*.mjs", "-o", "-name", "*.cjs", ")"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error("Could not enumerate JavaScript files for validation.");
  }
  for (const line of result.stdout.split(/\r?\n/)) {
    if (line.trim() && !line.includes("/node_modules/")) output.push(line.trim());
  }
  return output;
}

function deterministicValidation() {
  const failures = [];
  const sourceFiles = collectSourceFiles(PROJECT_ROOT);

  for (const file of sourceFiles) {
    const checked = spawnSync(process.execPath, ["--check", file], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    if (checked.status !== 0) {
      failures.push(path.relative(ROOT, file) + ": " + (checked.stderr || checked.stdout || "syntax check failed").trim());
    }
  }

  for (const jsonPath of ["ravin/package.json", "ravin/public/manifest.json"]) {
    try {
      JSON.parse(requireText(jsonPath));
    } catch (error) {
      failures.push(jsonPath + ": invalid JSON: " + error.message);
    }
  }

  const diffCheck = gitRaw(["diff", "--check", "--", "ravin"], [0, 2]);
  if (diffCheck.code !== 0) {
    failures.push("git diff --check: " + (diffCheck.stderr || diffCheck.stdout).trim());
  }

  return {
    success: failures.length === 0,
    checkedFiles: sourceFiles.length,
    failures: failures.slice(0, 20),
  };
}

function requireText(repoPath) {
  const result = spawnSync("git", ["show", ":" + repoPath], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (result.status === 0) return result.stdout;

  const diskPath = path.join(ROOT, repoPath);
  const disk = spawnSync(process.execPath, ["-e", "process.stdout.write(require('fs').readFileSync(process.argv[1],'utf8'))", diskPath], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (disk.status !== 0) throw new Error("Could not read " + repoPath);
  return disk.stdout;
}

const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "inspect_project",
      description: "Inspect RAVIN architecture, package metadata, and project files before deciding what to improve.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "list_files",
      description: "List files inside the RAVIN project.",
      parameters: {
        type: "object",
        properties: {
          directory: { type: "string" },
          recursive: { type: "boolean" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a RAVIN project file. Read relevant existing files before changing them.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          line_start: { type: "integer", minimum: 1 },
          line_end: { type: "integer", minimum: 1 },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Create or completely replace one file inside the RAVIN project. The evolution controller will review and may revert the result.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_validation",
      description: "Run the controller's deterministic syntax/JSON/diff validation after changes.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
];

async function executeTool(name, args) {
  if (name === "inspect_project") return inspectProject();
  if (name === "list_files") return listFiles(args);
  if (name === "read_file") return readFile(args);
  if (name === "write_file") return writeFile(args);
  if (name === "run_validation") return deterministicValidation();
  throw new Error("Unknown autonomous tool: " + name);
}

function serializeToolResult(value) {
  let text;
  try {
    text = JSON.stringify(value);
  } catch {
    text = JSON.stringify({ value: String(value) });
  }
  if (text.length > MAX_TOOL_RESULT_CHARS) {
    return JSON.stringify({ truncated: true, preview: text.slice(0, MAX_TOOL_RESULT_CHARS) });
  }
  return text;
}

function cloudflareConfig() {
  const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  const token = String(process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_API_KEY || "").trim();
  if (!accountId) throw new Error("Missing CLOUDFLARE_ACCOUNT_ID.");
  if (!token) throw new Error("Missing CLOUDFLARE_API_TOKEN.");
  return { accountId, token };
}

async function callModel(messages, options = {}) {
  const config = cloudflareConfig();
  const body = {
    model: MODEL,
    messages,
    temperature: options.temperature ?? 0.2,
    max_tokens: options.maxTokens ?? 1800,
    stream: false,
  };

  if (options.tools !== false) {
    body.tools = TOOL_DEFINITIONS;
    body.tool_choice = "auto";
  }

  const response = await fetch(
    "https://api.cloudflare.com/client/v4/accounts/" + encodeURIComponent(config.accountId) + "/ai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + config.token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    const quotaLike =
      response.status === 429 ||
      response.status === 402 ||
      /quota|rate limit|limit exceeded|neurons|capacity/i.test(details);

    if (quotaLike) {
      throw new QuotaPauseError("Workers AI quota/rate limit reached (" + response.status + ").");
    }

    throw new Error("Cloudflare Workers AI error " + response.status + ": " + details.slice(0, 1200));
  }

  const data = await response.json();
  const message = data?.choices?.[0]?.message;
  if (!message) throw new Error("Workers AI returned no assistant message.");
  return message;
}

function assistantForHistory(message) {
  const clean = { role: "assistant", content: message?.content ?? null };
  if (Array.isArray(message?.tool_calls) && message.tool_calls.length) clean.tool_calls = message.tool_calls;
  return clean;
}

async function runEvolutionAgent(state, constitution) {
  const systemPrompt =
    "You are the engineering agent inside RAVIN's experimental evolution laboratory.\n\n" +
    constitution +
    "\n\nYou do not control git, GitHub Actions, secrets, or the evolution controller. " +
    "You only have project-scoped tools. Choose ONE highest-value improvement per iteration. " +
    "Inspect before modifying. Preserve unrelated behavior. Prefer small coherent changes. " +
    "Do not rewrite the whole application. Do not add dependencies unless clearly necessary. " +
    "Do not add external network destinations, telemetry, credential handling, or privacy-sensitive behavior unless the existing task absolutely requires it. " +
    "Use run_validation after editing. Never claim verification you did not perform.";

  const stateContext = JSON.stringify({
    iteration: state.iteration,
    recentAccepted: state.recentAccepted || [],
    recentFailures: state.recentFailures || [],
    lastAcceptedSummary: state.lastAcceptedSummary || null,
  });

  const messages = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content:
        "Persistent evolution state: " + stateContext + "\n\n" +
        "Independently inspect the current RAVIN codebase, identify one high-value weakness, implement one bounded improvement, validate it, and finish with a concise summary of what changed and why it is better. " +
        "Do not repeat a recently failed or already accepted change unless there is a specific unresolved reason.",
    },
  ];

  for (let step = 1; step <= MAX_AGENT_STEPS; step += 1) {
    const message = await callModel(messages, { tools: true, temperature: 0.18, maxTokens: 1900 });
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];

    if (!calls.length) {
      return {
        summary: String(message.content || "Agent completed without a textual summary.").trim().slice(0, 1600),
        steps: step,
      };
    }

    messages.push(assistantForHistory(message));

    for (const call of calls) {
      const name = call?.function?.name;
      let args = {};
      try {
        args = JSON.parse(call?.function?.arguments || "{}");
      } catch {
        args = {};
      }

      let result;
      try {
        result = await executeTool(name, args);
      } catch (error) {
        result = { success: false, error: error.message };
      }

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        name,
        content: serializeToolResult(result),
      });
    }
  }

  throw new Error("Evolution agent reached its per-iteration reasoning limit.");
}

function changedFiles() {
  const output = git(["diff", "--name-only", "--", "ravin"]);
  return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

function projectDiff() {
  return gitRaw(["diff", "--", "ravin"], [0]).stdout;
}

function deterministicDiffGuard(files, diff) {
  const reasons = [];

  if (files.length > MAX_CHANGED_FILES) {
    reasons.push("Scope too large: " + files.length + " changed files exceeds limit " + MAX_CHANGED_FILES + ".");
  }

  if (diff.length > MAX_DIFF_CHARS) {
    reasons.push("Diff too large for one autonomous iteration.");
  }

  for (const file of files) {
    if (!file.startsWith("ravin/")) reasons.push("Change escaped the RAVIN project: " + file);
    if (/(^|\/)\.env($|\.)/.test(file)) reasons.push("Environment secret file is protected: " + file);
  }

  const addedLines = diff
    .split(/\r?\n/)
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .join("\n");

  const dangerousPatterns = [
    /child_process/,
    /\bexecSync\s*\(/,
    /\bspawnSync\s*\(/,
    /\beval\s*\(/,
    /\bFunction\s*\(/,
    /curl\s+/,
    /wget\s+/,
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(addedLines)) {
      reasons.push("Added code matched a high-risk execution pattern: " + pattern.toString());
    }
  }

  return { success: reasons.length === 0, reasons };
}

function extractJson(text) {
  const raw = String(text || "").trim();
  try {
    return JSON.parse(raw);
  } catch {}
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(raw.slice(start, end + 1));
  }
  throw new Error("Evaluator did not return valid JSON.");
}

async function evaluateDiff(diff, files, validation, constitution) {
  const prompt =
    "Review this proposed autonomous RAVIN change as a strict release gate.\n\n" +
    "Constitution:\n" + constitution + "\n\n" +
    "Changed files: " + JSON.stringify(files) + "\n" +
    "Deterministic validation: " + JSON.stringify(validation) + "\n\n" +
    "Diff:\n" + diff.slice(0, MAX_DIFF_CHARS) + "\n\n" +
    "Reject if the change is unsafe, privacy-invasive, credential-related, overly broad, likely to regress existing behavior, incomplete, unjustified, or not actually an improvement. " +
    "Accept only a bounded coherent improvement that passed validation. " +
    "Return ONLY JSON with this exact shape: " +
    "{\"accept\":true,\"reason\":\"short reason\",\"summary\":\"short description of improvement\"}";

  const message = await callModel(
    [
      { role: "system", content: "You are a conservative software change reviewer. Do not use tools." },
      { role: "user", content: prompt },
    ],
    { tools: false, temperature: 0, maxTokens: 550 }
  );

  const verdict = extractJson(message.content);
  return {
    accept: verdict.accept === true,
    reason: String(verdict.reason || "No reason supplied.").slice(0, 800),
    summary: String(verdict.summary || "Autonomous improvement.").slice(0, 500),
  };
}

async function checkpoint(state, kind, summary, commitCode) {
  await writeState(state);
  await appendJournal(kind, state.iteration, summary);

  git(["add", ".evolution/state.json", ".evolution/journal.md"]);
  if (commitCode) git(["add", "ravin"]);

  const staged = gitRaw(["diff", "--cached", "--quiet"], [0, 1]);
  if (staged.code === 0) return;

  const subject = ("evo: " + kind + " iteration " + state.iteration).slice(0, 72);
  git(["commit", "-m", subject]);
  git(["push", "origin", "HEAD:evolution"]);
}

async function recordFailure(state, kind, message) {
  state.rejected += 1;
  state.status = "running";
  state.currentExperiment = null;
  state.recentFailures = remember(state.recentFailures, {
    iteration: state.iteration,
    at: nowIso(),
    kind,
    message: String(message).slice(0, 700),
  });
  await checkpoint(state, "rejected", kind + ": " + message, false);
}

async function pauseForQuota(state, baseSha, message) {
  resetProjectTo(baseSha);
  state.quotaPauses += 1;
  state.status = "paused_quota";
  state.currentExperiment = null;
  state.recentFailures = remember(state.recentFailures, {
    iteration: state.iteration,
    at: nowIso(),
    kind: "quota",
    message,
  });
  await checkpoint(state, "quota-pause", message, false);
}

async function main() {
  if (currentBranch() !== EXPECTED_BRANCH) {
    throw new Error("Evolution controller refuses to run outside the evolution branch.");
  }

  const initialStatus = git(["status", "--porcelain"]);
  if (initialStatus) {
    throw new Error("Evolution branch must start clean. Found uncommitted changes:\n" + initialStatus);
  }

  const constitution = await fs.readFile(CONSTITUTION_FILE, "utf8");
  const state = await readState();
  const startedAt = Date.now();
  const deadline = startedAt + MAX_RUN_MINUTES * 60 * 1000;

  state.status = "running";
  state.lastRunAt = nowIso();

  for (let runIndex = 0; runIndex < MAX_ITERATIONS && Date.now() < deadline; runIndex += 1) {
    state.iteration += 1;
    state.attempted += 1;
    state.currentExperiment = "Selecting and implementing one bounded improvement";
    const baseSha = headSha();

    let agentResult;
    try {
      agentResult = await runEvolutionAgent(state, constitution);
    } catch (error) {
      if (error instanceof QuotaPauseError) {
        await pauseForQuota(state, baseSha, error.message);
        console.log("Evolution paused for API quota. A later scheduled run will retry.");
        return;
      }

      resetProjectTo(baseSha);
      await recordFailure(state, "agent-error", error.message);
      continue;
    }

    const files = changedFiles();
    if (!files.length) {
      state.noops += 1;
      state.status = "running";
      state.currentExperiment = null;
      state.recentFailures = remember(state.recentFailures, {
        iteration: state.iteration,
        at: nowIso(),
        kind: "no-op",
        message: agentResult.summary,
      });
      await checkpoint(state, "no-op", agentResult.summary, false);
      continue;
    }

    const diff = projectDiff();
    const guard = deterministicDiffGuard(files, diff);
    const validation = deterministicValidation();

    if (!guard.success || !validation.success) {
      resetProjectTo(baseSha);
      const reason =
        (!guard.success ? guard.reasons.join(" | ") : "") +
        (!validation.success ? " | Validation: " + validation.failures.join(" | ") : "");
      await recordFailure(state, "deterministic-gate", reason.replace(/^\s*\|\s*/, ""));
      continue;
    }

    let verdict;
    try {
      verdict = await evaluateDiff(diff, files, validation, constitution);
    } catch (error) {
      if (error instanceof QuotaPauseError) {
        await pauseForQuota(state, baseSha, "Quota reached before review; unreviewed code was discarded.");
        console.log("Evolution paused for API quota before review. Proposed code was reverted.");
        return;
      }

      resetProjectTo(baseSha);
      await recordFailure(state, "review-error", error.message);
      continue;
    }

    if (!verdict.accept) {
      resetProjectTo(baseSha);
      await recordFailure(state, "review-rejected", verdict.reason);
      continue;
    }

    state.accepted += 1;
    state.status = "running";
    state.currentExperiment = null;
    state.lastAcceptedAt = nowIso();
    state.lastAcceptedSummary = verdict.summary;
    state.recentAccepted = remember(state.recentAccepted, {
      iteration: state.iteration,
      at: state.lastAcceptedAt,
      files,
      summary: verdict.summary,
    });

    await checkpoint(state, "accepted", verdict.summary + " | " + verdict.reason, true);
    console.log("Accepted evolution iteration " + state.iteration + ": " + verdict.summary);
  }

  state.status = "idle";
  state.currentExperiment = null;
  await checkpoint(state, "run-complete", "Bounded evolution session completed.", false);
  console.log("Evolution session complete.");
}

main().catch(async (error) => {
  console.error("RAVIN evolution controller failed:", error?.stack || error);
  process.exitCode = 1;
});
