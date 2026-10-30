import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("Phase 6 public Geo runtime resolves only active immutable Geo release state", () => {
  const worker = read("workers/public.mjs");
  const runtime = read("workers/geo-release-runtime.mjs");

  assert.match(worker, /activeGeoReleaseState/);
  assert.match(worker, /publicGeoExperienceFromState/);
  assert.doesNotMatch(worker, /FROM geo_placements_3d g/);
  assert.doesNotMatch(worker, /geo_experience_drafts_3d/);

  assert.match(runtime, /geo_experience_active_releases_3d/);
  assert.match(runtime, /geo_releases_3d/);
  assert.match(runtime, /e\.type='geo'/);
  assert.match(runtime, /e\.lifecycle='active'/);
  assert.match(runtime, /project\.status !== "published"/);
});

test("active Geo manifest is checksum and identity validated before customer data is returned", () => {
  const runtime = read("workers/geo-release-runtime.mjs");

  assert.match(runtime, /digestHex\(row\.manifest_json\)/);
  assert.match(runtime, /Active Geo release manifest checksum mismatch/);
  assert.match(runtime, /manifest\.format !== "rekixo-geo-release"/);
  assert.match(runtime, /manifest\.release\.id !== row\.geo_release_id/);
  assert.match(runtime, /manifest\.release\.experienceId !== row\.experience_id/);
  assert.match(runtime, /manifest\.release\.projectId !== row\.project_id/);
  assert.match(runtime, /manifest\.release\.projectSlug !== row\.slug/);
  assert.match(runtime, /assertGeoPresentationManifestV1\(manifest\)/);
  assert.match(runtime, /validLegacyPlacement\(manifest\.placement\)/);
  assert.match(runtime, /manifest\?\.format === "rekixo\.geo-presentation"/);
});

test("Geo public runtime loads its pinned Building release by immutable ID instead of current Building pointer", () => {
  const runtime = read("workers/geo-release-runtime.mjs");
  const buildingRuntime = read("workers/release-runtime.mjs");

  assert.match(
    runtime,
    /releaseStateById\(\s*env,\s*slug,\s*row\.source_building_release_id/s,
  );
  assert.match(
    runtime,
    /Number\(building\.manifest\.release\.version\)[\s\S]*row\.source_building_release_version/,
  );
  assert.match(
    runtime,
    /building\.manifestSha256 !==[\s\S]*manifest\.sourceBuilding\.manifestSha256/,
  );
  assert.match(runtime, /Active Geo release Building source integrity mismatch/);

  assert.match(buildingRuntime, /export async function releaseStateById/);
  const start = buildingRuntime.indexOf("export async function releaseStateById");
  const end = buildingRuntime.indexOf("function publicWalkthroughFromStudio", start);
  const block = buildingRuntime.slice(start, end);
  assert.match(block, /WHERE p\.slug=\? AND r\.id=\?/);
  assert.doesNotMatch(block, /p\.active_release_id=r\.id/);
});

test("Building and Geo live pointers stay independent", () => {
  const runtime = read("workers/release-runtime.mjs");
  const geoRuntime = read("workers/geo-release-runtime.mjs");

  assert.match(runtime, /p\.active_release_id=r\.id/);
  assert.match(geoRuntime, /ar\.geo_release_id/);
  assert.match(geoRuntime, /gr\.source_building_release_id/);
  assert.doesNotMatch(geoRuntime, /p\.active_release_id=r\.id/);
});

test("model bytes remain public for a Building release pinned by active Geo even after Building upgrades", () => {
  const runtime = read("workers/release-runtime.mjs");

  assert.match(runtime, /geo_experience_active_releases_3d gar/);
  assert.match(runtime, /geo_releases_3d gr/);
  assert.match(runtime, /gr\.source_building_release_id=r\.id/);
  assert.match(runtime, /e\.type='geo'/);
  assert.match(runtime, /e\.lifecycle='active'/);

  const assetStart = runtime.indexOf("export async function serveReleaseAsset");
  const assetEnd = runtime.indexOf("export async function handleReleaseReadRequest", assetStart);
  const assetBlock = runtime.slice(assetStart, assetEnd);
  assert.match(assetBlock, /\?='model'/);
  assert.match(assetBlock, /p\.active_release_id=r\.id/);
  assert.match(assetBlock, /gr\.source_building_release_id=r\.id/);
});

test("Geo derivative authorization follows the same active Geo source release", () => {
  const runtime = read("workers/release-runtime.mjs");

  assert.match(runtime, /export async function geoModelDerivativeForReleaseState/);
  assert.match(runtime, /export async function geoModelDerivativeForActiveRelease/);

  const start = runtime.indexOf("async function serveGeoModelDerivative");
  const end = runtime.indexOf("export async function serveReleaseAsset", start);
  const block = runtime.slice(start, end);
  assert.match(block, /p\.active_release_id=r\.id/);
  assert.match(block, /geo_experience_active_releases_3d gar/);
  assert.match(block, /gr\.source_building_release_id=r\.id/);
});

test("public Geo payload exposes independent Geo and Building release identities", () => {
  const runtime = read("workers/geo-release-runtime.mjs");
  const page = read("apps/public/src/geo/GeoPublicDemo.tsx");

  assert.match(runtime, /buildingRelease:/);
  assert.match(runtime, /geoRelease:/);
  assert.match(runtime, /sourceDraftRevision/);
  assert.match(runtime, /Backward-compatible alias/);

  assert.match(page, /GEO RELEASE/);
  assert.match(page, /BUILDING SOURCE/);
  assert.match(page, /data\.geoRelease\.version/);
  assert.match(page, /data\.buildingRelease\.version/);
});

test("Geo publish and rollback become public immediately through active immutable pointer", () => {
  const mapper = read("apps/admin/src/geo/GeoMapper3D.tsx");
  const dashboard = read("apps/admin/src/dashboard/EngineDashboard.tsx");

  assert.match(mapper, /const geoLive = Boolean\(geoReleaseState\?\.activeRelease\)/);
  assert.match(mapper, /Open Geo Live/);
  assert.match(mapper, /Publish verified draft se naya immutable Geo Release/);
  assert.match(mapper, /Activate \/ Rollback/);

  assert.match(dashboard, /const activeGeo = geoState\?\.activeRelease/);
  assert.match(dashboard, /geoPublicProjectPath\(selectedProject\.slug\)/);
  assert.match(dashboard, /Open Geo Live/);
  assert.doesNotMatch(dashboard, /geoPlacement\(selectedSlug\)/);
  assert.doesNotMatch(dashboard, /Public compatibility snapshot/);
});

test("canonical Building and Geo URLs remain separate and stable", () => {
  const core = read("packages/engine-core/src/index.ts");
  const publicMain = read("apps/public/src/main.tsx");
  const page = read("apps/public/src/geo/GeoPublicDemo.tsx");

  assert.match(core, /geoPublicProjectPath/);
  assert.match(publicMain, /geoRoute/);
  assert.match(page, /\/3Dprojects\/api\/projects\/\$\{encodeURIComponent\(slug\)\}\/geo-placement/);
  assert.match(page, /href=\{\`\/3Dprojects\/\$\{encodeURIComponent\(data\.project\.slug\)\}\`\}/);
});

test("legacy mutable Geo placement is retained only as non-runtime compatibility data", () => {
  const publicWorker = read("workers/public.mjs");
  const adminWorker = read("workers/admin-cloud.mjs");
  const docs = read("ARCHITECTURE.md");

  assert.doesNotMatch(publicWorker, /geo_placements_3d/);
  assert.match(adminWorker, /geo_placements_3d/);
  assert.match(docs, /not a Phase 6 public source of truth/);
});

test("Public Worker deploy is triggered by future Geo runtime-only changes", () => {
  const workflow = read(".github/workflows/deploy-cloudflare.yml");

  assert.match(
    workflow,
    /workers\/\(public\|release-runtime\|geo-release-runtime\|geo-plot-public\|geo-plot-geometry\|http-range\|storage-boundary\|project-branding\)\\\.mjs\$/,
  );
  assert.match(workflow, /Deploy isolated 3D Public Worker/);
});

test("Phase 6 remains Engine-only and does not add Platform dependencies", () => {
  const files = [
    "workers/geo-release-runtime.mjs",
    "workers/public.mjs",
    "workers/release-runtime.mjs",
    "apps/public/src/geo/GeoPublicDemo.tsx",
    "apps/admin/src/geo/GeoMapper3D.tsx",
    "apps/admin/src/dashboard/EngineDashboard.tsx",
  ];

  for (const path of files) {
    const source = read(path);
    assert.doesNotMatch(source, /tiyansh-production|tiyansh-gallery-production/);
    assert.doesNotMatch(source, /\/api\/admin\//);
    assert.doesNotMatch(source, /rekixo-ar3d-platform/);
  }
});
