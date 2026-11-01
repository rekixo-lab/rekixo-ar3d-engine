// Operator-run full remote D1 + project-owned R2 bytes archive.
// No uploads/deletions. NEVER run against a real environment without authorization.
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {createReadStream,existsSync,mkdirSync,readFileSync,statSync,writeFileSync} from "node:fs";
import {resolve,join,dirname,sep} from "node:path";
import {pathToFileURL} from "node:url";
import {verifyGeoRecoveryManifest} from "./geo-restore-isolated.mjs";
const hash=x=>createHash("sha256").update(x).digest("hex");
export async function shaFile(path){
 return new Promise((resolveHash,reject)=>{
  const h=createHash("sha256"),stream=createReadStream(path);
  stream.on("data",data=>h.update(data));
  stream.on("error",reject);
  stream.on("end",()=>resolveHash(h.digest("hex")));
 });
}
export function geoBackupPlan(manifest){
 verifyGeoRecoveryManifest(manifest);
 const objects=manifest.payload.r2Objects;
 if(!Array.isArray(objects))throw Error("Full project R2 object index is required for a complete backup.");
 const prefix="projects/"+manifest.projectSlug+"/";
 if(objects.length>10000)throw Error("Project exceeds operator backup object limit.");
 const paths=new Set();
 for(const x of objects){
  if(typeof x.key!=="string"||!x.key.startsWith(prefix)||
     x.key.includes("\\")||x.key.split("/").some(part=>!part||part==="."||part===".."))
   throw Error("Invalid R2 object or escaped project storage boundary.");
  if(paths.has(x.key))throw Error("Duplicated R2 object in recovery manifest.");
  paths.add(x.key);
  if(!Number.isSafeInteger(x.size)||x.size<0||x.size>21474836480)
   throw Error("R2 object exceeds safe backup bounds.");
  if(x.knownSha256!==null&&x.knownSha256!==undefined&&
     !/^[a-f0-9]{64}$/i.test(x.knownSha256))
   throw Error("Invalid known R2 SHA256.");
 }
 for(const a of manifest.payload.assets)if(!paths.has(a.r2_key))
  throw Error("Referenced studio asset absent from complete R2 object index.");
 return {schema:"rekixo-full-geo-backup-plan-v1",
   projectSlug:manifest.projectSlug,manifestSha256:manifest.sha256,
   objects:objects.map(x=>({
    key:x.key,size:x.size,knownSha256:x.knownSha256||null
   })).sort((a,b)=>a.key.localeCompare(b.key))};
}
function execWrangler(args){
 const command=process.platform==="win32"?"npx.cmd":"npx";
 const p=spawnSync(command,["--no-install","wrangler",...args],{
  encoding:"utf8",timeout:600000,maxBuffer:2*1024*1024,
  stdio:["ignore","pipe","pipe"]
 });
 if(p.error||p.status!==0)
  throw Error("Wrangler read-only export failed: "+args.slice(0,3).join(" ")+"; "+
   (p.stderr||p.error?.message||"nonzero exit").slice(0,800));
}
export async function exportRemoteGeoDemoBackup(manifest,folder){
 const plan=geoBackupPlan(manifest);
 const output=resolve(folder);
 if(existsSync(output))throw Error("Refusing to overwrite existing archive directory.");
 mkdirSync(output,{recursive:true,mode:0o700});
 const root=join(output,"r2");
 const d1=join(output,"d1-export.sql");
 const index={schema:"rekixo-full-geo-backup-index-v1",
  createdAt:new Date().toISOString(),projectSlug:plan.projectSlug,
  sourceManifestSha256:plan.manifestSha256,d1:null,r2:[],
  limitations:["Cloudflare credentials are never stored in this archive.",
   "For point-in-time consistency, stop all writes during both exports.",
   "Test isolated restore before accepting the archive."]};
 writeFileSync(join(output,"geo-manifest.json"),JSON.stringify(manifest,null,2),{mode:0o600});
 execWrangler(["d1","export","rekixo-3d-production","--remote",
   "--config","wrangler.admin.jsonc","--output="+d1]);
 index.d1={file:"d1-export.sql",sha256:await shaFile(d1),size:statSync(d1).size};
 for(const row of plan.objects){
  const target=resolve(root,row.key);
  if(!target.startsWith(resolve(root)+sep))throw Error("Unsafe R2 destination.");
  mkdirSync(dirname(target),{recursive:true,mode:0o700});
  execWrangler(["r2","object","get","rekixo-3d-assets/"+row.key,
    "--remote","--config","wrangler.admin.jsonc","--file",target]);
  const size=statSync(target).size,sha256=await shaFile(target);
  if(size!==row.size||row.knownSha256&&sha256!==row.knownSha256)
   throw Error("R2 bytes failed immutable size/hash review for "+row.key);
  index.r2.push({key:row.key,file:"r2/"+row.key,sha256,size});
 }
 index.status="D1_EXPORT_AND_ALL_PROJECT_R2_OBJECT_BYTES_VERIFIED";
 index.completeObjectCount=index.r2.length;
 writeFileSync(join(output,"backup-index.json"),JSON.stringify(index,null,2),{mode:0o600});
 return {path:output,objects:index.completeObjectCount,d1Sha256:index.d1.sha256};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [,,source,output]=process.argv;
 if(!source||!output)throw Error("Usage: node scripts/geo-cloud-backup.mjs geo-manifest.json /encrypted/empty-backup-folder");
 const manifest=JSON.parse(readFileSync(source,"utf8"));
 const result=await exportRemoteGeoDemoBackup(manifest,output);
 process.stdout.write(JSON.stringify(result,null,2)+"\n");
}
