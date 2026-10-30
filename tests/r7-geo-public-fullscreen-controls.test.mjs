import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const helper = fs.readFileSync("apps/public/src/geo/fullscreen-controls.ts", "utf8");
const loader = fs.readFileSync("apps/public/src/geo/fullscreen-controls-loader.ts", "utf8");
const css = fs.readFileSync("apps/public/src/geo/fullscreen-controls.css", "utf8");
const publicCss = fs.readFileSync("apps/public/src/geo/geo-public-demo.css", "utf8");
const publicSource = fs.readFileSync("apps/public/src/geo/GeoPublicDemo.tsx", "utf8");
const html = fs.readFileSync("apps/public/index.html", "utf8");

test("public Geo mirrors camera controls into native fullscreen", () => {
  assert.match(helper, /fullscreenchange/);
  assert.match(helper, /document\.fullscreenElement/);
  assert.match(helper, /cloneNode\(true\)/);
  assert.match(helper, /originals\[index\]\?\.click\(\)/);
  assert.match(helper, /geo-camera-toolbar--fullscreen-clone/);
});

test("normal Geo customer view renders the live toolbar in a row below the map", () => {
  assert.match(publicSource, /createPortal\([\s\S]*geo-camera-toolbar--normal-row/);
  assert.match(publicSource, /className="geo-public-toolbar-slot"/);
  assert.match(publicCss, /geo-public-map-layout[\s\S]*geo-public-toolbar-slot/);
  assert.match(css, /visibility:\s*visible\s*!important/);
  assert.doesNotMatch(css, /visibility:\s*hidden\s*!important/);
});

test("mobile camera buttons fit six columns with transparent controls and no outer panel", () => {
  assert.match(publicCss, /@media \(max-width: 640px\)[\s\S]*geo-public-toolbar-slot/);
  assert.match(publicCss, /grid-template-columns:\s*repeat\(6, minmax\(0, 1fr\)\)/);
  assert.match(publicCss, /border:\s*0 !important;[\s\S]*background:\s*transparent !important;[\s\S]*box-shadow:\s*none !important;/);
  assert.match(publicCss, /button\.is-active::after/);
  assert.match(publicCss, /\.jio-public-project-logo\s*\{\s*width:\s*25px;\s*height:\s*25px;/);
});

test("fullscreen camera controls remain visible as high-contrast buttons in one row", () => {
  const fullscreenStyles = css.slice(css.indexOf("/* Fullscreen controls intentionally retain the original high-contrast button"));
  assert.match(fullscreenStyles, /\.geo-camera-toolbar--fullscreen-clone\s*\{[\s\S]*display:\s*flex\s*!important/);
  assert.match(fullscreenStyles, /flex-flow:\s*row nowrap\s*!important/);
  assert.match(fullscreenStyles, /visibility:\s*visible\s*!important/);
  assert.match(fullscreenStyles, /opacity:\s*1\s*!important/);
  assert.match(fullscreenStyles, /background:\s*rgba\(5, 18, 27, \.76\)\s*!important/);
  assert.match(fullscreenStyles, /\.geo-camera-toolbar--fullscreen-clone button,[\s\S]*border:\s*1px solid/);
  assert.match(fullscreenStyles, /\.geo-camera-toolbar--fullscreen-clone button,[\s\S]*background:\s*rgba\(8, 22, 32, \.88\)\s*!important/);
  assert.match(fullscreenStyles, /@media \(max-width: 640px\)[\s\S]*\.geo-camera-toolbar--fullscreen-clone button,[\s\S]*flex:\s*1 1 0\s*!important/);
});

test("fullscreen bridge is lazy-loaded only for public Geo routes", () => {
  assert.match(loader, /parts\.length === 3/);
  assert.match(loader, /parts\[0\] === "3Dprojects"/);
  assert.match(loader, /parts\[2\] === "geo"/);
  assert.match(loader, /import\("\.\/fullscreen-controls"\)/);
  assert.match(html, /\/src\/geo\/fullscreen-controls\.css/);
  assert.match(html, /\/src\/geo\/fullscreen-controls-loader\.ts/);
  assert.doesNotMatch(html, /src="\/src\/geo\/fullscreen-controls\.ts"/);
});

test("fullscreen uses the Geo scene and places the cloned camera dock at the bottom", () => {
  assert.ok(publicSource.includes("fullscreenControl: false"));
  assert.ok(publicSource.includes("scene.requestFullscreen?.()"));
  assert.ok(publicSource.includes("document.exitFullscreen()"));
  const fullscreenDock = css.slice(css.lastIndexOf("/* The scene's own fullscreen"));
  assert.ok(fullscreenDock.includes(".geo-integrated-scene:fullscreen .geo-camera-toolbar--fullscreen-clone"));
  assert.ok(fullscreenDock.includes("bottom: calc(10px + env(safe-area-inset-bottom"));
});
