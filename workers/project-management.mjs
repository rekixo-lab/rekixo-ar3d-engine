// Engine-owned project profile and client directory. No Platform integration.
import {provisionProjectClient,revokeProjectClient} from "./project-client-access.mjs";
import {ownerProvisionClientPassword,ownerCreateClientPassword,clientLoginId} from "./project-client-passwords.mjs";
// Directory roles are proposals only: never permissions, sessions or credentials.
const json = (payload, status = 200) => Response.json(payload,{
  status, headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"},
});
const fail = (error,status=400) => json({error},status);
const validText = (v,max) => typeof v==="string" && v.length<=max && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v);
const normalize = (v,max) => {
  if(!validText(v,max))throw Error("Invalid field length or control characters.");
  return v.trim();
};
const email = v => !v || (/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v) && v.length<=254);
const phone = v => !v || (/^\+?[0-9() -]{7,25}$/.test(v) && v.replace(/\D/g,"").length>=7);
function urlValue(value, kind="external") {
  const v=normalize(value,1000);
  if(!v)return "";
  let url;
  try{url=new URL(v);}catch{throw Error("Provide a complete https:// URL.");}
  if(url.protocol!=="https:" || url.username || url.password || !url.hostname || /[\s<>]/.test(v))
    throw Error("Only secure HTTPS URLs without embedded credentials are allowed.");
  // Never accept google.evil.com or a lookalike host as Google Maps.
  // Support Google's country-code domains and official goo.gl short links.
  const googleHost=/(^|\.)google\.(?:com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/.test(url.hostname);
  const googleShort=url.hostname==="goo.gl" || url.hostname.endsWith(".goo.gl");
  if(kind==="maps" && !(googleHost || googleShort))
    throw Error("Map link must be an official Google Maps HTTPS URL.");
  return url.href;
}
const fields={
  projectNumber:80,ownerName:160,
  builderName:200,contactName:160,address:600,phonePrimary:25,phoneSecondary:25,
  whatsapp:25,email:254,websiteUrl:1000,mapsUrl:1000,brochureUrl:1000,
};
const columns={
  projectNumber:"project_number",ownerName:"owner_name",
  builderName:"builder_name",contactName:"contact_name",address:"address",
  phonePrimary:"phone_primary",phoneSecondary:"phone_secondary",whatsapp:"whatsapp",
  email:"email",websiteUrl:"website_url",mapsUrl:"maps_url",brochureUrl:"brochure_url",
};
function normalizeProfile(value){
  if(!value||typeof value!=="object"||Array.isArray(value))throw Error("Invalid project contact profile.");
  const out={};
  for(const [key,size] of Object.entries(fields))out[key]=normalize(value[key]??"",size);
  for(const key of ["phonePrimary","phoneSecondary","whatsapp"])
    if(!phone(out[key]))throw Error("Invalid "+key+" phone number.");
  if(!email(out.email))throw Error("Invalid email address.");
  for(const key of ["websiteUrl","brochureUrl"])out[key]=urlValue(out[key]);
  out.mapsUrl=urlValue(out.mapsUrl,"maps");
  if(typeof value.publicContactsEnabled!=="boolean")
    throw Error("Explicit public contact permission is required.");
  out.publicContactsEnabled=value.publicContactsEnabled;
  return out;
}
const emptyProfile=()=>({...Object.fromEntries(Object.keys(fields).map(key=>[key,""])),publicContactsEnabled:false});
function profileView(row){
  return {revision:row?.revision||0,values:row
    ? {...Object.fromEntries(Object.entries(columns).map(([k,v])=>[k,row[v]||""])),
       publicContactsEnabled:row.public_contacts_enabled===1}
    : emptyProfile()};
}
async function audit(env,actor,action,projectId,targetId,detail={}){
  await env.DB.prepare(`INSERT INTO engine_admin_audit
    (id,actor_email,action,project_id,target_id,details_json,created_at) VALUES(?,?,?,?,?,?,?)`)
  .bind(crypto.randomUUID(),actor.email,action,projectId,targetId,JSON.stringify(detail),new Date().toISOString()).run();
}
async function getState(env,project){
  const [prof,clients] = await Promise.all([
    env.DB.prepare("SELECT * FROM project_profiles_3d WHERE project_id=?").bind(project.id).first(),
    env.DB.prepare(`SELECT c.id,c.display_name AS displayName,c.email,c.phone,
         c.proposed_role AS proposedRole,c.access_state AS accessState,c.notes,
         c.created_at AS createdAt,c.updated_at AS updatedAt,
         g.role AS grantedRole,g.active AS grantActive,
         g.epoch AS grantEpoch,
         pwd.login_type AS credentialLoginType,pwd.login_id AS credentialLoginId,
         pwd.must_change_password AS mustChangePassword,pwd.active AS passwordActive
      FROM project_client_directory_3d c
      LEFT JOIN project_client_grants_3d g ON g.client_id=c.id AND g.project_id=c.project_id
      LEFT JOIN project_client_passwords_3d pwd ON pwd.client_id=c.id AND pwd.project_id=c.project_id
      WHERE c.project_id=? ORDER BY c.updated_at DESC,c.id ASC LIMIT 200`)
      .bind(project.id).all(),
  ]);
  return {project:{id:project.id,slug:project.slug,projectKind:project.project_kind||"legacy",
    name:project.name,location:project.location||"",status:project.status},
    profile:profileView(prof),clients:(clients.results||[]).map(c=>({
      ...c,grantActive:c.accessState!=="disabled"&&c.grantActive===1
    })),clientLoginEnabled:true};
}
function sameOrigin(req){
  try{return new URL(req.headers.get("origin")||"").origin===new URL(req.url).origin;}
  catch{return false;}
}
export async function handleProjectManagementAdmin(request,env,actor,project,parts=[]){
  if(parts.length!==2 || parts[1]!=="manage")return null;
  if(request.method==="GET")return json(await getState(env,project));
  if(!["PUT","POST","PATCH"].includes(request.method))return fail("Method not allowed.",405);
  if(!sameOrigin(request))return fail("Same-origin request required.",403);
  if(project.status==="archived")return fail("Archived project is read-only.",409);
  const raw=await request.text();
  if(raw.length>12000)return fail("Request exceeds management input size limit.",413);
  let body;try{body=JSON.parse(raw);}catch{return fail("Malformed JSON.");}
  try{
    if(request.method==="PUT"){
      if(!Number.isInteger(body.expectedRevision)||body.expectedRevision<0)
        return fail("Expected profile revision required.");
      const value=normalizeProfile(body.profile);
      const args=[...Object.keys(columns).map(k=>value[k]),value.publicContactsEnabled?1:0];
      const now=new Date().toISOString();
      const cols=[...Object.values(columns),"public_contacts_enabled"];
      let result;
      if(body.expectedRevision===0){
        const binds=[project.id,...args,actor.email,now];
        result=await env.DB.prepare(`INSERT INTO project_profiles_3d
         (project_id,${cols.join(",")},revision,updated_by,updated_at)
         VALUES (${["?",...cols.map(()=>"?"),"1","?","?"].join(",")})
         ON CONFLICT(project_id) DO NOTHING`).bind(...binds).run();
      }else{
        result=await env.DB.prepare(`UPDATE project_profiles_3d SET
          ${cols.map(c=>c+"=?").join(",")},revision=revision+1,
          updated_by=?,updated_at=? WHERE project_id=? AND revision=?`)
          .bind(...args,actor.email,now,project.id,body.expectedRevision).run();
      }
      if(result.meta?.changes!==1)return fail("Profile changed in another session. Reload first.",409);
      await audit(env,actor,"project.profile_updated",project.id,project.id,{fields:Object.keys(value)});
      return json(await getState(env,project));
    }
    if(request.method==="POST"&&body.action==="create-client"){
      const name=normalize(body.displayName,160),mail=normalize(body.email||"",254).toLowerCase();
      const mobile=normalize(body.phone||"",25),notes=normalize(body.notes||"",500);
      const role=body.proposedRole||"viewer";
      if(!name||!["viewer","editor","approver","client_admin"].includes(role)||!email(mail)||!phone(mobile)||
         (!mail&&!mobile))return fail("Client name, contact and valid proposed role required.");
      const count=await env.DB.prepare("SELECT COUNT(*) AS total FROM project_client_directory_3d WHERE project_id=?")
        .bind(project.id).first();
      if(Number(count?.total||0)>=200)return fail("Client directory project limit reached.",409);
      const id=crypto.randomUUID(),now=new Date().toISOString();
      if(role==="client_admin"){
        // One transaction: client directory, grant, credentials and audit.
        // On a duplicate login ID nothing is left half-created.
        const credential=await ownerCreateClientPassword(env,actor,project,{
          id,displayName:name,email:mail,phone:mobile,notes,loginType:body.loginType
        });
        return json({...(await getState(env,project)),credential},201);
      }
      await env.DB.prepare(`INSERT INTO project_client_directory_3d
       (id,project_id,display_name,email,phone,proposed_role,access_state,notes,
        created_by,created_at,updated_by,updated_at)
       VALUES(?,?,?,?,?,?,'not_provisioned',?,?,?,?,?)`)
        .bind(id,project.id,name,mail,mobile,role,notes,actor.email,now,actor.email,now).run();
      await audit(env,actor,"project.client_record_added",project.id,id,{proposedRole:role});
      return json(await getState(env,project),201);
    }
    if(request.method==="PATCH"&&body.action==="update-client"){
      if(typeof body.id!=="string"||!/^[0-9a-f-]{36}$/i.test(body.id))
        return fail("Choose a valid client record.");
      const previous=await env.DB.prepare(`SELECT c.*,p.login_type AS loginType,
        p.login_id AS loginId,p.active AS passwordActive
        FROM project_client_directory_3d c LEFT JOIN project_client_passwords_3d p
        ON p.client_id=c.id AND p.project_id=c.project_id
        WHERE c.project_id=? AND c.id=?`).bind(project.id,body.id).first();
      if(!previous)return fail("Client is not in this project.",404);
      if(body.expectedUpdatedAt!==previous.updated_at)
        return fail("Client was changed in another tab. Reload first.",409);
      const displayName=normalize(body.displayName,160);
      const mail=normalize(body.email||"",254).toLowerCase();
      const mobile=normalize(body.phone||"",25);
      const notes=normalize(body.notes||"",500);
      const role=body.proposedRole;
      if(!displayName||(!mail&&!mobile)||!email(mail)||!phone(mobile)||
        !["viewer","editor","approver","client_admin"].includes(role))
        return fail("Valid name, contact and role are required.");
      const roleChanged=role!==previous.proposed_role;
      const nextLoginId=previous.loginType?
        clientLoginId(previous.loginType==="email"?mail:mobile,previous.loginType):null;
      if(previous.loginType&&!nextLoginId)
        return fail("This client's login uses the "+previous.loginType+". Enter a valid replacement before saving.");
      const loginChanged=Boolean(nextLoginId&&nextLoginId!==previous.loginId);
      const now=new Date().toISOString(),ts=Date.now();
      const statements=[
        env.DB.prepare(`UPDATE project_client_directory_3d
          SET display_name=?,email=?,phone=?,notes=?,proposed_role=?,updated_by=?,updated_at=?
          WHERE project_id=? AND id=? AND updated_at=?`)
          .bind(displayName,mail,mobile,notes,role,actor.email,now,project.id,body.id,previous.updated_at)
      ];
      if(roleChanged){
        statements.push(env.DB.prepare(`UPDATE project_client_grants_3d
          SET epoch=epoch+1,active=0,updated_at=?,granted_by=?
          WHERE project_id=? AND client_id=?`).bind(now,actor.email,project.id,body.id));
        statements.push(env.DB.prepare(`UPDATE project_client_passwords_3d
          SET active=0,updated_at=? WHERE project_id=? AND client_id=?`)
          .bind(now,project.id,body.id));
      }else if(loginChanged){
        statements.push(env.DB.prepare(`UPDATE project_client_passwords_3d
          SET login_id=?,password_version=password_version+1,must_change_password=1,updated_at=?
          WHERE project_id=? AND client_id=? AND login_id=?`)
          .bind(nextLoginId,now,project.id,body.id,previous.loginId));
        statements.push(env.DB.prepare(`UPDATE project_client_grants_3d
          SET epoch=epoch+1,updated_at=?,granted_by=? WHERE project_id=? AND client_id=?`)
          .bind(now,actor.email,project.id,body.id));
      }
      if(roleChanged||loginChanged){
        statements.push(env.DB.prepare("DELETE FROM project_client_invitations_3d WHERE project_id=? AND client_id=?")
          .bind(project.id,body.id));
        statements.push(env.DB.prepare(`UPDATE project_client_sessions_3d SET revoked_at=?
          WHERE project_id=? AND client_id=? AND revoked_at IS NULL`).bind(ts,project.id,body.id));
      }
      statements.push(env.DB.prepare(`INSERT INTO engine_admin_audit
        (id,actor_email,action,project_id,target_id,details_json,created_at)
        VALUES(?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),actor.email,"project.client_updated",project.id,body.id,
        JSON.stringify({roleChanged,loginChanged,allSessionsRevoked:roleChanged||loginChanged}),now));
      const result=await env.DB.batch(statements);
      if(result[0]?.meta?.changes!==1)return fail("Client changed concurrently. Reload first.",409);
      return json(await getState(env,project));
    }
    if(request.method==="PATCH"&&body.action==="enable-client"){
      if(typeof body.id!=="string"||!/^[0-9a-f-]{36}$/i.test(body.id))
        return fail("Valid client ID required.");
      const now=new Date().toISOString();
      const result=await env.DB.batch([
        env.DB.prepare(`UPDATE project_client_directory_3d
          SET access_state='not_provisioned',updated_by=?,updated_at=?
          WHERE project_id=? AND id=? AND access_state='disabled'`)
          .bind(actor.email,now,project.id,body.id),
        env.DB.prepare(`INSERT INTO engine_admin_audit
          (id,actor_email,action,project_id,target_id,details_json,created_at)
          VALUES(?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),actor.email,
          "project.client_reenabled",project.id,body.id,"{}",now)
      ]);
      if(result[0]?.meta?.changes!==1)return fail("Client is not disabled or was updated.",409);
      // Re-enabling a directory record never reactivates the old password or grant.
      return json(await getState(env,project));
    }
    if(request.method==="POST"&&["provision-client-password","reset-client-password"].includes(body.action)){
      const credential=await ownerProvisionClientPassword(env,actor,project,body.id,body.loginType);
      return json({...(await getState(env,project)),credential});
    }
    if(request.method==="POST"&&body.action==="grant-client-access"){
      const invitation=await provisionProjectClient(env,actor,project,body,request);
      return json({...(await getState(env,project)),invitation});
    }
    if(request.method==="PATCH"&&(body.action==="disable-client"||
       body.action==="revoke-client-access")){
      await revokeProjectClient(env,actor,project,body);
      return json(await getState(env,project));
    }
    return fail("Unknown management action.");
  }catch(err){
    if(/UNIQUE constraint failed/i.test(String(err)))return fail("This client email is already in the project.",409);
    return fail(err instanceof Error?err.message:"Management update failed.",409);
  }
}
