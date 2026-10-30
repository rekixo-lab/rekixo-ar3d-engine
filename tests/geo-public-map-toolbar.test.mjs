import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const geoApp = await readFile(new URL("../apps/public/src/geo/GeoPublicDemo.tsx", import.meta.url), "utf8");
const geoStyles = await readFile(new URL("../apps/public/src/geo/geo-public-demo.css", import.meta.url), "utf8");

test("Geo customer header keeps only the project logo, name, and subtitle", () => {
  const headerStart = geoApp.indexOf('<header className="jio-public-header">');
  const headerEnd = geoApp.indexOf("</header>", headerStart);
  assert.ok(headerStart >= 0 && headerEnd > headerStart, "Geo project header must exist");
  const header = geoApp.slice(headerStart, headerEnd);

  assert.match(header, /className="jio-public-branding"/);
  assert.match(header, /className="jio-public-project-logo"/);
  assert.match(header, /<h1>\{data\.project\.name\}<\/h1>/);
  assert.match(header, /data\.project\.location \|\| "Rekixo AR3D Engine"/);
  assert.doesNotMatch(header, /INTEGRATED 3D GEO EXPERIENCE|Enter building|Open location|jio-public-header-actions/);
  assert.doesNotMatch(geoApp, /const mapsUrl\s*=/);
});

test("Geo map toolbar orders all camera views before the Building website link", () => {
  const toolbarStart = geoApp.indexOf('<nav className="geo-camera-toolbar geo-camera-toolbar--normal-row"');
  const toolbarEnd = geoApp.indexOf("</nav>", toolbarStart);
  assert.ok(toolbarStart >= 0 && toolbarEnd > toolbarStart, "Geo map toolbar must exist");
  const toolbar = geoApp.slice(toolbarStart, toolbarEnd);
  const declaredViews = geoApp.slice(geoApp.indexOf("const GEO_CAMERA_VIEWS"), geoApp.indexOf("let mapsPromise"));
  const labels = ["Overview", "Front", "Corner", "Entry view", "Aerial"];
  let previous = -1;
  for (const label of labels) {
    const position = declaredViews.indexOf(`label: "${label}"`);
    assert.ok(position > previous, `${label} should retain the requested camera order`);
    previous = position;
  }

  assert.ok(toolbar.indexOf("{GEO_CAMERA_VIEWS.map") < toolbar.indexOf('className="geo-building-link"'));
  assert.match(toolbar, /Building <span aria-hidden="true">↗<\/span>/);
  assert.doesNotMatch(geoApp.slice(geoApp.indexOf('{toolbarContainer ? createPortal(<nav className="geo-camera-toolbar') - 35, geoApp.indexOf('{toolbarContainer ? createPortal(<nav className="geo-camera-toolbar')), /!failure/);
  assert.ok(toolbar.includes('href={`/3Dprojects/${encodeURIComponent(data.project.slug)}`}'));
  assert.match(toolbar, /target="_blank"/);
  assert.match(toolbar, /rel="noopener noreferrer"/);
  assert.ok(toolbar.includes('aria-label={`Open ${data.project.name} building website in a new tab`}'));
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
  assert.ok(geoStyles.includes("grid-template-columns: repeat(6, minmax(0, 1fr))"));
});

test("normal camera row spans available width without a panel or button pills", () => {
  const transparentRow = geoStyles.slice(geoStyles.indexOf("/* Transparent, full-width camera controls:"));
  assert.match(transparentRow, /grid-template-columns:\s*repeat\(6, minmax\(0, 1fr\)\)/);
  assert.match(transparentRow, /width:\s*100% !important/);
  assert.match(transparentRow, /border:\s*0 !important/);
  assert.match(transparentRow, /border-radius:\s*0 !important/);
  assert.match(transparentRow, /background:\s*transparent !important/);
  assert.match(transparentRow, /box-shadow:\s*none !important/);
  assert.match(transparentRow, /button\.is-active::after/);
});


test("Geo customer view omits developer runtime and fallback badges", () => {
  assert.doesNotMatch(geoApp, /geo-quality-badge|GEO RUNTIME|GEO FALLBACK|Integrated vector terrain \+ immutable 3D Building/);
  assert.doesNotMatch(geoStyles, /\.geo-quality-badge/);
  assert.match(geoStyles, /\.geo-fallback-note\s*\{/);
  assert.match(geoApp, /aria-label=\{mapFallbackReason\}/);
});
