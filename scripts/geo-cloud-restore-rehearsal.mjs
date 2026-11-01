// Fully OFFLINE D1 + downloaded project R2 bytes integrity rehearsal.
// Never connects to, overwrites or activates any Cloudflare resource.
import {existsSync,mkdirSync,readFileSync,statSync} from "node:fs";
import {resolve,join,sep} from "node:path";
import {pathToFileURL} from "node:url";
import {DatabaseSync} from "node:sqlite";
import {createHash} from "node:crypto";
import {shaFile,geoBackupPlan} from "./geo-cloud-backup.mjs";
const sha=x=>createHash("sha256").update(x).digest("hex");
const guard=(ok,text)=>{if(!ok)throw Error("Offline restore integrity: "+text);};
export async function verifyFullGeoCloudArchive(folder){
 const root=resolve(folder),manifest=JSON.parse(readFileSync(join(root,"geo-manifest.json"),"utf8"));
 const index=JSON.parse(readFileSync(join(root,"backup-index.json"),"utf8"));
 const plan=geoBackupPlan(manifest);
 guard(index.schema==="rekixo-full-geo-backup-index-v1"&&
  index.status==="D1_EXPORT_AND_ALL_PROJECT_R2_OBJECT_BYTES_VERIFIED",
  "archive index is not marked complete");
 guard(plan.manifestSha256===index.sourceManifestSha256&&
  plan.projectSlug===index.projectSlug,"archive does not match approved source manifest");
 guard(index.completeObjectCount===plan.objects.length&&
   index.r2?.length===plan.objects.length,"project R2 byte set is incomplete");
 guard(index.d1?.file==="d1-export.sql","full D1 export is required");
 const d1=join(root,index.d1.file);
 guard(existsSync(d1)&&statSync(d1).size===index.d1.size&&
  await shaFile(d1)===index.d1.sha256,"full D1 bytes checksum failed");
 const expected=new Map(plan.objects.map(x=>[x.key,x]));
 for(const object of index.r2){
  const spec=expected.get(object.key);
  guard(spec&&object.file==="r2/"+object.key,"foreign or mismatched R2 object");
  const name=resolve(root,object.file);
  guard(name.startsWith(root+sep)&&existsSync(name),"R2 file escapes archive or missing");
  guard(object.size===spec.size&&statSync(name).size===spec.size,"R2 byte count changed");
  const checksum=await shaFile(name);
  guard(checksum===object.sha256&&(!spec.knownSha256||
    checksum===spec.knownSha256),"R2 SHA-256 mismatch for "+object.key);
  expected.delete(object.key);
 }
 guard(expected.size===0,"missing indexed project R2 bytes");
 return {archiveRoot:root,projectSlug:plan.projectSlug,objectCount:index.r2.length,
   d1Path:d1,sourceManifest:manifest};
}
export async function rehearseFullGeoRestore(folder,sqliteTarget){
 const check=await verifyFullGeoCloudArchive(folder);
 const file=resolve(sqliteTarget);
 guard(file.endsWith(".sqlite")&&!existsSync(file),
  "restore MUST target a fresh nonexistent local .sqlite file");
 mkdirSync(resolve(file,".."),{recursive:true});
 const db=new DatabaseSync(file);
 try{
  db.exec(readFileSync(check.d1Path,"utf8"));
  const id=check.sourceManifest.payload.project.id;
  const current=db.prepare(
   "SELECT id,slug FROM projects_3d WHERE id=?"
  ).get(id);
  guard(current?.slug===check.projectSlug,
   "D1 exported project identity does not match recovery manifest");
  for(const saved of check.sourceManifest.payload.mappingReleases){
   const row=db.prepare(
    "SELECT plots_json,sha256,project_id FROM geo_plot_mapping_releases_3d WHERE id=?"
   ).get(saved.id);
   guard(row?.project_id===id&&row.sha256===saved.sha256&&
    sha(row.plots_json)===saved.sha256,"immutable Geo mapping changed in exported D1");
  }
  const active=check.sourceManifest.payload.activeMapping;
  if(active){
   const fromDb=db.prepare(
    "SELECT mapping_release_id FROM geo_plot_mapping_active_3d WHERE project_id=?"
   ).get(id);
   guard(fromDb?.mapping_release_id===active.mapping_release_id,
    "active Geo mapping shifted while exporting D1/R2");
  }
  return {schema:"rekixo-full-geo-isolated-restore-test-v1",
   projectSlug:check.projectSlug,isolatedSqlite:file,
   d1Restored:true,r2BytesVerified:check.objectCount,
   immutableReleaseCount:check.sourceManifest.payload.mappingReleases.length,
   productionChanged:false};
 }finally{db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [,,folder,database]=process.argv;
 if(!folder||!database)throw Error("Usage: node scripts/geo-cloud-restore-rehearsal.mjs full-backup-folder /tmp/new-isolated.sqlite");
 const result=await rehearseFullGeoRestore(folder,database);
 process.stdout.write(JSON.stringify(result,null,2)+"\n");
}
