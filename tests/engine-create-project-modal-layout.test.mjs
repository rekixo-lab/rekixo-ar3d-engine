import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const dashboard = fs.readFileSync("apps/admin/src/dashboard/EngineDashboard.tsx", "utf8");
const css = fs.readFileSync("apps/admin/src/dashboard/engine-dashboard.css", "utf8");

test("Create Project modal keeps all three independently selectable project kinds", () => {
  assert.match(dashboard, /\["building", "building_geo", "masterplan_geo"\]/);
  assert.match(dashboard, /name="engine-project-kind"/);
  assert.match(dashboard, /checked={createKind === kind}/);
  assert.match(dashboard, /ensureProject\(draft, createKind/);
  assert.match(dashboard, /role="dialog" aria-modal="true"/);
  assert.match(dashboard, /role="alert"/);
  assert.match(dashboard, /event\.key === "Escape"/);
});

test("Create Project modal scopes small radio and checkbox controls", () => {
  assert.match(css, /\.engine-overview-modal \.engine-overview-kind input\[type="radio"\]/);
  assert.match(css, /width: 19px;\s*height: 19px;\s*min-height: 19px/);
  assert.match(css, /\.engine-overview-modal \.engine-overview-create-public-contact input\[type="checkbox"\]/);
  assert.match(css, /width: 17px;\s*height: 17px;\s*min-height: 17px/);
  assert.match(css, /grid-template-columns: 40px minmax\(0, 1fr\) 20px/);
  assert.match(css, /overflow-wrap: anywhere/);
});

test("Create Project dialog supports mobile width and viewport-height scrolling", () => {
  assert.match(css, /max-height: calc\(100dvh - 32px\)/);
  assert.match(css, /\.engine-overview-modal__body\s*\{[^}]*overflow-y: auto/s);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(dashboard, /disabled={createBusy}/);
  assert.match(dashboard, /createPublicContacts/);
});
