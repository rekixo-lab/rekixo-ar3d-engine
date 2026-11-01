// Dedicated least-privilege client portal. It does NOT reuse the owner session,
// general cloud-admin endpoints or masterplan payment/buyer APIs.
import {clientTokenHash,newClientBearer,validClientBearer} from "./project-client-access.mjs";
import {canProjectClient} from "../shared/project-client-roles.js";
import {handleGeoPlotCommercial} from "./geo-plot-commercial.mjs";
import {validProjectSlug} from "../shared/project-slug-policy.js";
const PREFIX="/3Dprojects/api/client-portal";
const COOKIE="rekixo_3d_project_client";
const SESSION_MS=8*60*60*1000;
const response=(body,status=200,headers={})=>Response.json(body,{status,headers:{
 "Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer",...headers}});
const clear=()=>COOKIE+"=; Path=/3Dprojects; HttpOnly; Secure; SameSite=Strict; Max-Age=0";
const issue=token=>COOKIE+"="+token+"; Path=/3Dprojects; HttpOnly; Secure; SameSite=Strict; Max-Age="+Math.floor(SESSION_MS/1000);
const sameOrigin=request=>{
 try{return new URL(request.headers.get("Origin")||"").origin===new URL(request.url).origin;}
 catch{return false;}
};
const bearer=request=>{
 const value=(request.headers.get("Cookie")||"").split(";")
 .map(s=>s.trim()).find(s=>s.startsWith(COOKIE+"="));
 return value?value.slice(COOKIE.length+1):"";
};
export async function projectClientSession(request,env){
 const token=bearer(request);
 if(!validClientBearer(token))return null;
 const now=Date.now(),hash=await clientTokenHash(token);
 const s=await env.DB.prepare(
  "SELECT s.project_id AS projectId,s.client_id AS clientId,g.role,c.email,c.display_name AS displayName,p.slug,p.name AS projectName,p.status AS projectStatus "+
  "FROM project_client_sessions_3d s JOIN project_client_grants_3d g ON g.client_id=s.client_id AND g.project_id=s.project_id "+
  "JOIN project_client_directory_3d c ON c.id=s.client_id AND c.project_id=s.project_id "+
  "JOIN projects_3d p ON p.id=s.project_id "+
  "WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? "+
  "AND g.active=1 AND g.epoch=s.grant_epoch AND c.access_state='not_provisioned' LIMIT 1"
 ).bind(hash,now).first();
 return s||null;
}
async function enroll(request,env){
 if(request.method!=="POST")return response({error:"Method not allowed."},405);
 if(!sameOrigin(request))return response({error:"Same-origin request required."},403);
 if(new URL(request.url).protocol!=="https:")return response({error:"HTTPS required."},403);
 const raw=await request.text();
 if(raw.length>512)return response({error:"Invitation request too large."},413);
 let data;try{data=JSON.parse(raw);}catch{return response({error:"Invalid invitation request."},400);}
 const token=data?.token,email=String(data?.email||"").trim().toLowerCase();
 if(!validClientBearer(token)||!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))
  return response({error:"Invalid or expired project invitation."},401);
 const hash=await clientTokenHash(token),now=Date.now(),sessionToken=newClientBearer();
 const sessionHash=await clientTokenHash(sessionToken),nonce=crypto.randomUUID();
 const invitation=await env.DB.prepare(
  "SELECT i.client_id AS clientId,i.project_id AS projectId,i.grant_epoch AS epoch,c.email,g.role "+
  "FROM project_client_invitations_3d i JOIN project_client_directory_3d c ON c.id=i.client_id AND c.project_id=i.project_id "+
  "JOIN project_client_grants_3d g ON g.client_id=i.client_id AND g.project_id=i.project_id "+
  "JOIN projects_3d p ON p.id=i.project_id "+
  "WHERE i.token_hash=? AND i.redeemed_nonce IS NULL AND i.expires_at>? "+
  "AND g.active=1 AND g.epoch=i.grant_epoch AND c.access_state='not_provisioned' "+
  "AND p.status<>'archived' LIMIT 1"
 ).bind(hash,now).first();
 if(!invitation||invitation.email.toLowerCase()!==email)
  return response({error:"Invalid or expired project invitation."},401);
 const results=await env.DB.batch([
  env.DB.prepare(
   "UPDATE project_client_invitations_3d SET redeemed_nonce=? WHERE token_hash=? "+
   "AND redeemed_nonce IS NULL AND expires_at>? AND grant_epoch=?"
  ).bind(nonce,hash,now,invitation.epoch),
  env.DB.prepare(
   "INSERT INTO project_client_sessions_3d(token_hash,client_id,project_id,grant_epoch,created_at,expires_at) "+
   "SELECT ?,i.client_id,i.project_id,i.grant_epoch,?,? FROM project_client_invitations_3d i "+
   "JOIN project_client_grants_3d g ON g.client_id=i.client_id AND g.project_id=i.project_id "+
   "JOIN project_client_directory_3d c ON c.id=i.client_id AND c.project_id=i.project_id "+
   "WHERE i.token_hash=? AND i.redeemed_nonce=? AND i.grant_epoch=g.epoch "+
   "AND g.active=1 AND c.access_state='not_provisioned'"
  ).bind(sessionHash,now,now+SESSION_MS,hash,nonce),
  env.DB.prepare(
   "INSERT INTO engine_admin_audit(id,actor_email,action,project_id,target_id,details_json,created_at) "+
   "SELECT ?,?,'client.invitation_accepted',i.project_id,i.client_id,?,? "+
   "FROM project_client_invitations_3d i WHERE i.token_hash=? AND i.redeemed_nonce=?"
  ).bind(crypto.randomUUID(),email,JSON.stringify({role:invitation.role}),
    new Date(now).toISOString(),hash,nonce)
 ]);
 if(results[0]?.meta?.changes!==1||results[1]?.meta?.changes!==1)
  return response({error:"Invitation was already used, revoked or expired."},409);
 return response({ok:true,role:invitation.role},200,{"Set-Cookie":issue(sessionToken)});
}
export async function handleProjectClientPortal(request,env,url=new URL(request.url)){
 if(url.pathname!==PREFIX&&!url.pathname.startsWith(PREFIX+"/"))return null;
 try{
  if(url.pathname===PREFIX+"/enroll")return enroll(request,env);
  if(url.pathname===PREFIX+"/session"){
   if(request.method!=="GET")return response({error:"Method not allowed."},405);
   const s=await projectClientSession(request,env);
   return response({authenticated:Boolean(s),user:s?{
    displayName:s.displayName,email:s.email,role:s.role,
    projectSlug:s.slug,projectName:s.projectName}:null});
  }
  if(url.pathname===PREFIX+"/logout"){
   if(request.method!=="POST")return response({error:"Method not allowed."},405);
   if(!sameOrigin(request))return response({error:"Same-origin request required."},403);
   const value=bearer(request);
   if(validClientBearer(value))await env.DB.prepare(
    "UPDATE project_client_sessions_3d SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL"
   ).bind(Date.now(),await clientTokenHash(value)).run();
   return response({ok:true},200,{"Set-Cookie":clear()});
  }
  const match=url.pathname.match(/^\/3Dprojects\/api\/client-portal\/projects\/([a-z0-9-]+)\/(overview|commercial)$/);
  if(!match)return response({error:"Unknown project client route."},404);
  const s=await projectClientSession(request,env);
  if(!s)return response({error:"Client sign-in required."},401);
  const slug=match[1],section=match[2];
  if(!validProjectSlug(slug)||slug!==s.slug)
   return response({error:"Project access is restricted."},403);
  if(section==="overview"){
   if(request.method!=="GET")return response({error:"Method not allowed."},405);
   if(!canProjectClient(s.role,"project.read"))
    return response({error:"Role is not authorized."},403);
   return response({project:{slug:s.slug,name:s.projectName,status:s.projectStatus},
     role:s.role,permissions:{commercialRead:canProjectClient(s.role,"commercial.read"),
      commercialPrepare:canProjectClient(s.role,"commercial.prepare"),
      commercialApprove:canProjectClient(s.role,"commercial.approve")}});
  }
  if(section==="commercial"){
   if(!["GET","PUT"].includes(request.method))
    return response({error:"Method not allowed."},405);
   const permission=request.method==="GET"?"commercial.read":"commercial.prepare";
   if(!canProjectClient(s.role,permission))
    return response({error:"Role is not authorized for commercial changes."},403);
   if(request.method!=="GET"&&!sameOrigin(request))
    return response({error:"Same-origin request required."},403);
   const ctx=await env.DB.prepare(
    "SELECT p.id AS project_id,p.slug,p.status,p.project_kind,e.id AS experience_id,"+
    "ar.geo_release_id,r.source_building_release_id "+
    "FROM projects_3d p JOIN experiences_3d e ON e.project_id=p.id AND e.type='geo' "+
    "JOIN geo_experience_active_releases_3d ar ON ar.experience_id=e.id AND ar.project_id=p.id "+
    "JOIN geo_releases_3d r ON r.id=ar.geo_release_id AND r.project_id=p.id "+
    "WHERE p.id=? AND p.slug=? AND p.project_kind IN ('legacy','building_geo') LIMIT 1"
   ).bind(s.projectId,slug).first();
   if(!ctx)return response({error:"Current project Geo release is unavailable."},404);
   return handleGeoPlotCommercial(request,env,{
    project:{id:ctx.project_id,slug:ctx.slug,status:ctx.status,project_kind:ctx.project_kind},
    active:{experience_id:ctx.experience_id,geo_release_id:ctx.geo_release_id,
      source_building_release_id:ctx.source_building_release_id}
   },{email:s.email,role:s.role},{
    allowApprove:canProjectClient(s.role,"commercial.approve")
   });
  }
  return response({error:"Unknown client route."},404);
 }catch(error){
  console.error("Scoped client portal operation failed.",error instanceof Error?error.message:"unknown");
  return response({error:"Project client session or request could not be verified."},409);
 }
}
