import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  DHOLERA_GLB_DEMO_SLUG,
  dholeraDemoFocusCenter,
  dholeraProjectedModelSize,
  dholeraDemoZoomCorrection,
  dholeraDemoGroundTargetZoom,
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
  assert.match(source,/dholeraDemoZoomCorrection\(data\.project\.slug,projected,viewport\)/);
  assert.match(source,/dholeraProjectedModelSize\(/);
  assert.match(source,/demoFitAttempts >= 3/);
  assert.match(source,/cameraActionRef\.current\?\.\("overview"\)/);
  assert.match(source,/demoFitPending = false; \/\/ manual zoom wins/);
  assert.match(source,/window\.cancelAnimationFrame\(demoFitFrame\)/);
  assert.doesNotMatch(source,/modelRoot\.scale\.setScalar|model\.scale\.multiplyScalar/);
  assert.match(source,/demoGroundTargetZoom = dholeraDemoGroundTargetZoom/);
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
