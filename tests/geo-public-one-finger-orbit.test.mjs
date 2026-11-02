import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createGeoOneFingerOrbit,normalizeGeoOrbitHeading} from "../shared/geo-touch-orbit.js";

const src=readFileSync(new URL("../apps/public/src/geo/GeoPublicDemo.tsx",import.meta.url),"utf8");
const css=readFileSync(new URL("../apps/public/src/geo/geo-public-demo.css",import.meta.url),"utf8");
const finger=(x,y=200,id=1)=>({identifier:id,clientX:x,clientY:y});
const makeEvent=(touches,{target=null,cancelable=true}={})=>{
  const counters={prevented:0,stopped:0};
  return {
    touches,target,cancelable,counters,
    preventDefault(){counters.prevented++;},
    stopPropagation(){counters.stopped++;},
  };
};
function rig(initialHeading=0){
  let heading=initialHeading,clock=1000;
  const writes=[],redraw=[],captures=[];
  const orbit=createGeoOneFingerOrbit({
    getHeading:()=>heading,
    setHeading:value=>{heading=value;writes.push(value);},
    onRotate:()=>redraw.push(clock),
    onCaptureChange:value=>captures.push(value),
    shouldIgnoreTarget:target=>target==="control",
    now:()=>clock,
  });
  return{orbit,writes,redraw,captures,get heading(){return heading;},
    tick:ms=>{clock+=ms;}};
}

test("one finger horizontal swipe rotates the Geo camera, and does not pan or fake plot tap",()=>{
  const r=rig(90);
  r.orbit.onTouchStart(makeEvent([finger(120)]));
  assert.equal(r.orbit.suppressClick(),false);
  assert.deepEqual(r.captures,[true],"one finger captures map navigation before movement");
  const small=makeEvent([finger(124)]);
  r.orbit.onTouchMove(small);
  assert.equal(small.counters.prevented,1);
  assert.equal(small.counters.stopped,1);
  assert.equal(r.writes.length,0,"tiny movement must preserve tap selection");
  const first=makeEvent([finger(152)]);
  r.orbit.onTouchMove(first);
  assert.equal(first.counters.prevented,1);
  assert.equal(first.counters.stopped,1);
  assert.ok(Math.abs(r.heading-(90+32*.46))<1e-9);
  const next=makeEvent([finger(192)]);
  r.orbit.onTouchMove(next);
  assert.ok(Math.abs(r.heading-(90+72*.46))<1e-9);
  assert.equal(r.redraw.length,2);
  r.orbit.onTouchEnd(makeEvent([]));
  assert.deepEqual(r.captures,[true,false],"native map gestures resume on release");
  assert.equal(r.writes.length,2,"the camera must not keep rotating after release");
  assert.equal(r.orbit.suppressClick(),true,"post-rotation synthetic click must be ignored");
  r.tick(481);
  assert.equal(r.orbit.suppressClick(),false,"later genuine taps must work");
});

test("leftward swipe decreases camera bearing with normalized 0..360 headings",()=>{
  const r=rig(355);
  r.orbit.onTouchStart(makeEvent([finger(200)]));
  r.orbit.onTouchMove(makeEvent([finger(170)]));
  assert.ok(r.heading>=0&&r.heading<360);
  assert.ok(Math.abs(r.heading-341.2)<1e-9);
  assert.equal(normalizeGeoOrbitHeading(-4),356);
  assert.equal(normalizeGeoOrbitHeading(725),5);
});

test("real tap, vertical-only movement and touch on controls do not rotate",()=>{
  const r=rig(125);
  r.orbit.onTouchStart(makeEvent([finger(200)]));
  r.orbit.onTouchEnd(makeEvent([]));
  assert.equal(r.orbit.suppressClick(),false);
  r.orbit.onTouchStart(makeEvent([finger(80,40)]));
  const vertical=makeEvent([finger(80,230)]);
  r.orbit.onTouchMove(vertical);
  assert.equal(r.writes.length,0);
  assert.equal(vertical.counters.prevented,1);
  r.orbit.onTouchEnd(makeEvent([]));
  r.orbit.onTouchStart(makeEvent([finger(75)],{target:"control"}));
  r.orbit.onTouchMove(makeEvent([finger(130)]));
  assert.equal(r.writes.length,0);
  r.orbit.onTouchEnd(makeEvent([]));
});

test("two-finger native gestures are never consumed by app orbit",()=>{
  const r=rig(300);
  r.orbit.onTouchStart(makeEvent([finger(30)]));
  const twoStart=makeEvent([finger(30),finger(140,200,2)]);
  r.orbit.onTouchStart(twoStart);
  const pinch=makeEvent([finger(20),finger(190,200,2)]);
  r.orbit.onTouchMove(pinch);
  assert.deepEqual(pinch.counters,{prevented:0,stopped:0});
  assert.deepEqual(r.captures,[true,false],"pinch restores native gesture handling");
  assert.equal(r.writes.length,0);
  // Finger 2 lifted: finger 1 must remain locked until complete release.
  r.orbit.onTouchEnd(makeEvent([finger(200)]));
  r.orbit.onTouchMove(makeEvent([finger(270)]));
  assert.equal(r.writes.length,0);
  r.orbit.onTouchEnd(makeEvent([]));
  r.orbit.onTouchStart(makeEvent([finger(130)]));
  r.orbit.onTouchMove(makeEvent([finger(165)]));
  assert.equal(r.writes.length,1,"next independent one-finger gesture works");
});

test("cancellation, unavailable map heading and un-cancelable move are safe",()=>{
  const r=rig(40);
  r.orbit.onTouchStart(makeEvent([finger(100)]));
  r.orbit.onTouchCancel(makeEvent([]));
  r.orbit.onTouchMove(makeEvent([finger(150)]));
  assert.equal(r.writes.length,0);
  r.orbit.onTouchStart(makeEvent([finger(130)]));
  const move=makeEvent([finger(168)],{cancelable:false});
  r.orbit.onTouchMove(move);
  assert.deepEqual(move.counters,{prevented:0,stopped:1});
  assert.equal(r.writes.length,1);
  let calls=0;
  const invalid=createGeoOneFingerOrbit({
    getHeading:()=>NaN,
    setHeading:()=>calls++,
  });
  invalid.onTouchStart(makeEvent([finger(90)]));
  invalid.onTouchMove(makeEvent([finger(180)]));
  assert.equal(calls,0);
});


test("camera rotation is visible on every move, changes direction and stops on release",()=>{
  const r=rig(90);
  r.orbit.onTouchStart(makeEvent([finger(100)]));
  r.orbit.onTouchMove(makeEvent([finger(140)]));
  assert.ok(r.heading>90,"right swipe must increase camera heading");
  const afterRight=r.heading;
  assert.equal(r.redraw.length,1,"redraw is requested during the finger move");
  r.orbit.onTouchMove(makeEvent([finger(95)]));
  assert.ok(r.heading<afterRight,"left swipe must decrease heading immediately");
  const afterLeft=r.heading;
  r.orbit.onTouchEnd(makeEvent([]));
  assert.equal(r.heading,afterLeft);
  assert.deepEqual(r.captures,[true,false]);
  r.orbit.destroy();
  assert.equal(r.writes.length,2,"no deferred easing after touchend/destroy");
});

test("Google map avoids the swipe hint while preserving native two-finger navigation and plot picking",()=>{
  assert.match(src,/const touchCapable = navigator\.maxTouchPoints>0/);
  assert.match(src,/gestureHandling: "greedy"/);
  assert.match(src,/onCaptureChange:capturing=>/);
  assert.match(src,/gestureHandling:capturing\?"none":"greedy"/);
  assert.doesNotMatch(src,/gestureHandling:\s*"cooperative"/);
  assert.match(src,/touchHost\?\.addEventListener\("touchmove",touchOrbit\.onTouchMove,\{capture:true,passive:false\}\)/);
  assert.match(src,/touchHost\.removeEventListener\("touchmove",touchOrbit\.onTouchMove,true\)/);
  assert.match(src,/map\.moveCamera\(\{heading\}\)/);
  assert.match(src,/map\.setHeading\?\.\(heading\)/);
  assert.match(src,/if\(touchOrbit\?\.suppressClick\(\)\)return;/);
  assert.match(src,/pickModelGeoPlot\(/);
  assert.match(src,/window\.addEventListener\("pointerup",onNativePointerUp,true\)/);
  assert.match(src,/geo\.placement\.headingDeg|data\.placement\.headingDeg/);
  assert.match(css,/\.geo-integrated-map\s*\{[\s\S]*touch-action: none;/);
  assert.match(src,/touchHost\?\.addEventListener\("touchstart",touchOrbit\.onTouchStart,true\)/);
  assert.match(src,/onRotate:\(\)=>overlay\?\.requestRedraw\(\)/);
});
