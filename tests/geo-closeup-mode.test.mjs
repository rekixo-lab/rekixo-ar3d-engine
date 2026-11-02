import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {geoCloseupCameraOffset,geoCloseupFrontDirection,
  geoCloseupMinDistance,geoCloseupPlotFocus}
  from "../shared/geo-closeup-camera.js";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const source=read("apps/public/src/geo/GeoCloseupScene.tsx");
const parent=read("apps/public/src/geo/GeoPublicDemo.tsx");
const css=read("apps/public/src/geo/geo-public-demo.css");
const plots=[{id:"18",corners:[[0,0],[20,0],[20,50],[0,50]],sides:{
  front:{roadFacing:true,edges:[0],length:20,unit:"ft"},
  back:{roadFacing:false,edges:[2],length:20,unit:"ft"},
  depthA:{roadFacing:false,edges:[1],length:50,unit:"ft"},
  depthB:{roadFacing:false,edges:[3],length:50,unit:"ft"},
}}];

test("independent 3D camera can approach the immutable GLB beyond Google zoom framing",()=>{
  const radius=100;
  const close=geoCloseupMinDistance(radius);
  assert.ok(close>0&&close<1.3);
  const overview=geoCloseupCameraOffset(radius,"overview");
  const aerial=geoCloseupCameraOffset(radius,"aerial");
  const front=geoCloseupCameraOffset(radius,"front");
  assert.equal(overview.length,3);
  assert.ok(Math.hypot(...overview)>radius*2);
  assert.ok(aerial[1]>Math.abs(aerial[0])+Math.abs(aerial[2]));
  assert.ok(front[1]<Math.hypot(front[0],front[2]));
  for(const view of ["overview","front","corner","aerial"]){
    const result=geoCloseupCameraOffset(radius,view);
    assert.ok(result.every(Number.isFinite));
    assert.ok(Math.hypot(...result)>close);
  }
  assert.equal(geoCloseupMinDistance(Infinity),geoCloseupMinDistance(10));
});

test("focus plot calculates location only from mapped corners and never changes release",()=>{
  const before=structuredClone(plots[0]);
  const focused=geoCloseupPlotFocus(plots[0],5);
  assert.deepEqual(focused.target,[10,5,25]);
  assert.ok(focused.distance>=Math.hypot(20,50));
  const elevation={...plots[0],planeY:12.5};
  assert.deepEqual(geoCloseupPlotFocus(elevation,0)?.target,[10,12.5,25]);
  assert.equal(geoCloseupPlotFocus({corners:[]}),null);
  assert.equal(geoCloseupPlotFocus({corners:[[0,0],[1,NaN],[1,1]]}),null);
  assert.deepEqual(plots[0],before,"camera focus must not mutate polygon coordinates");
});

test("visual Front camera derives selected road-side normal without inventing a compass status",()=>{
  const direction=geoCloseupFrontDirection(plots);
  assert.equal(direction.length,2);
  assert.ok(Math.abs(direction[0])<1e-8);
  assert.ok(direction[1]<0,"front of clockwise screen rectangle faces outward");
  assert.deepEqual(geoCloseupFrontDirection([{corners:plots[0].corners,sides:{}}]),[0,1]);
  assert.ok(geoCloseupCameraOffset(20,"corner",direction).every(Number.isFinite));
});

test("close-up verifies the original GLB hash and preserves plot picking and status color",()=>{
  assert.match(source,/crypto\.subtle\.digest\("SHA-256",bytes\)/);
  assert.match(source,/bytes\.byteLength!==model\.byteSize/);
  assert.match(source,/actual!==model\.sha256\.toLowerCase\(\)/);
  assert.match(source,/loader\.setMeshoptDecoder\(MeshoptDecoder\)/);
  assert.match(source,/buildModelGeoPlotLayer\(verified,plots\)/);
  assert.match(source,/plotLayer\.setStatusPresentation\(/);
  assert.match(source,/ray\.intersectObjects\(plotLayer\.hitMeshes\.filter/);
  assert.match(source,/selected\)onPlotSelect\(selected\)/);
  assert.match(source,/geoCloseupPlotFocus\(plot,groundY\)/);
  assert.match(source,/controls\.enableDamping=true/);
  assert.match(source,/controls\.touches\.TWO=THREE\.TOUCH\.DOLLY_PAN/);
  assert.match(source,/controls\.minDistance=geoCloseupMinDistance\(siteRadius\)/);
  assert.match(source,/renderer\.forceContextLoss\(\)/);
  assert.match(source,/plotLayer\?\.dispose\(\)/);
  assert.match(source,/disposeVerifiedModel\(loadedModel\)/);
  assert.doesNotMatch(source,/window\.location\.assign|localStorage|innerHTML/);
});

test("customer Geo/3D mode switch keeps one map renderer, camera dock and plot sidebar",()=>{
  assert.match(parent,/closeupMode&&<GeoCloseupScene/);
  assert.match(parent,/if \(closeupMode \|\| !hostRef\.current/);
  assert.match(parent,/hidden=\{closeupMode\}/);
  assert.match(parent,/setCloseupMode\(current=>!current\)/);
  assert.match(parent,/closeupMode\?closeupControlRef\.current\?\.zoom\(1\)/);
  assert.match(parent,/closeupMode\)closeupControlRef\.current\?\.preset\(view\.id==="entry"\?"front":view\.id\)/);
  assert.match(parent,/onFocusPlot=\{closeupMode&&selectedPlot/);
  assert.match(parent,/statusEnabled=\{statusEnabled\}/);
  assert.match(parent,/statuses=\{statusSummary\.statusById\}/);
  assert.match(parent,/<GeoPlotDetailsDrawer/);
  assert.match(parent,/geo-camera-toolbar--normal-row/);
  assert.match(css,/\.geo-integrated-map\[hidden\]\{display:none!important\}/);
  assert.match(css,/\.geo-model-inspector/);
});

test("show the actual native zoom diagnostics; no invented satellite resolution",()=>{
  assert.match(parent,/setZoomDiagnostics\(\{requested,actual:actual!\}\)/);
  assert.match(parent,/mapZoomChanged = map\.addListener\("zoom_changed"/);
  assert.match(parent,/Last requested: \{zoomDiagnostics\?\.requested\.toFixed\(2\)/);
  assert.match(parent,/Actual camera: \{zoomDiagnostics\?\.actual\.toFixed\(2\)/);
  assert.match(parent,/Satellite detail limit: \{satelliteMaxZoom\?\.toFixed\(2\)/);
  assert.match(parent,/getMaxZoomAtLatLng\(center\)/);
  assert.match(parent,/Open 3D Close-up/);
  assert.match(parent,/closeupMode\?"Geo Map":"3D Close-up"/);
});
