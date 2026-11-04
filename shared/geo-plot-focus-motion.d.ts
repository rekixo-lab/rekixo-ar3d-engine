export declare const GEO_PLOT_FOCUS_DURATION_MS: number;
export declare function geoPlotFocusMotion(now: number, startedAt: number, reducedMotion?: boolean): {
  fillOpacity: number;
  haloOpacity: number;
  edgeOpacity: number;
  dotsOpacity: number;
  rippleOpacity: number;
  rippleScale: number;
  animate: boolean;
};
