import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {ENGINE_PROJECT_KINDS,isEngineProjectKind,projectModuleVisible,newProjectStartPath} from "../shared/engine-project-kinds.js";
import {deriveAffineGeoCalibration,geoPoint,validateImagePlots,validateMasterplanDraft} from "../workers/masterplan-geo-geometry.mjs";
const read=(p)=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const control=[
  {u:0,v:0,lat:22.7,lng:75.8,source:"survey A",verified:true},
  {u:1,v:0,lat:22.7,lng:75.801,source:"survey B",verified:true},
  {u:0,v:1,lat:22.699,lng:75.8,source:"survey C",verified:true},
];
const side=(edges)=>({edges,length:25,unit:"m",roadFacing:false,source:"approved layout",verified:true});
const plot={
  id:"25",corners:[[.1,.1],[.4,.1],[.4,.3],[.1,.3]],
  layout:"four",sides:{front:side([0]),depthA:side([1]),back:side([2]),depthB:side([3])},
  area:{value:250,unit:"sqm",source:"approved survey",verified:true},
  facing:"north-east",facingSource:"approved north arrow",facingVerified:true,
  road:"24 ft road",notes:""
};
const source={imageAssetId:"asset-01",width:2400,height:1600,controlPoints:control,plots:[plot]};
test("explicit Engine project kinds and separate project navigation",()=>{
  assert.deepEqual(ENGINE_PROJECT_KINDS,["legacy","building","building_geo","masterplan_geo"]);
  assert.equal(isEngineProjectKind("other"),false);
  assert.equal(newProjectStartPath("masterplan_geo"),"masterplan");
  assert.equal(newProjectStartPath("building_geo"),"source-pack");
  assert.equal(projectModuleVisible("masterplan_geo","building"),false);
  assert.equal(projectModuleVisible("masterplan_geo","masterplan-plots"),true);
  assert.equal(projectModuleVisible("building_geo","geo"),true);
  assert.equal(projectModuleVisible("building","geo"),false);
  assert.equal(projectModuleVisible("legacy","geo-plots"),true);
  assert.equal(projectModuleVisible("legacy","masterplan"),false);
});
test("three independent GPS controls derive a sensible WGS84 image transform",()=>{
  const fitted=deriveAffineGeoCalibration(control);
  assert.equal(fitted.maxResidualM,0);
  const a=geoPoint(fitted.transform,[0,0]),b=geoPoint(fitted.transform,[1,0]),c=geoPoint(fitted.transform,[0,1]);
  assert.ok(Math.abs(a.lat-control[0].lat)<1e-8);
  assert.ok(Math.abs(b.lng-control[1].lng)<1e-8);
  assert.ok(Math.abs(c.lat-control[2].lat)<1e-8);
  assert.ok(fitted.sizeM.width>50&&fitted.sizeM.width<300);
  assert.ok(fitted.sizeM.height>50&&fitted.sizeM.height<300);
});
test("reviewed image polygons preserve source-backed measurements without requiring a GLB",()=>{
  const data=validateMasterplanDraft(source,{publish:true});
  assert.equal(data.imageAssetId,"asset-01");
  assert.equal(data.width,2400);assert.equal(data.plots[0].corners[0][0],.1);
  assert.equal(data.plots[0].area.verified,true);
  assert.ok(data.calibration);
  assert.throws(()=>validateMasterplanDraft({...source,controlPoints:control.slice(0,2)},{publish:true}),/at least three/);
  assert.throws(()=>validateMasterplanDraft({...source,controlPoints:control.map((v,i)=>i===0?{...v,verified:false}:v)},{publish:true}),/survey source/);
  assert.throws(()=>validateMasterplanDraft({...source,plots:[{...plot,area:{...plot.area,verified:false}}]},{publish:true}),/approved area/);
});
test("image plot topology rejects overlap and accepts shared image boundaries",()=>{
  const adjacent={...plot,id:"26",corners:plot.corners.map(([x,y])=>[x+.3,y])};
  assert.equal(validateImagePlots([plot,adjacent]).length,2);
  assert.throws(()=>validateImagePlots([plot,{...adjacent,corners:adjacent.corners.map(([x,y])=>[x-.15,y])}]),/overlap/);
  assert.throws(()=>validateImagePlots([plot,{...plot,id:"25"}]),/Duplicate/);
  assert.throws(()=>validateImagePlots([{...plot,corners:[[.1,.1],[.4,.3],[.1,.3],[.4,.1]]}]),/degenerate|intersect/);
});
test("control point fit rejects collinearity and mismatched GPS controls",()=>{
  const collinear=control.map((v,i)=>({...v,u:i/4,v:i/4}));
  assert.throws(()=>deriveAffineGeoCalibration(collinear),/collinear/);
  const wrong=[...control,{u:.8,v:.8,lat:22.65,lng:75.81,source:"survey D",verified:true}];
  assert.throws(()=>deriveAffineGeoCalibration(wrong),/residual/);
});
test("Engine storage isolation and admin-only financial writes",()=>{
  const sql=read("database/migrations/0040_three_project_kinds_and_management.sql");
  const saleSql=read("database/migrations/0041_private_masterplan_sales_ledger.sql");
  const api=read("workers/admin-cloud.mjs");
  const master=read("workers/masterplan-geo-admin.mjs");
  const sales=read("workers/masterplan-sales.mjs");
  const publicEntry=read("workers/public.mjs");
  const server=read("workers/masterplan-geo-public.mjs");
  assert.match(sql,/DEFAULT 'legacy'/);
  assert.match(sql,/CHECK\(project_kind IN/);
  assert.match(sql,/masterplan_geo_releases_3d/);
  assert.match(sql,/trg_masterplan_release_no_update/);
  assert.match(saleSql,/idx_masterplan_sale_one_live_per_plot/);
  assert.match(saleSql,/idx_masterplan_reversal_once/);
  assert.match(api,/handleProjectManagementAdmin/);
  assert.match(api,/handleMasterplanGeoAdmin/);
  assert.match(api,/handleMasterplanSalesAdmin/);
  assert.match(master,/verified_revision=d\.revision/);
  assert.match(sales,/same-origin financial write|Same-origin financial write/);
  assert.match(sales,/state='confirmed'/);
  assert.match(publicEntry,/publicMasterplanResponse/);
  assert.match(server,/project_kind='masterplan_geo'/);
  assert.match(server,/assertDraftAssetKey/);
  assert.doesNotMatch(api,/rekixo-ar3d-platform/);
});
