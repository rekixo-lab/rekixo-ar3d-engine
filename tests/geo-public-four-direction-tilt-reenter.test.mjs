import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createGeoOneFingerOrbit,clampGeoOrbitTilt} from "../shared/geo-touch-orbit.js";

const source=readFileSync(new URL("../apps/public/src/geo/GeoPublicDemo.tsx",import.meta.url),"utf8");
const touch=(x,y,id=1)=>({identifier:id,clientX:x,clientY:y});
const event=(...touches)=>{
  const flags={prevented:0,stopped:0};
  return {touches,target:null,cancelable:true,flags,
    preventDefault(){flags.prevented++;},stopPropagation(){flags.stopped++;}};
};
function rig(startHeading=90,startTilt=67.5){
  let heading=startHeading,tilt=startTilt,time=1_000;
  const writes=[],redraws=[],captures=[],legacyHeading=[],legacyTilt=[];
  const orbit=createGeoOneFingerOrbit({
    getHeading:()=>heading,
    setHeading:value=>{heading=value;legacyHeading.push(value);},
    getTilt:()=>tilt,
    setTilt:value=>{tilt=value;legacyTilt.push(value);},
    setCamera:camera=>{heading=camera.heading;tilt=camera.tilt;writes.push({...camera});},
    onRotate:()=>redraws.push(time),
    onCaptureChange:capturing=>captures.push(capturing),
    shouldIgnoreTarget:target=>target==="toolbar",
    now:()=>time,
  });
  return {orbit,writes,redraws,captures,legacyHeading,legacyTilt,
    get heading(){return heading;},get tilt(){return tilt;},
    tick:ms=>{time+=ms;}};
}
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,
  "expected "+expected+", got "+actual);

test("up/down swipes change the camera tilt immediately and never rotate heading",()=>{
  const r=rig(110,60);
  r.orbit.onTouchStart(event(touch(100,250)));
  r.orbit.onTouchMove(event(touch(100,150)));
  close(r.tilt,18);close(r.heading,110);
  assert.equal(r.writes.length,1);
  assert.equal(r.redraws.length,1,"WebGL redraw while finger moves");
  r.orbit.onTouchMove(event(touch(100,200)));
  close(r.tilt,39);close(r.heading,110);
  assert.equal(r.writes.length,2);
  r.orbit.onTouchEnd(event());
  assert.deepEqual(r.captures,[true,false]);
  r.tick(50);assert.equal(r.writes.length,2,"no animation after release");
  assert.equal(r.orbit.suppressClick(),true,"vertical drag cannot select a plot");
  r.tick(500);assert.equal(r.orbit.suppressClick(),false);
});

test("diagonal gestures change tilt and heading in one camera write per move",()=>{
  const r=rig(350,45);
  r.orbit.onTouchStart(event(touch(100,120)));
  r.orbit.onTouchMove(event(touch(140,70)));
  close(r.heading,8.4);
  close(r.tilt,24);
  assert.deepEqual(r.writes,[{heading:r.heading,tilt:r.tilt}]);
  assert.equal(r.legacyHeading.length,0);
  assert.equal(r.legacyTilt.length,0);
  r.orbit.onTouchMove(event(touch(110,130)));
  close(r.heading,354.6);
  close(r.tilt,49.2);
  assert.equal(r.writes.length,2);
  r.orbit.onTouchEnd(event());
  assert.equal(r.redraws.length,2);
});

test("tilt is clamped at top-down and at the maximum low-angle view",()=>{
  assert.equal(clampGeoOrbitTilt(-200),0);
  assert.equal(clampGeoOrbitTilt(500),67.5);
  const r=rig(90,40);
  r.orbit.onTouchStart(event(touch(100,200)));
  r.orbit.onTouchMove(event(touch(100,-200)));
  close(r.tilt,0);
  r.orbit.onTouchMove(event(touch(100,500)));
  close(r.tilt,67.5);
  assert.equal(r.writes.length,2);
});

test("small taps and toolbar taps do not move either camera axis",()=>{
  const r=rig();
  r.orbit.onTouchStart(event(touch(100,100)));
  r.orbit.onTouchMove(event(touch(103,103)));
  r.orbit.onTouchEnd(event());
  assert.equal(r.writes.length,0);
  r.orbit.onTouchStart({...event(touch(100,100)),target:"toolbar"});
  r.orbit.onTouchMove(event(touch(200,250)));
  assert.equal(r.writes.length,0);
});

test("second finger returns navigation to native Google pinch and never resumes until release",()=>{
  const r=rig();
  r.orbit.onTouchStart(event(touch(100,100)));
  r.orbit.onTouchMove(event(touch(120,80)));
  const before=r.writes.length;
  const pinch=event(touch(120,80),touch(180,130,2));
  r.orbit.onTouchStart(pinch);
  r.orbit.onTouchMove(pinch);
  assert.deepEqual(pinch.flags,{prevented:0,stopped:0});
  assert.deepEqual(r.captures,[true,false]);
  r.orbit.onTouchEnd(event(touch(160,110)));
  r.orbit.onTouchMove(event(touch(190,80)));
  assert.equal(r.writes.length,before);
  r.orbit.onTouchEnd(event());
  r.orbit.onTouchStart(event(touch(90,90)));
  r.orbit.onTouchMove(event(touch(90,45)));
  assert.equal(r.writes.length,before+1);
});

test("Geo public integration uses tilt with atomic moveCamera, Re-enter and safe controls",()=>{
  assert.match(source,/getTilt:\(\)=>map\.getTilt\?\.\(\)\?\?initialCamera\.tilt/);
  assert.match(source,/setCamera:\(\{heading,tilt\}\)=>\{/);
  assert.match(source,/if\(map\.moveCamera\)map\.moveCamera\(\{heading,tilt\}\)/);
  assert.match(source,/else \{map\.setHeading\?\.\(heading\);map\.setTilt\?\.\(tilt\);\}/);
  assert.match(source,/reenterActionRef\.current = \(\) => applyCamera\("overview"\)/);
  assert.match(source,/map\.moveCamera\(\{ center, \.\.\.preset \}\)/);
  assert.match(source,/setZoom\(preset\.zoom\)/);
  assert.match(source,/aria-label="Re-enter project map"/);
  assert.doesNotMatch(source,/label: "Aerial"/);
  assert.match(source,/if\(touchOrbit\?\.suppressClick\(\)\)return;/);
  assert.match(source,/gestureHandling:capturing\?"none":"greedy"/);
  assert.match(source,/onRotate:\(\)=>overlay\?\.requestRedraw\(\)/);
  assert.match(source,/touchOrbit\?\.destroy\(\)/);
});
