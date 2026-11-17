import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {
  TRUESOIL_FARMS_GEO_SLUG,
  truesoilFarmsOpeningPreset,
  truesoilFarmsFitCamera,
} from "../shared/truesoil-farms-geo-camera.js";

const source=readFileSync("apps/public/src/geo/GeoPublicDemo.tsx","utf8");
const css=readFileSync("apps/public/src/geo/geo-public-demo.css","utf8");
const anchor={lat:20.04,lng:79.35};
const bounds={min:{x:350,y:-400,z:0},max:{x:950,y:170,z:20}};
const mobile={width:390,height:650};
const desktop={width:1200,height:650};

test("only exact Truesoil Farms engine slug gets a north-up, overhead opening camera",()=>{
  assert.deepEqual(truesoilFarmsOpeningPreset(TRUESOIL_FARMS_GEO_SLUG,"overview"),
    {zoom:17.5,tilt:0,heading:0});
  for(const other of ["other-project","dholera-villas-glb-demo-5809b995",
    "truesoil-farms-1c2440","truesoil-farms-3d-8a7cf13c-extra"]){
    assert.equal(truesoilFarmsOpeningPreset(other,"overview"),null);
    assert.equal(truesoilFarmsFitCamera(other,anchor,bounds,mobile),null);
  }
  for(const view of ["front","corner","entry","aerial"])
    assert.equal(truesoilFarmsOpeningPreset(TRUESOIL_FARMS_GEO_SLUG,view),null);
});

test("first camera centers on already placed complete GLB, not the anchor",()=>{
  const fit=truesoilFarmsFitCamera(TRUESOIL_FARMS_GEO_SLUG,anchor,bounds,mobile);
  assert.ok(fit);
  assert.equal(fit.tilt,0);
  assert.equal(fit.heading,0);
  assert.ok(fit.center.lat<anchor.lat,"north/south visual centroid is below anchor");
  assert.ok(fit.center.lng>anchor.lng,"east/west visual centroid is right of anchor");
  assert.ok(Math.abs(fit.center.lat-anchor.lat-(-115/111000))<0.00002);
  assert.ok(Math.abs(fit.center.lng-anchor.lng-(650/104500))<0.0003);
});

test("portrait camera zoom keeps the full saved-scale road and plots in frame",()=>{
  const fit=truesoilFarmsFitCamera(TRUESOIL_FARMS_GEO_SLUG,anchor,bounds,mobile);
  const desktopFit=truesoilFarmsFitCamera(TRUESOIL_FARMS_GEO_SLUG,anchor,bounds,desktop);
  assert.ok(fit&&desktopFit);
  assert.ok(fit.zoom<desktopFit.zoom,"wider screen can zoom closer");
  const metresPerPixel=156543.03392804097*Math.cos(anchor.lat*Math.PI/180)/2**fit.zoom;
  assert.ok((bounds.max.x-bounds.min.x)/metresPerPixel<=mobile.width*0.79);
  assert.ok((bounds.max.y-bounds.min.y)/metresPerPixel<=mobile.height*0.77);
  const larger={min:{x:-600,y:-600},max:{x:1000,y:1000}};
  const wideFit=truesoilFarmsFitCamera(TRUESOIL_FARMS_GEO_SLUG,anchor,larger,mobile);
  assert.ok(wideFit.zoom<fit.zoom,"larger footprint must zoom farther out");
});

test("invalid geometry cannot move map away from safe default",()=>{
  for(const invalid of [
    {min:{x:0,y:0},max:{x:0,y:10}},
    {min:{x:10,y:0},max:{x:0,y:10}},
    {min:{x:0,y:0},max:{x:Infinity,y:10}},
  ]) assert.equal(truesoilFarmsFitCamera(TRUESOIL_FARMS_GEO_SLUG,anchor,invalid,mobile),null);
  assert.equal(truesoilFarmsFitCamera(TRUESOIL_FARMS_GEO_SLUG,anchor,bounds,{width:0,height:650}),null);
  assert.equal(truesoilFarmsFitCamera(TRUESOIL_FARMS_GEO_SLUG,{lat:90,lng:79},bounds,mobile),null);
});

test("production viewer gates first-frame correction and preserves manual navigation",()=>{
  assert.match(source,/data\.project\.slug === TRUESOIL_FARMS_GEO_SLUG/);
  assert.match(source,/truesoilFarmsOpeningPreset\(data\.project\.slug,"overview"\)/);
  assert.match(source,/truesoilFarmsFitCamera\(data\.project\.slug/);
  assert.match(source,/new THREE\.Box3\(\)\.setFromObject\(modelRoot\)/);
  assert.match(source,/if\(isTruesoilFarms&&truesoilFitCamera\)/);
  assert.match(source,/truesoilFitSettled&&truesoilFitCamera&&!truesoilReadySent/);
  assert.match(source,/window\.clearTimeout\(truesoilReadyTimer\)/);
  assert.match(source,/geo-demo-preparing geo-truesoil-preparing/);
  assert.match(css,/\.geo-truesoil-preparing\{z-index:5;pointer-events:auto\}/);
  assert.match(source,/const isDholeraDemo = data\.project\.slug === DHOLERA_GLB_DEMO_SLUG/);
  assert.match(source,/map\.moveCamera\(\{ center, \.\.\.preset \}\)/);
  assert.doesNotMatch(source,/modelRoot\.scale\.setScalar|model\.scale\.multiplyScalar/);
});
