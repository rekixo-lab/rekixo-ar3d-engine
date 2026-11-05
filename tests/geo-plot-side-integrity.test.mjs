import test from "node:test";
import assert from "node:assert/strict";
import {inspectGeoPlotSideCoverage,assignCoveredGeoPlotEdge,
  repairGeoPlotSideCoverage} from "../shared/geo-plot-side-integrity.js";
import {assignVisiblePlotEdge} from "../shared/geo-plot-mapper-ux.js";
import {validateGeoPlot} from "../workers/geo-plot-geometry.mjs";
const side=(edges,unit="ft")=>({edges,length:10,unit,roadFacing:false,source:"approved-plan",verified:true});
const polygon=(n)=>{
  const corners=Array.from({length:n},(_,i)=>[
    Math.round(Math.cos(2*Math.PI*i/n)*10000)/100,
    Math.round(Math.sin(2*Math.PI*i/n)*10000)/100
  ]);
  const layout=n===3?"three":"four";
  const sides=n===3?{front:side([0]),depthA:side([1]),back:side([2])}:{
    front:side([0]),depthA:side([1]),back:side([2]),
    depthB:side(Array.from({length:n-3},(_,i)=>i+3))
  };
  return {id:"2",corners,layout,sides,area:{value:1000,unit:"sqft",source:"approved-plan",verified:true},
    facing:"west",facingSource:"approved-plan",facingVerified:true,road:"road"};
};
const valid=(p)=>{assert.equal(inspectGeoPlotSideCoverage(p).ok,true);
  assert.equal(validateGeoPlot(p).id,"2");};

test("all common 3–80 corner polygons retain one role per segment on swaps",()=>{
  for(const n of [3,4,5,6,7,8,9,10,12,20,40,80]){
    const p=polygon(n);
    valid(p);
    for(const role of (n===3?["front","depthA","back"]:["front","depthA","back","depthB"])){
      const picked=Math.min(n-1,role==="front"?n-1:role==="depthA"?2:1);
      const changed=assignVisiblePlotEdge(p,role,picked);
      valid(changed);
      assert.deepEqual(changed.corners,p.corners);
      assert.equal(changed.area.value,p.area.value);
      assert.equal(changed.sides.front.source,p.sides.front.source);
    }
  }
});

test("7-corner rounded boundary: change Front without orphaning original edges",()=>{
  const p=polygon(7);
  const changed=assignVisiblePlotEdge(p,"front",5);
  valid(changed);
  assert.deepEqual(changed.sides.front.edges,[3,4,5,6]);
  assert.deepEqual(changed.sides.depthB.edges,[0]);
  assert.equal(changed.sides.front.verified,false);
  assert.equal(changed.facingVerified,false);
  assert.deepEqual(p.sides.front.edges,[0]);
});

test("multi-segment boundary transfer preserves all edges and contiguous groups",()=>{
  const p=polygon(7);
  p.sides={front:side([0,1]),depthA:side([2,3]),back:side([4]),depthB:side([5,6])};
  const extended=assignVisiblePlotEdge(p,"front",2,{extend:true});
  valid(extended);
  assert.deepEqual(extended.sides.front.edges,[0,1,2]);
  assert.deepEqual(extended.sides.depthA.edges,[3]);
  const shrunk=assignVisiblePlotEdge(extended,"front",2,{extend:true});
  valid(shrunk);
  assert.deepEqual(shrunk.sides.front.edges,[0,1]);
  assert.deepEqual(shrunk.sides.depthA.edges,[2,3]);
  assert.throws(()=>assignVisiblePlotEdge(extended,"front",1,{extend:true}),/first or last/);
});

test("prevent removal of sole side edge; never mutate user's original draft",()=>{
  const p=polygon(7),before=structuredClone(p);
  assert.throws(()=>assignVisiblePlotEdge(p,"front",1,{extend:true}),/last boundary edge/);
  assert.deepEqual(p,before);
  valid(p);
});

test("detect and explicitly repair the historical lost-edge edit seen in Plot 2",()=>{
  const p=polygon(7);
  p.sides.front.edges=[5];
  p.sides.depthB.edges=[3,4,6];
  const audit=inspectGeoPlotSideCoverage(p);
  assert.equal(audit.ok,false);
  assert.deepEqual(audit.missingEdges,[0]);
  assert.ok(audit.disconnectedRoles.includes("depthB"));
  assert.throws(()=>assignVisiblePlotEdge(p,"front",3),/Repair Sides/);
  const repaired=repairGeoPlotSideCoverage(p);
  valid(repaired);
  assert.deepEqual(repaired.corners,p.corners);
  assert.deepEqual(repaired.area,p.area);
  assert.equal(repaired.sides.front.source,"approved-plan");
  assert.equal(repaired.sides.front.verified,false);
  assert.equal(repaired.sides.front.roadFacing,false);
  assert.equal(repaired.facingVerified,false);
  assert.equal(inspectGeoPlotSideCoverage(p).ok,false);
});

test("missing roles, duplicate edges, disconnected sides and wraparound are handled",()=>{
  const p=polygon(6);
  p.sides={front:side([5]),depthA:side([0,1,2]),back:side([3]),depthB:side([4])};
  valid(p);
  const wrap=assignVisiblePlotEdge(p,"front",0,{extend:true});
  valid(wrap);assert.deepEqual(wrap.sides.front.edges,[5,0]);
  const continued=assignVisiblePlotEdge(wrap,"front",1,{extend:true});
  valid(continued);assert.deepEqual(continued.sides.front.edges,[5,0,1]);
  const unwrapped=assignVisiblePlotEdge(continued,"front",5,{extend:true});
  valid(unwrapped);assert.deepEqual(unwrapped.sides.front.edges,[0,1]);
  const corrupted=structuredClone(p);
  corrupted.sides.depthB.edges=[4,0];
  assert.deepEqual(inspectGeoPlotSideCoverage(corrupted).duplicateEdges,[0]);
  valid(repairGeoPlotSideCoverage(corrupted));
});

test("repair preserves coordinates and does not alter an already-valid polygon",()=>{
  for(const n of [3,4,5,6,7,8,10,20,80]){
    const p=polygon(n);
    assert.equal(repairGeoPlotSideCoverage(p),p);
    p.sides.front.edges=[];
    const repaired=repairGeoPlotSideCoverage(p);
    valid(repaired);
    assert.deepEqual(repaired.corners,p.corners);
    assert.deepEqual(repaired.area,p.area);
  }
});
