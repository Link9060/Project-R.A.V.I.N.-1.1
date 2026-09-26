export const SUBSYSTEMS = Object.freeze([
  "memory",
  "agent",
  "frontend",
  "accessibility",
  "performance",
  "reliability",
  "self_builder",
  "testing",
  "maintainability",
]);

export function defaultDiversityState() {
  return {
    acceptedBySubsystem: Object.fromEntries(SUBSYSTEMS.map((name) => [name, 0])),
    attemptedBySubsystem: Object.fromEntries(SUBSYSTEMS.map((name) => [name, 0])),
    lastAcceptedIteration: Object.fromEntries(SUBSYSTEMS.map((name) => [name, null])),
    recentSubsystems: [],
  };
}

export function normalizeDiversityState(input) {
  const base = defaultDiversityState();
  const value = input && typeof input === "object" ? input : {};
  return {
    acceptedBySubsystem: { ...base.acceptedBySubsystem, ...(value.acceptedBySubsystem || {}) },
    attemptedBySubsystem: { ...base.attemptedBySubsystem, ...(value.attemptedBySubsystem || {}) },
    lastAcceptedIteration: { ...base.lastAcceptedIteration, ...(value.lastAcceptedIteration || {}) },
    recentSubsystems: Array.isArray(value.recentSubsystems)
      ? value.recentSubsystems.filter((x) => SUBSYSTEMS.includes(x)).slice(-8)
      : [],
  };
}

function textOf(plan) {
  return [
    plan?.title,
    plan?.problem,
    plan?.rationale,
    ...(Array.isArray(plan?.likelyFiles) ? plan.likelyFiles : []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function inferSubsystem(plan, requestedFocus = null) {
  const text = textOf(plan);
  const rules = [
    ["memory", /\bmemory|memories|context|retriev|session|project_memory|permanent_memory/],
    ["accessibility", /\baccessib|aria|keyboard|screen reader|reduced.motion|contrast/],
    ["performance", /\bperformance|latency|speed|bundle|render|startup|cache|optimi/],
    ["self_builder", /\bself.?builder|builder mode|project scanner|tool executor|engineering tool/],
    ["agent", /\bagent|model|routing|prompt|tool.?call|conversation mode|work mode|reasoning/],
    ["testing", /\btest|benchmark|validation|smoke|assert|coverage|observab/],
    ["reliability", /\breliab|error|recovery|retry|timeout|crash|fallback|robust|race/],
    ["frontend", /\bui|frontend|layout|button|panel|chat|composer|css|html|animation|theme/],
    ["maintainability", /\brefactor|maintain|duplicate|cleanup|structure|modular|documentation/],
  ];

  for (const [name, re] of rules) {
    if (re.test(text)) return name;
  }

  return SUBSYSTEMS.includes(requestedFocus) ? requestedFocus : "maintainability";
}

export function chooseDiversityFocus(input, iteration = 0) {
  const state = normalizeDiversityState(input);
  const recent = state.recentSubsystems.slice(-3);

  const scored = SUBSYSTEMS.map((name, index) => {
    const accepted = Number(state.acceptedBySubsystem[name] || 0);
    const attempted = Number(state.attemptedBySubsystem[name] || 0);
    const last = state.lastAcceptedIteration[name];
    const recencyGap = Number.isFinite(Number(last))
      ? Math.max(0, Number(iteration) - Number(last))
      : 9999;
    const recentPenalty = recent.reduce(
      (sum, value, position) => sum + (value === name ? 30 - position * 6 : 0),
      0
    );

    return {
      name,
      score:
        accepted * 12 +
        attempted * 2 +
        recentPenalty -
        Math.min(25, Math.floor(recencyGap / 5)) +
        index / 100,
    };
  });

  scored.sort((a, b) => a.score - b.score);
  return {
    focus: scored[0].name,
    ranking: scored,
    recentSubsystems: recent,
  };
}

export function recordSubsystemAttempt(input, subsystem) {
  const state = normalizeDiversityState(input);
  const name = SUBSYSTEMS.includes(subsystem) ? subsystem : "maintainability";
  state.attemptedBySubsystem[name] = Number(state.attemptedBySubsystem[name] || 0) + 1;
  return state;
}

export function recordSubsystemAcceptance(input, subsystem, iteration) {
  const state = normalizeDiversityState(input);
  const name = SUBSYSTEMS.includes(subsystem) ? subsystem : "maintainability";
  state.acceptedBySubsystem[name] = Number(state.acceptedBySubsystem[name] || 0) + 1;
  state.lastAcceptedIteration[name] = Number(iteration);
  state.recentSubsystems = [...state.recentSubsystems, name].slice(-8);
  return state;
}

export function diversityGate(input, subsystem) {
  const state = normalizeDiversityState(input);
  const recent = state.recentSubsystems.slice(-3);
  const sameRecent = recent.filter((value) => value === subsystem).length;

  if (recent.length >= 3 && sameRecent >= 3) {
    return {
      success: false,
      reason:
        "Subsystem diversity cooldown: " +
        subsystem +
        " occupied the last three accepted experiments.",
    };
  }

  return { success: true, reason: null };
}
