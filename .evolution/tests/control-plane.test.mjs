import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createPathResolver,
  deterministicDiffGuard,
  scanTextForSecrets,
} from "../lib/security.mjs";
import {
  defaultState,
  readState,
  writeStateAtomic,
} from "../lib/state.mjs";

test("diff guard catches deleted authentication marker", () => {
  const result = deterministicDiffGuard(
    ["ravin/server.js"],
    [
      "diff --git a/ravin/server.js b/ravin/server.js",
      "-  const auth = await requireUser(req, res);",
      "+  const auth = null;",
    ].join("\n")
  );

  assert.equal(result.success, false);
  assert.match(result.reasons.join(" "), /requireUser/);
});

test("diff guard allows a small ordinary code change", () => {
  const result = deterministicDiffGuard(
    ["ravin/public/app.js"],
    [
      "diff --git a/ravin/public/app.js b/ravin/public/app.js",
      "+const retryCount = 3;",
    ].join("\n")
  );

  assert.equal(result.success, true);
});

test("secret scanner catches credential-shaped material", () => {
  const findings = scanTextForSecrets(
    'const token = "ghp_abcdefghijklmnopqrstuvwxyz123456";'
  );

  assert.ok(findings.includes("GitHub token"));
});

test("path resolver blocks symlink traversal outside project", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "ravin-evo-path-test-"));
  const project = path.join(temp, "ravin");
  const outside = path.join(temp, "outside");

  await fs.mkdir(project);
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, "secret.txt"), "nope", "utf8");
  await fs.symlink(outside, path.join(project, "escape"));

  const resolvePath = await createPathResolver(project);

  await assert.rejects(
    () => resolvePath("escape/secret.txt", { allowMissingLeaf: false }),
    /Symbolic-link paths are not allowed/
  );

  await fs.rm(temp, { recursive: true, force: true });
});

test("state writes are atomic and recover from a corrupted primary file", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "ravin-evo-state-test-"));
  const stateFile = path.join(temp, "state.json");
  const backupFile = path.join(temp, "state.backup.json");

  const state = defaultState();
  state.iteration = 7;
  await writeStateAtomic(stateFile, backupFile, state);

  state.iteration = 8;
  await writeStateAtomic(stateFile, backupFile, state);

  await fs.writeFile(stateFile, "{corrupted", "utf8");
  const recovered = await readState(stateFile, backupFile);

  assert.equal(recovered.iteration, 7);

  await fs.rm(temp, { recursive: true, force: true });
});
