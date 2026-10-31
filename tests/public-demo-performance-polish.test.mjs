import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const index = fs.readFileSync("apps/public/index.html", "utf8");
const runtime = fs.readFileSync("apps/public/src/demo-performance.ts", "utf8");
const css = fs.readFileSync("apps/public/src/performance-polish.css", "utf8");

test("public demo wires phase 7 performance polish", () => {
  assert.match(index, /performance-polish\.css/);
  assert.match(index, /demo-performance\.ts/);
});

test("runtime detects constrained devices without changing 3D source semantics", () => {
  assert.match(runtime, /deviceMemory/);
  assert.match(runtime, /hardwareConcurrency/);
  assert.match(runtime, /saveData/);
  assert.match(runtime, /prefers-reduced-motion/);
  assert.match(runtime, /demo-low-power/);
  assert.match(runtime, /viewer-loader/);
  assert.match(runtime, /viewer-notice/);
  assert.doesNotMatch(runtime, /reconstruct|inferRoom|replaceModel|modelUrl\s*=/i);
});

test("low-power and responsive polish reduce UI cost while preserving usability", () => {
  assert.match(css, /\.demo-low-power/);
  assert.match(css, /backdrop-filter:\s*none\s*!important/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /orientation: landscape/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /min-height:\s*52px/);
  assert.match(css, /viewer-loader-track/);
});

test("source-site detection shares the model bounds traversal instead of walking the scene twice", () => {
  const viewer = fs.readFileSync("apps/public/src/viewer/Viewer3D.tsx", "utf8");
  const boundsStart = viewer.indexOf("const worldBoundsByMesh = new Map<THREE.Mesh, THREE.Box3>()");
  const boundsEnd = viewer.indexOf("// First detect physical floor bands", boundsStart);
  assert.ok(boundsStart >= 0 && boundsEnd > boundsStart);
  const boundsPass = viewer.slice(boundsStart, boundsEnd);
  assert.match(boundsPass, /node\.userData\.sourceGeometry\?\.siteGeometry === "included-in-source"/);
  assert.match(viewer, /const preserveSourceSite = includedSourceSite/);
  assert.equal((viewer.match(/node\.userData\.sourceGeometry\?\.siteGeometry === "included-in-source"/g) ?? []).length, 1);
});

test("public Geo route does not eagerly import the Building viewer bundle", () => {
  const app = fs.readFileSync("apps/public/src/main.tsx", "utf8");
  assert.equal(app.includes('import { Viewer3D } from "./viewer/Viewer3D";'), false);
  assert.equal(app.includes('import "./viewer/walkthrough-ui.css";'), false);
  const viewer = fs.readFileSync("apps/public/src/viewer/Viewer3D.tsx", "utf8");
  assert.ok(viewer.includes('import "./walkthrough-ui.css";'));
  assert.ok(app.includes('const GeoPublicDemo = lazy(() => import("./geo/GeoPublicDemo"));'));
  assert.ok(app.includes('const loadViewer3D = () => import("./viewer/Viewer3D");'));
  assert.ok(app.includes('const Viewer3D = lazy(() => loadViewer3D().then((module) => ({ default: module.Viewer3D })));'));
  assert.ok(app.includes("void loadViewer3D().catch(() => undefined);"));
  assert.ok(app.includes("<Suspense fallback={<LoadingPage />}>"));
  assert.ok(app.includes("masterplanRoute ? <MasterplanPublic /> : geoRoute ? <GeoPublicDemo /> : <App />"));
});
test("Building renderer honors the presentation performance quality profile", () => {
  const viewer = fs.readFileSync("apps/public/src/viewer/Viewer3D.tsx", "utf8");
  assert.match(viewer, /antialias: referenceVisual \|\| !environmentMobileQuality/);
  assert.match(viewer, /renderer\.shadowMap\.enabled = referenceVisual \|\| !environmentMobileQuality/);
  assert.match(
    viewer,
    /renderer\.setPixelRatio\(Math\.min\(window\.devicePixelRatio \|\| 1, environmentMobileQuality \? \(referenceVisual \? 1\.55 : 1\.35\) : 2\)\)/,
  );
  assert.match(viewer, /environmentProfile\?\.quality === "performance"/);
});
