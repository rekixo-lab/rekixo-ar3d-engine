import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");

test("plot layout workflow initializes existing cloud project identity without inventing rooms", () => {
  const ui = read("apps/admin/src/building/PlotSiteHandoff.tsx");
  assert.match(ui, /draft\.id = project\.id/);
  assert.match(ui, /draft\.slug = project\.slug/);
  assert.match(ui, /await saveDraft\(initial, null\)/);
  assert.match(ui, /Cloud draft not found/);
  assert.match(ui, /Site Base/);
  assert.match(ui, /No invented rooms or plot IDs/);
  assert.match(ui, /!processingReady/);
  assert.match(ui, /processing\.processingJobId/);
});

test("first Plot Site publishing requires operator confirmation and canonical artifact", () => {
  const ui = read("apps/admin/src/building/PlotSiteHandoff.tsx");
  const cloud = read("apps/admin/src/studio/cloud.ts");
  const admin = read("workers/admin-cloud.mjs");
  const publish = read("workers/release-publish.mjs");
  assert.match(ui, /reviewed the actual GLB\/site bounds, orientation and materials/);
  assert.match(ui, /window\.confirm/);
  assert.match(ui, /await publishRelease\(slug, draftRevision, true\)/);
  assert.match(cloud, /requireCanonicalSource: true/);
  assert.match(admin, /body\.requireCanonicalSource === true/);
  assert.match(publish, /if \(requireCanonicalSource\)/);
  assert.match(publish, /resolveCanonicalReleaseSource/);
  assert.match(publish, /if \(!approvedCanonical\)/);
  assert.match(publish, /currentProject\.active_release_id/);
  assert.match(ui, /Open Geo Alignment/);
  assert.doesNotMatch(ui, /publishGeoRelease/);
});

test("legacy Building/Geo publishing and existing immutable releases remain independent", () => {
  const component = read("apps/admin/src/building/BuildingWorkspace.tsx");
  const publisher = read("workers/release-publish.mjs");
  assert.match(component, /<PlotSiteHandoff/);
  assert.match(component, /Open Component Review/);
  assert.match(component, /Open Building Releases/);
  assert.match(publisher, /requireCanonicalSource = false/);
});
