import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const get = (name) => fs.readFileSync(name, "utf8");
const map = get("apps/admin/src/geo/GeoIntegratedAuthoringMap.tsx");
const editor = get("apps/admin/src/geo/GeoMapper3DV2.tsx");
const css = get("apps/admin/src/geo/geo-v2.css");

test("map fullscreen control opens the whole Geo Editor rather than hiding controls", () => {
  assert.match(map, /fullscreenControl: false/);
  assert.match(map, /Open Full Editor/);
  assert.match(map, /onToggleEditor/);
  assert.match(editor, /onToggleEditor=\{toggleEditor\}/);
  assert.match(editor, /Exit Full Editor/);
  assert.match(css, /\.geo-v2-integrated-card--focus \{[\s\S]*position:fixed/);
  assert.match(css, /\.geo-v2-integrated-card--focus > \.geo-v2-exact-placement-grid \{[\s\S]*display:block/);
});

test("map has non-resetting fine zoom buttons and current zoom label", () => {
  assert.match(map, /getZoom\?\(\): number \| undefined/);
  assert.match(map, /const stepZoom =/);
  assert.match(map, /current \+ difference/);
  assert.match(map, /stepZoom\(0\.5\)/);
  assert.match(map, /stepZoom\(-0\.5\)/);
  assert.match(map, /mapZoom\.toFixed\(1\)/);
  assert.match(map, /zoomControl: true/);
});

test("full viewport editor keeps matching points, fine tune and the canonical source in one dock", () => {
  assert.match(editor, /"corners" \| "fine" \| "position" \| "release"/);
  assert.match(editor, /aria-label="Geo editor tools"/);
  assert.match(editor, /<GeoGuidedRigidAlignment/);
  assert.match(editor, /editorTab === "position"/);
  assert.match(editor, /sourceReleaseId/);
  assert.match(editor, /editorTab === "release"/);
  assert.match(editor, /Create & Select Anchor/);
  assert.match(css, /\.geo-v2-guided-dock--editor \{/);
  assert.match(css, /\.geo-v2-editor-footer \{/);
  assert.match(css, /\.geo-v2-editor-tabs \{/);
  assert.match(css, /\.geo-v2-editor-guide--fine/);
});

test("save, verify and immutable publish remain gated in full editor", () => {
  assert.match(editor, /onClick=\{\(\) => void run\(save\)\}/);
  assert.match(editor, /disabled=\{busy \|\| Boolean\(verificationBlocker\)\}/);
  assert.match(editor, /disabled=\{busy \|\| !publishReady\}/);
  assert.match(editor, /window\.confirm\("Publish this exact saved and verified Geo placement/);
  assert.match(editor, /onClick=\{\(\) => \{[\s\S]*void run\(publish\)/);
  assert.match(editor, /if \(previewVariant !== "canonical"\)/);
  assert.match(editor, /setDockOpen\(true\)/);
  assert.match(editor, /window\.addEventListener\("keydown", closeOnEscape\)/);
});

test("source resize and the map remain mounted while switching fullscreen and editor tabs", () => {
  assert.match(editor, /geo-v2-integrated-card--focus/);
  assert.match(map, /mapResizeObserver\.observe\(hostRef\.current!\)/);
  assert.match(css, /geo-v2-editor-guide--position, \.geo-v2-editor-guide--release \{ display:none; \}/);
  assert.match(css, /\.geo-v2-integrated-card--focus \.geo-v2-map-column \{/);
});
