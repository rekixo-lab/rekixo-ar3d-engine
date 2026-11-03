import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const geoApp = await readFile(new URL("../apps/public/src/geo/GeoPublicDemo.tsx", import.meta.url), "utf8");
const geoStyles = await readFile(new URL("../apps/public/src/geo/geo-public-demo.css", import.meta.url), "utf8");

test("Geo customer header keeps project branding and icon-only quick actions", () => {
  const headerStart = geoApp.indexOf('<header className="jio-public-header">');
  const headerEnd = geoApp.indexOf("</header>", headerStart);
  assert.ok(headerStart >= 0 && headerEnd > headerStart, "Geo project header must exist");
  const header = geoApp.slice(headerStart, headerEnd);

  assert.match(header, /className="jio-public-branding"/);
  assert.match(header, /className="jio-public-project-logo"/);
  assert.match(header, /<h1>\{data\.project\.name\}<\/h1>/);
  assert.match(header, /<GeoHeaderSubtitle text=\{data\.project\.location \|\| "Rekixo AR3D Engine"\}/);
  assert.match(header, /className="jio-public-header-actions"/);
  assert.doesNotMatch(header, /INTEGRATED 3D GEO EXPERIENCE|Enter building|Open location/);
  assert.doesNotMatch(header, />\s*(?:Call|WhatsApp|Admin Panel)\s*<\/a>/);
  assert.doesNotMatch(geoApp, /const mapsUrl\s*=/);
});

test("Geo toolbar keeps three camera presets, Re-enter, and project 3D Model link", () => {
  const toolbarStart = geoApp.indexOf('<nav className="geo-camera-toolbar geo-camera-toolbar--normal-row"');
  const toolbarEnd = geoApp.indexOf("</nav>", toolbarStart);
  assert.ok(toolbarStart >= 0 && toolbarEnd > toolbarStart, "Geo map toolbar must exist");
  const toolbar = geoApp.slice(toolbarStart, toolbarEnd);
  const declaredViews = geoApp.slice(geoApp.indexOf("const GEO_CAMERA_VIEWS"), geoApp.indexOf("let mapsPromise"));
  const labels = ["Overview", "Front", "Corner"];
  let previous = -1;
  for (const label of labels) {
    const position = declaredViews.indexOf(`label: "${label}"`);
    assert.ok(position > previous, `${label} should retain the requested camera order`);
    previous = position;
  }

  assert.match(toolbar, /\{GEO_CAMERA_VIEWS\.map/);
  assert.match(toolbar, /aria-label="Re-enter project map"/);
  assert.match(toolbar, /onClick=\{\(\) => reenterActionRef\.current\?\.\(\)\}/);
  assert.doesNotMatch(declaredViews, /label: "Aerial"/);
  assert.doesNotMatch(declaredViews, /label: "Entry view"/);
  assert.doesNotMatch(toolbar, /Entry view/);
  assert.doesNotMatch(toolbar, /geo-building-link|Building <span|building website/);
  assert.match(toolbar, /<a className="geo-model-site-link"/);
  assert.match(toolbar, /href=\{modelSiteHref\}/);
  assert.match(toolbar, /target="_blank" rel="noopener noreferrer"/);
  assert.match(toolbar, />3D Model<\/a>/);
  assert.match(geoApp, /modelSiteHref=\{`\/3Dprojects\/\$\{encodeURIComponent\(slug\)\}`\}/,
    "3D website must use this project's own slug, never a hardcoded or external URL");
  assert.doesNotMatch(geoApp.slice(geoApp.indexOf('{toolbarContainer ? createPortal(<nav className="geo-camera-toolbar') - 35, geoApp.indexOf('{toolbarContainer ? createPortal(<nav className="geo-camera-toolbar')), /!failure/);
  assert.doesNotMatch(toolbar, /Open location|Google Maps/);
});

test("Geo camera controls are fixed to the viewport bottom with mobile safe-area padding", () => {
  const dock = geoStyles.slice(geoStyles.lastIndexOf("/* Public Geo: a viewport-bottom navigation dock"));
  assert.ok(dock.includes(".geo-public-toolbar-slot {"));
  assert.ok(dock.includes("position: fixed;"));
  assert.ok(dock.includes("bottom: 0;"));
  assert.ok(dock.includes("safe-area-inset-bottom"));
  assert.ok(dock.includes("touch-action: none;"));
  assert.ok(dock.includes(".geo-map-quick-actions"));
  assert.ok(geoStyles.includes("grid-template-columns: repeat(5, minmax(0, 1fr))"));
});

test("normal Geo camera row has five independent rounded actions and no outer panel", () => {
  const transparentRow = geoStyles.slice(geoStyles.indexOf("/* Transparent, full-width camera controls:"));
  assert.match(transparentRow, /grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(transparentRow, /width:\s*100% !important/);
  assert.match(transparentRow, /border:\s*0 !important/);
  assert.match(transparentRow, /border-radius:\s*0 !important/);
  assert.match(transparentRow, /background:\s*transparent !important/);
  assert.match(transparentRow, /box-shadow:\s*none !important/);
  assert.match(transparentRow, /button\.is-active::after/);
  const polished = geoStyles.slice(geoStyles.lastIndexOf("/* Customer Geo: independent rounded camera controls"));
  assert.ok(polished.length > 300);
  assert.match(polished, /\.geo-public-toolbar-slot\{[\s\S]*background:transparent !important/);
  assert.match(polished, /\.geo-public-toolbar-slot > \.geo-camera-toolbar--normal-row\{[\s\S]*background:transparent !important/);
  assert.match(polished, /\.geo-camera-toolbar--normal-row button,[\s\S]*\.geo-model-site-link\{[\s\S]*border-radius:10px !important/);
  assert.match(polished, /\.geo-model-site-link\{[\s\S]*background:rgba\(13,61,50,.85\) !important/);
  assert.match(polished, /\.geo-camera-toolbar--normal-row button\.is-active\{[\s\S]*border-radius:10px !important/);
  assert.match(polished, /\.geo-camera-toolbar--normal-row button\.is-active::after\{[\s\S]*display:none/);
  assert.doesNotMatch(polished, /\.geo-camera-toolbar--fullscreen-clone/);
});


test("Geo customer view omits developer runtime and fallback badges", () => {
  assert.doesNotMatch(geoApp, /geo-quality-badge|GEO RUNTIME|GEO FALLBACK|Integrated vector terrain \+ immutable 3D Building/);
  assert.doesNotMatch(geoStyles, /\.geo-quality-badge/);
  assert.match(geoStyles, /\.geo-fallback-note\s*\{/);
  assert.match(geoApp, /aria-label=\{mapFallbackReason\}/);
});
