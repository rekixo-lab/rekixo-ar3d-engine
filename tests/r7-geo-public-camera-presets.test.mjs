import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync("apps/public/src/geo/GeoPublicDemo.tsx", "utf8");
const css = fs.readFileSync("apps/public/src/geo/geo-public-demo.css", "utf8");

test("public Geo exposes the five customer camera presets", () => {
  for (const label of ["Overview", "Front", "Corner", "Entry view", "Aerial"]) {
    assert.match(source, new RegExp(`label: \\"${label}\\"`));
  }
  assert.match(source, /geo-camera-toolbar/);
  assert.match(css, /\.geo-camera-toolbar/);
  assert.match(css, /button\.is-active/);
});

test("satellite imagery metadata is informative and never clamps the customer camera", () => {
  assert.ok(source.includes("MaxZoomService"));
  assert.ok(source.includes("getMaxZoomAtLatLng(center)"));
  assert.ok(source.includes("setSatelliteMaxZoom(candidate)"));
  assert.ok(source.includes("maptypeid_changed"));
  assert.ok(source.includes("isFractionalZoomEnabled: true"));
  assert.ok(!source.includes("Math.min(preset.zoom, satelliteLimit)"));
  assert.ok(!source.includes("Math.min(requested, satelliteLimit)"));
  assert.ok(!source.includes("if (userZoom !== undefined && userZoom > candidate)"));
  assert.ok(!/\\bmaxZoom\\s*:/.test(source));
});

test("camera presets control the real Google map camera rather than the Building transform", () => {
  assert.match(source, /cameraPreset\(view, data\.placement\.headingDeg\)/);
  assert.ok(source.includes("map.moveCamera?.({ center, ...preset })"));
  assert.match(source, /cameraActionRef\.current\?\.\(view\.id\)/);
});

test("manual zoom preserves one-finger Google pan and avoids resetting the user's camera", () => {
  assert.ok(source.includes('gestureHandling: "greedy"'));
  assert.ok(source.includes("draggable: true"));
  assert.ok(source.includes("zoomActionRef.current = (step) =>"));
  assert.ok(source.includes("map.setZoom(requested)"));
  assert.ok(source.includes("map.getZoom?.()"));
  assert.ok(source.includes('map.addListener("zoom_changed"'));
  const satelliteHandler = source.slice(source.indexOf("setSatelliteMaxZoom(candidate);"), source.indexOf('mapIdle = map.addListener("idle"'));
  assert.ok(!satelliteHandler.includes("applyCamera(activeCameraView)"));
});

test("verified close-up 3D inspection can go past the satellite imagery ceiling", () => {
  assert.ok(source.includes("function GeoModelInspector"));
  assert.ok(source.includes("void loadVerifiedModel(model)"));
  assert.ok(source.includes("controls.minDistance = Math.max(radius * 0.01, 0.001)"));
  assert.ok(source.includes("controls.touches.ONE = THREE.TOUCH.ROTATE"));
  assert.ok(source.includes("controls.touches.TWO = THREE.TOUCH.DOLLY_PAN"));
  assert.ok(source.includes("<GeoModelInspector model={data.model} />"));
  assert.ok(css.includes(".geo-model-inspector"));
});

test("one zoom-in tap requests precisely 2x map scale and reports a native Google limit", () => {
  assert.ok(source.includes('aria-label="Zoom in 2×"'));
  assert.ok(source.includes('aria-label="Zoom out 2×"'));
  assert.ok(source.includes("zoomActionRef.current?.(1)"));
  assert.ok(source.includes("zoomActionRef.current?.(-1)"));
  assert.ok(source.includes("const requested = Math.max(0, current + step)"));
  assert.ok(source.includes('actual < requested - 0.1'));
  assert.ok(source.includes("Google Maps has reached its native zoom limit here"));
  assert.ok(source.includes('className="geo-zoom-notice"'));
  assert.ok(css.includes(".geo-zoom-notice"));
});
