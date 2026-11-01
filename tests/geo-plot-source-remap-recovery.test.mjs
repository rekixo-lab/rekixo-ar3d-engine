import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtempSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {geoSourceChangePlan,stageSelectedGeoSourceRemap} from "../shared/geo-plot-source-remap.js";
import {verifyGeoRecoveryManifest,restoreGeoManifestIntoIsolatedSQLite} from "../scripts/geo-restore-isolated.mjs";
const sha=x=>createHash("sha256").update(x).digest("hex");
const alignment=(kind)=>{
 const newer=kind==="new",a=newer?8:10,tx=newer?1:0,tz=newer?3:0;
 const anchors=[[0,0],[.5,0],[0,1],[.5,1]].map(([u,v],i)=>({
   id:"A"+i,u,v,x:tx+2*u*a,z:tz+v*a,evidence:"Survey p5"
 }));
 const checkpoints=[[.2,.1],[.8,.8]].map(([u,v],i)=>({
   id:"C"+i,u,v,x:tx+2*u*a,z:tz+v*a,evidence:"Independent survey p9"
 }));
 return {imageAssetId:"source-img",imageSha256:"a".repeat(64),
   imageWidth:200,imageHeight:100,geoReleaseId:newer?"geo-new":"geo-old",
   buildingReleaseId:newer?"building-new":"building-old",
   modelSha256:(newer?"c":"b").repeat(64),anchors,checkpoints};
};
const plot=(id,corners)=>({id,corners,layout:"four",area:{
 value:100,unit:"sqm",source:"Signed plot survey p5",verified:true},
 sides:Object.fromEntries(["front","depthA","back","depthB"].map((r,i)=>[r,{
   edges:[i],length:10,unit:"m",source:"Signed plot survey p5",
   verified:true,roadFacing:r==="front"}])),
 facing:"east",facingSource:"Signed north",facingVerified:true,
 planeY:0,planeSource:"Old model datum",planeVerified:true,road:"Road",notes:"approved"});
test("Source switch preflight estimates every changed model corner but stages only selected canonical IDs",()=>{
 const one=plot("1",[[0,0],[10,0],[10,10],[0,10]]);
 const two=plot("2",[[10,0],[20,0],[20,10],[10,10]]);
 const p=geoSourceChangePlan([one,two],alignment("old"),alignment("new"),["1"]);
 assert.equal(p.selectedCount,1);
 assert.deepEqual(p.unreviewedIds,["2"]);
 assert.deepEqual(p.rows[0].proposedCorners,[[1,3],[9,3],[9,11],[1,11]]);
 const output=stageSelectedGeoSourceRemap([one,two],alignment("old"),alignment("new"),["1"]);
 assert.deepEqual(output.plots[0].corners,p.rows[0].proposedCorners);
 assert.equal(output.plots[0].area.verified,false);
 assert.equal(output.plots[0].sides.front.roadFacing,false);
 assert.equal(output.plots[0].planeY,undefined);
 assert.deepEqual(output.plots[1],two);
 assert.equal(one.planeVerified,true,"source immutable plot untouched");
});
test("Source switch fails closed on different image, unverified checkpoints, bad IDs and conflicting remap",()=>{
 const original=plot("1",[[0,0],[10,0],[10,10],[0,10]]);
 const next=alignment("new");
 assert.throws(()=>geoSourceChangePlan([original],alignment("old"),
   {...next,imageSha256:"f".repeat(64)},["1"]),/Different original image checksum/);
 assert.throws(()=>geoSourceChangePlan([original],alignment("old"),
   {...next,checkpoints:[]},["1"]),/independently verified|Independent|checkpoints/i);
 assert.throws(()=>stageSelectedGeoSourceRemap([original],alignment("old"),next,[]),/Select plot IDs/);
 assert.throws(()=>geoSourceChangePlan([original],alignment("old"),next,["2"]),/existing/);
 const duplicate=plot("2",[[3,0],[13,0],[13,10],[3,10]]);
 assert.throws(()=>stageSelectedGeoSourceRemap([original,duplicate],alignment("old"),
   next,["1"]),/overlap/i);
});
function fixture(){
 const sealed=JSON.stringify([plot("1",[[0,0],[10,0],[10,10],[0,10]])]);
 const projectId="project-1",releaseId="geo-release-map-v1";
 const payload={
  project:{id:projectId,slug:"test-site",projectKind:"legacy",status:"published"},
  activeGeo:{experienceId:"experience-1",geoReleaseId:"geo-release-v1",buildingReleaseId:"building-v1"},
  draft:{project_id:projectId,revision:4,plots_json:sealed},
  inventory:{project_id:projectId,revision:3,rows_json:"[]"},
  alignment:null,
  activeMapping:{project_id:projectId,mapping_release_id:releaseId},
  mappingReleases:[{id:releaseId,project_id:projectId,sha256:sha(sealed),plots_json:sealed,version:1}],
  geoReleases:[{id:"geo-release-v1",source_building_release_id:"building-v1"}],
  assets:[{id:"asset-1",r2_key:"projects/project-1/image.png",
    sha256:"e".repeat(64),byte_size:254,kind:"reference",mime_type:"image/png"}]
 };
 return {schema:"rekixo-geo-project-recovery-manifest-v1",
 completeness:"METADATA_AND_R2_REFERENCES_ONLY",sha256:sha(JSON.stringify(payload)),payload};
}
test("Metadata-only manifest has verified immutable releases and restores to an isolated SQLite file",()=>{
 const pkg=fixture();
 assert.deepEqual(verifyGeoRecoveryManifest(pkg),{
   projectSlug:"test-site",releaseCount:1,assetRefs:1,r2BytesIncluded:false,productionRestorable:false});
 const directory=mkdtempSync(join(tmpdir(),"geo-restore-"));
 try{
   const file=join(directory,"offline.sqlite");
   assert.equal(restoreGeoManifestIntoIsolatedSQLite(pkg,file).isolatedRestored,true);
   const db=new DatabaseSync(file);
   try{
     assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sealed_releases").get().count,1);
     assert.equal(db.prepare("SELECT COUNT(*) AS count FROM r2_references").get().count,1);
     assert.equal(db.prepare("SELECT slug FROM manifest").get().slug,"test-site");
   }finally{db.close();}
   assert.throws(()=>restoreGeoManifestIntoIsolatedSQLite(pkg,file),/overwrite/);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
test("Recovery manifest rejects tampering, cross-project releases and fake R2 byte coverage",()=>{
 const original=fixture();
 for(const update of [
   p=>{p.sha256="f".repeat(64)},
   p=>{p.payload.mappingReleases[0].sha256="f".repeat(64);p.sha256=sha(JSON.stringify(p.payload));},
   p=>{p.payload.draft.project_id="another-project";p.sha256=sha(JSON.stringify(p.payload));},
   p=>{p.completeness="FULL_R2_BYTES_INCLUDED";}
 ]){const pkg=structuredClone(original);update(pkg);
   assert.throws(()=>verifyGeoRecoveryManifest(pkg),/verification/);
 }
});
test("Recovery and source-rebind operations are always owner-scoped, revision-gated and never write published releases",()=>{
 const mapper=readFileSync(new URL("../workers/geo-plot-mapping.mjs",import.meta.url),"utf8");
 const recovery=readFileSync(new URL("../workers/geo-plot-recovery.mjs",import.meta.url),"utf8");
 assert.match(mapper,/engineAdminReadAccess\(request,env\)/);
 assert.match(mapper,/approvedSourceRemapPlan/);
 assert.match(mapper,/expectedPreflightToken!==preflight.token/);
 assert.match(mapper,/REM A P SOURCE|REMAP SOURCE/);
 assert.match(mapper,/geo_release_id=\?,building_release_id=\?,revision=revision\+1/);
 assert.match(mapper,/verified_revision=NULL,verified_inventory_revision=NULL,verified_alignment_revision=NULL/);
 assert.match(recovery,/await sha256\(row.plots_json\)!==row.sha256/);
 assert.match(recovery,/METADATA_AND_R2_REFERENCES_ONLY/);
 assert.doesNotMatch(recovery,/UPDATE .*geo_plot_mapping_releases|DELETE FROM/);
});
