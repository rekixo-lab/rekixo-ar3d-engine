import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL("../" + path, import.meta.url), "utf8");
const worker = read("workers/project-branding.mjs");
const cloud = read("apps/admin/src/studio/cloud.ts");
const builder = read("apps/admin/src/branding/ProjectShareBuilder.tsx");

test("Building has an isolated, atomic Publish Update for logo and poster", () => {
  const begin = worker.indexOf("async function publishBuildingSite(");
  const end = worker.indexOf("// One atomic publish for the customer's Geo logo", begin);
  assert.ok(begin >= 0 && end > begin, "Building handler must be separate from Geo");
  const handler = worker.slice(begin, end);
  assert.match(worker, /action === "publish-building-site"/);
  assert.match(handler, /experienceReadiness\(env, project, slug, "building"\)/);
  assert.match(handler, /expectedLogoDraftVersion/);
  assert.match(handler, /expectedBuildingCardVersion/);
  assert.match(handler, /readLogoVersion/);
  assert.match(handler, /readShareVersion/);
  assert.match(handler, /env\.MODEL_ASSETS\.head\(key\)/);
  assert.match(handler, /env\.DB\.batch\(\[/);
  assert.match(handler, /INSERT INTO project_branding_share_versions_3d/);
  assert.match(handler, /branding\.building_site_updated/);
  assert.match(handler, /'building'/);
  assert.doesNotMatch(handler, /MODEL_ASSETS\.delete|DELETE FROM|DROP TABLE/);
  assert.doesNotMatch(handler, /geo_site_updated|publishGeoRelease/);
});

test("Owner UI uses one context-aware Publish Update, without lying about draft uploads", () => {
  assert.match(cloud, /publishBuildingSiteBranding/);
  assert.match(cloud, /action: "publish-building-site"/);
  assert.match(builder, /async function updateBuildingSite\(\)/);
  assert.match(builder, /async function updateGeoSite\(\)/);
  assert.match(builder, /Update Building Site/);
  assert.match(builder, /Update Geo Site/);
  assert.match(builder, /activeExperience === "geo" \? updateGeoSite\(\) : updateBuildingSite\(\)/);
  assert.match(builder, /if \(logoFiles \|\| shareFiles\.building \|\| shareFiles\.geo\)/);
  assert.match(builder, /engine-branding-advanced-action/);
});

test("Building and Geo model releases remain independent of share image updates", () => {
  const code = read("workers/release-publish.mjs");
  assert.match(code, /currentProject\.active_release_id/);
  assert.match(code, /INSERT INTO release_activations_3d/);
  assert.doesNotMatch(worker.slice(worker.indexOf("async function publishBuildingSite("),
    worker.indexOf("// One atomic publish for the customer's Geo logo")), /UPDATE projects_3d/);
});
