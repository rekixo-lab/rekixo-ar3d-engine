// Draft-only and release-bound continuity plan. Never infer a sold/available status
// or carry a public approval across an unverified Building/Geo source change.
const key = (value) => String(value ?? "").trim().toLowerCase();
const geometryKey = (plot) => JSON.stringify({
  layout: plot.layout ?? null,
  corners: plot.corners,
  planeY: plot.planeY ?? null,
});

export function planGeoCommercialContinuity(oldPlots, newPlots, commercialRows, sameSource) {
  if (!Array.isArray(oldPlots) || !Array.isArray(newPlots) ||
      !Array.isArray(commercialRows) || typeof sameSource !== "boolean")
    throw Error("Invalid Geo commercial continuity input.");
  const oldById = new Map(), newById = new Map();
  for (const [plots, index] of [[oldPlots, oldById], [newPlots, newById]]) {
    for (const plot of plots) {
      const id = key(plot?.id);
      if (!id || index.has(id)) throw Error("Duplicate or invalid canonical Plot ID in commercial continuity.");
      index.set(id, plot);
    }
  }
  const carried = [], approved = [], needsReview = [], missing = [];
  const seen = new Set();
  for (const row of commercialRows) {
    const id = key(row?.plot_id ?? row?.plotId);
    if (!id || seen.has(id)) throw Error("Duplicate or invalid commercial Plot ID.");
    seen.add(id);
    const old = oldById.get(id), next = newById.get(id);
    if (!old || !next) { missing.push(row.plot_id ?? row.plotId); continue; }
    carried.push(next.id);
    if (sameSource && geometryKey(old) === geometryKey(next))
      approved.push(next.id);
    else needsReview.push(next.id);
  }
  return {
    sourceRows: commercialRows.length,
    carriedRows: carried.length,
    reviewRows: needsReview.length,
    missingRows: missing.length,
    approvedPlotIds: approved,
    reviewPlotIds: needsReview,
    missingPlotIds: missing,
  };
}
