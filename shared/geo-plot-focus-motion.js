// A finite, low-cost selection pulse. No perpetual map render loop.
export const GEO_PLOT_FOCUS_DURATION_MS = 880;
export function geoPlotFocusMotion(now, startedAt, reducedMotion = false) {
  const elapsed = Math.max(0, Number(now) - Number(startedAt));
  const progress = Math.min(1, elapsed / GEO_PLOT_FOCUS_DURATION_MS);
  const impulse = reducedMotion ? 0 : Math.max(0, Math.sin(progress * Math.PI * 3.4)) * (1 - progress);
  return {
    fillOpacity: 0.16 + impulse * 0.20,
    haloOpacity: 0.40 + impulse * 0.38,
    edgeOpacity: 0.92 + impulse * 0.08,
    dotsOpacity: 0.90 + impulse * 0.10,
    animate: !reducedMotion && elapsed < GEO_PLOT_FOCUS_DURATION_MS,
  };
}
