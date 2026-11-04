// The entrance ripple finishes after 1.35s. Glass reflection stays active
// while selected; reduced-motion uses a static prism and no redraw loop.
export const GEO_PLOT_FOCUS_DURATION_MS = 1350;
export function geoPlotFocusMotion(now, startedAt, reducedMotion = false) {
  const elapsed = Math.max(0, Number(now) - Number(startedAt));
  const progress = Math.min(1, elapsed / GEO_PLOT_FOCUS_DURATION_MS);
  const wave = reducedMotion ? 0 :
    Math.pow(Math.max(0, Math.sin(progress * Math.PI * 3.3)), 2) * (1 - progress);
  const shimmer = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(elapsed / 1000 * 1.65);
  return {
    // Preserve original plan texture and plot number through the glass.
    fillOpacity: 0.20 + wave * 0.10,
    haloOpacity: 0.72 + wave * 0.15,
    edgeOpacity: 0.99,
    dotsOpacity: 0.99,
    rippleOpacity: reducedMotion ? 0 : 0.68 * Math.pow(1 - progress, 1.45),
    rippleScale: reducedMotion ? 1 : 1 + 0.14 * progress,
    wallOpacity: 0.15 + 0.08 * shimmer,
    roofOpacity: 0.08 + 0.04 * shimmer,
    rimOpacity: 0.70 + 0.25 * shimmer,
    reflectTime: reducedMotion ? 0 : elapsed / 1000,
    reflectStrength: reducedMotion ? 0 : 0.88,
    animate: !reducedMotion,
  };
}
