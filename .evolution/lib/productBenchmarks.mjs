import fs from "node:fs/promises";
import path from "node:path";

async function read(root, rel) {
  try { return await fs.readFile(path.join(root, rel), "utf8"); }
  catch { return ""; }
}

function checksToResult(checks) {
  const results = checks.map(([name, pass, evidence]) => ({
    name,
    pass: Boolean(pass),
    evidence: String(evidence || "").slice(0, 500),
  }));
  return {
    success: results.every((item) => item.pass),
    passed: results.filter((item) => item.pass).length,
    total: results.length,
    results,
  };
}

export async function runRavinProductBenchmarks(projectRoot) {
  const [
    server,
    memory,
    agent,
    tools,
    executor,
    cloudflare,
    selfBuilder,
    systemPrompt,
    app,
    indexHtml,
  ] = await Promise.all([
    read(projectRoot, "server.js"),
    read(projectRoot, "public/memory.js"),
    read(projectRoot, "src/agent/agent.js"),
    read(projectRoot, "src/agent/tools.js"),
    read(projectRoot, "src/agent/toolExecutor.js"),
    read(projectRoot, "src/cloudflareClient.js"),
    read(projectRoot, "src/self/selfBuilder.js"),
    read(projectRoot, "src/systemPrompt.js"),
    read(projectRoot, "public/app.js"),
    read(projectRoot, "public/index.html"),
  ]);

  const memoryContracts = checksToResult([
    [
      "memory API is authenticated",
      /app\.(?:get|post|delete)\(["']\/api\/memories/.test(server) &&
        /\/api\/memories[\s\S]{0,650}?requireUser\s*\(/.test(server),
      "Memory endpoints must stay behind requireUser().",
    ],
    [
      "memory queries are user-scoped",
      /user_id=eq\.\$\{encodeURIComponent\(auth\.user\.id\)\}/.test(server) ||
        /user_id:\s*auth\.user\.id/.test(server),
      "Stored/retrieved memories must be scoped to the authenticated user.",
    ],
    [
      "permanent memory client supports read",
      /listPermanentMemories/.test(memory),
      "RAVIN UI must retain permanent-memory retrieval.",
    ],
    [
      "permanent memory client supports add",
      /addPermanentMemory/.test(memory),
      "RAVIN UI must retain permanent-memory creation.",
    ],
    [
      "memory UI renders safely",
      /textContent\s*=/.test(app) && !/memory-row[\s\S]{0,300}?innerHTML\s*=/.test(app),
      "Memory content should be rendered as text rather than injected HTML.",
    ],
  ]);

  const routingContracts = checksToResult([
    [
      "conversation and work models remain distinct",
      /conversation\s*:/.test(cloudflare) && /work\s*:/.test(cloudflare),
      "RAVIN keeps separate conversation/work model routing.",
    ],
    [
      "mode normalization remains bounded",
      /normalizeRavinMode/.test(cloudflare) && /===\s*["']work["']/.test(cloudflare),
      "Unknown modes should collapse to a known RAVIN mode.",
    ],
    [
      "conversation path remains tool-free",
      /mode:\s*["']conversation["'][\s\S]{0,500}?tools:\s*\[\]/.test(agent),
      "Everyday conversation should not expose engineering tools.",
    ],
    [
      "work path retains controlled tools",
      /mode:\s*["']work["']/.test(agent) && /TOOL_DEFINITIONS/.test(agent),
      "Engineering work should retain the controlled tool layer.",
    ],
  ]);

  const builderContracts = checksToResult([
    [
      "builder inspects before modifying",
      /Inspect before modifying/i.test(selfBuilder),
      "Self-builder prompt preserves inspect-before-edit behavior.",
    ],
    [
      "builder requires verification",
      /Never claim success without verification/i.test(selfBuilder),
      "Builder must not claim success without validation.",
    ],
    [
      "project tool execution remains allowlisted",
      /validateCommand/.test(executor) &&
        /Command not allowed/.test(executor) &&
        !/shell:\s*true/.test(executor),
      "RAVIN project tools should not expose arbitrary shell execution.",
    ],
    [
      "project path containment exists",
      /outside the RAVIN project/i.test(executor) || /relativeToRoot\.startsWith\(["']\.\.["']\)/.test(executor),
      "RAVIN's own builder should remain project-scoped.",
    ],
  ]);

  const identityContracts = checksToResult([
    [
      "RAVIN identity retained",
      /You are RAVIN/i.test(systemPrompt),
      "Core system prompt still identifies RAVIN.",
    ],
    [
      "credential secrecy retained",
      /Never expose API keys|Never expose.*credentials/i.test(systemPrompt),
      "Core prompt preserves credential secrecy.",
    ],
    [
      "engineering verification retained",
      /verify/i.test(systemPrompt) && /modifying code|editing/i.test(systemPrompt),
      "Core prompt retains verification-oriented engineering behavior.",
    ],
  ]);

  const uxContracts = checksToResult([
    [
      "composer remains accessible",
      /id=["']messageInput["']/.test(indexHtml) &&
        /aria-label=["']Send["']/.test(indexHtml),
      "Primary chat input/send controls remain identifiable.",
    ],
    [
      "reduced motion remains supported",
      /prefers-reduced-motion/.test(app) || /prefers-reduced-motion/.test(indexHtml),
      "RAVIN should respect reduced-motion preferences.",
    ],
    [
      "settings control remains accessible",
      /id=["']settingsBtn["'][^>]*aria-label=/.test(indexHtml) ||
        /aria-label=["'][^"']*settings/i.test(indexHtml),
      "Settings button retains an accessible name.",
    ],
    [
      "ARROW shell integration retained",
      /data-arrow-os-shell/.test(indexHtml) &&
        /arrow-shell\.css/.test(indexHtml) &&
        /arrow-shell\.js/.test(indexHtml),
      "RAVIN remains connected to the ARROW shell.",
    ],
  ]);

  const groups = {
    memory: memoryContracts,
    routing: routingContracts,
    builder: builderContracts,
    identity: identityContracts,
    ux: uxContracts,
  };

  const total = Object.values(groups).reduce((sum, group) => sum + group.total, 0);
  const passed = Object.values(groups).reduce((sum, group) => sum + group.passed, 0);

  return {
    success: Object.values(groups).every((group) => group.success),
    passed,
    total,
    score: total ? Math.round((passed / total) * 100) : 0,
    groups,
  };
}

export function compareRavinProductBenchmarks(baseline, candidate) {
  const reasons = [];
  if (!candidate?.success) reasons.push("RAVIN-specific product contracts did not fully pass.");

  for (const name of ["memory", "routing", "builder", "identity", "ux"]) {
    const before = baseline?.groups?.[name]?.passed;
    const after = candidate?.groups?.[name]?.passed;
    if (Number.isFinite(before) && Number.isFinite(after) && after < before) {
      reasons.push("RAVIN " + name + " benchmark regressed from " + before + " to " + after + ".");
    }
  }

  if (
    Number.isFinite(baseline?.score) &&
    Number.isFinite(candidate?.score) &&
    candidate.score < baseline.score
  ) {
    reasons.push("RAVIN product score regressed from " + baseline.score + " to " + candidate.score + ".");
  }

  return {
    success: reasons.length === 0,
    reasons,
    deltaScore: (candidate?.score ?? 0) - (baseline?.score ?? 0),
  };
}
