// Finite entrance animation: keep strong static focus after the pulse ends.
// No perpetual map render loop, and no animation for reduced-motion users.
export const GEO_PLOT_FOCUS_DURATION_MS = 1350;
export function geoPlotFocusMotion(now, startedAt, reducedMotion = false) {
  const elapsed = Math.max(0, Number(now) - Number(startedAt));
  const progress = Math.min(1, elapsed / GEO_PLOT_FOCUS_DURATION_MS);
  const wave = reducedMotion ? 0 :
    Math.pow(Math.max(0, Math.sin(progress * Math.PI * 3.3)), 2) * (1 - progress);
  return {
    fillOpacity: 0.31 + wave * 0.15,
    haloOpacity: 0.62 + wave * 0.28,
    edgeOpacity: 0.97,
    dotsOpacity: 0.97,
    rippleOpacity: reducedMotion ? 0 : 0.68 * Math.pow(1 - progress, 1.45),
    rippleScale: reducedMotion ? 1 : 1 + 0.14 * progress,
    animate: !reducedMotion && elapsed < GEO_PLOT_FOCUS_DURATION_MS,
  };
}
