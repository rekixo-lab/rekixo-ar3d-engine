import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  DHOLERA_GLB_DEMO_SLUG,
  dholeraDemoFocusCenter,
  dholeraProjectedModelSize,
  dholeraDemoZoomCorrection,
  dholeraDemoGroundTargetZoom,
  dholeraDemoPresentationBoost,
} from "../shared/dholera-demo-geo-camera.js";

const slug=DHOLERA_GLB_DEMO_SLUG;
const source=readFileSync("apps/public/src/geo/GeoPublicDemo.tsx","utf8");

test("Dholera camera is scoped to the exact approved demo and not Shreem Palace",()=>{
  const anchor={lat:20.4789419,lng:84.394951};
  const bounds={min:{x:-30,y:-5,z:0},max:{x:10,y:5,z:1}};
  assert.equal(dholeraDemoFocusCenter("shreem-palace-demo-a6532789",anchor,bounds),null);
  assert.equal(dholeraDemoZoomCorrection("shreem-palace-demo-a6532789",
    {width:50,height:10},{width:1000,height:500}),null);
  assert.equal(dholeraProjectedModelSize("another-project",bounds,new Array(16).fill(0),
    {width:1000,height:500}),null);
  assert.match(source,/data\.project\.slug === DHOLERA_GLB_DEMO_SLUG/);
});

test("Dholera camera center follows transformed model bounds in local ENU metres",()=>{
  const anchor={lat:20.4789419,lng:84.394951};
  const bounds={min:{x:100,y:0,z:0},max:{x:200,y:200,z:8}};
  const center=dholeraDemoFocusCenter(slug,anchor,bounds);
  assert.ok(center);
  assert.ok(center.lat>anchor.lat);
  assert.ok(center.lng>anchor.lng);
  assert.ok(Math.abs(center.lat-anchor.lat-100/111000)<0.00002);
  assert.ok(Math.abs(center.lng-anchor.lng-150/104000)<0.00002);
  const origin={min:{x:-20,y:-20},max:{x:20,y:20}};
  const same=dholeraDemoFocusCenter(slug,anchor,origin);
  assert.ok(Math.abs(same.lat-anchor.lat)<1e-12);
  assert.ok(Math.abs(same.lng-anchor.lng)<1e-12);
  assert.equal(dholeraDemoFocusCenter(slug,anchor,{min:{x:100,y:5},max:{x:NaN,y:2}}),null);
});

test("projection pixel bounds measure model corners, not guessed satellite zoom",()=>{
  const m=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]; // identity clip transform
  const bounds={min:{x:-0.5,y:-0.2,z:0},max:{x:0.5,y:0.2,z:0}};
  const result=dholeraProjectedModelSize(slug,bounds,m,{width:1000,height:500});
  assert.deepEqual(result,{width:500,height:100});
  assert.equal(dholeraProjectedModelSize(slug,bounds,
    [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,-1],{width:1000,height:500}),null);
  assert.equal(dholeraProjectedModelSize(slug,bounds,m,{width:0,height:500}),null);
});

test("fit zoom makes small demo larger but never clips its viewport target or invents maxZoom",()=>{
  const viewport={width:1200,height:600};
  assert.equal(dholeraDemoZoomCorrection(slug,{width:100,height:40},viewport),1.4);
  assert.equal(dholeraDemoZoomCorrection(slug,{width:2000,height:1200},viewport),0,
    "once model has loaded, an automatic zoom-out must never occur");
  const near=dholeraDemoZoomCorrection(slug,{width:1032,height:480},viewport);
  assert.ok(Math.abs(near)<1e-12);
  assert.equal(dholeraDemoZoomCorrection(slug,{width:0,height:20},viewport),null);
  assert.doesNotMatch(source,/map\.setZoom\(Math\.max\(0,current \+ correction\)\)/,
    "load-time camera must not iterate zoom after Google clamps it");
  assert.match(source,/dholeraProjectedModelSize\(/);
  assert.match(source,/demoCameraIdle && demoModelRoot && demoModelBounds/);
  assert.match(source,/cameraActionRef\.current\?\.\("overview"\)/);
  assert.match(source,/demoCameraIdle=false; \/\/ user zoom is always authoritative/);
  assert.match(source,/window\.clearTimeout\(demoReadyTimer\)/);
  assert.doesNotMatch(source,/modelRoot\.scale\.setScalar|model\.scale\.multiplyScalar/);
  assert.match(source,/zoom:demoPresentationDone\?20:\(map\.getZoom\?\.\(\)\?\?20\)/,
    "GLB load must preserve Google native map zoom without asking for an unsupported higher zoom");
  assert.match(source,/map\.getZoom\?\.\(\)\?\?0,demoGroundTargetZoom\?\?20\.5,preset\.zoom/);
});

test("Dholera first completed GLB load targets a large metric footprint without snap zoom-out",()=>{
  const model={
    min:{x:0,y:0,z:0},
    max:{x:41.27,y:8.85,z:0.93},
  };
  const desktop=dholeraDemoGroundTargetZoom(slug,model,20.4789419,{width:1300,height:460});
  const mobile=dholeraDemoGroundTargetZoom(slug,model,20.4789419,{width:390,height:600});
  assert.ok(desktop>21.4 && desktop<22.5,"desktop camera should fill most width at native zoom");
  assert.ok(mobile<desktop && mobile>19.5,"smaller screens reduce requested zoom");
  assert.equal(dholeraDemoGroundTargetZoom("shreem-palace-demo-a6532789",model,20.47,{width:1300,height:460}),null);
  assert.equal(dholeraDemoGroundTargetZoom(slug,model,100,{width:1300,height:460}),null);
  assert.equal(dholeraDemoGroundTargetZoom(slug,model,20.47,{width:0,height:460}),null);
  const view={width:1300,height:460};
  for(const rendered of [
    {width:1000,height:1000},{width:3000,height:40},{width:400,height:500},
    {width:5000,height:5000},
  ]){
    assert.ok(dholeraDemoZoomCorrection(slug,rendered,view)>=0,
      "camera fit must never produce a negative correction even for transient tall GLB bounds");
  }
});

test("Dholera presentation fallback fills a capped native satellite zoom viewport",()=>{
  const viewport={width:1300,height:460};
  const boost=dholeraDemoPresentationBoost(slug,{width:290,height:24},viewport);
  assert.ok(boost>3.3&&boost<3.55,"roughly 22% wide colony gets enlarged to ~78% width");
  assert.equal(dholeraDemoPresentationBoost(slug,{width:1700,height:700},viewport),1,
    "never automatically shrink already-large 3D model");
  assert.equal(dholeraDemoPresentationBoost(slug,{width:10,height:1},{width:3000,height:900}),3.75);
  assert.equal(dholeraDemoPresentationBoost("shreem-palace-demo-a6532789",
    {width:290,height:24},viewport),null);
  assert.equal(dholeraDemoPresentationBoost(slug,{width:290,height:24},viewport,true),null,
    "do not visually magnify a project with official mapped plots");
  assert.equal(dholeraDemoPresentationBoost(slug,{width:0,height:24},viewport),null);
  assert.match(source,/demoModelRoot\.scale\.multiplyScalar\(boost\)/);
  assert.match(source,/demoModelRoot\.position\.add\(centerBefore\.sub\(centerAfter\)\)/);
  assert.match(source,/setDemoSceneReady\(true\)/);
  assert.match(source,/geo-demo-preparing/);
  assert.match(source,/Concept demo · visual scale/);
});

test("first Dholera render never requests higher unsupported zoom after model load",()=>{
  assert.match(source,/\.\.\.\(isDholeraDemo\?\{zoom:20\}:\{\}\)/);
  assert.doesNotMatch(source,/demoGroundTargetZoom = dholeraDemoGroundTargetZoom/);
  assert.match(source,/demoPresentationDone\?20:\(map\.getZoom\?\.\(\)\?\?20\)/);
  assert.match(source,/if \(demoCameraIdle && demoModelRoot && demoModelBounds && !demoPresentationDone\)/);
  assert.doesNotMatch(source,/demoFitPending/);
});
