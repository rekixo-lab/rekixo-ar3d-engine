import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { validProjectSlug } from "../shared/project-slug-policy.js";

const read = (file) => fs.readFileSync(file, "utf8");
const PRODUCTION_PROTECTION_WORKER = "workers/project-deletion.mjs";

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(absolute));
    else out.push(absolute);
  }
  return out;
}

test("generic runtime has no first-project or Jyoti identity fallback", () => {
  const runtimeFiles = [
    ...walk("apps"),
    ...walk("packages"),
    ...walk("workers"),
  ].filter((file) => {
    if (!/\.(?:ts|tsx|js|mjs)$/.test(file)) return false;
    const normalized = file.split(path.sep).join("/");
    // Project/profile bundles are positive-match, lazy-loaded modules. Tenant
    // identity may exist there; it must not exist in the generic entry/runtime.
    if (normalized.endsWith("/src/viewer/projectExperience.ts")) return false;
    if (/\/dist\/assets\/projectExperience-[^/]+\.js$/.test(normalized))
      return false;
    if (/\/dist\/assets\/studio-source-profiles-[^/]+\.js$/.test(normalized))
      return false;
    // The destructive deletion worker owns a narrow production protection lock.
    // Dedicated regression tests prove that it is a guard, not a tenant fallback.
    if (normalized === PRODUCTION_PROTECTION_WORKER) return false;
    return true;
  });

  const violations = [];
  for (const file of runtimeFiles) {
    const source = read(file);
    if (/FIRST_PROJECT_SLUG|jyoti-paradise|Jyoti Paradise|project_jyoti|model_jyoti|scene_jyoti/i.test(source)) {
      violations.push(file);
    }
  }
  assert.deepEqual(violations, []);
});

test("admin discovers projects dynamically instead of assuming one tenant", () => {
  const worker = read("workers/admin.mjs");
  const admin = read("apps/admin/src/dashboard/EngineDashboard.tsx");
  assert.match(worker, /async function listProjects/);
  assert.match(worker, /\/api\/projects/);
  assert.match(worker, /ORDER BY p\.created_at ASC, p\.slug ASC/);
  assert.match(admin, /projects\(query,"active",100,0\)/);
  assert.match(admin, /projects\(search,"active",100,projectNextOffset\)/);
  assert.match(admin, /items\[0\]\?\.slug/);
  assert.doesNotMatch(admin, /FIRST_PROJECT_SLUG/);
});

test("public runtime derives tenant only from the requested project path", () => {
  const app = read("apps/public/src/main.tsx");
  const core = read("packages/engine-core/src/index.ts");
  assert.match(app, /projectSlugFromPathname\(window\.location\.pathname\)/);
  assert.match(core, /validProjectSlug/);
  assert.match(core, /publicProjectPath/);
  assert.match(core, /projectAssetPrefix/);
});

test("future project creation is controlled provisioning, not a schema migration", () => {
  const workflow = read(".github/workflows/provision-project.yml");
  const renderer = read("scripts/render-project-provision-sql.mjs");
  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /rekixo-3d-production/);
  assert.match(workflow, /render-project-provision-sql\.mjs/);
  assert.match(renderer, /status, created_at, updated_at/);
  assert.match(renderer, /'draft'/);
  assert.match(renderer, /ON CONFLICT\(slug\) DO NOTHING/);
  assert.doesNotMatch(renderer, /published/);
});

test("reserved Engine routes are rejected consistently before provisioning", () => {
  for (const slug of [
    "api",
    "assets",
    "studio",
    "login",
    "showcase",
    "published",
  ])
    assert.equal(validProjectSlug(slug), false, slug);
  assert.equal(validProjectSlug("garden-residences"), true);

  const provision = spawnSync(
    process.execPath,
    [
      "scripts/render-project-provision-sql.mjs",
      "api",
      "Reserved Route",
      "",
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(provision.status, 0);
  assert.match(provision.stderr, /reserved route/i);

  const consumers = [
    "packages/engine-core/src/index.ts",
    "apps/admin/src/studio/domain.ts",
    "workers/admin.mjs",
    "workers/admin-cloud.mjs",
    "workers/release-runtime.mjs",
    "scripts/render-project-provision-sql.mjs",
  ];
  for (const file of consumers)
    assert.match(
      read(file),
      /project-slug-policy\.js/,
      `${file} must use the shared project slug policy`,
    );
});

test("historical Jyoti migrations remain immutable compatibility history", () => {
  const migrations = fs.readdirSync("database/migrations").sort();
  assert.deepEqual(migrations.slice(0, 3), [
    "0001_core.sql",
    "0002_jyoti_production_viewer.sql",
    "0003_jyoti_supplied_content_v1.sql",
  ]);
  for (const migration of migrations.slice(3)) {
    const prefix = Number(migration.slice(0, 4));
    assert.ok(Number.isInteger(prefix) && prefix >= 4, `new migrations must be additive after 0003: ${migration}`);
  }
  assert.match(read("database/migrations/0001_core.sql"), /jyoti-paradise/);
});

test("privileged Engine writes live only behind the dedicated cloud auth boundary", () => {
  const worker = read("workers/admin.mjs");
  const cloud = read("workers/admin-cloud.mjs");
  assert.match(worker, /handleCloudAdminRequest/);
  assert.match(cloud, /sessionFor\(request, env\)/);
  assert.match(cloud, /sameOrigin\(request\)/);
  assert.match(cloud, /Engine Admin sign-in required/);
  assert.match(cloud, /ENGINE_ADMIN_SESSION_SECRET/);
  assert.doesNotMatch(cloud, /tiyansh_admin|\\bSESSION_SECRET\\b|\\bADMIN_PASSWORD_HASH\\b/);
  assert.match(worker, /request\.method !== "GET"/);
});
