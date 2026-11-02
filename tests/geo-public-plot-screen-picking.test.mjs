import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {pointInScreenTriangle} from "../shared/geo-plot-screen-hit.js";

const viewer=readFileSync(new URL("../apps/public/src/geo/GeoPublicDemo.tsx",import.meta.url),"utf8");
const layer=readFileSync(new URL("../apps/public/src/geo/geoPlotModelOverlay.ts",import.meta.url),"utf8");

test("screen-space picking covers visible mapped triangles, edges and arbitrary winding",()=>{
  assert.equal(pointInScreenTriangle(0,0,-.8,-.8,.8,-.8,0,.8),true);
  assert.equal(pointInScreenTriangle(0,-.8,-.8,-.8,.8,-.8,0,.8),true);
  assert.equal(pointInScreenTriangle(.9,.9,-.8,-.8,.8,-.8,0,.8),false);
  assert.equal(pointInScreenTriangle(0,0,0,.8,.8,-.8,-.8,-.8),true);
  assert.equal(pointInScreenTriangle(0,0,0,0,0,0,0,0),false);
  assert.equal(pointInScreenTriangle(NaN,0,-1,-1,1,-1,0,1),false);
});

test("WebGL customer plots retain raycast and fall back to real projected triangles",()=>{
  assert.match(layer,/ray\.intersectObjects\(meshes,false\)/);
  assert.match(layer,/projection\.clone\(\)\.multiply\(mesh\.matrixWorld\)/);
  assert.match(layer,/pointInScreenTriangle\(/);
  assert.match(layer,/mesh\.updateWorldMatrix\(true,false\)/);
  assert.match(layer,/const index=mesh\.geometry\.index/);
  assert.match(layer,/if\(a\.w<=0\|\|b\.w<=0\|\|c\.w<=0\)continue/);
});

test("customer selection retains real map taps and approved detail after status bar removal",()=>{
  assert.match(viewer,/window\.addEventListener\("pointerup",onNativePointerUp,true\)/);
  assert.match(viewer,/window\.removeEventListener\("pointerup",onNativePointerUp,true\)/);
  assert.match(viewer,/mapClick=map\.addListener\("click"/);
  assert.match(viewer,/pickModelGeoPlot\(/);
  assert.match(viewer,/setSelectedPlot\(plotIds\.get\(id\)\|\|null\)/);
  assert.match(viewer,/<GeoPlotDetailsDrawer/);
  assert.doesNotMatch(viewer,/geo-plot-public-controls|showPlotBoundaries/);
});
