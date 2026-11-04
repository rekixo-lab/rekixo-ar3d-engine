import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {geoPlotFocusMotion, GEO_PLOT_FOCUS_DURATION_MS} from "../shared/geo-plot-focus-motion.js";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("selection pulse settles and never schedules an unlimited redraw", () => {
  const atStart = geoPlotFocusMotion(100, 100);
  const during = geoPlotFocusMotion(300, 100);
  const settled = geoPlotFocusMotion(100 + GEO_PLOT_FOCUS_DURATION_MS, 100);
  assert.equal(atStart.animate, true);
  assert.equal(during.animate, true);
  assert.equal(settled.animate, false);
  assert.equal(settled.fillOpacity, 0.31);
  assert.equal(settled.haloOpacity, 0.62);
  assert.ok(during.fillOpacity >= 0.31 && during.fillOpacity <= 0.46);
  assert.ok(during.rippleOpacity > 0 && during.rippleScale > 1);
  assert.equal(settled.rippleOpacity, 0);
  assert.ok(settled.rippleScale > 1);
});

test("reduced-motion preference keeps static selected outline", () => {
  const motion = geoPlotFocusMotion(150, 100, true);
  assert.equal(motion.animate, false);
  assert.equal(motion.haloOpacity, 0.62);
  assert.equal(motion.edgeOpacity, 0.97);
  assert.equal(motion.rippleOpacity, 0);
});

test("selected plot follows GLB-local coordinates with transparent depth-tested overlay", () => {
  const focus = read("apps/public/src/geo/geoPlotSelectionFocus.ts");
  const layer = read("apps/public/src/geo/geoPlotModelOverlay.ts");
  const viewer = read("apps/public/src/geo/GeoPublicDemo.tsx");
  assert.match(focus, /selected-plot-white-focus-edge/);
  assert.match(focus, /selected-plot-status-glow/);
  assert.match(focus, /selected-plot-corner-markers/);
  assert.match(focus, /selected-plot-outward-ripple/);
  assert.match(focus, /depthTest: true, depthWrite: false/);
  assert.match(focus, /clear\(\);\s*group\.removeFromParent\(\)/);
  assert.match(layer, /setSelectedPlot:/);
  assert.match(layer, /tickSelection:/);
  assert.match(viewer, /selectionPresentationRef/);
  assert.match(viewer, /plotLayer\?\.tickSelection\(/);
  assert.match(viewer, /prefers-reduced-motion: reduce/);
  assert.match(viewer, /setSelectedPlot\(plotIds\.get\(id\)\|\|null\)/);
  assert.match(viewer, /setDrawerOpen\(true\)/);
  assert.match(viewer, /onClose=\{\(\)=>setDrawerOpen\(false\)\}/);
  assert.match(viewer, /plot=\{drawerOpen\?selectedPlot:null\}/);
  assert.doesNotMatch(viewer, /onClose=\{\(\)=>setSelectedPlot\(null\)\}/);
});
