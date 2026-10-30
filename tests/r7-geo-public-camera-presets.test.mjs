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
  assert.match(source, /gestureHandling: "greedy"/);
  assert.match(source, /draggable: true/);
  assert.match(source, /zoomActionRef\\.current = \\(step\\) =>/);
  assert.match(source, /map\\.setZoom\\(zoom\\)/);
  assert.match(source, /map\\.getZoom\\?\\.\\(\\)/);
  assert.match(source, /map\\.addListener\\("zoom_changed"/);
  assert.doesNotMatch(source, /setSatelliteMaxZoom\\(candidate\\);\\s*if \\(isSatelliteMapType[^]*?applyCamera\\(activeCameraView\\)/);
});

test("verified close-up 3D inspection can go past the satellite imagery ceiling", () => {
  assert.match(source, /function GeoModelInspector/);
  assert.match(source, /loadVerifiedModel\\(model\\)/);
  assert.match(source, /controls\\.minDistance = Math\\.max\\(radius \\* 0\\.01, 0\\.001\\)/);
  assert.match(source, /controls\\.touches\\.ONE = THREE\\.TOUCH\\.ROTATE/);
  assert.match(source, /controls\\.touches\\.TWO = THREE\\.TOUCH\\.DOLLY_PAN/);
  assert.match(source, /inspectMode \\? <GeoModelInspector model=\\{data\\.model\\} \\/>/);
  assert.match(css, /\\.geo-model-inspector/);
});
