import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync("apps/public/src/geo/GeoPublicDemo.tsx", "utf8");
const css = fs.readFileSync("apps/public/src/geo/geo-public-demo.css", "utf8");

test("public Geo keeps three camera presets and adds desktop/tablet Aerial", () => {
  for (const label of ["Overview", "Front", "Corner"]) {
    assert.match(source, new RegExp(`label: \\"${label}\\"`));
  }
  const availableViews=source.slice(source.indexOf("const GEO_CAMERA_VIEWS"),source.indexOf("let mapsPromise"));
  assert.doesNotMatch(availableViews,/Entry view/);
  assert.equal((availableViews.match(/label: "/g)||[]).length,4);
  assert.match(availableViews,/Aerial/);
  assert.match(source,/case "aerial":[\s\S]*tilt: 0/);
  assert.match(css,/button\.geo-aerial-view\s*\{\s*display: none !important/);
  assert.match(source,/aria-label="Re-enter project map"/);
  assert.match(source,/onClick=\{\(\) => reenterActionRef\.current\?\.\(\)\}/);
  assert.match(source,/reenterActionRef\.current = \(\) => applyCamera\("overview"\)/);
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
  assert.ok(!source.includes("maxZoom:"));
});

test("camera presets control the real Google map camera rather than the Building transform", () => {
  assert.match(source, /cameraPreset\(view, data\.placement\.headingDeg\)/);
  assert.ok(source.includes("map.moveCamera({ center, ...preset })"));
  assert.match(source,/map\.setCenter\(center\)/);
  assert.match(source,/map\.setZoom\(preset\.zoom\)/);
  assert.match(source,/map\.setTilt\?\.\(preset\.tilt\)/);
  assert.match(source, /cameraActionRef\.current\?\.\(view\.id\)/);
});

test("manual zoom preserves native multi-finger navigation and avoids resetting the user's camera", () => {
  assert.ok(source.includes('gestureHandling: "greedy"'));
  assert.ok(source.includes("createGeoOneFingerOrbit({"));
  assert.ok(source.includes("draggable: true"));
  assert.ok(source.includes("zoomActionRef.current = (step) =>"));
  assert.ok(source.includes("map.setZoom(requested)"));
  assert.ok(source.includes("map.getZoom?.()"));
  assert.ok(source.includes('map.addListener("zoom_changed"'));
  const satelliteHandler = source.slice(source.indexOf("setSatelliteMaxZoom(candidate);"), source.indexOf('mapIdle = map.addListener("idle"'));
  assert.ok(!satelliteHandler.includes("applyCamera(activeCameraView)"));
});

test("customer map has requested minimal controls without a separate model inspector", () => {
  assert.doesNotMatch(source, /function GeoModelInspector|<GeoModelInspector/);
  assert.doesNotMatch(source, /aria-label="Reset Geo camera"|3D Detail/);
  assert.ok(source.includes('mapTypeId: "hybrid"'));
  assert.ok(source.includes("disableDefaultUI: true"));
  assert.ok(source.includes("keyboardShortcuts: false"));
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
