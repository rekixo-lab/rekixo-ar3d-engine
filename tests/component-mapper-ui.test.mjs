import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const worker = fs.readFileSync("workers/component-mapper-data.mjs", "utf8");
const entry = fs.readFileSync("workers/admin-entry.mjs", "utf8");
const mapper = fs.readFileSync(
  "apps/admin/src/source-pack/ComponentMapper.tsx",
  "utf8",
);
const processing = fs.readFileSync(
  "apps/admin/src/source-pack/ProcessingSpine.tsx",
  "utf8",
);
const main = fs.readFileSync("apps/admin/src/main.tsx", "utf8");
const css = fs.readFileSync(
  "apps/admin/src/source-pack/component-mapper.css",
  "utf8",
);

test("component mapper data is authenticated and only exposes verified canonical catalog metadata", () => {
  assert.match(worker, /engineAdminReadAccess/);
  assert.match(worker, /sameOrigin/);
  assert.match(worker, /processing_jobs_3d/);
  assert.match(worker, /processing_artifacts_3d/);
  assert.match(worker, /source_packs_3d/);
  assert.match(worker, /MODEL_ASSETS\.get\(catalogArtifact\.r2_key\)/);
  assert.match(worker, /sha256Hex\(bytes\)/);
  assert.match(worker, /validateCatalogIdentity\(catalog, project, identity\)/);
  assert.match(worker, /Node catalog is stale for the current sealed Source Pack/);
  assert.doesNotMatch(worker, /MODEL_ASSETS\.(put|delete)/);
  assert.doesNotMatch(worker, /UPDATE\s+source_packs_3d/i);
  assert.doesNotMatch(worker, /UPDATE\s+processing_jobs_3d/i);
  assert.doesNotMatch(worker, /UPDATE\s+processing_artifacts_3d/i);
  assert.doesNotMatch(worker, /r2Key\s*:/);
});

test("component mapper catalog search is bounded and selectable-node only", () => {
  assert.match(worker, /const MAX_LIMIT = 200/);
  assert.match(worker, /const DEFAULT_LIMIT = 80/);
  assert.match(worker, /node\?\.selectable === true/);
  assert.match(worker, /Math\.min\(MAX_LIMIT, Math\.max\(1, requestedLimit\)\)/);
  assert.match(worker, /\.slice\(0, 160\)/);
  assert.match(worker, /filtered\.slice\(offset, offset \+ limit\)/);
  assert.match(worker, /totalSelectable: selectable\.length/);
});

test("mapper readiness fails closed before draft, sealed pack, succeeded job or node catalog", () => {
  assert.match(worker, /Create and save the Studio cloud draft before component mapping/);
  assert.match(worker, /Seal a Source Pack before component mapping/);
  assert.match(worker, /Canonical processing must succeed before component mapping/);
  assert.match(worker, /A verified node-catalog-v1 artifact is required before component mapping/);
  assert.match(worker, /bindingStatus\(/);
  assert.match(worker, /return "stale"/);
});

test("Admin entry handles mapper data before reviewed-binding and legacy cloud fallback", () => {
  const mapperIndex = entry.indexOf("handleComponentMapperDataRequest");
  const bindingsIndex = entry.indexOf("handleReviewedComponentBindingsRequest");
  const fallbackIndex = entry.indexOf("return adminWorker.fetch");
  assert.ok(mapperIndex >= 0);
  assert.ok(bindingsIndex > mapperIndex);
  assert.ok(fallbackIndex > bindingsIndex);
});

test("Component Mapper page provides canonical search, semantic targets and optimistic reviewed saves", () => {
  assert.match(mapper, /Reviewed Component Mapper/);
  assert.match(mapper, /Search node name or canonical node ID/);
  assert.match(mapper, /SELECTABLE NODES/);
  assert.match(mapper, /REVIEWED BINDINGS/);
  assert.match(mapper, /BINDING IDENTITY/);
  assert.match(mapper, /changeFloor/);
  assert.match(mapper, /changeUnit/);
  assert.match(mapper, /changeRoom/);
  assert.match(mapper, /changeSemantic/);
  assert.match(mapper, /saveReviewedComponentBindings/);
  assert.match(mapper, /clearReviewedComponentBindings/);
  assert.match(mapper, /data\.draft\.revision/);
  assert.match(mapper, /data\.processing\.processingJobId/);
  assert.match(mapper, /Save reviewed mappings/);
});

test("processing handoff advertises node catalog and links only catalog-ready output to mapper", () => {
  assert.match(processing, /nodeCatalog\?: ProcessingArtifactV1/);
  assert.match(processing, /Model prepared/);
  assert.match(processing, /Model validated and ready for component review/);
  assert.match(processing, /canonicalOutput\?\.nodeCatalog/);
  assert.match(processing, /\/3Dprojects\/component-mapper\?project=/);
  assert.match(processing, /Review Components/);
});

test("Admin router exposes component mapper as a lazy route and mapper is responsive", () => {
  assert.match(main, /lazy\(\(\) => import\("\.\/source-pack\/ComponentMapper"\)\)/);
  assert.match(main, /path === "\/3Dprojects\/component-mapper"/);
  assert.match(css, /@media \(max-width: 980px\)/);
  assert.match(css, /@media \(max-width: 680px\)/);
  assert.match(css, /component-mapper__actions/);
});
