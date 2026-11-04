import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {GEO_PLOT_STATUS_COLORS} from "../shared/geo-plot-status.js";

const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");

test("Available, Booked, Sold use one saturated Green/Yellow/Red palette everywhere",()=>{
  assert.deepEqual(GEO_PLOT_STATUS_COLORS,{
    available:0x00dc84,booked:0xffc20a,sold:0xff4052
  });
  const legend=read("apps/public/src/geo/geo-public-demo.css");
  assert.ok(legend.includes(".jio-public-shell,.geo-plot-status{"),
    "Status colors must also work in standalone or portaled legend");
  const drawer=read("apps/public/src/geo/geo-plot-details-drawer.css");
  const overlay=read("apps/public/src/geo/geoPlotModelOverlay.ts");
  for(const [key,value] of Object.entries(GEO_PLOT_STATUS_COLORS)){
    const hex="#"+value.toString(16).padStart(6,"0");
    assert.ok(legend.includes("--geo-"+key+":"+hex),
      "Status bar must use exact same "+key+" hue as 3D plot");
    assert.ok(drawer.includes("color:var(--geo-"+key+","+hex+")"),
      "Drawer status label must use exact same "+key+" hue");
    assert.ok(drawer.includes("--geo-plot-shape-stroke:var(--geo-"+key+","+hex+")"),
      "Drawer polygon border must use exact same "+key+" hue");
    assert.ok(overlay.includes("GEO_PLOT_STATUS_COLORS."+key),
      "WebGL must read canonical "+key+" hue");
  }
  assert.match(overlay,/const selectedAccent=/);
  assert.match(overlay,/if\(focus\.selectedId\)focus\.setAccent\(selectedAccent\(focus\.selectedId\)\)/);
  assert.match(overlay,/depthTest:true,depthWrite:false/);
});

test("Selected 3D prism retains color fidelity, reflective shine and legible satellite geometry",()=>{
  const focus=read("apps/public/src/geo/geoPlotSelectionFocus.ts");
  assert.match(focus,/color: accent, transparent: true, opacity: 0\.99/);
  assert.match(focus,/if \(edge\) \(edge\.material as THREE\.LineBasicMaterial\)\.color\.setHex\(hex\)/);
  assert.match(focus,/sharpShine = exp\(-550\.0/);
  assert.match(focus,/softShine = exp\(-65\.0/);
  assert.match(focus,/#include <colorspace_fragment>/);
  assert.match(focus,/#include <tonemapping_fragment>/);
  assert.match(focus,/depthTest: true,\s*depthWrite: false/);
  assert.match(focus,/transparent: true/);
  // No geometry, status data or hit targets are modified by visual changes.
  assert.doesNotMatch(focus,/UPDATE geo_plot|INSERT INTO geo_plot/);
});

test("Status text remains colorful when selected, with no brightness filter changing the hue",()=>{
  const css=read("apps/public/src/geo/geo-public-demo.css");
  assert.doesNotMatch(css,/geo-plot-status-option\.is-active\{[^}]*filter:brightness/);
  assert.doesNotMatch(css,/geo-plot-status-option:hover\{[^}]*filter:brightness/);
  assert.match(css,/geo-plot-status-option-label\{[^}]*text-shadow/);
  assert.match(css,/geo-plot-status-dot\{[^}]*box-shadow/);
  assert.match(css,/geo-plot-status-option--available b\{color:var\(--geo-available\)/);
  assert.match(css,/geo-plot-status-option--booked b\{color:var\(--geo-booked\)/);
  assert.match(css,/geo-plot-status-option--sold b\{color:var\(--geo-sold\)/);
});
