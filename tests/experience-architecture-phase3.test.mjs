import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("Phase 3 overview remains Building-first and keeps Geo optional", () => {
  const dashboard = read("apps/admin/src/dashboard/EngineDashboard.tsx");

  assert.match(dashboard, /SOURCE PACK/);
  assert.match(dashboard, /<span>BUILDING<\/span>/);
  assert.match(dashboard, /<span>GEO<\/span>/);
  assert.match(dashboard, /\{geoLive \? "LIVE" : geoExperience \? "SETUP" : "OPTIONAL"\}/);
  assert.match(dashboard, /Exact real-world Building placement\. Optional unless the customer needs map context/);
  assert.match(dashboard, /Customer ko map-based experience chahiye to Geo add karein; otherwise Building complete hai/);
  assert.doesNotMatch(dashboard, /Create → Edit → Map → Live/);
});

test("Geo Experience creation still requires an active immutable Building release", () => {
  const mapper = read("apps/admin/src/geo/GeoMapper3DV2.tsx");

  assert.match(mapper, /releaseItems\.find\(\(item\) => item\.active\)/);
  assert.match(mapper, /if \(!source\) throw new Error\("Publish one Building release before enabling Geo\."\)/);
  assert.match(mapper, /await createGeoExperience\(selectedSlug, source\.id\)/);
  assert.match(mapper, /disabled=\{busy \|\| !activeRelease\}/);
  assert.match(mapper, /PINNED BUILDING SOURCE/);
  assert.match(mapper, /Immutable Building Release/);
});

test("Building and Geo expose independent canonical customer URLs", () => {
  const dashboard = read("apps/admin/src/dashboard/EngineDashboard.tsx");

  assert.match(dashboard, /publicProjectPath\(selectedProject\.slug\)/);
  assert.match(dashboard, /geoPublicProjectPath\(selectedProject\.slug\)/);
  assert.match(dashboard, /Open Building Live/);
  assert.match(dashboard, /Open Geo Live/);
});

test("Geo source changes remain explicit and verification never silently upgrades the pinned Building source", () => {
  const mapper = read("apps/admin/src/geo/GeoMapper3DV2.tsx");

  assert.match(mapper, /sourceReleaseId !== state\.project\.activeBuildingReleaseId/);
  assert.match(mapper, /Historical Building release/);
  assert.match(mapper, /setSourceReleaseId\(event\.target\.value\)/);
  assert.match(mapper, /sourceBuildingReleaseId: sourceReleaseId/);
  assert.match(mapper, /Verification deliberately requires the active immutable Building release/);
  assert.doesNotMatch(mapper, /setSourceReleaseId\(activeRelease\.id\)/);
});

test("control-center surfaces load Experience, Building release, editable Geo V2 draft and immutable Geo live state through Engine-owned APIs", () => {
  const dashboard = read("apps/admin/src/dashboard/EngineDashboard.tsx");
  const mapper = read("apps/admin/src/geo/GeoMapper3DV2.tsx");
  const geoApi = read("apps/admin/src/geo/geoV2Api.ts");
  const cloud = read("apps/admin/src/studio/cloud.ts");

  assert.match(dashboard, /experiences\(selectedSlug\)/);
  assert.match(dashboard, /releases\(selectedSlug\)/);
  assert.match(dashboard, /geoReleases\(selectedSlug\)/);
  assert.match(mapper, /loadGeoV2\(slug\)/);
  assert.match(mapper, /geoReleases\(slug\)/);
  assert.match(geoApi, /const CLOUD_BASE = "\/3Dprojects\/api\/cloud\/projects"/);
  assert.match(geoApi, /\/geo-v2/);
  assert.match(cloud, /\/experiences/);
  assert.match(cloud, /\/geo-releases/);
  assert.doesNotMatch(dashboard + mapper + geoApi, /rekixo-ar3d-platform|tiyansh-production|tiyansh-gallery-production/);
});

test("Phase 3 responsive coverage follows the new Overview control-center layouts", () => {
  const css = read("apps/admin/src/dashboard/engine-dashboard.css");

  assert.match(css, /\.engine-overview-status-grid/);
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 1120px\)/);
  assert.match(css, /\.engine-overview-status-grid \{\s*grid-template-columns: 1fr/);
  assert.match(css, /@media \(max-width: 860px\)/);
  assert.match(css, /\.engine-overview-layout \{\s*grid-template-columns: 1fr/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /\.engine-overview-flow__steps \{\s*grid-template-columns: 1fr/);
});

test("project creation starts Source Pack and presents Geo only as a later optional stage", () => {
  const dashboard = read("apps/admin/src/dashboard/EngineDashboard.tsx");

  assert.match(dashboard, /Choose one independent Engine project type/);
  assert.match(dashboard, /newProjectStartPath\(createKind\)/);
  assert.match(dashboard, /Finish Building workflow/);
  assert.match(dashboard, /Customer ko map-based experience chahiye to Geo add karein; otherwise Building complete hai/);
  assert.match(dashboard, /OPTIONAL/);
  assert.doesNotMatch(dashboard, /3D Jio Mapper me real location set karein/);
});
