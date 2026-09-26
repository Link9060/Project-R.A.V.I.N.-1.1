import fs from "node:fs/promises";
import path from "node:path";

export const SCHEMA_VERSION = 3;

export function defaultState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    branch: "evolution",
    status: "ready",
    iteration: 0,
    attempted: 0,
    accepted: 0,
    rejected: 0,
    noops: 0,
    quotaPauses: 0,
    timePauses: 0,
    apiRetries: 0,
    syncsFromMain: 0,
    lastRunAt: null,
    lastAcceptedAt: null,
    lastAcceptedSummary: null,
    currentExperiment: null,
    recentFailures: [],
    recentAccepted: [],
    metrics: {
      lastBaseline: null,
      lastCandidate: null,
      bestQualityScore: null,
      qualityAnchor: null,
      diversity: {
        acceptedBySubsystem: {},
        attemptedBySubsystem: {},
        lastAcceptedIteration: {},
        recentSubsystems: []
      },
      aiUsage: {
        calls: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0
      }
    }
  };
}

function migrate(input) {
  const base = defaultState();
  const state = { ...base, ...(input && typeof input === "object" ? input : {}) };
  state.schemaVersion = SCHEMA_VERSION;
  state.metrics = { ...base.metrics, ...(state.metrics || {}) };
  state.metrics.aiUsage = {
    ...base.metrics.aiUsage,
    ...(state.metrics.aiUsage || {})
  };
  state.metrics.diversity = {
    ...base.metrics.diversity,
    ...(state.metrics.diversity || {}),
    acceptedBySubsystem: {
      ...(base.metrics.diversity.acceptedBySubsystem || {}),
      ...(state.metrics.diversity?.acceptedBySubsystem || {})
    },
    attemptedBySubsystem: {
      ...(base.metrics.diversity.attemptedBySubsystem || {}),
      ...(state.metrics.diversity?.attemptedBySubsystem || {})
    },
    lastAcceptedIteration: {
      ...(base.metrics.diversity.lastAcceptedIteration || {}),
      ...(state.metrics.diversity?.lastAcceptedIteration || {})
    },
    recentSubsystems: Array.isArray(state.metrics.diversity?.recentSubsystems)
      ? state.metrics.diversity.recentSubsystems.slice(-8)
      : []
  };
  state.recentFailures = Array.isArray(state.recentFailures) ? state.recentFailures : [];
  state.recentAccepted = Array.isArray(state.recentAccepted) ? state.recentAccepted : [];
  return state;
}

export async function readState(stateFile, backupFile) {
  for (const candidate of [stateFile, backupFile]) {
    try {
      const parsed = JSON.parse(await fs.readFile(candidate, "utf8"));
      return migrate(parsed);
    } catch {}
  }
  return defaultState();
}

export async function writeStateAtomic(stateFile, backupFile, state) {
  await fs.mkdir(path.dirname(stateFile), { recursive: true });

  try {
    const current = await fs.readFile(stateFile, "utf8");
    JSON.parse(current);
    await fs.writeFile(backupFile, current, "utf8");
  } catch {}

  const temp = stateFile + ".tmp";
  await fs.writeFile(temp, JSON.stringify(migrate(state), null, 2) + "\n", "utf8");
  await fs.rename(temp, stateFile);
}

export async function appendJsonl(file, record) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, JSON.stringify(record) + "\n", "utf8");
}

export async function appendJournal(file, kind, iteration, summary) {
  const clean = String(summary || "").replace(/\s+/g, " ").trim().slice(0, 1600);
  await fs.appendFile(
    file,
    "- " + new Date().toISOString() + " | iteration " + iteration + " | " + kind + " | " + clean + "\n",
    "utf8"
  );
}

export function remember(list, entry, limit = 25) {
  const next = Array.isArray(list) ? [...list, entry] : [entry];
  return next.slice(-limit);
}

export async function readHistory(historyFile, { limit = 30, query = "" } = {}) {
  let raw = "";
  try {
    raw = await fs.readFile(historyFile, "utf8");
  } catch {
    return [];
  }

  const q = String(query || "").trim().toLowerCase();
  const rows = raw
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });

  const filtered = q
    ? rows.filter((row) => JSON.stringify(row).toLowerCase().includes(q))
    : rows;

  return filtered.slice(-Math.max(1, Math.min(100, Number(limit) || 30)));
}
