import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const file = (path) => fs.readFileSync(path, "utf8");

test("Geo Focus Mode remains an in-place viewport overlay with collapsible tools", () => {
  const mapper = file("apps/admin/src/geo/GeoMapper3DV2.tsx");
  const styles = file("apps/admin/src/geo/geo-v2.css");
  assert.match(mapper, /Open Full Editor/);
  assert.match(mapper, /Exit Full Editor/);
  assert.match(mapper, /Hide Tools/);
  assert.match(mapper, /Show Tools/);
  assert.match(mapper, /geo-v2-integrated-card--focus/);
  assert.match(styles, /position:fixed; inset:0; z-index:1500/);
  assert.match(styles, /height:100dvh; width:100vw/);
  assert.match(styles, /geo-v2-integrated-card--dock-closed/);
  assert.doesNotMatch(mapper, /requestFullscreen\(/);
});

test("Geo alignment uses canonical GLB by default and keeps derivative diagnostic-only", () => {
  const mapper = file("apps/admin/src/geo/GeoMapper3DV2.tsx");
  assert.match(mapper, /useState<"canonical" \| "geo">\("canonical"\)/);
  assert.match(mapper, /previewVariant === "geo" && geoDerivativeAvailable/);
  assert.match(mapper, /Geo derivative \(diagnostic\)/);
  assert.match(mapper, /previewVariant !== "canonical"/);
  assert.match(mapper, /source\?\.url && source\.mimeType === "model\/gltf-binary"/);
});

test("Geo map geometry checks do not change original mesh geometry", () => {
  const map = file("apps/admin/src/geo/GeoIntegratedAuthoringMap.tsx");
  assert.match(map, /node\.frustumCulled = false/);
  assert.match(map, /Box3\(\)\.setFromObject\(model\)/);
  assert.match(map, /Geometry Check/);
  assert.match(map, /render\(drawScene, drawCamera\)/);
  assert.doesNotMatch(map, /model\.scale\.setScalar\(0\)/);
});

test("Top-reference zoom and ground-plane point capture are opt-in", () => {
  const top = file("apps/admin/src/geo/GeoBuildingTopReference.tsx");
  assert.match(top, /zoomRef/);
  assert.match(top, /Fit Model/);
  assert.match(top, /groundPlanePick/);
  assert.match(top, /raycaster\.ray\.intersectPlane/);
  assert.match(top, /raycaster\.intersectObject\(model, true\)/);
  assert.match(top, /roundedPoint/);
});

test("Geo anchor visibility inspects model-anchor select rather than height-mode select", () => {
  const work = file("apps/admin/src/geo/GeoWorkspace.tsx");
  const mapper = file("apps/admin/src/geo/GeoMapper3DV2.tsx");
  assert.match(work, /\[data-geo-model-anchor\]/);
  assert.match(mapper, /select data-geo-model-anchor/);
  assert.doesNotMatch(work, /\[data-geo-section="fine"\] select:last-of-type/);
});
