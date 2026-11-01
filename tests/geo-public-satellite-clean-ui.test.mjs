import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const file=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const viewer=file("apps/public/src/geo/GeoPublicDemo.tsx");
const css=file("apps/public/src/geo/geo-public-demo.css");
const mapOptions=viewer.slice(viewer.indexOf("new google.maps.Map(hostRef.current, {"),
  viewer.indexOf("});",viewer.indexOf("new google.maps.Map(hostRef.current, {")));
const mapActions=viewer.slice(viewer.indexOf('<nav className="geo-map-quick-actions"'),
  viewer.indexOf('</nav>',viewer.indexOf('<nav className="geo-map-quick-actions"')));

test("Public Geo defaults to vector satellite with only custom zoom/fullscreen controls",()=>{
  assert.match(mapOptions,/mapTypeId:\s*"satellite"/);
  assert.match(mapOptions,/renderingType:\s*google\.maps\.RenderingType\?\.VECTOR/);
  assert.match(mapOptions,/disableDefaultUI:\s*true/);
  assert.match(mapOptions,/keyboardShortcuts:\s*false/);
  assert.match(mapOptions,/mapTypeControl:\s*false/);
  assert.match(mapOptions,/gestureHandling:\s*"greedy"/);
  assert.match(mapActions,/aria-label="Zoom out 2×"/);
  assert.match(mapActions,/aria-label="Zoom in 2×"/);
  assert.match(mapActions,/aria-label="Toggle Geo fullscreen"/);
  assert.equal((mapActions.match(/<button\s/g)||[]).length,3);
  assert.doesNotMatch(mapActions,/3D Detail|Reset Geo camera|Return to overview/);
});

test("Visible published plots remain clickable and source-reviewed details remain intact",()=>{
  assert.doesNotMatch(viewer,/geo-plot-public-controls|Select a mapped plot|Plots \{showPlotBoundaries/);
  assert.match(viewer,/pickModelGeoPlot\(/);
  assert.match(viewer,/setSelectedPlot\(plotIds\.get\(id\)\|\|null\)/);
  assert.match(viewer,/selectedPlot && <aside className="geo-plot-public-details"/);
  assert.match(viewer,/publicationMode==="preliminary"/);
  assert.match(viewer,/selectedPlot\.area&&/);
  assert.doesNotMatch(css,/\.geo-plot-public-controls/);
});

test("Google's legally required attribution remains owned and visible in Maps runtime",()=>{
  // Do not add CSS that obscures Google logo, copyright, or map data credits.
  assert.doesNotMatch(css,/\.gm-style-cc\s*\{|\.gmnoprint\s*\{|\.gm-style\s+img\s*\{/);
  assert.doesNotMatch(viewer,/map\.getDiv\(\).*\.remove|gm-style-cc.*display:\s*none/);
});
