// An isolated rehearsal for the owner-private Geo recovery manifest.
// Intentionally NEVER connects to remote D1, Cloudflare APIs, R2 or production.
// The resulting SQLite file is an offline inspection copy, not a live DB dump.
import {createHash} from "node:crypto";
import {readFileSync,existsSync,mkdirSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {pathToFileURL} from "node:url";
import {DatabaseSync} from "node:sqlite";
const sha=x=>createHash("sha256").update(x).digest("hex");
function assert(ok,message){if(!ok)throw Error("Geo recovery verification: "+message);}
export function verifyGeoRecoveryManifest(manifest){
  assert(manifest?.schema==="rekixo-geo-project-recovery-manifest-v1","unsupported recovery schema");
  assert(manifest.completeness==="METADATA_AND_R2_REFERENCES_ONLY",
    "manifest must not falsely claim verified R2 payload bytes");
  const data=manifest.payload;
  assert(data?.project?.id&&data?.project?.slug&&data.activeGeo?.geoReleaseId,
    "project ownership and active Geo release are required");
  assert(sha(JSON.stringify(data))===manifest.sha256,"manifest envelope checksum mismatch");
  assert(Array.isArray(data.mappingReleases)&&Array.isArray(data.assets),"release and R2 reference lists required");
  assert(data.mappingReleases.length<=200&&data.assets.length<=2500,
    "recovery manifest exceeds authenticated export scope limits");
  const ids=new Set();
  for(const release of data.mappingReleases){
    assert(release.project_id===data.project.id,"cross-project mapping release");
    assert(!ids.has(release.id),"duplicate mapping release ID");
    ids.add(release.id);
    assert(sha(release.plots_json)===release.sha256,"sealed release checksum mismatch: "+release.id);
    const plots=JSON.parse(release.plots_json);
    assert(Array.isArray(plots)&&plots.length<=2500,"invalid immutable release plot collection");
    const seen=new Set();
    for(const p of plots){
      const key=String(p.id||"").toLowerCase();
      assert(key&&!seen.has(key),"duplicate canonical Plot ID in sealed release");
      seen.add(key);
    }
  }
  if(data.activeMapping){
    assert(data.activeMapping.project_id===data.project.id,"active release belongs to another project");
    assert(ids.has(data.activeMapping.mapping_release_id),
      "active mapping release is missing from backed-up history");
  }
  const assets=new Set();
  for(const asset of data.assets){
    assert(typeof asset.id==="string"&&!assets.has(asset.id),"duplicate R2 reference");
    assets.add(asset.id);
    assert(typeof asset.r2_key==="string"&&asset.r2_key.length>0,
      "R2 storage key missing");
    assert(typeof asset.sha256==="string"&&/^[a-f0-9]{64}$/i.test(asset.sha256),
      "R2 checksum missing or malformed");
  }
  for(const field of ["draft","inventory","alignment"]){
    const record=data[field];
    if(record)assert(record.project_id===data.project.id,
      field+" record belongs to another project");
  }
  return {projectSlug:data.project.slug,releaseCount:ids.size,assetRefs:assets.size,
    r2BytesIncluded:false,productionRestorable:false};
}
export function restoreGeoManifestIntoIsolatedSQLite(manifest,databasePath){
  const verified=verifyGeoRecoveryManifest(manifest);
  const output=resolve(databasePath);
  assert(output.endsWith(".sqlite"),"offline rehearsal path must end in .sqlite");
  assert(!existsSync(output),"refusing to overwrite an existing SQLite file");
  mkdirSync(dirname(output),{recursive:true});
  const db=new DatabaseSync(output);
  try{
    db.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE manifest(project_id TEXT PRIMARY KEY,slug TEXT NOT NULL,
        geo_release_id TEXT NOT NULL,manifest_sha256 TEXT NOT NULL,scope TEXT NOT NULL);
      CREATE TABLE recovery_rows(kind TEXT NOT NULL,id TEXT NOT NULL,
        project_id TEXT NOT NULL,payload_json TEXT NOT NULL,
        PRIMARY KEY(kind,id));
      CREATE TABLE sealed_releases(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,
        checksum TEXT NOT NULL,plots_json TEXT NOT NULL);
      CREATE TABLE r2_references(id TEXT PRIMARY KEY,key TEXT NOT NULL,
        sha256 TEXT NOT NULL,byte_size INTEGER);`);
    db.exec("BEGIN IMMEDIATE");
    const data=manifest.payload;
    db.prepare("INSERT INTO manifest VALUES(?,?,?,?,?)").run(data.project.id,
      data.project.slug,data.activeGeo.geoReleaseId,manifest.sha256,manifest.completeness);
    const row=db.prepare("INSERT INTO recovery_rows VALUES(?,?,?,?)");
    for(const kind of ["draft","inventory","alignment","activeMapping"]){
      const value=data[kind];
      if(value)row.run(kind,value.id||data.project.id,data.project.id,JSON.stringify(value));
    }
    const release=db.prepare("INSERT INTO sealed_releases VALUES(?,?,?,?)");
    for(const v of data.mappingReleases)release.run(v.id,data.project.id,v.sha256,v.plots_json);
    const ref=db.prepare("INSERT INTO r2_references VALUES(?,?,?,?)");
    for(const v of data.assets)ref.run(v.id,v.r2_key,v.sha256,v.byte_size||null);
    db.exec("COMMIT");
    const found=db.prepare("SELECT COUNT(*) AS n FROM sealed_releases").get();
    assert(Number(found.n)===verified.releaseCount,"isolated restore lost a sealed release");
    for(const value of db.prepare("SELECT checksum,plots_json FROM sealed_releases").all())
      assert(sha(value.plots_json)===value.checksum,"rehearsal checksum changed");
    return {...verified,output,isolatedRestored:true};
  }catch(error){try{db.exec("ROLLBACK");}catch{}throw error;}
  finally{db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const [,,input,output]=process.argv;
  if(!input)throw Error("Usage: node scripts/geo-restore-isolated.mjs manifest.json [isolated.sqlite]");
  const manifest=JSON.parse(readFileSync(input,"utf8"));
  const result=output?restoreGeoManifestIntoIsolatedSQLite(manifest,output):
    verifyGeoRecoveryManifest(manifest);
  process.stdout.write(JSON.stringify(result,null,2)+"\n");
}
