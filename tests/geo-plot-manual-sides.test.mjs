import test from "node:test";
import assert from "node:assert/strict";
import {
  geoManualCornerChain,stageGeoManualSideRange,geoManualSourceSignature,
  proposeGeoManualSideMapping,applyGeoManualSideProposal
} from "../shared/geo-plot-manual-sides.js";
import {inspectGeoPlotSideCoverage} from "../shared/geo-plot-side-integrity.js";
import {validateGeoPlot} from "../workers/geo-plot-geometry.mjs";

const side=edges=>({edges,length:21.166667,unit:"ft",source:"signed-cad-pdf",
  verified:true,roadFacing:true,facingDirection:"west"});
const polygon=n=>{
  const corners=Array.from({length:n},(_,i)=>{
    const t=i*Math.PI*2/n;
    return [Math.cos(t)*25,Math.sin(t)*25];
  });
  return {id:"2",corners,layout:n===3?"three":"four",
    sides:n===3?{front:side([0]),depthA:side([1]),back:side([2])}:{
      front:side([0]),depthA:side([1]),back:side([2]),
      depthB:side(Array.from({length:n-3},(_,i)=>i+3))},
    area:{value:92.13,unit:"sqm",source:"signed-cad-pdf",verified:true},
    facing:"west",facingSource:"signed-cad-pdf",facingVerified:true,road:"two internal roads"};
};
const validate=plot=>{
  assert.equal(inspectGeoPlotSideCoverage(plot).ok,true);
  assert.equal(validateGeoPlot(plot).id,"2");
};

test("manual corner range keeps all intermediate segments, including wraparound",()=>{
  assert.deepEqual(geoManualCornerChain(4,1,7),[4,5,6,0]);
  assert.deepEqual(geoManualCornerChain(0,1,3),[0]);
  assert.deepEqual(geoManualCornerChain(2,0,3),[2]);
  assert.throws(()=>geoManualCornerChain(2,2,7),/DIFFERENT/);
  assert.throws(()=>geoManualCornerChain(0,7,7),/DIFFERENT/);
});

test("stage one independent role without moving any other side, including rounded 7-corner plot",()=>{
  const p=polygon(7),original=structuredClone(p);
  const locked=stageGeoManualSideRange(p,{},"front",4,6);
  assert.deepEqual(locked,{front:[4,5]});
  assert.deepEqual(p,original);
  const extra=stageGeoManualSideRange(p,locked,"back",2,3);
  assert.deepEqual(extra,{front:[4,5],back:[2]});
  assert.deepEqual(locked,{front:[4,5]});
  assert.throws(()=>stageGeoManualSideRange(p,extra,"depthA",5,6),/overlaps/);
});

test("preview explicitly fills remaining sides and is fully server-valid for 3–80 corners",()=>{
  for(const n of [3,4,5,6,7,8,10,12,20,40,80]){
    const p=polygon(n),before=structuredClone(p);
    const frontStart=n>=5?Math.floor(n/2):1;
    const frontEnd=(frontStart+1)%n;
    const locked=stageGeoManualSideRange(p,{},"front",frontStart,frontEnd);
    const preview=proposeGeoManualSideMapping(p,locked);
    validate(preview.plot);
    assert.deepEqual(preview.plot.sides.front.edges,[frontStart]);
    assert.deepEqual(preview.plot.corners,p.corners);
    assert.deepEqual(preview.plot.area,p.area);
    assert.equal(preview.plot.sides.front.length,p.sides.front.length);
    assert.equal(preview.plot.sides.front.source,p.sides.front.source);
    assert.equal(preview.plot.sides.front.verified,false);
    assert.equal(preview.plot.facingVerified,false);
    assert.equal(preview.edgeCount,n);
    assert.deepEqual(p,before);
    assert.deepEqual(applyGeoManualSideProposal(p,preview),preview.plot);
  }
});

test("selecting Front range plus Back is independent and locks BOTH exact ranges",()=>{
  const p=polygon(7);
  let locked=stageGeoManualSideRange(p,{},"front",4,6);
  locked=stageGeoManualSideRange(p,locked,"back",2,3);
  const preview=proposeGeoManualSideMapping(p,locked);
  validate(preview.plot);
  assert.deepEqual(preview.plot.sides.front.edges,[4,5]);
  assert.deepEqual(preview.plot.sides.back.edges,[2]);
  assert.ok(preview.changedUnpinned.length>0);
  assert.ok(preview.changedRoles.includes("front"));
  assert.ok(preview.changedRoles.includes("depthB"));
  const committed=applyGeoManualSideProposal(p,preview);
  assert.deepEqual(committed.corners,p.corners);
  assert.equal(committed.area.value,92.13);
  assert.deepEqual(p.sides.front.edges,[0]);
});

test("non-front 7-corner segment can be independently selected and other pinned sides stay fixed",()=>{
  const p=polygon(7);
  let locks=stageGeoManualSideRange(p,{},"depthA",4,5);
  const prev=proposeGeoManualSideMapping(p,locks);
  validate(prev.plot);
  assert.deepEqual(prev.plot.sides.depthA.edges,[4]);
  assert.deepEqual(p.sides.front.edges,[0]);
  assert.ok(prev.changedUnpinned.length);
});

test("four-corner user can manually select Back without automatic Front rotation",()=>{
  const p=polygon(4);
  const locks=stageGeoManualSideRange(p,{},"back",1,2);
  const preview=proposeGeoManualSideMapping(p,locks);
  validate(preview.plot);
  assert.deepEqual(preview.plot.sides.back.edges,[1]);
  assert.deepEqual(p.sides.back.edges,[2]);
  assert.ok(preview.changedUnpinned.length>0);
});

test("manual locked ranges cannot steal too many edges or overlap",()=>{
  const p=polygon(7);
  const locks=stageGeoManualSideRange(p,{},"front",0,5);
  const locked=stageGeoManualSideRange(p,locks,"back",5,0);
  assert.throws(()=>proposeGeoManualSideMapping(p,locked),/cannot make a complete/);
  assert.deepEqual(p.sides.front.edges,[0]);
});

test("applying stale preview after Undo or another role edit is refused",()=>{
  const p=polygon(7),locks=stageGeoManualSideRange(p,{},"front",4,5);
  const proposal=proposeGeoManualSideMapping(p,locks);
  assert.equal(proposal.baseSignature,geoManualSourceSignature(p));
  const changed=structuredClone(p);
  changed.sides.front.edges=[6];
  assert.throws(()=>applyGeoManualSideProposal(changed,proposal),/changed since the side preview/);
});

test("no-change preview retains existing signed approvals and untouched commercial/source data",()=>{
  const p=polygon(4);
  const preview=proposeGeoManualSideMapping(p,{front:[0]});
  assert.deepEqual(preview.changedRoles,[]);
  assert.equal(preview.plot.sides.front.verified,true);
  assert.equal(preview.plot.facingVerified,true);
  assert.equal(preview.plot.road,p.road);
  assert.deepEqual(preview.plot.area,p.area);
  assert.deepEqual(p.sides.front.edges,[0]);
});
