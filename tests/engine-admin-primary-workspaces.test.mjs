import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { projectModuleVisible } from "../shared/engine-project-kinds.js";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Engine owner sidebar uses only the concise, type-gated workspaces", () => {
  const shell = read("apps/admin/src/layout/EngineAdminShell.tsx");
  assert.match(shell, /const primaryNavSections = new Set<ShellSection>/);
  assert.match(shell, /primaryNavSections\.has\(item\.id\) && projectModuleVisible\(projectKind,item\.id\)/);
  for (const id of ["overview", "clients", "profile", "masterplan-plots", "building", "geo", "geo-plots", "branding"]) {
    assert.ok(shell.includes(`"${id}"`), `Missing primary workspace: ${id}`);
  }
  for (const label of ["3D Building Editor", "3D Building Geo Editor", "Masterplan Plot Mapper", "Share & Branding"]) {
    assert.ok(shell.includes(label), `Missing accessible workspace title: ${label}`);
  }
});

test("primary tools depend on project kind, not universal menus", () => {
  assert.equal(projectModuleVisible("building", "geo"), false);
  assert.equal(projectModuleVisible("building", "building"), true);
  assert.equal(projectModuleVisible("building_geo", "geo"), true);
  assert.equal(projectModuleVisible("building_geo", "geo-plots"), true);
  assert.equal(projectModuleVisible("masterplan_geo", "masterplan-plots"), true);
  assert.equal(projectModuleVisible("masterplan_geo", "building"), false);
});

test("masterplan source calibration and plot mapping share one editor", () => {
  const workspace = read("apps/admin/src/masterplan/MasterplanWorkspace.tsx");
  assert.match(workspace, /masterplan-editor-tabs/);
  assert.match(workspace, /Source & GPS/);
  assert.match(workspace, /Plot Mapper & Measurements/);
  assert.match(workspace, /panel==="source"/);
  assert.match(workspace, /panel==="plots"/);
  assert.match(workspace, /Publish Update/);
  // The prior standalone URLs remain routed for historical bookmarks.
  const router = read("apps/admin/src/main.tsx");
  assert.match(router, /\/3Dprojects\/masterplan/);
  assert.match(router, /\/3Dprojects\/mapping-controls/);
});
