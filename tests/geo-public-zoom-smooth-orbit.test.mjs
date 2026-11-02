import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {closerGeoCameraZoom,GEO_EXTRA_CAMERA_MAGNIFICATION,GEO_EXTRA_CAMERA_ZOOM}
  from "../shared/geo-camera-zoom.js";
import {createGeoOneFingerOrbit}
  from "../shared/geo-touch-orbit.js";

const src=readFileSync(new URL("../apps/public/src/geo/GeoPublicDemo.tsx",import.meta.url),"utf8");
const orbitSrc=readFileSync(new URL("../shared/geo-touch-orbit.js",import.meta.url),"utf8");

function simulatedOrbit(heading=340){
  const callbacks=new Map(),cancelled=[];
  let nextId=1,clock=10_000,rendered=heading,redraws=0;
  const writes=[];
  const orbit=createGeoOneFingerOrbit({
    getHeading:()=>rendered,
    setHeading:value=>{rendered=value;writes.push(value);},
    onRotate:()=>{redraws++;},
    now:()=>clock,
    requestFrame:callback=>{const id=nextId++;callbacks.set(id,callback);return id;},
    cancelFrame:id=>{cancelled.push(id);callbacks.delete(id);},
  });
  const touch=x=>({identifier:1,clientX:x,clientY:200});
  const e=(type,x)=>({
    touches:type==="end"?[]:[touch(x)],
    target:null,cancelable:true,
    preventDefault(){},stopPropagation(){},
  });
  const tick=()=>{
    const [id,callback]=[...callbacks.entries()][0]||[];
    if(!callback)return false;
    callbacks.delete(id);
    clock+=16;
    callback(clock);
    return true;
  };
  return {orbit,writes,callbacks,cancelled,e,tick,
    get heading(){return rendered;},get redraws(){return redraws;}};
}

test("50% extra Geo camera zoom is a fractional level, not a 50% larger raw zoom number",()=>{
  assert.equal(GEO_EXTRA_CAMERA_MAGNIFICATION,1.5);
  assert.ok(Math.abs(GEO_EXTRA_CAMERA_ZOOM-Math.log2(1.5))<1e-12);
  for(const base of [18.65,19,19.85,20.1,21.25]){
    const requested=closerGeoCameraZoom(base);
    assert.ok(Math.abs(Math.pow(2,requested-base)-1.5)<1e-12);
    assert.ok(src.includes("closerGeoCameraZoom("+base+")"),
      "Every preset, not just Overview, must use 50% closer framing");
  }
  assert.equal(closerGeoCameraZoom(Infinity),Infinity);
  assert.match(src,/isFractionalZoomEnabled:\s*true/);
  assert.match(src,/map\.moveCamera\?\.\(\{ center, \.\.\.preset \}\)/);
  assert.doesNotMatch(src,/maxZoom:\s*\d/);
  assert.match(src,/Google Maps has reached its native zoom limit here/);
  assert.match(src,/zoomActionRef\.current\?\.\(1\)/,
    "the existing manual 2x zoom control must keep working");
});

test("irregular touch delivery coalesces heading updates to animation frames and settles accurately",()=>{
  const r=simulatedOrbit(90);
  r.orbit.onTouchStart(r.e("start",120));
  r.orbit.onTouchMove(r.e("move",150));
  r.orbit.onTouchMove(r.e("move",180));
  assert.equal(r.callbacks.size,1,"multiple touch events schedule only one frame");
  assert.equal(r.writes.length,0,"no unthrottled camera writes");
  assert.equal(r.orbit.suppressClick(),true);
  assert.ok(r.tick());
  assert.equal(r.writes.length,1);
  const target=90-60*0.46;
  assert.ok(r.heading>target&&r.heading<90,
    "frame easing moves toward target without snapping immediately");
  r.orbit.onTouchEnd(r.e("end",0));
  let frames=1;
  while(r.tick()&&frames<35)frames++;
  assert.ok(frames>2&&frames<35,"orbit should glide smoothly and stop");
  assert.ok(Math.abs(r.heading-target)<1e-9,"final heading must match full finger travel");
  assert.equal(r.callbacks.size,0,"no forever-running animation loop");
  assert.equal(r.redraws,frames,"one overlay redraw per camera animation frame");
});

test("smoothing uses the shortest path safely across 360 degrees",()=>{
  const r=simulatedOrbit(355);
  r.orbit.onTouchStart(r.e("start",200));
  r.orbit.onTouchMove(r.e("move",170));
  assert.ok(r.tick());
  assert.ok(r.heading>355,"left drag crosses heading zero in the short direction");
  let count=0;while(r.tick()&&count++<35){}
  assert.ok(Math.abs(r.heading-8.8)<1e-9);
});

test("second finger cancels the active orbit frame and preserves Google native pinch",()=>{
  const r=simulatedOrbit();
  r.orbit.onTouchStart(r.e("start",120));
  r.orbit.onTouchMove(r.e("move",180));
  assert.equal(r.callbacks.size,1);
  const pinch={touches:[{identifier:1,clientX:180},{identifier:2,clientX:250}],
    preventDefault(){throw Error("native pinch must never be prevented");},
    stopPropagation(){throw Error("native pinch must never be blocked");}};
  r.orbit.onTouchStart(pinch);
  r.orbit.onTouchMove(pinch);
  assert.equal(r.callbacks.size,0);
  assert.equal(r.cancelled.length,1);
  assert.equal(r.writes.length,0);
  r.orbit.onTouchEnd({touches:[{identifier:1,clientX:180}]});
  r.orbit.onTouchMove(r.e("move",250));
  assert.equal(r.writes.length,0);
  r.orbit.onTouchEnd(r.e("end",0));
  r.orbit.onTouchStart(r.e("start",100));
  r.orbit.onTouchMove(r.e("move",150));
  assert.equal(r.callbacks.size,1,"next independent gesture must work");
});

test("unmount destroys pending frames and prevents late camera updates",()=>{
  const r=simulatedOrbit();
  r.orbit.onTouchStart(r.e("start",100));
  r.orbit.onTouchMove(r.e("move",200));
  assert.equal(r.callbacks.size,1);
  r.orbit.destroy();
  assert.equal(r.callbacks.size,0);
  assert.equal(r.cancelled.length,1);
  assert.equal(r.tick(),false);
  assert.equal(r.writes.length,0);
  r.orbit.onTouchStart(r.e("start",100));
  r.orbit.onTouchMove(r.e("move",200));
  assert.equal(r.callbacks.size,0);
  assert.match(src,/touchOrbit\?\.destroy\(\)/);
});

test("touch frame scheduler preserves plot click guard and full-screen rotation",()=>{
  assert.match(orbitSrc,/requestFrame=typeof requestAnimationFrame==="function"\?requestAnimationFrame:null/);
  assert.match(orbitSrc,/ORBIT_FRAME_EASING=0\.42/);
  assert.match(orbitSrc,/if\(frameHandle!==null\|\|disposed\)return/);
  assert.match(src,/createGeoOneFingerOrbit\(\{/);
  assert.match(src,/touchHost\?\.addEventListener\("touchmove",touchOrbit\.onTouchMove,\{capture:true,passive:false\}\)/);
  assert.match(src,/if\(touchOrbit\?\.suppressClick\(\)\)return/);
  assert.match(src,/gestureHandling: touchCapable \? "cooperative" : "greedy"/);
});
