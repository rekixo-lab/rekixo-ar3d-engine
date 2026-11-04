import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {geoPlotFocusMotion, GEO_PLOT_FOCUS_DURATION_MS} from "../shared/geo-plot-focus-motion.js";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("selection pulse settles while selected prism reflection keeps moving", () => {
  const atStart = geoPlotFocusMotion(100, 100);
  const during = geoPlotFocusMotion(300, 100);
  const settled = geoPlotFocusMotion(100 + GEO_PLOT_FOCUS_DURATION_MS, 100);
  assert.equal(atStart.animate, true);
  assert.equal(during.animate, true);
  assert.equal(settled.animate, true);
  assert.equal(settled.fillOpacity, 0.26);
  assert.ok(settled.haloOpacity >= 0.80 && settled.haloOpacity <= 0.98);
  assert.ok(during.fillOpacity >= 0.26 && during.fillOpacity <= 0.38);
  assert.ok(settled.reflectTime > during.reflectTime);
  assert.ok(settled.reflectStrength > 0);
  assert.ok(settled.wallOpacity > 0 && settled.roofOpacity > 0);
  assert.ok(during.rippleOpacity > 0 && during.rippleScale > 1);
  assert.equal(settled.rippleOpacity, 0);
  assert.ok(settled.rippleScale > 1);
});

test("reduced-motion preference keeps static selected outline", () => {
  const motion = geoPlotFocusMotion(150, 100, true);
  assert.equal(motion.animate, false);
  assert.equal(motion.haloOpacity, 0.80);
  assert.equal(motion.reflectTime, 0);
  assert.equal(motion.reflectStrength, 0);
  assert.equal(motion.edgeOpacity, 0.99);
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

test("visual strength is at least 25 percent greater than the previous glass baseline", () => {
  const frame = geoPlotFocusMotion(100, 100, true);
  assert.ok(frame.fillOpacity >= 0.20 * 1.25);
  assert.ok(frame.wallOpacity >= (0.15 + 0.08 * 0.5) * 1.25);
  assert.ok(frame.roofOpacity >= (0.08 + 0.04 * 0.5) * 1.25);
  const shader = read("apps/public/src/geo/geoPlotSelectionFocus.ts");
  assert.match(shader, /float alpha = clamp\(uOpacity \* \(0\.90 \+ glint \* 0\.48\), 0\.0, 0\.80\)/);
});

test("glass prism uses the exact mapped footprint and a bounded redraw timer", () => {
  const focus = read("apps/public/src/geo/geoPlotSelectionFocus.ts");
  const viewer = read("apps/public/src/geo/GeoPublicDemo.tsx");
  for (const name of ["selected-plot-prism-glass-walls", "selected-plot-prism-glass-roof",
    "selected-plot-prism-roof-edge", "selected-plot-prism-vertical-edges"]) {
    assert.ok(focus.includes(name));
  }
  assert.match(focus, /new THREE\.ShaderMaterial\(/);
  assert.match(focus, /new THREE\.ShapeGeometry\(shape\)/);
  assert.match(focus, /points\[\(index \+ 1\) % points\.length\]/);
  assert.match(focus, /depthTest: true,\s*depthWrite: false/);
  assert.match(focus, /\[fill, halo, ripple, edge, dots, walls, roof, roofEdge, pillars\]/);
  assert.match(viewer, /selectionRedrawTimer=window\.setTimeout/);
  assert.match(viewer, /clearSelectionRedrawTimer\(\)/);
  assert.match(viewer, /document\.hidden/);
});
