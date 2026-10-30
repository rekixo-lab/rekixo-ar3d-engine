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

test("satellite close-up honors Google's location-specific imagery ceiling", () => {
  assert.match(source, /MaxZoomService/);
  assert.match(source, /getMaxZoomAtLatLng\(center\)/);
  assert.match(source, /isSatelliteMapType/);
  assert.match(source, /Math\.min\(preset\.zoom, satelliteLimit\)/);
  assert.match(source, /maptypeid_changed/);
  assert.match(source, /isFractionalZoomEnabled: true/);
  assert.doesNotMatch(source, /\bmaxZoom\s*:/);
});

test("camera presets control the real Google map camera rather than the Building transform", () => {
  assert.match(source, /cameraPreset\(view, data\.placement\.headingDeg\)/);
  assert.match(source, /map\.moveCamera\?\.\(\{ center, \.\.\.preset, zoom \}\)/);
  assert.match(source, /cameraActionRef\.current\?\.\(view\.id\)/);
});

test("manual zoom preserves one-finger Google pan and avoids resetting the user's camera", () => {
  assert.ok(source.includes('gestureHandling: "greedy"'));
  assert.ok(source.includes("draggable: true"));
  assert.ok(source.includes("zoomActionRef.current = (step) =>"));
  assert.ok(source.includes("map.setZoom(zoom)"));
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
