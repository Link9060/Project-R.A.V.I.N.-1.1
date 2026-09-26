import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createPathResolver,
  deterministicDiffGuard,
  scanTextForSecrets,
} from "./lib/security.mjs";
import {
  defaultState,
  readState,
  writeStateAtomic,
} from "./lib/state.mjs";
import {
  runBenchmarks,
} from "./lib/validation.mjs";

const ROOT = process.cwd();
const PROJECT_ROOT = path.join(ROOT, "ravin");

async function testPathContainment() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "ravin-evo-path-"));
  const project = path.join(temp, "ravin");
  const outside = path.join(temp, "outside");
  await fs.mkdir(project, { recursive: true });
  await fs.mkdir(outside, { recursive: true });
  await fs.writeFile(path.join(project, "safe.txt"), "safe", "utf8");

  const resolve = await createPathResolver(project);
  assert.equal(await resolve("safe.txt", { allowMissingLeaf: false }), path.join(project, "safe.txt"));

  await assert.rejects(() => resolve("../outside/file.txt"));
  await fs.symlink(outside, path.join(project, "escape"));
  await assert.rejects(() => resolve("escape/file.txt"));

  await fs.rm(temp, { recursive: true, force: true });
}

function testDiffGuards() {
  const securityDeletion = [
    "diff --git a/ravin/server.js b/ravin/server.js",
    "--- a/ravin/server.js",
    "+++ b/ravin/server.js",
    "@@ -1 +0,0 @@",
    "-const auth = await requireUser(req, res);",
  ].join("\n");

  const deletionResult = deterministicDiffGuard(["ravin/server.js"], securityDeletion);
  assert.equal(deletionResult.success, false);
  assert.ok(deletionResult.reasons.some((x) => x.includes("requireUser(")));

  const dependencyMismatch = deterministicDiffGuard(
    ["ravin/package.json"],
    "diff --git a/ravin/package.json b/ravin/package.json\n+{\"dependencies\":{\"x\":\"1\"}}"
  );
  assert.equal(dependencyMismatch.success, false);
  assert.ok(dependencyMismatch.reasons.some((x) => x.includes("package-lock.json")));

  const suspiciousNetwork = deterministicDiffGuard(
    ["ravin/public/app.js"],
    "diff --git a/ravin/public/app.js b/ravin/public/app.js\n+fetch(\"https://example.invalid/telemetry\")"
  );
  assert.equal(suspiciousNetwork.success, false);
  assert.ok(suspiciousNetwork.reasons.some((x) => x.includes("external network destination")));
}

function testSecretScanner() {
  assert.ok(scanTextForSecrets("Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456").length > 0);
  assert.equal(scanTextForSecrets("const x = 'normal text';").length, 0);
}

async function testStateRecovery() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "ravin-evo-state-"));
  const stateFile = path.join(temp, "state.json");
  const backupFile = path.join(temp, "state.backup.json");

  const initial = defaultState();
  initial.iteration = 41;
  await writeStateAtomic(stateFile, backupFile, initial);

  const next = { ...initial, iteration: 42 };
  await writeStateAtomic(stateFile, backupFile, next);

  await fs.writeFile(stateFile, "{broken", "utf8");
  const recovered = await readState(stateFile, backupFile);
  assert.equal(recovered.iteration, 41);

  await fs.rm(temp, { recursive: true, force: true });
}

async function testCurrentRavinBenchmarks() {
  const report = await runBenchmarks(PROJECT_ROOT);
  assert.equal(report.syntax.success, true, "Current RAVIN JavaScript must parse.");
  assert.equal(report.json.success, true, "Current RAVIN JSON must parse.");
  assert.equal(report.packageLock.success, true, "package-lock must match package.json.");
  assert.equal(report.ui.success, true, "Required UI/ARROW contracts must remain present.");
  assert.equal(report.api.success, true, "Required API/auth contracts must remain present.");
  assert.equal(report.server.success, true, "RAVIN /api/health smoke test must pass.");
  assert.ok(report.qualityScore >= 90, "Current RAVIN quality score should be at least 90.");
  return report;
}

async function main() {
  await testPathContainment();
  testDiffGuards();
  testSecretScanner();
  await testStateRecovery();
  const benchmark = await testCurrentRavinBenchmarks();

  console.log(JSON.stringify({
    ok: true,
    tests: [
      "path containment + symlink rejection",
      "security deletion gate",
      "dependency lock gate",
      "new external destination gate",
      "secret scanner",
      "atomic state recovery",
      "current RAVIN benchmark suite"
    ],
    qualityScore: benchmark.qualityScore,
    serverLatencyMs: benchmark.server.latencyMs ?? null
  }, null, 2));
}

main().catch((error) => {
  console.error("[EVO selftest failed]", error?.stack || error);
  process.exit(1);
});
