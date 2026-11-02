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

test("mobile camera buttons fit four columns with transparent controls and no outer panel", () => {
  assert.match(publicCss, /@media \(max-width: 640px\)[\s\S]*geo-public-toolbar-slot/);
  assert.match(publicCss, /grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(publicCss, /border:\s*0 !important;[\s\S]*background:\s*transparent !important;[\s\S]*box-shadow:\s*none !important;/);
  assert.match(publicCss, /button\.is-active::after/);
  assert.match(publicCss, /\.jio-public-project-logo\s*\{\s*width:\s*34px;\s*height:\s*34px;/);
});

test("fullscreen camera controls have no outer panel and four separate rounded buttons", () => {
  const fullscreenStyles = css.slice(css.indexOf("/* Geo fullscreen: four independent, rounded camera buttons"));
  assert.match(fullscreenStyles, /\.geo-integrated-scene:fullscreen \.geo-camera-toolbar--fullscreen-clone\s*\{[\s\S]*display:\s*grid\s*!important/);
  assert.match(fullscreenStyles, /grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(fullscreenStyles, /gap:\s*clamp\(5px, 1vw, 11px\)/);
  assert.match(fullscreenStyles, /padding:\s*0 !important;[\s\S]*border:\s*0 !important;[\s\S]*background:\s*transparent !important;/);
  assert.match(fullscreenStyles, /box-shadow:\s*none !important;[\s\S]*backdrop-filter:\s*none !important;/);
  assert.match(fullscreenStyles, /\.geo-integrated-scene:fullscreen \.geo-camera-toolbar--fullscreen-clone button\s*\{[\s\S]*border-radius:\s*10px !important/);
  assert.match(fullscreenStyles, /button:hover,[\s\S]*button:focus-visible[\s\S]*border-radius:\s*10px !important/);
  assert.match(fullscreenStyles, /button\.is-active\s*\{[\s\S]*border-radius:\s*10px !important/);
  assert.match(fullscreenStyles, /button\.is-active::after\s*\{[\s\S]*display:\s*none !important/);
  assert.match(fullscreenStyles, /button:focus-visible\s*\{[\s\S]*box-shadow:\s*0 0 0 2px/);
  assert.match(fullscreenStyles, /@media \(max-width: 640px\)[\s\S]*gap:\s*5px !important/);
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
  const fullscreenDock = css.slice(css.indexOf("/* Geo fullscreen: four independent, rounded camera buttons"));
  assert.ok(fullscreenDock.includes(".geo-integrated-scene:fullscreen .geo-camera-toolbar--fullscreen-clone"));
  assert.ok(fullscreenDock.includes("bottom: calc(10px + env(safe-area-inset-bottom"));
});
