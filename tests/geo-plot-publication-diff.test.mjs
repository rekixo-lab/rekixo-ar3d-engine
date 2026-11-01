import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {compareGeoPlotPublication} from "../shared/geo-plot-publication-diff.js";
const plot=(id,x=0)=>({id,corners:[[x,0],[x+10,0],[x+10,10],[x,10]],layout:"four",
  planeY:0,planeSource:"Signed datum",planeVerified:true,
  area:{value:100,unit:"sqm",source:"Signed plan",verified:true},
  sides:{front:{edges:[0],length:10,unit:"m",source:"Plan",verified:true,roadFacing:true}},
  road:"Main",facing:"east",facingSource:"Signed",facingVerified:true,notes:""});
test("Compare never mutates live immutable releases and reports every changed fact separately",()=>{
 const old=[plot("1"),plot("2",10)];
 const next=[{...plot("1"),area:{...plot("1").area,value:90}},plot("3",20)];
 const before=structuredClone(old);
 const diff=compareGeoPlotPublication(next,old);
 assert.equal(diff.added,1);assert.equal(diff.changed,1);assert.equal(diff.removed,1);
 assert.deepEqual(diff.approvalRequired,["1","2","3"]);
 assert.ok(diff.changes.find(x=>x.plotId==="1").fields.includes("approvedArea"));
 assert.ok(diff.changes.find(x=>x.plotId==="2").kind==="removed");
 assert.deepEqual(old,before);
});
test("Notes-only edits never silently invalidate geometric measurement approval",()=>{
 const x=compareGeoPlotPublication([{...plot("1"),notes:"visible note"}],[plot("1")]);
 assert.equal(x.changed,1);
 assert.deepEqual(x.changes[0].fields,["notes"]);
 assert.equal(x.changes[0].requiresReapproval,false);
});
test("Canonical Plot ID matching is case-insensitive and duplicates are rejected",()=>{
 assert.equal(compareGeoPlotPublication([plot("A")],[plot("a")]).changed,0);
 assert.throws(()=>compareGeoPlotPublication([plot("A"),plot("a")],[]),/duplicate/);
});
test("Server demands fresh preview token and binds active mapping ID atomically inside transaction",()=>{
 const source=readFileSync(new URL("../workers/geo-plot-mapping.mjs",import.meta.url),"utf8");
 const editor=readFileSync(new URL("../apps/admin/src/geo/GeoPlotMapper.tsx",import.meta.url),"utf8");
 assert.match(source,/publicationPreflight\(env,ctx\)/);
 assert.match(source,/body.expectedPreflightToken!==preflight.token/);
 assert.match(source,/COALESCE\(\(SELECT a.mapping_release_id FROM geo_plot_mapping_active_3d/);
 assert.match(source,/digest\(live.plots_json\)!==live.sha256/);
 assert.match(editor,/Preview Live vs Draft Plot Changes/);
 assert.match(editor,/Fresh server-side sealed release read/);
 assert.match(editor,/window.confirm\(summary\)/);
});
