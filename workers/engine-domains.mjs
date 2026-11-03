// Optional owner-controlled domains; canonical AR3D links are never removed.
const json=(body,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"no-store"}});
const validHost=value=>typeof value==="string"&&value.length<254&&
 /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(value)&&
 !value.split(".").some(part=>!part||part.length>63||part.startsWith("-")||part.endsWith("-"))&&
 !["ar3dstudio.in","admin.rekixo.com","rekixo.com"].includes(value)&&
 !/(?:\.local|\.internal|\.test|\.invalid|\.workers\.dev)$/.test(value);
const normalize=x=>String(x||"").trim().toLowerCase().replace(/\.$/,"");
const challenge=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)))
 .map(x=>x.toString(16).padStart(2,"0")).join("");
async function state(env,project){
 const result=await env.DB.prepare(`SELECT hostname,status,verified_at AS verifiedAt
 FROM engine_project_domains_3d WHERE project_id=? ORDER BY created_at DESC`)
 .bind(project.id).all();
 const base="https://ar3dstudio.in/3Dprojects/"+encodeURIComponent(project.slug);
 return {fallbackWebsite:base,fallbackAdmin:base+"/client-admin",
 domains:(result.results||[]).map(d=>({...d,
  website:"https://"+d.hostname+"/",admin:"https://"+d.hostname+"/admin"}))};
}
export async function handleEngineDomainsAdmin(req,env,actor,project){
 if(req.method==="GET")return json(await state(env,project));
 if(!["POST","DELETE"].includes(req.method))return json({error:"Method not allowed."},405);
 try{
  if(new URL(req.headers.get("origin")||"").origin!==new URL(req.url).origin)
   return json({error:"Same-origin request required."},403);
 }catch{return json({error:"Same-origin request required."},403);}
 if(project.status==="archived")return json({error:"Archived project."},409);
 const raw=await req.text();
 if(raw.length>1000)return json({error:"Request too large."},413);
 let body;try{body=JSON.parse(raw);}catch{return json({error:"Malformed request."},400);}
 const host=normalize(body?.hostname);
 if(!validHost(host))return json({error:"Enter the customer hostname only (without https://)."},400);
 const time=new Date().toISOString();
 const audit=(action)=>env.DB.prepare(`INSERT INTO engine_admin_audit
 (id,actor_email,action,project_id,target_id,details_json,created_at)
 VALUES (?,?,?,?,?,'{}',?)`).bind(crypto.randomUUID(),actor.email,action,project.id,host,time);
 try{
  const old=await env.DB.prepare("SELECT project_id,status,challenge FROM engine_project_domains_3d WHERE hostname=?")
   .bind(host).first();
  if(old&&old.project_id!==project.id)return json({error:"Hostname is registered for another project."},409);
  if(req.method==="DELETE"){
   if(!old)return json({error:"Domain not found."},404);
   await env.DB.batch([env.DB.prepare(`UPDATE engine_project_domains_3d
    SET status='disabled',updated_at=? WHERE hostname=? AND project_id=?`)
    .bind(time,host,project.id),audit("project.domain_disabled")]);
   return json(await state(env,project));
  }
  if(body.action==="add"){
   if(old&&old.status!=="disabled")return json({error:"Domain is already registered."},409);
   const limit=await env.DB.prepare(`SELECT count(*) AS total FROM engine_project_domains_3d
    WHERE project_id=? AND status!='disabled'`).bind(project.id).first();
   if(Number(limit?.total||0)>=3)return json({error:"Three domains per project maximum."},409);
   const token=challenge();
   await env.DB.batch([
    env.DB.prepare(`INSERT INTO engine_project_domains_3d
     (hostname,project_id,status,challenge,created_at,updated_at)
     VALUES (?,?,'pending',?,?,?) ON CONFLICT(hostname) DO UPDATE SET
     status='pending',challenge=excluded.challenge,verified_at=NULL,updated_at=excluded.updated_at
     WHERE engine_project_domains_3d.project_id=excluded.project_id`)
     .bind(host,project.id,token,time,time),audit("project.domain_registered")]);
   return json({...await state(env,project),notice:
     "Saved as Pending. Attach this hostname to Cloudflare Worker rekixo-3d-public, finish DNS/SSL, then Verify."});
  }
  if(body.action==="verify"){
   if(!old||old.status==="disabled")return json({error:"Register the hostname first."},404);
   const proof=await fetch("https://"+host+"/3Dprojects/api/domain-proof/"+old.challenge,{redirect:"manual"});
   const data=proof.ok?await proof.json().catch(()=>null):null;
   if(!proof.ok||data?.type!=="ar3d-domain-proof"||data?.projectId!==project.id||
      data?.hostname!==host||data?.challenge!==old.challenge)
    return json({error:"Cloudflare domain, DNS or SSL not ready. Verify after setup."},409);
   await env.DB.batch([
    env.DB.prepare(`UPDATE engine_project_domains_3d SET status='active',
      verified_at=?,updated_at=? WHERE hostname=? AND project_id=?`)
      .bind(time,time,host,project.id),audit("project.domain_activated")]);
   return json({...await state(env,project),notice:"Domain verified and active."});
  }
  return json({error:"Unsupported action."},400);
 }catch(e){return json({error:e instanceof Error?e.message:"Domain update failed."},409);}
}
