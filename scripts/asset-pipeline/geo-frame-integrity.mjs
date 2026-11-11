/**
 * Reject map-only derivatives whose coordinates drift from their pinned
 * canonical Building GLB. 3D Geo placement and plot geometry are authored in
 * the original local metres; recentering a derivative moves the entire site.
 */
export function assessGeoFrameIntegrity(sourceBounds, derivativeBounds) {
  function boundsArray(bounds, key) {
    const list = bounds?.[key];
    if (!Array.isArray(list) || list.length !== 3 ||
        list.some((value) => typeof value !== "number" || !Number.isFinite(value)))
      throw Error(`Invalid ${key} geo bounds.`);
    return list;
  }

  const sourceMin = boundsArray(sourceBounds, "min");
  const sourceMax = boundsArray(sourceBounds, "max");
  const derivativeMin = boundsArray(derivativeBounds, "min");
  const derivativeMax = boundsArray(derivativeBounds, "max");
  let maxDriftM = 0;
  const axes = [];
  for (let i = 0; i < 3; i += 1) {
    const spanM = sourceMax[i] - sourceMin[i];
    const derivativeSpanM = derivativeMax[i] - derivativeMin[i];
    if (spanM < 0 || derivativeSpanM < 0) throw Error("Inverted geo bounds.");
    // A flat/near-flat plane still needs an absolute tolerance; large sites
    // cannot exceed half a metre of bounding-box drift during simplification.
    const toleranceM = Math.min(0.5, Math.max(0.1, spanM * 0.001));
    const minDriftM = Math.abs(sourceMin[i] - derivativeMin[i]);
    const maxEdgeDriftM = Math.abs(sourceMax[i] - derivativeMax[i]);
    const driftM = Math.max(minDriftM, maxEdgeDriftM);
    maxDriftM = Math.max(maxDriftM, driftM);
    axes.push({ axis: ["x", "y", "z"][i], driftM, toleranceM, ok: driftM <= toleranceM });
  }
  return { ok: axes.every((axis) => axis.ok), maxDriftM, axes };
}
