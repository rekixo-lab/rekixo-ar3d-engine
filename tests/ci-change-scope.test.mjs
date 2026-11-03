import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {classifyCiChanges} from "../scripts/ci-change-scope.mjs";

const read = path => readFileSync(new URL("../" + path,import.meta.url),"utf8");

test("only app stylesheets use fast lane and receive targeted visual specs",()=>{
  const geo = classifyCiChanges(["apps/public/src/geo/geo-public-demo.css"]);
  assert.equal(geo.lane,"ui");
  assert.equal(geo.run_building_browser,false);
  assert.match(geo.fast_browser_specs,/geo-true-north-compass\.spec\.ts/);
  assert.match(geo.fast_browser_specs,/geo-mobile-viewport-fit\.spec\.ts/);

  const admin = classifyCiChanges(["apps/admin/src/layout/engine-admin.css"]);
  assert.equal(admin.lane,"ui");
  assert.equal(admin.run_building_browser,false);
  assert.match(admin.fast_browser_specs,/client-admin-responsive-motion\.spec\.ts/);

  const building = classifyCiChanges(["apps/public/src/viewer/viewer.css"]);
  assert.equal(building.lane,"ui");
  assert.equal(building.run_building_browser,true);
  assert.match(building.fast_browser_specs,/public-building\.spec\.ts/);

  const mixed = classifyCiChanges(["apps/admin/src/other.css","apps/public/src/geo/geo-public-demo.css"]);
  assert.equal(mixed.lane,"ui");
  assert.match(mixed.fast_browser_specs,/client-admin-responsive-motion\.spec\.ts/);
  assert.match(mixed.fast_browser_specs,/geo-true-north-compass\.spec\.ts/);
});

test("no unknown, logic, test, auth, mapping, database or workflow change can bypass full tests",()=>{
  const critical=[
    "apps/public/src/geo/GeoPublicDemo.tsx",
    "shared/geo-touch-orbit.js",
    "workers/public-entry.mjs",
    "workers/project-branding.mjs",
    "database/migrations/0042_example.sql",
    "apps/admin/src/login/SignIn.tsx",
    "tests/geo-public-true-north-compass.test.mjs",
    "e2e/geo-true-north-compass.spec.ts",
    ".github/workflows/validate.yml",
    ".github/workflows/deploy-cloudflare.yml",
    "scripts/ci-change-scope.mjs",
    "package-lock.json",
    "docs/README.md",
    "apps/public/src/geo/looks.css.backup",
  ];
  for(const file of critical){
    const result=classifyCiChanges(["apps/public/src/geo/geo-public-demo.css",file]);
    assert.equal(result.lane,"full",file);
    assert.equal(result.run_building_browser,true,file);
    assert.equal(result.fast_browser_specs,"",file);
  }
  assert.equal(classifyCiChanges([]).lane,"full","empty/failed detection never becomes fast");
  assert.equal(classifyCiChanges(["apps/public/src/geo/geo-public-demo.css","apps/public/src/geo/GeoPublicDemo.tsx"]).lane,"full");
});

test("workflow keeps a stable required check and never weakens production safety",()=>{
  const validate=read(".github/workflows/validate.yml");
  const deploy=read(".github/workflows/deploy-cloudflare.yml");
  const verifier=read(".github/workflows/verify-production-building-demo.yml");
  assert.match(validate,/name: Validate Rekixo AR3D Engine/);
  assert.match(validate,/concurrency:/);
  assert.match(validate,/cancel-in-progress: true/);
  assert.match(validate,/scripts\/ci-change-scope\.mjs pr/);
  assert.match(validate,/Unit and integration tests/);
  assert.match(validate,/Run fast browser UI smoke/);
  assert.match(validate,/Migration verification/);
  assert.match(validate,/Diff whitespace safety/);
  assert.match(deploy,/Require merged PR for production push/);
  assert.match(deploy,/scripts\/ci-change-scope\.mjs push/);
  assert.match(deploy,/Verify active immutable release integrity/);
  assert.match(deploy,/Verify sensitive Admin reads are protected/);
  assert.match(deploy,/Deploy isolated 3D Public Worker/);
  assert.match(verifier,/run_building_browser/);
  assert.match(verifier,/workflow_run\.head_sha/);
});
