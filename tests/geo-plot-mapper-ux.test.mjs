import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {validateGeoPlotCollection} from "../workers/geo-plot-geometry.mjs";
import {nextCsvPlotForDrawing,positionCursorLoupe,assignVisiblePlotEdge,
  draftStorageKey,packLocalPlotDraft,unpackLocalPlotDraft,visibleMappingProgress
} from "../shared/geo-plot-mapper-ux.js";
const row=id=>({id:String(id)});
const plot=(n=4)=>({id:"1",layout:"four",corners:Array.from({length:n},(_,i)=>
  [Math.cos(2*Math.PI*i/n),Math.sin(2*Math.PI*i/n)]),
  sides:{front:{edges:[0],length:10,unit:"ft",source:"plan",roadFacing:false,verified:true},
    depthA:{edges:[1],length:15,unit:"ft",source:"plan",roadFacing:false,verified:true},
    back:{edges:[2],length:10,unit:"ft",source:"plan",roadFacing:false,verified:true},
    depthB:{edges:[3],length:15,unit:"ft",source:"plan",roadFacing:false,verified:true}},
  area:{value:150,unit:"sqft",source:"plan",verified:true},
  facing:"east",facingVerified:true,planeVerified:true,road:"23 FEET ROAD"});
test("CSV-first drawing uses pending approved Plot 1, never invents Plot 37",()=>{
  const inventory=Array.from({length:36},(_,i)=>row(i+1));
  assert.equal(nextCsvPlotForDrawing(inventory,[]).id,"1");
  assert.equal(nextCsvPlotForDrawing(inventory,[plot()]).id,"2");
  assert.equal(nextCsvPlotForDrawing(inventory,[row("20")],"20").id,"21");
  assert.equal(nextCsvPlotForDrawing(inventory,[row("36")],"36").id,"1");
  assert.equal(nextCsvPlotForDrawing(inventory,inventory.map(x=>x.id)),null);
  assert.equal(nextCsvPlotForDrawing([],[]),null);
  assert.deepEqual(visibleMappingProgress(inventory,[plot()]),
    {inventory:36,confirmed:1,pending:35,unexpected:0});
  assert.equal(visibleMappingProgress(inventory,[{id:"37"}]).unexpected,1);
});
test("loupe follows pointer in center and flips inside four viewport edges",()=>{
  assert.deepEqual(positionCursorLoupe([100,100],[900,700]),{left:118,top:118});
  for(const pt of [[0,0],[899,0],[0,699],[899,699],[450,350]]){
    const pos=positionCursorLoupe(pt,[900,700]);
    assert.ok(pos.left>=8&&pos.left+170<=900);
    assert.ok(pos.top>=8&&pos.top+170<=700);
  }
  assert.deepEqual(positionCursorLoupe([10,10],[400,400]),{left:28,top:28});
});
test("four-corner visual Front selection assigns actual visible road edge and resets approvals",()=>{
  const before=plot(),after=assignVisiblePlotEdge(before,"front",2);
  assert.deepEqual(after.sides.front.edges,[2]);
  assert.equal(after.sides.front.roadFacing,true);
  assert.equal(after.facingVerified,false);
  assert.equal(after.sides.depthA.verified,false);
  assert.deepEqual(before.sides.front.edges,[0]);
});
test("visual irregular chain does not assign one segment to two roles and rejects disconnected segments",()=>{
  const p=plot(6);
  p.sides.front.edges=[0];
  const after=assignVisiblePlotEdge(p,"front",1,{extend:true});
  assert.deepEqual(after.sides.front.edges,[0,1]);
  assert.equal(after.sides.depthA.edges.length,0);
  assert.equal(after.sides.front.verified,false);
  assert.throws(()=>assignVisiblePlotEdge(after,"front",4,{extend:true}),/connected/);
  assert.throws(()=>assignVisiblePlotEdge(p,"depthB",-1),/valid plot side/);
});
test("local draft recovery is source/revision bound, expires and cannot cross projects",()=>{
  const entry={projectSlug:"satharai-50a45356",geoReleaseId:"geo_release_22be5a",
    buildingReleaseId:"building_release_a",mappingRevision:0,plot:plot(),
    originalId:null,shape:"four",checkedAt:Date.now()};
  const raw=packLocalPlotDraft(entry);
  assert.ok(raw);
  assert.equal(unpackLocalPlotDraft(raw,entry).plot.id,"1");
  assert.equal(unpackLocalPlotDraft(raw,{...entry,geoReleaseId:"other"}),null);
  assert.equal(unpackLocalPlotDraft(raw,{...entry,projectSlug:"other"}),null);
  assert.equal(unpackLocalPlotDraft(raw,{...entry,mappingRevision:1}),null);
  assert.equal(unpackLocalPlotDraft(raw,entry,entry.checkedAt+8*86400000),null);
  assert.equal(unpackLocalPlotDraft("{invalid",entry),null);
  assert.ok(draftStorageKey(entry.projectSlug)?.includes("satharai"));
  assert.equal(draftStorageKey("../other"),null);
});

test("visual Back/Depth swap retains all four edges and passes server draft geometry validation",()=>{
  const before=plot();
  const after=assignVisiblePlotEdge(before,"back",1);
  assert.deepEqual(after.sides.back.edges,[1]);
  assert.deepEqual(after.sides.depthA.edges,[2]);
  const covered=Object.values(after.sides).flatMap(side=>side.edges);
  assert.deepEqual(covered.slice().sort(),[0,1,2,3]);
  assert.equal(validateGeoPlotCollection([after]).length,1);
});
test("irregular chains allow wraparound clockwise but never disconnected or mid-chain removal",()=>{
  const p=plot(6);
  p.sides.front.edges=[5];
  const wrap=assignVisiblePlotEdge(p,"front",0,{extend:true});
  assert.deepEqual(wrap.sides.front.edges,[5,0]);
  const continued=assignVisiblePlotEdge(wrap,"front",1,{extend:true});
  assert.deepEqual(continued.sides.front.edges,[5,0,1]);
  assert.throws(()=>assignVisiblePlotEdge(continued,"front",0,{extend:true}),/chain end/);
  assert.deepEqual(assignVisiblePlotEdge(continued,"front",5,{extend:true}).sides.front.edges,[0,1]);
});
test("actual UI contract keeps Confirm & Next, source/revision-safe local recovery and visible publish",()=>{
  const editor=readFileSync(new URL("../apps/admin/src/geo/GeoPlotMapper.tsx",import.meta.url),"utf8");
  const css=readFileSync(new URL("../apps/admin/src/geo/geo-plot-mapper.css",import.meta.url),"utf8");
  assert.match(editor,/nextCsvPlotForDrawing\(inventoryRows,plots\)/);
  assert.match(editor,/Confirm Plot/);
  assert.match(editor,/confirmPlotAndNext/);
  assert.match(editor,/readBack=await callApi<MappingState>\(api\)/);
  assert.match(editor,/Publish Verified Mapping to Customer Site/);
  assert.match(editor,/mode==="side"/);
  assert.match(editor,/assignVisiblePlotEdge\(/);
  assert.match(editor,/unpackLocalPlotDraft/);
  assert.match(editor,/getCoalescedEvents/);
  assert.match(editor,/positionCursorLoupe/);
  assert.match(css,/\.geo-plot-dock-tabs/);
  assert.match(css,/\.geo-plot-confirm-primary/);
});
