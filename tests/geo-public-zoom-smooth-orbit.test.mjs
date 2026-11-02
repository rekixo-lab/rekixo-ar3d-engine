import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {closerGeoCameraZoom,GEO_EXTRA_CAMERA_MAGNIFICATION,GEO_EXTRA_CAMERA_ZOOM}
  from "../shared/geo-camera-zoom.js";
import {createGeoOneFingerOrbit}
  from "../shared/geo-touch-orbit.js";

const src=readFileSync(new URL("../apps/public/src/geo/GeoPublicDemo.tsx",import.meta.url),"utf8");
const orbitSrc=readFileSync(new URL("../shared/geo-touch-orbit.js",import.meta.url),"utf8");

function simulatedOrbit(initialHeading=340){
  let clock=10_000,heading=initialHeading,redraws=0;
  const writes=[],captures=[];
  const orbit=createGeoOneFingerOrbit({
    getHeading:()=>heading,
    setHeading:value=>{heading=value;writes.push(value);},
    onRotate:()=>{redraws++;},
    onCaptureChange:value=>captures.push(value),
    now:()=>clock,
  });
  const touch=x=>({identifier:1,clientX:x,clientY:200});
  const e=(type,x)=>({
    touches:type==="end"?[]:[touch(x)],
    target:null,cancelable:true,
    preventDefault(){},stopPropagation(){},
  });
  return {orbit,writes,captures,e,advance:ms=>{clock+=ms;},
    get heading(){return heading;},get redraws(){return redraws;}};
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


test("irregular touch delivery moves camera immediately with no post-release animation",()=>{
  const r=simulatedOrbit(90);
  r.orbit.onTouchStart(r.e("start",120));
  r.orbit.onTouchMove(r.e("move",150));
  assert.ok(Math.abs(r.heading-(90+30*.46))<1e-9,
    "first movement renders before finger release");
  r.orbit.onTouchMove(r.e("move",180));
  assert.equal(r.writes.length,2,"each changed move updates camera immediately");
  const target=90+60*.46;
  assert.ok(Math.abs(r.heading-target)<1e-9);
  assert.equal(r.orbit.suppressClick(),true);
  r.orbit.onTouchEnd(r.e("end",0));
  r.advance(1000);
  assert.ok(Math.abs(r.heading-target)<1e-9,"camera stays still once finger is lifted");
  assert.equal(r.writes.length,2,"no easing tail or delayed writes");
  assert.equal(r.redraws,2);
  assert.deepEqual(r.captures,[true,false]);
});

test("horizontal drag reverses direction instantly and normalizes across 360 degrees",()=>{
  const r=simulatedOrbit(355);
  r.orbit.onTouchStart(r.e("start",200));
  r.orbit.onTouchMove(r.e("move",170));
  assert.ok(r.heading>340&&r.heading<350,"left drag decreases the camera heading");
  assert.ok(Math.abs(r.heading-341.2)<1e-9);
  r.orbit.onTouchMove(r.e("move",210));
  assert.ok(Math.abs(r.heading-359.6)<1e-9,
    "rightward drag reverses immediately instead of waiting for release");
});

test("second finger releases orbit ownership and allows native Google pinch",()=>{
  const r=simulatedOrbit();
  r.orbit.onTouchStart(r.e("start",120));
  r.orbit.onTouchMove(r.e("move",180));
  assert.equal(r.writes.length,1);
  const pinch={touches:[{identifier:1,clientX:180},{identifier:2,clientX:250}],
    preventDefault(){throw Error("native pinch must never be prevented");},
    stopPropagation(){throw Error("native pinch must never be blocked");}};
  r.orbit.onTouchStart(pinch);
  r.orbit.onTouchMove(pinch);
  assert.deepEqual(r.captures,[true,false]);
  assert.equal(r.writes.length,1,"native two-finger movement is not treated as orbit");
  r.orbit.onTouchEnd({touches:[{identifier:1,clientX:180}]});
  r.orbit.onTouchMove(r.e("move",250));
  assert.equal(r.writes.length,1,"remaining pinch finger stays locked");
  r.orbit.onTouchEnd(r.e("end",0));
  r.orbit.onTouchStart(r.e("start",100));
  r.orbit.onTouchMove(r.e("move",150));
  assert.equal(r.writes.length,2,"new independent gesture rotates correctly");
});

test("unmount stops ownership and prevents late camera updates",()=>{
  const r=simulatedOrbit();
  r.orbit.onTouchStart(r.e("start",100));
  r.orbit.onTouchMove(r.e("move",200));
  assert.equal(r.writes.length,1);
  r.orbit.destroy();
  assert.deepEqual(r.captures,[true,false]);
  r.orbit.onTouchStart(r.e("start",100));
  r.orbit.onTouchMove(r.e("move",200));
  assert.equal(r.writes.length,1);
  assert.match(src,/touchOrbit\?\.destroy\(\)/);
});

test("public viewer uses immediate moveCamera and never shows cooperative gesture hint",()=>{
  assert.doesNotMatch(orbitSrc,/ORBIT_FRAME_EASING|requestAnimationFrame/);
  assert.match(orbitSrc,/setHeading\(heading\)/);
  assert.match(src,/createGeoOneFingerOrbit\(\{/);
  assert.match(src,/touchHost\?\.addEventListener\("touchmove",touchOrbit\.onTouchMove,\{capture:true,passive:false\}\)/);
  assert.match(src,/if\(touchOrbit\?\.suppressClick\(\)\)return/);
  assert.match(src,/gestureHandling: "greedy"/);
  assert.match(src,/gestureHandling:capturing\?"none":"greedy"/);
  assert.match(src,/if\(map\.moveCamera\)map\.moveCamera\(\{heading\}\)/);
});
