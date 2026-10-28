import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = fs.readFileSync("packages/engine-core/src/geo-guided-rigid-alignment.ts","utf8");
const ui = fs.readFileSync("apps/admin/src/geo/GeoGuidedRigidAlignment.tsx","utf8");
const mapper = fs.readFileSync("apps/admin/src/geo/GeoMapper3DV2.tsx","utf8");

async function solver() {
  const out=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(out).toString("base64")}`);
}
const EARTH_RADIUS=6378137;
const RAD=Math.PI/180;
function fromEnu(origin,e,n) {
  const latitude=origin.latitude+n/(EARTH_RADIUS*RAD);
  const longitude=origin.longitude+e/(EARTH_RADIUS*RAD*Math.cos((origin.latitude+latitude)*RAD/2));
  return {latitude,longitude};
}
function pairsAt(scale, corruption=0) {
  const origin={latitude:13.0411,longitude:79.8509};
  const src=[{x:-20,y:0,z:-30},{x:20,y:0,z:-30},{x:20,y:0,z:30},{x:-20,y:0,z:30}];
  const heading=-14*RAD;
  const c=Math.cos(heading),s=Math.sin(heading);
  const pairs=src.map((p,i)=>{
    const e=scale*(c*p.x+s*p.z)+5+(i===3?corruption:0);
    const n=scale*(s*p.x-c*p.z)-8;
    return {id:`P${i+1}`,source:p,target:fromEnu(origin,e,n)};
  });
  return {origin,pairs};
}

test("2.5x plotting layout cannot silently pass ordinary guided-scale policy",async()=>{
 const {solveGeoGuidedRigidAlignment:solve}=await solver();
 const {origin,pairs}=pairsAt(2.5);
 assert.throws(()=>solve(origin,{x:0,y:0,z:0},pairs,{allowScale:true}),/Measured uniform scale 2\.500x is outside 0\.5–1\.5x/);
 const fixed=solve(origin,{x:0,y:0,z:0},pairs);
 assert.equal(fixed.scale,1);
 assert.ok(fixed.maxErrorM>10);
});

test("explicit 3+ paired extended calibration recovers actual uniform scale with low residual",async()=>{
 const {solveGeoGuidedRigidAlignment:solve}=await solver();
 const {origin,pairs}=pairsAt(2.5);
 const result=solve(origin,{x:0,y:0,z:0},pairs,{allowScale:true,allowExtendedScale:true});
 assert.ok(Math.abs(result.scale-2.5)<1e-5, String(result.scale));
 assert.ok(Math.abs(result.headingDeg-14)<1e-5,String(result.headingDeg));
 assert.ok(result.maxErrorM<1e-5,String(result.maxErrorM));
 assert.equal(result.pointCount,4);
 assert.equal(result.points.length,4);
});

test("extended calibration refuses fewer than 3 points and unbounded factors",async()=>{
 const {solveGeoGuidedRigidAlignment:solve}=await solver();
 const {origin,pairs}=pairsAt(2.5);
 assert.throws(()=>solve(origin,{x:0,y:0,z:0},pairs.slice(0,2),
  {allowScale:true,allowExtendedScale:true}),/at least 3/);
 assert.throws(()=>solve(origin,{x:0,y:0,z:0},pairs,
  {allowScale:false,allowExtendedScale:true}),/requires explicit uniform-scale/);
 const extreme=pairsAt(7);
 assert.throws(()=>solve(extreme.origin,{x:0,y:0,z:0},extreme.pairs,
  {allowScale:true,allowExtendedScale:true}),/outside 0\.1–5x/);
});

test("extended calibration still computes honest residual for mismatched survey corners",async()=>{
 const {solveGeoGuidedRigidAlignment:solve}=await solver();
 const {origin,pairs}=pairsAt(2.5,12);
 const bad=solve(origin,{x:0,y:0,z:0},pairs,
  {allowScale:true,allowExtendedScale:true});
 assert.ok(bad.maxErrorM>2, String(bad.maxErrorM));
 assert.ok(bad.rmsErrorM>1, String(bad.rmsErrorM));
});

test("review gate, diagnostics and fine adjust persist meaningful 2.5x scale",()=>{
 assert.match(ui,/Reviewed site measurements · permit 0\.1–5× scale/);
 assert.match(ui,/setAllowExtendedScale\(false\), \[pairs, modelUrl, anchor\?\.id\]/);
 assert.match(ui,/Measured best fit:/);
 assert.match(ui,/allowExtendedScale/);
 assert.match(ui,/solveState\.solution\.maxErrorM > 2/);
 assert.match(mapper,/Math\.min\(100, Math\.max\(0\.01,/);
 assert.doesNotMatch(mapper,/Math\.min\(1\.5, Math\.max\(0\.5, \(Number\.isFinite\(scale\)/);
});
