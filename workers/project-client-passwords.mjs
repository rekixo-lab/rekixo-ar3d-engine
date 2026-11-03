// Password logins for one AR3D Client Admin project. Never use Engine Owner auth.
// Mirrors AR3D Platform mobile/email + temporary-password-first-login workflow.
import {clientTokenHash,newClientBearer} from "./project-client-access.mjs";
import {validProjectSlug} from "../shared/project-slug-policy.js";
const encode=new TextEncoder();
// Cloudflare Workers rejects a single PBKDF2 deriveBits call above 100,000 iterations.
// Keep provisioning, sign-in and password changes on the same supported cost.
const ITERATIONS=100000;
export const validClientPassword=value=>
 typeof value==="string"&&value.length>=8&&value.length<=128&&
 !/\s/.test(value)&&/[a-z]/i.test(value)&&/[0-9]/.test(value);
const toHex=buf=>Array.from(new Uint8Array(buf)).map(v=>v.toString(16).padStart(2,"0")).join("");
const now=()=>new Date().toISOString();
function randomPassword(){
 const pool="ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
 const vals=new Uint8Array(12);crypto.getRandomValues(vals);
 const password="A7"+Array.from(vals,v=>pool[v%pool.length]).join("");
 return password;
}
function normalizePhone(value){
 const raw=String(value||"").trim().replace(/[\s().-]/g,"");
 const valuePlus=raw.startsWith("00")?"+"+raw.slice(2):raw;
 if(/^[6-9][0-9]{9}$/.test(valuePlus))return "+91"+valuePlus;
 if(/^0[6-9][0-9]{9}$/.test(valuePlus))return "+91"+valuePlus.slice(1);
 if(/^91[6-9][0-9]{9}$/.test(valuePlus))return "+"+valuePlus;
 if(/^\+91[6-9][0-9]{9}$/.test(valuePlus))return valuePlus;
 if(/^\+[1-9][0-9]{7,14}$/.test(valuePlus))return valuePlus;
 return "";
}
export function clientLoginId(value,type){
 if(type==="mobile")return normalizePhone(value);
 if(type==="email"){
  const v=String(value||"").trim().toLowerCase();
  return v.length<=254&&/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v)?v:"";
 }
 return "";
}
async function passwordDigest(password,saltHex){
 const salt=Uint8Array.from(saltHex.match(/.{2}/g)||[],s=>parseInt(s,16));
 const key=await crypto.subtle.importKey("raw",encode.encode(password),"PBKDF2",false,["deriveBits"]);
 return toHex(await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt,iterations:ITERATIONS},key,256));
}
const constantTimeEqual=(a,b)=>{
 if(typeof a!=="string"||typeof b!=="string"||a.length!==b.length)return false;
 let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
 return diff===0;
};
async function hashPassword(password){
 if(!validClientPassword(password))throw Error("Password needs 8+ characters, a letter and a number.");
 const salt=toHex(crypto.getRandomValues(new Uint8Array(16)));
 return {salt,hash:await passwordDigest(password,salt)};
}
async function verifyPassword(password,salt,hash){
 if(typeof password!=="string"||password.length>128||!password)return false;
 try{return constantTimeEqual(await passwordDigest(password,salt),hash);}
 catch{return false;}
}
const audit=(env,actor,action,projectId,clientId,details)=>env.DB.prepare(
 "INSERT INTO engine_admin_audit(id,actor_email,action,project_id,target_id,details_json,created_at) VALUES(?,?,?,?,?,?,?)"
).bind(crypto.randomUUID(),actor,action,projectId,clientId,JSON.stringify(details),now());
const validId=x=>typeof x==="string"&&/^[0-9a-f-]{36}$/i.test(x);

/** Create the project directory record, grant and first password atomically. */
export async function ownerCreateClientPassword(env,actor,project,details){
 if(project.status==="archived")throw Error("Archived projects cannot add clients.");
 const id=details.id||crypto.randomUUID();
 if(!validId(id)||typeof details.displayName!=="string"||!details.displayName.trim())
  throw Error("Valid client name required.");
 const type=details.loginType==="email"?"email":details.loginType==="mobile"?"mobile":
  details.phone?"mobile":"email";
 const loginId=clientLoginId(type==="mobile"?details.phone:details.email,type);
 if(!loginId)throw Error("Valid "+(type==="mobile"?"mobile number":"email")+" required.");
 const time=now(),password=randomPassword(),digest=await hashPassword(password);
 const result=await env.DB.batch([
  env.DB.prepare("INSERT INTO project_client_directory_3d "+
   "(id,project_id,display_name,email,phone,proposed_role,access_state,notes,created_by,created_at,updated_by,updated_at) "+
   "VALUES(?,?,?,?,?,'client_admin','not_provisioned',?,?,?,?,?)")
   .bind(id,project.id,details.displayName,details.email||"",details.phone||"",
    details.notes||"",actor.email,time,actor.email,time),
  env.DB.prepare("INSERT INTO project_client_grants_3d(client_id,project_id,role,epoch,active,granted_by,updated_at) "+
   "VALUES(?,?,'client_admin',1,1,?,?)").bind(id,project.id,actor.email,time),
  env.DB.prepare("INSERT INTO project_client_passwords_3d "+
   "(client_id,project_id,login_type,login_id,password_salt,password_hash,password_version,must_change_password,active,created_at,updated_at) "+
   "VALUES(?,?,?,?,?,?,1,1,1,?,?)")
   .bind(id,project.id,type,loginId,digest.salt,digest.hash,time,time),
  audit(env,actor.email,"project.client_record_added",project.id,id,{proposedRole:"client_admin"}),
  audit(env,actor.email,"client.password_provisioned",project.id,id,{loginType:type,loginId,grantEpoch:1})
 ]);
 if(result.some(item=>item.meta?.changes!==1))
  throw Error("Client and credentials could not be created consistently.");
 return {clientId:id,loginType:type,loginId,password,mustChangePassword:true};
}

/** Explicit owner-only password provisioning/reset; raw password returned ONCE. */
export async function ownerProvisionClientPassword(env,actor,project,clientId,loginType){
 if(!validId(clientId))throw Error("Valid client ID required.");
 if(project.status==="archived")throw Error("Archived projects cannot enable client access.");
 const client=await env.DB.prepare(
  "SELECT id,project_id,email,phone,proposed_role,access_state FROM project_client_directory_3d WHERE project_id=? AND id=?"
 ).bind(project.id,clientId).first();
 if(!client||client.access_state!=="not_provisioned"||client.proposed_role!=="client_admin")
  throw Error("Choose an active Client Admin record in this project.");
 const type=loginType==="email"?"email":loginType==="mobile"?"mobile":client.phone?"mobile":"email";
 const loginId=clientLoginId(type==="email"?client.email:client.phone,type);
 if(!loginId)throw Error("Provide a valid client "+(type==="mobile"?"mobile":"email")+" in Clients first.");
 const password=randomPassword(),digest=await hashPassword(password),time=now();
 const grant=await env.DB.prepare(
  "SELECT epoch FROM project_client_grants_3d WHERE client_id=? AND project_id=?"
 ).bind(client.id,project.id).first();
 const oldEpoch=Number(grant?.epoch||0),nextEpoch=oldEpoch+1;
 const statement=oldEpoch?
  env.DB.prepare("UPDATE project_client_grants_3d SET epoch=epoch+1,role='client_admin',active=1,granted_by=?,updated_at=? "+
   "WHERE project_id=? AND client_id=? AND epoch=?")
   .bind(actor.email,time,project.id,client.id,oldEpoch):
  env.DB.prepare("INSERT INTO project_client_grants_3d(client_id,project_id,role,epoch,active,granted_by,updated_at) "+
   "VALUES(?,?,'client_admin',1,1,?,?)").bind(client.id,project.id,actor.email,time);
 const result=await env.DB.batch([
  statement,
  env.DB.prepare(
   "INSERT INTO project_client_passwords_3d"+
   "(client_id,project_id,login_type,login_id,password_salt,password_hash,password_version,must_change_password,active,created_at,updated_at) "+
   "VALUES(?,?,?,?,?,?,1,1,1,?,?) "+
   "ON CONFLICT(client_id) DO UPDATE SET login_type=excluded.login_type,login_id=excluded.login_id,"+
   "password_salt=excluded.password_salt,password_hash=excluded.password_hash,"+
   "password_version=password_version+1,must_change_password=1,active=1,updated_at=excluded.updated_at "+
   "WHERE project_id=excluded.project_id"
  ).bind(client.id,project.id,type,loginId,digest.salt,digest.hash,time,time),
  env.DB.prepare("DELETE FROM project_client_invitations_3d WHERE project_id=? AND client_id=?").bind(project.id,client.id),
  env.DB.prepare("UPDATE project_client_sessions_3d SET revoked_at=? WHERE project_id=? AND client_id=? AND revoked_at IS NULL")
   .bind(Date.now(),project.id,client.id),
  audit(env,actor.email,"client.password_provisioned",project.id,client.id,
   {loginType:type,loginId,grantEpoch:nextEpoch})
 ]);
 if(result[0]?.meta?.changes!==1||result[1]?.meta?.changes!==1)
  throw Error("Client credentials changed in another request; reload and retry.");
 return {clientId:client.id,loginType:type,loginId,password,mustChangePassword:true};
}

const WINDOW=15*60*1000,ATTEMPT_MAX=6,IP_MAX=35;
async function countAttempt(env,key,nowMs){
 const row=await env.DB.prepare(
  "INSERT INTO project_client_login_attempts_3d(key_hash,attempts,window_start) VALUES(?,1,?) "+
  "ON CONFLICT(key_hash) DO UPDATE SET attempts=CASE WHEN excluded.window_start-window_start>=? THEN 1 ELSE attempts+1 END,"+
  "window_start=CASE WHEN excluded.window_start-window_start>=? THEN excluded.window_start ELSE window_start END "+
  "RETURNING attempts"
 ).bind(key,nowMs,WINDOW,WINDOW).first();
 return Number(row?.attempts||9999);
}
async function rateLimit(env,request,slug,loginId){
 const ip=String(request.headers.get("cf-connecting-ip")||"unknown").trim().slice(0,96);
 const time=Date.now();
 const [idKey,ipKey]=await Promise.all([
  clientTokenHash("client:"+slug+":"+ip+":"+loginId),
  clientTokenHash("ip:"+ip)
 ]);
 const [byId,byIp]=await Promise.all([countAttempt(env,idKey,time),countAttempt(env,ipKey,time)]);
 // Small maintenance runs after a throttled request; indexed expiration.
 if(byId>ATTEMPT_MAX||byIp>IP_MAX){
  await env.DB.prepare("DELETE FROM project_client_login_attempts_3d WHERE window_start<?")
   .bind(time-24*60*60*1000).run();
  return true;
 }
 return false;
}
const denied={status:401,body:{error:"Invalid client login ID or password."}};
export async function passwordClientLogin(request,env){
 if(request.method!=="POST")return {status:405,body:{error:"Method not allowed."}};
 if(new URL(request.url).protocol!=="https:")return {status:403,body:{error:"HTTPS required."}};
 const raw=await request.text();
 if(raw.length>1400)return {status:413,body:{error:"Login request is too large."}};
 let data;try{data=JSON.parse(raw);}catch{return {status:400,body:{error:"Invalid login request."}};}
 const slug=String(data?.projectSlug||"").trim().toLowerCase();
 const identifier=String(data?.loginId||"").trim();
 const password=data?.password;
 if(!validProjectSlug(slug)||identifier.length>254||!identifier||
    typeof password!=="string"||password.length>128||!password)
  return denied;
 const loginId=clientLoginId(identifier,"email")||clientLoginId(identifier,"mobile");
 if(!loginId)return denied;
 if(await rateLimit(env,request,slug,loginId))
  return {status:429,body:{error:"Too many login attempts. Retry after 15 minutes."},retryAfter:900};
 const credential=await env.DB.prepare(
  "SELECT pwd.client_id AS clientId,pwd.project_id AS projectId,pwd.password_hash AS passwordHash,"+
  "pwd.password_salt AS passwordSalt,pwd.must_change_password AS mustChangePassword,pwd.active,"+
  "g.epoch,g.role,c.access_state AS clientState,p.status AS projectStatus,pwd.password_version AS version "+
  "FROM project_client_passwords_3d pwd JOIN projects_3d p ON p.id=pwd.project_id "+
  "JOIN project_client_directory_3d c ON c.id=pwd.client_id AND c.project_id=pwd.project_id "+
  "JOIN project_client_grants_3d g ON g.client_id=pwd.client_id AND g.project_id=pwd.project_id "+
  "WHERE p.slug=? AND pwd.login_id=? AND pwd.active=1 AND g.active=1 AND g.role='client_admin' "+
  "AND c.access_state='not_provisioned' AND p.status<>'archived' LIMIT 1"
 ).bind(slug,loginId).first();
 // Perform a dummy digest on missing users as well to avoid a fast account probe.
 const salt=credential?.passwordSalt||"00000000000000000000000000000000";
 const hash=credential?.passwordHash||"0".repeat(64);
 if(!await verifyPassword(password,salt,hash)||!credential)return denied;
 const token=newClientBearer(),hashToken=await clientTokenHash(token),time=Date.now();
 const result=await env.DB.batch([
  env.DB.prepare("INSERT INTO project_client_sessions_3d(token_hash,client_id,project_id,grant_epoch,created_at,expires_at) "+
   "SELECT ?,g.client_id,g.project_id,g.epoch,?,? FROM project_client_grants_3d g "+
   "JOIN project_client_passwords_3d pwd ON pwd.client_id=g.client_id AND pwd.project_id=g.project_id "+
   "WHERE g.client_id=? AND g.project_id=? AND g.epoch=? AND g.active=1 AND pwd.password_version=? AND pwd.active=1")
   .bind(hashToken,time,time+8*60*60*1000,credential.clientId,credential.projectId,credential.epoch,credential.version),
  env.DB.prepare("UPDATE project_client_passwords_3d SET last_login_at=? WHERE client_id=? AND project_id=? AND password_version=?")
   .bind(now(),credential.clientId,credential.projectId,credential.version),
  audit(env,loginId,"client.password_login",credential.projectId,credential.clientId,{loginType:loginId.includes("@")?"email":"mobile"})
 ]);
 if(result[0]?.meta?.changes!==1)return {status:409,body:{error:"Client access was changed; sign in again."}};
 return {status:200,body:{ok:true,mustChangePassword:Boolean(credential.mustChangePassword)},cookie:token};
}
export async function passwordClientChange(request,env,session){
 if(session.role!=="client_admin")return {status:403,body:{error:"Client Admin required."}};
 if(request.method!=="POST")return {status:405,body:{error:"Method not allowed."}};
 const raw=await request.text();
 if(raw.length>1000)return {status:413,body:{error:"Password update too large."}};
 let data;try{data=JSON.parse(raw);}catch{return {status:400,body:{error:"Invalid password request."}};}
 if(!validClientPassword(data?.newPassword)||typeof data?.oldPassword!=="string"||
   data.oldPassword.length>128||data.oldPassword===data.newPassword)
  return {status:400,body:{error:"Use a different 8+ character password with a letter and number."}};
 const row=await env.DB.prepare("SELECT password_salt AS salt,password_hash AS hash,password_version AS version "+
  "FROM project_client_passwords_3d WHERE client_id=? AND project_id=? AND active=1")
  .bind(session.clientId,session.projectId).first();
 if(!row||!await verifyPassword(data.oldPassword,row.salt,row.hash))
  return {status:401,body:{error:"Current password is incorrect."}};
 const digest=await hashPassword(data.newPassword);
 const result=await env.DB.batch([
  env.DB.prepare("UPDATE project_client_passwords_3d SET password_hash=?,password_salt=?,"+
   "password_version=password_version+1,must_change_password=0,updated_at=? "+
   "WHERE client_id=? AND project_id=? AND password_version=? AND active=1")
   .bind(digest.hash,digest.salt,now(),session.clientId,session.projectId,row.version),
  env.DB.prepare("UPDATE project_client_sessions_3d SET revoked_at=? "+
   "WHERE client_id=? AND project_id=? AND revoked_at IS NULL")
   .bind(Date.now(),session.clientId,session.projectId),
  audit(env,session.email,"client.password_changed",session.projectId,session.clientId,{allSessionsRevoked:true})
 ]);
 if(result[0]?.meta?.changes!==1)
  return {status:409,body:{error:"Password changed elsewhere. Sign in again."}};
 return {status:200,body:{ok:true,signInAgain:true},clearCookie:true};
}
