import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runBenchmarks } from "./lib/validation.mjs";

const ROOT = process.cwd();
const SOURCE = path.join(ROOT, "ravin");

async function copyProject() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "ravin-evo-mutant-"));
  const target = path.join(temp, "ravin");

  await fs.cp(SOURCE, target, {
    recursive: true,
    dereference: false,
    filter: (source) => path.basename(source) !== "node_modules",
  });

  const modules = path.join(SOURCE, "node_modules");
  try {
    const stat = await fs.stat(modules);
    if (stat.isDirectory()) {
      await fs.symlink(
        modules,
        path.join(target, "node_modules"),
        process.platform === "win32" ? "junction" : "dir"
      );
    }
  } catch {}

  return { temp, target };
}

async function mutateFile(root, rel, mutate) {
  const file = path.join(root, rel);
  const before = await fs.readFile(file, "utf8");
  const after = mutate(before);
  assert.notEqual(after, before, "Mutation did not alter " + rel);
  await fs.writeFile(file, after, "utf8");
}

async function runMutation(name, mutate, expectedFailure) {
  const { temp, target } = await copyProject();
  try {
    await mutate(target);
    const report = await runBenchmarks(target);
    assert.equal(report.success, false, name + " unexpectedly passed the full benchmark suite.");
    assert.equal(
      expectedFailure(report),
      true,
      name + " failed, but not for the expected protection. Report: " + JSON.stringify(report)
    );

    return {
      name,
      killed: true,
      qualityScore: report.qualityScore,
      productScore: report.product?.score ?? null,
    };
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

async function main() {
  const mutations = [];

  mutations.push(await runMutation(
    "remove chat authentication",
    async (root) => {
      await mutateFile(root, "server.js", (text) => {
        const marker = 'app.post("/api/chat", async (req, res) => {';
        const start = text.indexOf(marker);
        assert.ok(start >= 0);
        const tail = text.slice(start);
        const authPattern =
          /  const auth = await requireUser\(req, res\);\s*if \(!auth\) return;/;
        assert.ok(authPattern.test(tail));
        return text.slice(0, start) + tail.replace(
          authPattern,
          '  const auth = { user: { id: "mutation-test" }, token: "" };'
        );
      });
    },
    (report) =>
      report.api?.success === false ||
      report.server?.success === false ||
      report.product?.groups?.memory?.success === false
  ));

  mutations.push(await runMutation(
    "remove ARROW shell mount",
    async (root) => {
      await mutateFile(root, "public/index.html", (text) =>
        text.replace("data-arrow-os-shell", "data-mutated-shell")
      );
    },
    (report) =>
      report.ui?.success === false ||
      report.product?.groups?.ux?.success === false
  ));

  mutations.push(await runMutation(
    "remove permanent memory read capability",
    async (root) => {
      await mutateFile(root, "public/memory.js", (text) =>
        text.replace(/listPermanentMemories/g, "mutatedListPermanentMemories")
      );
    },
    (report) => report.product?.groups?.memory?.success === false
  ));

  mutations.push(await runMutation(
    "weaken RAVIN credential secrecy prompt",
    async (root) => {
      await mutateFile(root, "src/systemPrompt.js", (text) =>
        text.replace(
          /- Never expose API keys, credentials, environment secrets, or other private configuration\.\n?/,
          ""
        )
      );
    },
    (report) => report.product?.groups?.identity?.success === false
  ));

  mutations.push(await runMutation(
    "introduce JavaScript syntax error",
    async (root) => {
      await mutateFile(root, "public/app.js", (text) => text + "\nfunction mutationBroken( {\n");
    },
    (report) => report.syntax?.success === false
  ));

  mutations.push(await runMutation(
    "corrupt manifest JSON",
    async (root) => {
      await fs.writeFile(path.join(root, "public/manifest.json"), "{broken-json", "utf8");
    },
    (report) => report.json?.success === false
  ));

  mutations.push(await runMutation(
    "desynchronize package lock",
    async (root) => {
      await mutateFile(root, "package.json", (text) => {
        const pkg = JSON.parse(text);
        pkg.dependencies = { ...(pkg.dependencies || {}), "mutation-only-package": "1.0.0" };
        return JSON.stringify(pkg, null, 2) + "\n";
      });
    },
    (report) => report.packageLock?.success === false
  ));

  console.log(JSON.stringify({
    ok: mutations.every((item) => item.killed),
    mutationScore: Math.round(
      (mutations.filter((item) => item.killed).length / mutations.length) * 100
    ),
    killed: mutations.length,
    total: mutations.length,
    mutations,
  }, null, 2));
}

main().catch((error) => {
  console.error("[EVO mutation test failed]", error?.stack || error);
  process.exit(1);
});
