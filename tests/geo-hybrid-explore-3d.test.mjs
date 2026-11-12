import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {initialGeoExperienceMode} from "../shared/geo-experience-mode.js";
import {geoExploreCameraShot} from "../shared/geo-explore-camera.js";

const publicGeo=readFileSync("apps/public/src/geo/GeoPublicDemo.tsx","utf8");
const explore=readFileSync("apps/public/src/geo/GeoExplore3D.tsx","utf8");
const viewer=readFileSync("apps/public/src/viewer/Viewer3D.tsx","utf8");
const css=readFileSync("apps/public/src/geo/geo-public-demo.css","utf8");

test("only two demo projects default to immersive 3D; mapped and other inventory remains Geo-first",()=>{
  for(const slug of ["dholera-villas-glb-demo-5809b995","shreem-palace-demo-a6532789"]){
    assert.equal(initialGeoExperienceMode(slug), "explore");
    assert.equal(initialGeoExperienceMode(slug,true), "map");
  }
  assert.equal(initialGeoExperienceMode("satharai-jyoti-paradise"),"map");
  assert.equal(initialGeoExperienceMode("shree-dungar-residency"),"map");
  assert.match(publicGeo,/if\(data\?\.plotMapping\?\.plots\?\.length\)setDisplayMode\("map"\)/);
  assert.match(publicGeo,/aria-pressed=\{displayMode==="explore"\}/);
  assert.match(publicGeo,/aria-pressed=\{displayMode==="map"\}/);
});

function verifyFitsCorners(bounds,aspect,view){
  const shot=geoExploreCameraShot(bounds,aspect,view);
  assert.ok(shot);
  const {target,position,fov}=shot;
  const direction={x:position.x-target.x,y:position.y-target.y,z:position.z-target.z};
  const length=Math.hypot(direction.x,direction.y,direction.z);
  const dir={x:direction.x/length,y:direction.y/length,z:direction.z/length};
  const side=Math.hypot(dir.x,dir.z);
  const right={x:dir.z/side,y:0,z:-dir.x/side};
  const up={x:dir.y*right.z,y:dir.z*right.x-dir.x*right.z,z:-dir.y*right.x};
  const tanVertical=Math.tan(fov*Math.PI/360);
  const tanHorizontal=tanVertical*aspect;
  for(const x of [bounds.min.x,bounds.max.x])
    for(const y of [bounds.min.y,bounds.max.y])
      for(const z of [bounds.min.z,bounds.max.z]){
        const dx=x-target.x,dy=y-target.y,dz=z-target.z;
        const depth=length-(dx*dir.x+dy*dir.y+dz*dir.z);
        const horizontal=Math.abs(dx*right.x+dy*right.y+dz*right.z);
        const vertical=Math.abs(dx*up.x+dy*up.y+dz*up.z);
        assert.ok(depth>0, "all model corners in front of camera");
        assert.ok(horizontal/depth < tanHorizontal, "no horizontal cropping");
        assert.ok(vertical/depth < tanVertical, "no vertical cropping");
      }
  return shot;
}

test("the full colony is visible with real source bounds on desktop and mobile",()=>{
  const dholera={min:{x:0,y:0,z:0},max:{x:343.95,y:7.74,z:73.71}};
  const shreem={min:{x:-331.52,y:-10,z:-201.26},max:{x:331.52,y:139.96,z:201.26}};
  for(const bounds of [dholera,shreem]){
    for(const aspect of [1300/480,393/660,1,1920/1080]){
      for(const view of ["full","top","aerial"])verifyFitsCorners(bounds,aspect,view);
    }
  }
  assert.ok(geoExploreCameraShot(dholera,1300/480,"close").minDistance<10,
    "user can orbit/zoom close to individual buildings");
  assert.equal(geoExploreCameraShot(dholera,0,"full"),null);
  assert.equal(geoExploreCameraShot(dholera,1,"unknown"),null);
  assert.equal(geoExploreCameraShot({min:{x:0,y:0,z:0},max:{x:NaN,y:1,z:1}},1,"full"),null);
});

test("independent GLB rendering is selected instead of Google WebGL; original Geo remains immutable",()=>{
  assert.match(publicGeo,/displayMode==="explore" \? \(\s*<GeoExplore3D/);
  assert.match(publicGeo,/displayMode==="map"\?"is-active":""/);
  assert.match(explore,/import \{ Viewer3D \} from "\.\.\/viewer\/Viewer3D"/);
  assert.match(explore,/presentationView=\{view\}/);
  assert.match(explore,/geoExploreMode/);
  assert.match(explore,/allowInteriorControls=\{false\}/);
  assert.match(explore,/allowWalkControls=\{false\}/);
  assert.match(viewer,/geoExploreCameraShot\(modelBounds, camera\.aspect, "full"\)/);
  assert.match(viewer,/controls\.minDistance = shot\.minDistance/);
  assert.match(viewer,/controls\.maxDistance = shot\.maxDistance/);
  assert.doesNotMatch(explore,/data\.placement|google\.maps|\.scale\.setScalar/);
  assert.match(css,/\.geo-experience-switch/);
  assert.match(css,/\.geo-explore-stage > \.viewer-shell/);
});
