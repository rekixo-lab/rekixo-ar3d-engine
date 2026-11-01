import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {geoBackupPlan} from "../scripts/geo-cloud-backup.mjs";
import {verifyFullGeoCloudArchive,rehearseFullGeoRestore} from "../scripts/geo-cloud-restore-rehearsal.mjs";
const sha=value=>createHash("sha256").update(value).digest("hex");
const key="projects/test-site/draft-assets/asset1";
function fixture(){
 const sealed=JSON.stringify([{id:"1",corners:[[0,0],[1,0],[1,1],[0,1]]}]);
 const payload={project:{id:"test-project",slug:"test-site",projectKind:"legacy",status:"published"},
  activeGeo:{experienceId:"experience-1",geoReleaseId:"geo-1",buildingReleaseId:"building-1"},
  draft:null,inventory:null,alignment:null,
  activeMapping:{project_id:"test-project",mapping_release_id:"map-1"},
  mappingReleases:[{id:"map-1",project_id:"test-project",sha256:sha(sealed),plots_json:sealed}],
  geoReleases:[{id:"geo-1",source_building_release_id:"building-1"}],
  assets:[{id:"asset1",r2_key:key,sha256:sha("REAL-FILE"),byte_size:9,
   kind:"image",mime_type:"image/png"}],
  r2Objects:[{key,size:9,etag:"etag-v1",knownSha256:sha("REAL-FILE")}]};
 return {schema:"rekixo-geo-project-recovery-manifest-v1",completeness:"METADATA_AND_R2_REFERENCES_ONLY",
  projectSlug:"test-site",sha256:sha(JSON.stringify(payload)),payload};
}
const exportedD1=()=>`CREATE TABLE projects_3d(id TEXT PRIMARY KEY,slug TEXT);
CREATE TABLE geo_plot_mapping_releases_3d(id TEXT PRIMARY KEY,project_id TEXT,plots_json TEXT,sha256 TEXT);
CREATE TABLE geo_plot_mapping_active_3d(project_id TEXT PRIMARY KEY,mapping_release_id TEXT);
INSERT INTO projects_3d VALUES('test-project','test-site');
INSERT INTO geo_plot_mapping_releases_3d VALUES('map-1','test-project',
 '${JSON.stringify([{id:"1",corners:[[0,0],[1,0],[1,1],[0,1]]}]).replaceAll("'","''")}',
 '${sha(JSON.stringify([{id:"1",corners:[[0,0],[1,0],[1,1],[0,1]]}]))}');
INSERT INTO geo_plot_mapping_active_3d VALUES('test-project','map-1');`;
test("Cloud backup plan lists ALL project bytes and rejects path escapes and missing R2",()=>{
 const original=fixture();
 assert.equal(geoBackupPlan(original).objects.length,1);
 const malicious=structuredClone(original);
 malicious.payload.r2Objects[0].key="projects/test-site/../../other/asset";
 malicious.sha256=sha(JSON.stringify(malicious.payload));
 assert.throws(()=>geoBackupPlan(malicious),/escaped|invalid/i);
 const missing=structuredClone(original);
 missing.payload.r2Objects=[];
 missing.sha256=sha(JSON.stringify(missing.payload));
 assert.throws(()=>geoBackupPlan(missing),/absent|missing/i);
});
test("Full D1+R2 offline restore verifies all project bytes, immutable releases, and source binding",async()=>{
 const manifest=fixture();
 const root=mkdtempSync(join(tmpdir(),"rekixo-geo-cloud-"));
 try{
  const dir=join(root,"backup"),target=join(root,"isolated.sqlite");
  mkdirSync(join(dir,"r2","projects","test-site","draft-assets"),{recursive:true});
  const sql=exportedD1();
  writeFileSync(join(dir,"geo-manifest.json"),JSON.stringify(manifest));
  writeFileSync(join(dir,"d1-export.sql"),sql);
  writeFileSync(join(dir,"r2",key),"REAL-FILE");
  writeFileSync(join(dir,"backup-index.json"),JSON.stringify({
    schema:"rekixo-full-geo-backup-index-v1",
    status:"D1_EXPORT_AND_ALL_PROJECT_R2_OBJECT_BYTES_VERIFIED",
    projectSlug:"test-site",sourceManifestSha256:manifest.sha256,
    d1:{file:"d1-export.sql",sha256:sha(sql),size:Buffer.byteLength(sql)},
    r2:[{file:"r2/"+key,key,size:9,sha256:sha("REAL-FILE")}],
    completeObjectCount:1
  }));
  assert.equal((await verifyFullGeoCloudArchive(dir)).objectCount,1);
  const result=await rehearseFullGeoRestore(dir,target);
  assert.equal(result.d1Restored,true);
  assert.equal(result.r2BytesVerified,1);
  const db=new DatabaseSync(target);
  assert.equal(db.prepare("SELECT slug FROM projects_3d").get().slug,"test-site");
  db.close();
  assert.rejects(()=>rehearseFullGeoRestore(dir,target),/fresh nonexistent/);
  writeFileSync(join(dir,"r2",key),"TAMPERED!");
  assert.rejects(()=>verifyFullGeoCloudArchive(dir),/SHA|byte count|R2/i);
 }finally{rmSync(root,{recursive:true,force:true});}
});
