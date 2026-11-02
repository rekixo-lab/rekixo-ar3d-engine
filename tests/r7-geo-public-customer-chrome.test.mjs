import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const publicGeoSource = fs.readFileSync("apps/public/src/geo/GeoPublicDemo.tsx", "utf8");
const publicGeoCss = fs.readFileSync("apps/public/src/geo/geo-public-demo.css", "utf8");

test("public Geo customer chrome hides authoring metadata and keeps map actions", () => {
  assert.match(publicGeoCss, /\.jio-public-meta,\s*\.geo-runtime-note\s*\{\s*display:\s*none\s*!important;/s);
  assert.doesNotMatch(publicGeoSource, /INTEGRATED 3D GEO EXPERIENCE|Enter building|Open location/);
  assert.match(publicGeoSource, /geo-camera-toolbar--normal-row/);
  assert.doesNotMatch(publicGeoSource, /className="geo-building-link"/);
  assert.doesNotMatch(publicGeoSource, /Building <span aria-hidden="true">↗<\/span>/);
});

test("Geo project header stays compact and borderless", () => {
  assert.match(publicGeoCss, /\.jio-public-header\s*\{[\s\S]*border:\s*0 !important;[\s\S]*background:\s*transparent !important;[\s\S]*box-shadow:\s*none !important;/);
  assert.match(publicGeoCss, /\.jio-public-header::before,\s*\.jio-public-header::after\s*\{\s*display:\s*none !important;/);
  assert.match(publicGeoCss, /\.jio-public-project-logo\s*\{[\s\S]*width:\s*42px;[\s\S]*height:\s*42px;/);
  assert.match(publicGeoCss, /\.geo-building-link:hover/);
  assert.match(publicGeoCss, /\.geo-camera-toolbar\s*\{[\s\S]*top:\s*12px;[\s\S]*right:\s*12px;/);
  assert.match(publicGeoCss, /z-index:\s*10000 !important/);
  assert.match(publicGeoCss, /visibility:\s*visible !important/);
  assert.match(publicGeoCss, /backdrop-filter:\s*blur\(14px\)/);
  assert.match(publicGeoCss, /@media \(max-width:\s*640px\)/);
  assert.match(publicGeoCss, /\.jio-public-project-logo\s*\{\s*width:\s*34px;\s*height:\s*34px;/);
});
