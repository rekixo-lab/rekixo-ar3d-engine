import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Engine admin shows focused project-type navigation instead of technical subpages", () => {
  const shell = read("apps/admin/src/layout/EngineAdminShell.tsx");
  for (const label of ["Projects", "Clients", "Project Profile", "3D Building Editor", "3D Building Geo Editor", "Masterplan Plot Mapper", "3D Geo Plot Mapper", "Share & Branding"]) {
    assert.match(shell, new RegExp(`label:\\s*\\"${label}\\"`));
  }
  assert.match(shell, /ACTIVE PROJECT/);
  assert.match(shell, /engine-project-switcher/);
});

test("admin routes keep workflows behind the shared shell", () => {
  const main = read("apps/admin/src/main.tsx");
  assert.match(main, /EngineAdminShell/);
  assert.match(main, /\/3Dprojects\/building/);
  assert.match(main, /\/3Dprojects\/releases/);
  assert.match(main, /\/3Dprojects\/advanced/);
  assert.match(main, /GeoWorkspace/);
  assert.match(main, /window\.location\.replace\(`\/3Dprojects\/source-pack/);
});

test("Source Pack exposes one model selection and keeps advanced review protected", () => {
  const source = read("apps/admin/src/source-pack/SourcePackReview.tsx");
  assert.match(source, /Use This Model & Prepare/);
  assert.match(source, /Select verified 3D model/);
  assert.match(source, /<details className="source-review__advanced">/);
  assert.match(source, /ProcessingSpine/);
  assert.match(source, /SEAL SOURCE PACK/);
  assert.doesNotMatch(source, /source-review__workflow-nav/);
});

test("Geo uses exactly one mapping editor without duplicate outer step menus", () => {
  const geo = read("apps/admin/src/geo/GeoWorkspace.tsx");
  const mapper = read("apps/admin/src/geo/GeoMapper3DV2.tsx");
  assert.match(geo, /GeoMapper3DV2/);
  assert.doesNotMatch(geo, /geo-control-flow|MutationObserver/);
  assert.match(mapper, /Save Geo V2 Draft/);
  assert.match(mapper, /Verify Current Preview/);
  assert.match(mapper, /Publish Update/);
});

test("Building, Releases and Advanced separate operator concerns", () => {
  const building = read("apps/admin/src/building/BuildingWorkspace.tsx");
  const releases = read("apps/admin/src/releases/EngineReleases.tsx");
  const advanced = read("apps/admin/src/advanced/EngineAdvanced.tsx");

  for (const marker of ["SourcePackReview", "ComponentMapper", "3D Model", "Design", "Publish", "Restore Version"]) {
    assert.match(building, new RegExp(marker));
  }
  assert.doesNotMatch(building, /building-workspace__flow/);
  assert.match(releases, /activateRelease/);
  assert.match(releases, /activateGeoRelease/);
  assert.match(releases, /Immutable Building history/);
  assert.match(releases, /Immutable Geo history/);
  assert.match(advanced, /saveGeoMapsKey/);
  assert.match(advanced, /\/3Dprojects\/api\/geo-v2\/maps-config/);
  assert.match(advanced, /DELETE ALL PROJECTS/);
  assert.match(advanced, /DANGER ZONE/);
});
