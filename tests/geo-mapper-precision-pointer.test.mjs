import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {precisionSnap,zoomAnchorDelta,isMappingTap} from "../shared/geo-mapper-pointer.js";
const point=(x,y)=>[x,y];
const square=[point(0,0),point(10,0),point(10,10),point(0,10)];
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);

test("snap OFF preserves model-local precision at any screen scale",()=>{
  for(const zoom of [1,2,8,16,32,50]){
    const raw=point(9.99863,0.111239),project=p=>point(p[0]*zoom,p[1]*zoom);
    const result=precisionSnap(raw,project(raw),[{points:square}],project);
    assert.deepEqual(result.point,raw);
    assert.equal(result.kind,"none");
  }
});
test("snap radius is CSS pixels and does not scale or round model coordinates",()=>{
  for(const zoom of [1,2,8,16,32,50]){
    const project=p=>point(p[0]*zoom,p[1]*zoom);
    const close=point(5/zoom,4/zoom);
    const a=precisionSnap(close,project(close),[{points:square}],project,{enabled:true});
    assert.equal(a.kind,"vertex");
    assert.deepEqual(a.point,[0,0]);
    assert.ok(a.distance<=6);
    const far=point(8/zoom,7/zoom);
    const b=precisionSnap(far,project(far),[{points:square}],project,{enabled:true});
    assert.equal(b.kind,"none");
    assert.deepEqual(b.point,far);
  }
});
test("nearest vertex wins; first polygon position does not bias the answer",()=>{
  const project=p=>p;
  const rings=[{points:[[0,0],[0,10],[10,10],[10,0]]},{points:[[3,3],[3,11],[11,11],[11,3]]}];
  const v=precisionSnap([3.2,3.1],[3.2,3.1],rings,project,{enabled:true});
  assert.deepEqual(v.point,[3,3]);
  assert.equal(v.kind,"vertex");
});
test("nearest edge wins when no vertex is within 6 pixels",()=>{
  const project=p=>p;
  const raw=point(5,2.5);
  const out=precisionSnap(raw,raw,[{points:square}],project,{enabled:true});
  assert.equal(out.kind,"edge");
  assert.ok(distance(out.point,[5,0])<1e-9);
  assert.ok(distance(out.screen,[5,0])<1e-9);
});
test("dragging a corner never snaps to itself or its adjacent edges",()=>{
  const project=p=>p;
  const raw=point(0.1,0.1);
  const stuck=precisionSnap(raw,raw,[{points:square}],project,{enabled:true});
  assert.equal(stuck.kind,"vertex");
  assert.deepEqual(stuck.point,[0,0]);
  const movable=precisionSnap(raw,raw,[{points:square,skipIndex:0}],project,{enabled:true});
  assert.equal(movable.kind,"none");
  assert.deepEqual(movable.point,raw);
});
test("click threshold rejects accidental drawing from mouse drags or wrong pointer",()=>{
  assert.equal(isMappingTap({id:1,x:100,y:100},{id:1,x:108,y:101}),true);
  assert.equal(isMappingTap({id:1,x:100,y:100},{id:1,x:120,y:100}),false);
  assert.equal(isMappingTap({id:1,x:100,y:100},{id:2,x:100,y:100}),false);
  assert.equal(isMappingTap(null,{id:1,x:100,y:100}),false);
});
test("cursor zoom world-point anchor uses the exact before/after XZ difference",()=>{
  const before=[11.123456,99.123456],after=[14.123456,101.123456];
  const offset=zoomAnchorDelta(before,after);
  assert.deepEqual(offset,[-3,-2]);
  assert.deepEqual([after[0]+offset[0],after[1]+offset[1]],before);
  assert.equal(zoomAnchorDelta(null,after),null);
});
test("live editor uses the same snap target for hover, clicks and handle dragging",()=>{
  const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
  const s=read("apps/admin/src/geo/GeoPlotMapper.tsx");
  const css=read("apps/admin/src/geo/geo-plot-mapper.css");
  assert.match(s,/precisionPointer\(clientX,clientY,skipIndex/);
  assert.match(s,/const target=precisionPointer\(clientX,clientY\)/);
  assert.match(s,/const target=precisionPointer\(clientX,clientY,index\)/);
  assert.match(s,/onPointerUp=\{onOverlayPointerUp\}/);
  assert.match(s,/isMappingTap\(start/);
  assert.match(s,/wheelZoomRef\.current/);
  assert.match(s,/addEventListener\("wheel",handleWheel,\{passive:false\}\)/);
  assert.match(s,/controls\.zoomToCursor=true/);
  assert.match(s,/controls\.maxZoom=50/);
  assert.match(s,/max="5000"/);
  assert.match(s,/geo-plot-precision-crosshair/);
  assert.match(s,/geo-plot-precision-loupe/);
  assert.match(s,/geo-plot-handle-hit/);
  assert.match(s,/requestFullscreen/);
  assert.match(css,/\.geo-plot-precision-crosshair/);
  assert.match(css,/\[data-tool-mode="draw"\]/);
  assert.match(css,/\.geo-plot-handle-hit/);
  assert.doesNotMatch(s,/const near=all\.find\(/);
});
