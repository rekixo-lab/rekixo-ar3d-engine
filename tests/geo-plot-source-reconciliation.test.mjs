import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {geoInventoryReviewIssues,requireGeoInventoryReview} from "../shared/geo-plot-source-review.js";
import {assignFourCornerRoadFront,applyApprovedInventoryRow} from "../shared/geo-plot-source-operations.js";
import {validateGeoPlotCollection} from "../workers/geo-plot-geometry.mjs";
const source={id:"1",area:100,areaUnit:"sqm",areaSource:"Plan 2026 p5",
  front:10,back:10,depthA:10,depthB:10,lengthUnit:"m",measurementSource:"Plan 2026 p5",
  road:"23 feet road",facing:"east",facingSource:"Survey North",dimensions:"10x10",notes:"Approved"};
const side=(edges,roadFacing=false)=>({edges,length:10,unit:"m",roadFacing,
  source:"Plan 2026 p5",verified:true});
const mapped=()=>({id:"1",corners:[[0,0],[10,0],[10,10],[0,10]],layout:"four",
  sides:{front:side([0],true),depthA:side([1]),back:side([2]),depthB:side([3])},
  area:{value:1076.39104,unit:"sqft",source:"Plan 2026 p5",verified:true},
  facing:"east",facingSource:"Survey North",facingVerified:true,road:"23 feet road",
  planeY:0,planeSource:"Building release survey",planeVerified:true,notes:"sold plot (not business status)"});
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
test("inventory source matching uses physical area/length conversions rather than literal units",()=>{
  assert.deepEqual(geoInventoryReviewIssues([mapped()],[source]),[]);
  assert.equal(requireGeoInventoryReview([mapped()],[source]),true);
  assert.deepEqual(geoInventoryReviewIssues([mapped()],[]),[],"no CSV imported must remain legacy-compatible");
});
test("changed approved values, evidence, compass, road and missing IDs trigger fail-closed review",()=>{
  const variants=[
    [{...source,front:11},"front"],
    [{...source,area:110},"area"],
    [{...source,areaSource:"New signed source"},"areaSource"],
    [{...source,measurementSource:"New survey"},"frontSource"],
    [{...source,facing:"north"},"facing"],
    [{...source,facingSource:"New north register"},"facingSource"],
    [{...source,road:"20 feet road"},"road"],
    [{...source,id:"2"},"id"]
  ];
  for(const [newRow,key] of variants){
    const issues=geoInventoryReviewIssues([mapped()],[newRow]);
    assert.ok(issues.some(x=>x.field===key),JSON.stringify({key,issues}));
    assert.throws(()=>requireGeoInventoryReview([mapped()],[newRow]),/Inventory reconciliation required/);
  }
});
test("source comparison is per-plot and never modifies geometry/approvals",()=>{
  const a=mapped(),before=structuredClone(a);
  const issues=geoInventoryReviewIssues([a,{...mapped(),id:"2"}],[source,{...source,id:"2",front:20}]);
  assert.equal(issues.length,1);
  assert.equal(issues[0].plotId,"2");
  assert.deepEqual(a,before);
});
test("operator road-facing edge selection rotates role assignments, not geometry or approved numbers",()=>{
  const before=mapped();
  const next=assignFourCornerRoadFront(before,2);
  assert.deepEqual(before.sides.front.edges,[0]);
  assert.deepEqual(next.corners,before.corners);
  assert.deepEqual(next.sides.front.edges,[2]);
  assert.deepEqual(next.sides.depthA.edges,[3]);
  assert.deepEqual(next.sides.back.edges,[0]);
  assert.deepEqual(next.sides.depthB.edges,[1]);
  assert.equal(next.sides.front.roadFacing,true);
  assert.ok(Object.values(next.sides).every(s=>s.verified===false));
  assert.equal(next.facingVerified,false);
  assert.equal(next.area.verified,true,"area remains valid when only role ordering changed");
  assert.equal(next.planeVerified,true);
  assert.throws(()=>assignFourCornerRoadFront(before,4),/road-facing edge/);
});
test("apply current CSV to an already-mapped plot resets only changed source approvals",()=>{
  const before=mapped(),newCsv={...source,front:12,area:95,facing:"west",road:"30 ft road"};
  const out=applyApprovedInventoryRow(before,newCsv);
  assert.deepEqual(out.corners,before.corners);
  assert.equal(out.planeVerified,true);
  assert.equal(out.front,undefined);
  assert.equal(out.sides.front.length,12);
  assert.equal(out.sides.front.verified,false);
  assert.equal(out.area.value,95);
  assert.equal(out.area.verified,false);
  assert.equal(out.facingVerified,false);
  assert.equal(out.road,"30 ft road");
  assert.equal(out.sides.front.roadFacing,true);
  assert.equal(before.road,"23 feet road");
  assert.throws(()=>applyApprovedInventoryRow(before,{...source,id:"2"}),/must match/);
});
test("new mapping publications require explicit road-facing FRONT while sealed reads stay compatible",()=>{
  const invalid=mapped();invalid.sides.front.roadFacing=false;
  assert.equal(validateGeoPlotCollection([invalid]).length,1,
    "previous sealed release must remain readable");
  assert.throws(()=>validateGeoPlotCollection([invalid],{forPublish:true}),
    /road-facing Front/);
  assert.equal(validateGeoPlotCollection([mapped()],{forPublish:true}).length,1);
});
test("D1 source revision is required at both verify and publish with atomic race guard",()=>{
  const api=read("workers/geo-plot-mapping.mjs");
  const migration=read("database/migrations/0044_geo_plot_source_review.sql");
  assert.match(migration,/ADD COLUMN verified_inventory_revision/);
  assert.match(api,/verified_inventory_revision=\?/);
  assert.match(api,/requireGeoInventoryReview\(plots,inventory.rows\)/);
  assert.match(api,/verified_inventory_revision=COALESCE/);
  assert.match(api,/Inventory reconciliation required|Plot inventory was imported or changed/);
  assert.match(api,/COALESCE\(\(SELECT i.revision FROM geo_plot_inventory_3d/);
  assert.doesNotMatch(migration,/ALTER TABLE geo_plot_mapping_releases_3d/);
  assert.doesNotMatch(migration,/ALTER TABLE geo_plot_mapping_active_3d/);
});
test("both editors offer road edge selection and reset geometry-dependent approvals",()=>{
  const legacy=read("apps/admin/src/geo/GeoPlotMapper.tsx");
  const image=read("apps/admin/src/masterplan/MasterplanWorkspace.tsx");
  assert.match(legacy,/Road-facing FRONT boundary/);
  assert.match(legacy,/Apply Latest Approved CSV to Selected Plot/);
  assert.match(legacy,/inventoryIssues.length>0/);
  assert.match(image,/Road-facing FRONT edge/);
  assert.match(image,/area:\{\.\.\.prev.area,verified:false\},facingVerified:false/);
  assert.match(image,/assignFourCornerRoadFront/);
  assert.match(image,/facingVerified:false/);
});
