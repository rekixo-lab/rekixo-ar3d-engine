import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const verifier = fs.readFileSync("scripts/verify-production-building-demo.mjs", "utf8");
const workflow = fs.readFileSync(".github/workflows/verify-production-building-demo.yml", "utf8");

test("production demo verifier stays generic and targets active immutable Building releases", () => {
  assert.match(verifier, /\/3Dprojects\/api\/releases/);
  assert.match(verifier, /REKIXO_DEMO_PROJECT_SLUG/);
  assert.match(verifier, /NO_ACTIVE_BUILDING_RELEASES/);
  assert.match(verifier, /BUILDING_DEMO_READY/);
  assert.doesNotMatch(verifier, /jyoti|paradise/i);
});

test("production demo verifier checks the customer route, source model and safe presentation data", () => {
  assert.match(verifier, /\/3Dprojects\/\$\{encodeURIComponent\(slug\)\}/);
  assert.match(verifier, /model\?\.available === true/);
  assert.match(verifier, /method: "HEAD"/);
  assert.match(verifier, /Range: "bytes=0-3"/);
  assert.match(verifier, /Camera position/);
  assert.match(verifier, /floorLevels/);
  assert.match(verifier, /areaSqFt/);
  assert.match(verifier, /Walkthrough door references an unknown room/);
  assert.match(verifier, /inspectGlbGeometry/);
  assert.match(verifier, /LIVE_MODEL_GEOMETRY/);
  assert.match(verifier, /meshNodeCount/);
  assert.match(verifier, /hierarchyGroupCount/);
  assert.match(verifier, /meshCenterHistogram/);
  assert.match(verifier, /LIVE_PUBLIC_UI_BUNDLE/);
  assert.match(verifier, /Show Ground Floor only/);
  assert.match(verifier, /client-floor-controls/);
  assert.match(verifier, /Range: "bytes=0-19"/);
  assert.doesNotMatch(verifier, /reconstruct|inferRoom|replaceModel/i);
});

test("post-deploy QA runs only after successful production deployment or explicit dispatch", () => {
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /Deploy Rekixo AR3D Engine/);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /node scripts\/verify-production-building-demo\.mjs/);
  assert.match(workflow, /REKIXO_DEMO_PROJECT_SLUG/);
  assert.match(workflow, /ref: \$\{\{ github\.event\.workflow_run\.head_sha \|\| 'main' \}\}/);
});
