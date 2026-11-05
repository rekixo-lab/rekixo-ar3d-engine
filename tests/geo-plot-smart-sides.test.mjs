import test from "node:test";
import assert from "node:assert/strict";
import {inferFrontFirstSideGroups,roadFrontPreview,nearestPlotBoundaryEdge} from "../shared/geo-plot-smart-sides.js";

test("four clicked corners: first boundary is Front, next is Depth A",()=>{
  const out=inferFrontFirstSideGroups([[0,0],[4,0],[4,3],[0,3]]);
  assert.deepEqual(out,{
    layout:"four",roles:{front:[0],depthA:[1],back:[2],depthB:[3]},reviewRequired:false
  });
});

test("three-corner case retains three logical roles",()=>{
  const out=inferFrontFirstSideGroups([[0,0],[4,0],[0,3]]);
  assert.deepEqual(out,{layout:"three",roles:{front:[0],depthA:[1],back:[2]},reviewRequired:false});
});

test("straight consecutive irregular segments group under a single Front",()=>{
  const out=inferFrontFirstSideGroups([[0,0],[2,0],[4,0],[4,3],[0,3]]);
  assert.deepEqual(out,{
    layout:"four",roles:{front:[0,1],depthA:[2],back:[3],depthB:[4]},reviewRequired:false
  });
});

test("complex irregular shapes request review without dropping any edge",()=>{
  const out=inferFrontFirstSideGroups([[0,0],[4,0],[4,3],[2,4],[0,3]]);
  assert.equal(out.reviewRequired,true);
  const edges=Object.values(out.roles).flat().sort((a,b)=>a-b);
  assert.deepEqual(edges,[0,1,2,3,4]);
});

test("invalid input is rejected; no compass is guessed without verified heading",()=>{
  assert.equal(inferFrontFirstSideGroups([[1,1],[2,2]]),null);
  const plot={corners:[[0,0],[4,0],[4,3],[0,3]],sides:{front:{edges:[0]}}};
  assert.equal(roadFrontPreview(plot,Number.NaN,()=>{throw Error("should not call");}),null);
  assert.equal(roadFrontPreview(plot,0,(_p,edges)=>edges[0]===0?"north":null),"north");
});

test("direct side selection uses actual scaled edge distance",()=>{
  const corners=[[0,0],[1,0],[1,1],[0,1]];
  assert.equal(nearestPlotBoundaryEdge(corners,[0.52,0.02],1000,1000)?.edge,0);
  assert.equal(nearestPlotBoundaryEdge(corners,[0.99,0.51],1000,1000)?.edge,1);
  assert.equal(nearestPlotBoundaryEdge(corners,[0.5,0.98],1000,1000)?.edge,2);
  assert.equal(nearestPlotBoundaryEdge(corners,[0.02,0.5],1000,1000)?.edge,3);
  assert.equal(nearestPlotBoundaryEdge(corners,[0.5,0.5],0,1000),null);
});
