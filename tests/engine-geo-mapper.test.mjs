import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("3D Jio Mapper schema is additive and release pinned", () => {
  const sql = read("database/migrations/0023_geo_mapper_v1.sql");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS geo_placements_3d/);
  assert.match(sql, /release_id TEXT NOT NULL/);
  assert.match(sql, /release_version INTEGER NOT NULL/);
  assert.match(sql, /public_enabled INTEGER NOT NULL DEFAULT 0/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS engine_settings_3d/);
  assert.match(sql, /FOREIGN KEY \(project_id\) REFERENCES projects_3d\(id\) ON DELETE CASCADE/);
  assert.match(sql, /Geo placement release must belong to project/);
  assert.doesNotMatch(sql, /\bDROP\s+TABLE\b/i);
  assert.doesNotMatch(sql, /\bUPDATE\s+projects_3d\b/i);
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\s+projects_3d\b/i);
});

test("Engine Admin owns editable Geo drafts while legacy placement remains isolated", () => {
  const worker = read("workers/admin-cloud.mjs");
  assert.match(worker, /geoDraftSchemaReady/);
  assert.match(worker, /projectGeoDraft/);
  assert.match(worker, /geoPlacementSchemaReady/);
  assert.match(worker, /projectGeoPlacement/);
  assert.match(worker, /geoMapsSettings/);
  assert.match(worker, /engineMapsBrowserKey/);
  assert.match(worker, /sameOrigin\(request\)/);
  assert.match(worker, /geo\.draft_saved/);
  assert.match(worker, /geo\.draft_reset/);
  assert.match(worker, /geo\.placement_saved/);
  assert.match(worker, /geo\.maps_key_updated/);
  assert.match(worker, /Geo draft changed elsewhere/);
});

test("3D Geo Mapper remains an Engine-owned route and the V2 workflow preserves release-gated Geo authoring", () => {
  const main = read("apps/admin/src/main.tsx");
  const workspace = read("apps/admin/src/geo/GeoWorkspace.tsx");
  const mapper = read("apps/admin/src/geo/GeoMapper3DV2.tsx");

  assert.match(main, /path === "\/3Dprojects\/geo-mapper"/);
  assert.match(main, /<GeoWorkspace \/>/);
  assert.match(workspace, /GeoMapper3DV2/);
  assert.doesNotMatch(workspace, /geo-control-flow/);
  assert.match(mapper, /Enable 3D Geo for this project/);
  assert.match(mapper, /Publish one Building release before enabling Geo/);
  assert.match(mapper, /createGeoExperience\(selectedSlug, source\.id\)/);
  assert.match(mapper, /sourceReleaseId !== state\.project\.activeBuildingReleaseId/);
  assert.match(mapper, /Save Geo V2 Draft/);
  assert.match(mapper, /Verify Current Preview/);
  assert.match(mapper, /Publish Update/);
  assert.doesNotMatch(mapper, /saveGeoPlacement|removeGeoPlacement/);
  assert.doesNotMatch(mapper, /Public 3D Jio demo|type="checkbox"/);
  assert.doesNotMatch(mapper, /tiyansh-production|rekixo-ar3d-platform|geo_3d_placements/);
});

test("public 3D Geo Experience is fail-closed on active immutable Geo release identity", () => {
  const worker = read("workers/public.mjs");
  const runtime = read("workers/geo-release-runtime.mjs");
  const page = read("apps/public/src/geo/GeoPublicDemo.tsx");
  const main = read("apps/public/src/main.tsx");

  assert.match(worker, /publicGeo3DState/);
  assert.match(worker, /activeGeoReleaseState/);
  assert.match(worker, /Published 3D Geo Experience is unavailable/);
  assert.match(worker, /Public 3D Geo Experience is not currently published/);
  assert.doesNotMatch(worker, /FROM geo_placements_3d g/);

  assert.match(runtime, /geo_experience_active_releases_3d/);
  assert.match(runtime, /geo_releases_3d/);
  assert.match(runtime, /Active Geo release manifest checksum mismatch/);
  assert.match(runtime, /Active Geo release Building source integrity mismatch/);

  assert.doesNotMatch(page, /INTEGRATED 3D GEO EXPERIENCE|Enter building|Open location/);
  assert.match(page, /geo-camera-toolbar--normal-row/);
  assert.doesNotMatch(page, /className="geo-building-link"/);
  assert.match(page, /GEO RELEASE/);
  assert.match(page, /BUILDING SOURCE/);
  assert.match(page, /api\/projects\/\$\{encodeURIComponent\(slug\)\}\/geo-placement/);
  assert.match(page, /WebGLOverlayView/);
  assert.match(page, /applyRigidBuildingPlacement/);
  assert.match(page, /Viewer3D/);
  assert.doesNotMatch(page, /jio-public-grid/);
  assert.match(main, /geoRoute/);
  assert.match(main, /GeoPublicDemo/);
});

test("main deploy applies new Engine migrations before Workers deploy", () => {
  const workflow = read(".github/workflows/deploy-cloudflare.yml");
  assert.match(workflow, /migrations_changed=true/);
  assert.match(workflow, /steps\.public_runtime\.outputs\.migrations_changed == 'true'/);
  const migrateAt = workflow.indexOf("Apply isolated D1 migrations");
  const adminDeployAt = workflow.indexOf("Deploy isolated 3D Admin Worker");
  assert.ok(migrateAt >= 0 && adminDeployAt > migrateAt);
});

test("3D Geo mapper keeps model preview separate from map anchor to avoid drag snap regression", () => {
  const mapper = read("apps/admin/src/geo/GeoMapper3D.tsx");
  const preview = read("apps/admin/src/geo/GeoModelPreview.tsx");
  assert.match(mapper, /Map anchor aur 3D/);
  assert.match(mapper, /camera movement saved location ko/);
  assert.match(mapper, /<GeoModelPreview/);
  assert.match(preview, /Ground contact preview/);
  assert.match(preview, /Drag = orbit/);
});
