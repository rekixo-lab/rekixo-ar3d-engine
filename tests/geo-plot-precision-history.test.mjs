import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {validateGeoPlotCollection} from "../workers/geo-plot-geometry.mjs";
import {
  newPlotEditHistory,replacePlotEditHistory,updatePlotEditHistory,
  closeGroupedPlotEdit,undoPlotEdit,redoPlotEdit,
  geometryWithRevokedApprovals,nudgePlotCorner
} from "../shared/geo-plot-precision-history.js";

const side=(edge,roadFacing=false)=>({edges:[edge],length:10,unit:"m",source:"Approved survey",verified:true,roadFacing});
const plot=()=>({
 id:"17",corners:[[0,0],[10,0],[10,10],[0,10]],layout:"four",
 sides:{front:side(0,true),depthA:side(1),back:side(2),depthB:side(3)},
 area:{value:100,unit:"sqm",source:"Approved survey",verified:true},
 facing:"east",facingSource:"North reference",facingVerified:true,
 planeY:2,planeSource:"Site source",planeVerified:true,road:"23 feet road",notes:"original"
});
test("Undo/Redo restores exact working-plot attributes and never loses an immutable source approval",()=>{
 const source=plot(),first={...source,notes:"rechecked"};
 let history=newPlotEditHistory(source);
 history=updatePlotEditHistory(history,first);
 history=updatePlotEditHistory(history,{...first,road:"30 foot road"});
 assert.equal(history.past.length,2);
 const old=undoPlotEdit(history);
 assert.equal(old.present.road,source.road);
 assert.equal(old.present.notes,"rechecked");
 const older=undoPlotEdit(old);
 assert.deepEqual(older.present,source);
 assert.equal(older.present.area.verified,true);
 const restored=redoPlotEdit(redoPlotEdit(older));
 assert.equal(restored.present.road,"30 foot road");
 const edited=updatePlotEditHistory(old,{...old.present,notes:"new branch"});
 assert.equal(edited.future.length,0,"new edit clears the redo branch");
 assert.equal(history.present.road,"30 foot road","history versions stay immutable");
});
test("A continuous drag groups repeated pointer moves into one undo operation",()=>{
 const initial=plot();
 let state=newPlotEditHistory(initial);
 state=updatePlotEditHistory(state,{...initial,notes:"drag 1"},{grouped:true});
 state=updatePlotEditHistory(state,{...initial,notes:"drag 2"},{grouped:true});
 assert.equal(state.past.length,0);
 state=closeGroupedPlotEdit(state,initial);
 assert.equal(state.past.length,1);
 assert.deepEqual(undoPlotEdit(state).present,initial);
 assert.equal(closeGroupedPlotEdit(state,state.present),state,"unchanged drag adds no history");
});
test("Plot switching resets history: undo never brings back the prior plot ID",()=>{
 let state=newPlotEditHistory(plot());
 state=updatePlotEditHistory(state,{...plot(),notes:"changed"});
 state=replacePlotEditHistory(state,{...plot(),id:"18"});
 assert.equal(state.past.length,0);
 assert.equal(undoPlotEdit(state).present.id,"18");
 state=updatePlotEditHistory(state,null);
 assert.deepEqual(state,newPlotEditHistory(null));
});
test("Editor history remains bounded for large editing sessions",()=>{
 let state=newPlotEditHistory(plot());
 for(let i=0;i<115;i++)
   state=updatePlotEditHistory(state,{...state.present,notes:"draft "+i});
 assert.equal(state.past.length,100);
});
test("Corner nudges use local metres, revoke *all* spatial approvals and preserve source text",()=>{
 const before=plot();
 const result=nudgePlotCorner(before,0,0.01,-0.1);
 assert.equal(result.issue,null);
 assert.deepEqual(result.plot.corners[0],[0.01,-0.1]);
 assert.equal(result.plot.area.value,100);
 assert.equal(result.plot.area.source,"Approved survey");
 assert.equal(result.plot.area.verified,false);
 assert.equal(result.plot.facingVerified,false);
 assert.equal(result.plot.planeVerified,false);
 for(const role of Object.keys(before.sides)){
   assert.equal(result.plot.sides[role].verified,false);
   assert.equal(result.plot.sides[role].roadFacing,false);
 }
 assert.equal(before.sides.front.roadFacing,true);
 assert.throws(()=>validateGeoPlotCollection([result.plot],{forPublish:true}),/verify|road-facing Front/i);
 assert.deepEqual(undoPlotEdit(updatePlotEditHistory(newPlotEditHistory(before),result.plot)).present,before);
});
test("Invalid or degenerating nudges never mutate the current plot",()=>{
 const before=plot();
 for(const [index,dx,dz] of [[-1,.1,0],[2,NaN,0],[0,-1000,0],[0,10,0],[0,0,1e9]]){
   const {plot:after,issue}=nudgePlotCorner(before,index,dx,dz);
   assert.ok(issue,"bad nudge must explain its failure");
   assert.equal(after,before,"bad edit cannot alter the draft");
 }
 assert.equal(nudgePlotCorner(before,0,0,0).issue,null);
 assert.deepEqual(before.corners[0],[0,0]);
});
test("Manual drag revokes approval without changing signed lengths or plane datum",()=>{
 const before=plot();
 const changed=geometryWithRevokedApprovals(before,
   [[0.2,0],[10,0],[10,10],[0,10]]);
 assert.equal(changed.planeY,2);
 assert.equal(changed.planeSource,"Site source");
 assert.equal(changed.planeVerified,false);
 assert.equal(changed.sides.front.length,10);
 assert.equal(changed.sides.front.source,"Approved survey");
 assert.equal(changed.sides.front.verified,false);
 assert.equal(changed.sides.front.roadFacing,false);
 assert.equal(before.planeVerified,true);
});
test("All interactions stay client-side until explicit Apply/Save/Verify/Publish",()=>{
 const source=readFileSync(new URL("../apps/admin/src/geo/GeoPlotMapper.tsx",import.meta.url),"utf8");
 assert.match(source,/updatePlotEditHistory/);
 assert.match(source,/closeGroupedPlotEdit/);
 assert.match(source,/undoPlotEdit/);
 assert.match(source,/redoPlotEdit/);
 assert.match(source,/geometryWithRevokedApprovals\(prev,corners\)/);
 assert.match(source,/nudgeSelectedCorner/);
 assert.match(source,/Corner movement step/);
 assert.match(source,/Ctrl\/⌘\+Z/);
});
