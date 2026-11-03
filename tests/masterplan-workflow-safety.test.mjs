import test from "node:test";
import assert from "node:assert/strict";
import {reviewMasterplanCsv,invalidateMasterplanSourceProof,
  packMasterplanRecovery,unpackMasterplanRecovery} from "../shared/masterplan-workflow.js";
const p=()=>({
  id:"1",corners:[[.1,.1],[.2,.1],[.2,.2],[.1,.2]],layout:"four",
  sides:Object.fromEntries(["front","depthA","back","depthB"].map((role,i)=>
    [role,{edges:[i],length:30,unit:"ft",source:"survey",verified:true,roadFacing:role==="front"}])),
  area:{value:900,unit:"sqft",source:"survey",verified:true},
  facing:"north",facingSource:"survey",facingVerified:true,road:"30 ft",notes:""
});
test("Masterplan CSV updates metadata only, preserves polygon and revokes source approvals",()=>{
  const current=p();
  const csv="Plot No,Area,Front,Back,Depth A,Depth B,Facing,Notes\n"+
    "1,950,31,30,30,30,East,\"Corner, road\"\n";
  const out=reviewMasterplanCsv(csv,[current]);
  assert.deepEqual(out.changed,["1"]);
  assert.deepEqual(out.added,[]);assert.deepEqual(out.unmapped,[]);
  assert.deepEqual(out.plots[0].corners,current.corners);
  assert.equal(out.plots[0].area.value,950);
  assert.equal(out.plots[0].sides.front.length,31);
  assert.equal(out.plots[0].notes,"Corner, road");
  assert.equal(out.plots[0].facing,"east");
  assert.equal(out.plots[0].area.verified,false);
  assert.equal(out.plots[0].sides.front.verified,false);
  assert.equal(out.plots[0].facingVerified,false);
  assert.equal(current.area.value,900,"original remains unchanged");
});
test("CSV never remaps mapped polygons or invents unmapped geometry",()=>{
  const a=p();
  const unmapped=reviewMasterplanCsv("plotId,area,front\n1,900,30\n2,1000,25\n",[a]);
  assert.deepEqual(unmapped.unmapped,["2"]);
  assert.equal(unmapped.plots.length,1);
  assert.throws(()=>reviewMasterplanCsv(
    'plotId,cornersJSON\n1,"[[0.4,0.4],[0.5,0.4],[0.4,0.5]]"\n',[a]),
    /corners differ/);
});
test("CSV reports missing existing plot IDs, duplicates and incomplete dimensions",()=>{
  const one=p(),two={...p(),id:"2"};
  const reviewed=reviewMasterplanCsv("Plot ID,Area\n1,1000\n",[one,two]);
  assert.deepEqual(reviewed.missing,["2"]);
  assert.throws(()=>reviewMasterplanCsv("plotId,area\n1,100\n1,200\n",[one]),/Duplicate/);
  const withGaps=reviewMasterplanCsv("plotId,cornersJSON,area\n3,\"[[0.5,0.5],[0.6,0.5],[0.6,0.6]]\",120\n",[]);
  assert.deepEqual(withGaps.added,["3"]);
  assert.ok(withGaps.issues.some(i=>i.includes("missing front")));
});
test("Source replacement revokes all verification without changing geometries",()=>{
  const draft={revision:4,verifiedRevision:4,imageAssetId:"img1",
    controlPoints:[{u:0,v:0,lat:23,lng:76,source:"survey",verified:true}],
    plots:[p()]};
  const next=invalidateMasterplanSourceProof(draft);
  assert.equal(next.verifiedRevision,null);
  assert.equal(next.controlPoints[0].verified,false);
  assert.equal(next.plots[0].area.verified,false);
  assert.equal(next.plots[0].sides.front.verified,false);
  assert.deepEqual(next.plots[0].corners,draft.plots[0].corners);
  assert.equal(draft.plots[0].area.verified,true);
});
test("Local recovery is bound to exact project, source image and server revision",()=>{
  const record={projectSlug:"sample-site",revision:8,imageAssetId:"image-8",
    draft:{imageAssetId:"image-8",plots:[p()],controlPoints:[]},
    dirty:true,working:null,originalId:null};
  const raw=packMasterplanRecovery(record);
  assert.ok(unpackMasterplanRecovery(raw,{projectSlug:"sample-site",revision:8,imageAssetId:"image-8"}));
  assert.equal(unpackMasterplanRecovery(raw,{projectSlug:"other",revision:8,imageAssetId:"image-8"}),null);
  assert.equal(unpackMasterplanRecovery(raw,{projectSlug:"sample-site",revision:9,imageAssetId:"image-8"}),null);
  assert.equal(unpackMasterplanRecovery(raw,{projectSlug:"sample-site",revision:8,imageAssetId:"new-source"}),null);
});
