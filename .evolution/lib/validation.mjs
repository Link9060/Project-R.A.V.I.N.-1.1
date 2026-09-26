import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

function walkSync(root, matcher, output = []) {
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = spawnSync(process.execPath, [
        "-e",
        "const fs=require('fs');const p=process.argv[1];process.stdout.write(JSON.stringify(fs.readdirSync(p,{withFileTypes:true}).map(e=>({n:e.name,d:e.isDirectory(),f:e.isFile(),l:e.isSymbolicLink()}))))",
        current,
      ], { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
      if (entries.status !== 0) continue;
      entries = JSON.parse(entries.stdout || "[]");
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.l || entry.n === "node_modules" || entry.n === ".git" || entry.n === ".ravin-backups") continue;
      const full = path.join(current, entry.n);
      if (entry.d) stack.push(full);
      else if (entry.f && matcher(full)) output.push(full);
    }
  }
  return output;
}

function checkJavaScript(projectRoot) {
  const failures = [];
  const files = walkSync(projectRoot, (file) => /\.(?:js|mjs|cjs)$/.test(file));
  for (const file of files) {
    const result = spawnSync(process.execPath, ["--check", file], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    if (result.status !== 0) {
      failures.push(path.relative(projectRoot, file) + ": " + (result.stderr || result.stdout || "syntax error").trim());
    }
  }
  return { files: files.length, failures };
}

async function checkJson(projectRoot) {
  const failures = [];
  const files = walkSync(projectRoot, (file) => file.endsWith(".json"));
  for (const file of files) {
    try {
      JSON.parse(await fs.readFile(file, "utf8"));
    } catch (error) {
      failures.push(path.relative(projectRoot, file) + ": " + error.message);
    }
  }
  return { files: files.length, failures };
}

async function checkPackageLock(projectRoot) {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(projectRoot, "package.json"), "utf8"));
    const lock = JSON.parse(await fs.readFile(path.join(projectRoot, "package-lock.json"), "utf8"));
    const a = JSON.stringify(pkg.dependencies || {});
    const b = JSON.stringify(lock?.packages?.[""]?.dependencies || {});
    return {
      success: a === b,
      reason: a === b ? null : "package.json dependencies do not match package-lock.json root dependencies.",
    };
  } catch (error) {
    return { success: false, reason: "Could not validate package lock: " + error.message };
  }
}

async function checkUiContracts(projectRoot) {
  const file = path.join(projectRoot, "public", "index.html");
  let html = "";
  try { html = await fs.readFile(file, "utf8"); } catch {}

  const contracts = [
    ["arrow shell mount", /data-arrow-os-shell/],
    ["arrow shell stylesheet", /arrow-shell\.css/],
    ["arrow shell script", /arrow-shell\.js/],
    ["chat composer", /id=["']composer["']/],
    ["message input", /id=["']messageInput["']/],
    ["send button", /id=["']sendBtn["']/],
    ["settings button", /id=["']settingsBtn["']/],
    ["viewport metadata", /name=["']viewport["']/],
  ];

  const results = contracts.map(([name, re]) => ({ name, pass: re.test(html) }));
  return {
    results,
    passed: results.filter((x) => x.pass).length,
    total: results.length,
    success: results.every((x) => x.pass),
  };
}

async function checkApiSecurityContracts(projectRoot) {
  let server = "";
  try { server = await fs.readFile(path.join(projectRoot, "server.js"), "utf8"); } catch {}

  const contracts = [
    ["auth function exists", /function\s+requireUser\s*\(/],
    ["auth lookup exists", /function\s+getAuthenticatedUser\s*\(/],
    ["chat route exists", /app\.post\(["']\/api\/chat["']/],
    ["build route exists", /app\.post\(["']\/api\/build["']/],
    ["health route exists", /app\.get\(["']\/api\/health["']/],
    ["memory route exists", /\/api\/memories/],
    ["chat route checks auth", /app\.post\(["']\/api\/chat["'][\s\S]{0,700}?requireUser\s*\(/],
    ["build route checks auth", /app\.post\(["']\/api\/build["'][\s\S]{0,700}?requireUser\s*\(/],
  ];

  const results = contracts.map(([name, re]) => ({ name, pass: re.test(server) }));
  return {
    results,
    passed: results.filter((x) => x.pass).length,
    total: results.length,
    success: results.every((x) => x.pass),
  };
}

async function directorySize(root) {
  let total = 0;
  const files = walkSync(root, (file) => !file.includes(path.sep + "node_modules" + path.sep));
  for (const file of files) {
    try { total += (await fs.stat(file)).size; } catch {}
  }
  return { bytes: total, files: files.length };
}

async function copyForSmoke(projectRoot) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "ravin-evo-smoke-"));
  const target = path.join(temp, "ravin");
  await fs.cp(projectRoot, target, {
    recursive: true,
    dereference: false,
    filter: (source) => {
      const base = path.basename(source);
      return base !== ".git" && base !== ".ravin-backups";
    },
  });
  return { temp, target };
}

async function serverSmoke(projectRoot) {
  let copy;
  try {
    copy = await copyForSmoke(projectRoot);
  } catch (error) {
    return { success: false, reason: "Could not create isolated smoke-test copy: " + error.message, latencyMs: null };
  }

  const port = 32000 + Math.floor(Math.random() * 2000);
  const startedAt = Date.now();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: copy.target,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      PATH: process.env.PATH || "",
      NODE_ENV: "test",
      PORT: String(port),
      HOME: copy.temp,
      TMPDIR: copy.temp,
      SUPABASE_URL: "",
      SUPABASE_ANON_KEY: "",
      CLOUDFLARE_ACCOUNT_ID: "",
      CLOUDFLARE_API_TOKEN: "",
      GIT_TERMINAL_PROMPT: "0",
    },
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString().slice(-4000); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString().slice(-4000); });

  const deadline = Date.now() + 8000;
  let result = null;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const before = Date.now();
      const response = await fetch("http://127.0.0.1:" + port + "/api/health", {
        signal: AbortSignal.timeout(1200),
      });
      if (response.ok) {
        const body = await response.json();
        result = {
          success: body?.ok === true && body?.service === "RAVIN",
          latencyMs: Date.now() - before,
          health: body,
        };
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  try { child.kill("SIGTERM"); } catch {}
  await fs.rm(copy.temp, { recursive: true, force: true }).catch(() => {});

  if (result) return result;
  return {
    success: false,
    latencyMs: Date.now() - startedAt,
    reason: "RAVIN server did not pass /api/health smoke test.",
    stdout: stdout.slice(-1500),
    stderr: stderr.slice(-1500),
  };
}

function scoreReport(report) {
  let score = 100;
  if (!report.syntax.success) score -= 35;
  if (!report.json.success) score -= 20;
  if (!report.packageLock.success) score -= 15;
  if (!report.ui.success) score -= Math.max(8, (report.ui.total - report.ui.passed) * 4);
  if (!report.api.success) score -= Math.max(10, (report.api.total - report.api.passed) * 5);
  if (!report.server.success) score -= 30;
  return Math.max(0, score);
}

export async function runBenchmarks(projectRoot) {
  const syntax = checkJavaScript(projectRoot);
  syntax.success = syntax.failures.length === 0;

  const json = await checkJson(projectRoot);
  json.success = json.failures.length === 0;

  const [packageLock, ui, api, size, server] = await Promise.all([
    checkPackageLock(projectRoot),
    checkUiContracts(projectRoot),
    checkApiSecurityContracts(projectRoot),
    directorySize(projectRoot),
    serverSmoke(projectRoot),
  ]);

  const report = {
    at: new Date().toISOString(),
    syntax,
    json,
    packageLock,
    ui,
    api,
    server,
    size,
  };
  report.qualityScore = scoreReport(report);
  report.success =
    syntax.success &&
    json.success &&
    packageLock.success &&
    ui.success &&
    api.success &&
    server.success;
  return report;
}

export function compareBenchmarks(baseline, candidate) {
  const reasons = [];
  if (!candidate?.success) reasons.push("Candidate benchmark suite did not fully pass.");

  if (baseline?.ui?.passed != null && candidate?.ui?.passed < baseline.ui.passed) {
    reasons.push("UI contract coverage regressed.");
  }
  if (baseline?.api?.passed != null && candidate?.api?.passed < baseline.api.passed) {
    reasons.push("API/security contract coverage regressed.");
  }
  if (baseline?.qualityScore != null && candidate?.qualityScore < baseline.qualityScore) {
    reasons.push("Quality score regressed from " + baseline.qualityScore + " to " + candidate.qualityScore + ".");
  }

  const baseLatency = baseline?.server?.latencyMs;
  const candidateLatency = candidate?.server?.latencyMs;
  if (
    Number.isFinite(baseLatency) &&
    Number.isFinite(candidateLatency) &&
    candidateLatency > Math.max(baseLatency * 3, baseLatency + 500)
  ) {
    reasons.push("Health-check latency regressed significantly.");
  }

  const baseBytes = baseline?.size?.bytes;
  const candidateBytes = candidate?.size?.bytes;
  if (
    Number.isFinite(baseBytes) &&
    Number.isFinite(candidateBytes) &&
    candidateBytes > baseBytes * 1.35 &&
    candidateBytes - baseBytes > 100_000
  ) {
    reasons.push("Project size grew by more than 35% and 100 KB in one iteration.");
  }

  return {
    success: reasons.length === 0,
    reasons,
    delta: {
      qualityScore: (candidate?.qualityScore ?? 0) - (baseline?.qualityScore ?? 0),
      serverLatencyMs: (candidateLatency ?? 0) - (baseLatency ?? 0),
      bytes: (candidateBytes ?? 0) - (baseBytes ?? 0),
    },
  };
}
