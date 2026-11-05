import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const layer=read("apps/public/src/geo/geoPlotModelOverlay.ts");
const legend=read("apps/public/src/geo/geo-public-demo.css");

test("premium Geo plot floors keep labels visible while colored rims stay vivid",()=>{
  for(const [status,alpha] of [["available",".24"],["booked",".27"],["sold",".29"]]){
    assert.ok(layer.includes(status+":tinted(GEO_PLOT_STATUS_COLORS."+status+","+alpha+",1)"),
      status+" uses readable translucent floor and a solid status outline");
  }
  assert.match(layer,/rim\.opacity=0\.91/);
  assert.match(layer,/palette\.dim\.rim\.opacity=0/);
  assert.match(layer,/neutral:\{fill:fillMaterial,stroke:strokeMaterial,rim:rimMaterial\}/);
  assert.match(layer,/parts\.fill\.material=style\.fill/);
  assert.match(layer,/parts\.outline\.material=style\.stroke/);
  assert.match(layer,/parts\.rim\.material=style\.rim/);
  assert.match(layer,/filter&&valid!==filter\?palette\.dim/);
  assert.match(layer,/depthTest:true,depthWrite:false/);
});

test("status rim follows actual irregular plot edges, stays inward, and cannot capture clicks",()=>{
  assert.match(layer,/function plotStatusRimGeometry\(points:Array<\[number,number\]>,elevation:number\)/);
  assert.match(layer,/const twiceArea=points\.reduce/);
  assert.match(layer,/const winding=twiceArea>=0\?1:-1/);
  assert.match(layer,/const nx=-winding\*dz\/length\*width,nz=winding\*dx\/length\*width/);
  assert.match(layer,/Math\.max\(0\.025,Math\.min\(0\.15,span\*0\.009\)\)/);
  assert.match(layer,/rim\.name="geo-plot-status-rim-"\+plot\.id/);
  assert.match(layer,/plotGroup\.add\(mesh,rim,outline\)/);
  assert.match(layer,/hitMeshes\.push\(mesh\)/);
  assert.doesNotMatch(layer,/hitMeshes\.push\(rim\)/);
  assert.match(layer,/if\(rim instanceof THREE\.Mesh\)rim\.geometry\.dispose\(\)/);
  assert.match(layer,/style\.rim\.dispose\(\)/);
  assert.match(layer,/style\.fill\.dispose\(\)/);
  assert.match(layer,/style\.stroke\.dispose\(\)/);
});

test("premium customer status bar palette and text rules remain unchanged",()=>{
  assert.match(legend,/\.jio-public-shell,\.geo-plot-status\{--geo-available:#00dc84;--geo-booked:#ffc20a;--geo-sold:#ff4052\}/);
  assert.match(legend,/\.geo-plot-status-option--available,\.geo-plot-status-option--available b\{color:var\(--geo-available\)\}/);
  assert.match(legend,/\.geo-plot-status-option--booked,\.geo-plot-status-option--booked b\{color:var\(--geo-booked\)\}/);
  assert.match(legend,/\.geo-plot-status-option--sold,\.geo-plot-status-option--sold b\{color:var\(--geo-sold\)\}/);
});
