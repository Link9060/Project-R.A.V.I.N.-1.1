function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function productGroupPasses(report, name) {
  return finite(report?.product?.groups?.[name]?.passed, 0);
}

export function buildQualityAnchor(report) {
  return {
    createdAt: new Date().toISOString(),
    qualityScore: finite(report?.qualityScore, 0),
    productScore: finite(report?.product?.score, 0),
    uiPassed: finite(report?.ui?.passed, 0),
    apiPassed: finite(report?.api?.passed, 0),
    productGroups: {
      memory: productGroupPasses(report, "memory"),
      routing: productGroupPasses(report, "routing"),
      builder: productGroupPasses(report, "builder"),
      identity: productGroupPasses(report, "identity"),
      ux: productGroupPasses(report, "ux"),
    },
  };
}

export function updateQualityAnchor(anchor, report) {
  const next = buildQualityAnchor(report);
  if (!anchor) return next;

  return {
    ...anchor,
    updatedAt: new Date().toISOString(),
    qualityScore: Math.max(finite(anchor.qualityScore), next.qualityScore),
    productScore: Math.max(finite(anchor.productScore), next.productScore),
    uiPassed: Math.max(finite(anchor.uiPassed), next.uiPassed),
    apiPassed: Math.max(finite(anchor.apiPassed), next.apiPassed),
    productGroups: {
      memory: Math.max(finite(anchor.productGroups?.memory), next.productGroups.memory),
      routing: Math.max(finite(anchor.productGroups?.routing), next.productGroups.routing),
      builder: Math.max(finite(anchor.productGroups?.builder), next.productGroups.builder),
      identity: Math.max(finite(anchor.productGroups?.identity), next.productGroups.identity),
      ux: Math.max(finite(anchor.productGroups?.ux), next.productGroups.ux),
    },
  };
}

export function compareToQualityAnchor(anchor, report) {
  if (!anchor) {
    return { success: true, reasons: [], anchorMissing: true };
  }

  const reasons = [];
  const current = buildQualityAnchor(report);

  const comparisons = [
    ["overall quality score", finite(anchor.qualityScore), current.qualityScore],
    ["RAVIN product score", finite(anchor.productScore), current.productScore],
    ["UI contracts", finite(anchor.uiPassed), current.uiPassed],
    ["API/security contracts", finite(anchor.apiPassed), current.apiPassed],
    ["memory contracts", finite(anchor.productGroups?.memory), current.productGroups.memory],
    ["routing contracts", finite(anchor.productGroups?.routing), current.productGroups.routing],
    ["builder contracts", finite(anchor.productGroups?.builder), current.productGroups.builder],
    ["identity contracts", finite(anchor.productGroups?.identity), current.productGroups.identity],
    ["UX contracts", finite(anchor.productGroups?.ux), current.productGroups.ux],
  ];

  for (const [name, best, now] of comparisons) {
    if (now < best) {
      reasons.push(
        "Long-term regression: " +
          name +
          " fell below the best-known-good anchor (" +
          now +
          " < " +
          best +
          ")."
      );
    }
  }

  return {
    success: reasons.length === 0,
    reasons,
    anchorMissing: false,
    anchor,
    current,
  };
}
