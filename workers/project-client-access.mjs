// Owner-only project invitation management. Bearer links are shown exactly once
// and delivered out-of-band after the owner confirms the intended contact.
import {PROJECT_CLIENT_ROLES} from "../shared/project-client-roles.js";
import {projectClientAdminPath} from "../shared/project-client-admin-url.js";
const enc=new TextEncoder();
export const clientTokenHash=async token=>Array.from(new Uint8Array(await crypto.subtle.digest(
 "SHA-256",enc.encode(token)))).map(n=>n.toString(16).padStart(2,"0")).join("");
export const newClientBearer=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)))
 .map(n=>n.toString(16).padStart(2,"0")).join("");
export const validClientBearer=token=>typeof token==="string"&&/^[a-f0-9]{64}$/.test(token);
const identity=id=>typeof id==="string"&&/^[a-f0-9-]{36}$/i.test(id);
const audit=(env,actor,action,projectId,targetId,data={})=>env.DB.prepare(
 "INSERT INTO engine_admin_audit(id,actor_email,action,project_id,target_id,details_json,created_at) VALUES(?,?,?,?,?,?,?)"
 ).bind(crypto.randomUUID(),actor.email,action,projectId,targetId,JSON.stringify(data),new Date().toISOString());
export async function provisionProjectClient(env,actor,project,body,request){
 if(!identity(body?.id))throw Error("Choose an existing directory client.");
 const client=await env.DB.prepare(
  "SELECT id,project_id,email,proposed_role,access_state FROM project_client_directory_3d WHERE project_id=? AND id=?"
 ).bind(project.id,body.id).first();
 if(!client||client.access_state!=="not_provisioned"||!client.email)
  throw Error("Only an enabled project directory contact with an email may be invited.");
 if(!PROJECT_CLIENT_ROLES.includes(client.proposed_role))
  throw Error("Client directory role is not permitted.");
 if(body.role!==client.proposed_role)
  throw Error("Explicit grant must match the owner's reviewed directory role.");
 const now=Date.now(),expires=now+24*60*60*1000;
 const before=await env.DB.prepare(
  "SELECT epoch FROM project_client_grants_3d WHERE project_id=? AND client_id=?"
 ).bind(project.id,client.id).first();
 const priorEpoch=Number(before?.epoch||0);
 const token=newClientBearer(),tokenHash=await clientTokenHash(token),nextEpoch=priorEpoch+1;
 const update=priorEpoch?env.DB.prepare(
  "UPDATE project_client_grants_3d SET epoch=epoch+1,role=?,active=1,granted_by=?,updated_at=? WHERE project_id=? AND client_id=? AND epoch=?"
 ).bind(client.proposed_role,actor.email,new Date(now).toISOString(),project.id,client.id,priorEpoch)
 :env.DB.prepare(
  "INSERT INTO project_client_grants_3d(client_id,project_id,role,epoch,active,granted_by,updated_at) VALUES(?,?,?,1,1,?,?)"
 ).bind(client.id,project.id,client.proposed_role,actor.email,new Date(now).toISOString());
 const results=await env.DB.batch([
  update,
  env.DB.prepare("DELETE FROM project_client_invitations_3d WHERE project_id=? AND client_id=?")
   .bind(project.id,client.id),
  env.DB.prepare(
   "INSERT INTO project_client_invitations_3d(token_hash,client_id,project_id,grant_epoch,issued_at,expires_at) VALUES(?,?,?,?,?,?)"
  ).bind(tokenHash,client.id,project.id,nextEpoch,now,expires),
  env.DB.prepare(
   "UPDATE project_client_sessions_3d SET revoked_at=? WHERE project_id=? AND client_id=? AND revoked_at IS NULL"
  ).bind(now,project.id,client.id),
  audit(env,actor,"project.client_access_invited",project.id,client.id,
   {role:client.proposed_role,epoch:nextEpoch,expiryHours:24})
 ]);
 if(results[0]?.meta?.changes!==1||results[2]?.meta?.changes!==1)
  throw Error("Concurrent client grant revision. Reload before inviting.");
 const origin=new URL(request.url).origin;
 if(!origin.startsWith("https://"))throw Error("Client invitation requires HTTPS.");
 return {clientId:client.id,role:client.proposed_role,expiresAt:expires,
   // Fragment is not sent in HTTP requests, proxy logs or Referer headers.
   inviteUrl:origin+projectClientAdminPath(project.slug)+"#invite="+token};
}
export async function revokeProjectClient(env,actor,project,body){
 if(!identity(body?.id))throw Error("Valid project client required.");
 const client=await env.DB.prepare(
  "SELECT id,access_state FROM project_client_directory_3d WHERE project_id=? AND id=?"
 ).bind(project.id,body.id).first();
 if(!client)throw Error("Project client is not present.");
 const now=Date.now();
 const results=await env.DB.batch([
  env.DB.prepare(
   "UPDATE project_client_grants_3d SET epoch=epoch+1,active=0,updated_at=?,granted_by=? WHERE project_id=? AND client_id=?"
  ).bind(new Date(now).toISOString(),actor.email,project.id,client.id),
  env.DB.prepare(
   "UPDATE project_client_directory_3d SET access_state='disabled',updated_by=?,updated_at=? WHERE project_id=? AND id=?"
  ).bind(actor.email,new Date(now).toISOString(),project.id,client.id),
  env.DB.prepare("DELETE FROM project_client_invitations_3d WHERE project_id=? AND client_id=?")
   .bind(project.id,client.id),
  env.DB.prepare("UPDATE project_client_sessions_3d SET revoked_at=? WHERE project_id=? AND client_id=? AND revoked_at IS NULL")
   .bind(now,project.id,client.id),
  audit(env,actor,"project.client_access_revoked",project.id,client.id,{allSessionsRevoked:true})
 ]);
 if(results[1]?.meta?.changes!==1)throw Error("Client changed during access revocation.");
 return {clientId:client.id,revoked:true};
}
