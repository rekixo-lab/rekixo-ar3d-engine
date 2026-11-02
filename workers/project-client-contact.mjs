// Editable customer-facing contact profile for one authenticated Client Admin.
// Project owner fields, publication consent and immutable mapping stay owner-only.
const PROFILE_FIELDS=Object.freeze({
 contactName:["contact_name",160],
 address:["address",600],
 phonePrimary:["phone_primary",25],
 phoneSecondary:["phone_secondary",25],
 whatsapp:["whatsapp",25],
 email:["email",254],
 websiteUrl:["website_url",1000],
 mapsUrl:["maps_url",1000],
 brochureUrl:["brochure_url",1000]
});
const KEYS=Object.keys(PROFILE_FIELDS);
const badControl=/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
const validPhone=s=>!s||(/^\+?[0-9() -]{7,25}$/.test(s)&&s.replace(/\D/g,"").length>=7);
const validEmail=s=>!s||/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(s);
function safeUrl(value,maps=false){
 if(!value)return "";
 let url;
 try{url=new URL(value);}catch{throw Error("Provide complete HTTPS links.");}
 if(url.protocol!=="https:"||url.username||url.password||/[\s<>]/.test(value))
  throw Error("Only secure HTTPS URLs without credentials are accepted.");
 const hostname=url.hostname.toLowerCase();
 if(maps&&!(/(^|\.)google\.(?:com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/.test(hostname)||
   hostname==="goo.gl"||hostname.endsWith(".goo.gl")))
   throw Error("Map link must use official Google Maps domain.");
 return url.href;
}
function validate(fields){
 if(!fields||typeof fields!=="object"||Array.isArray(fields)||
   Object.keys(fields).length!==KEYS.length||
   Object.keys(fields).some(k=>!Object.hasOwn(PROFILE_FIELDS,k)))
  throw Error("Exactly the permitted client contact fields are required.");
 const out={};
 for(const [key,[,max]] of Object.entries(PROFILE_FIELDS)){
  const raw=fields[key];
  if(typeof raw!=="string"||raw.length>max||badControl.test(raw))
   throw Error("Invalid client contact field: "+key);
  out[key]=raw.trim();
 }
 for(const k of ["phonePrimary","phoneSecondary","whatsapp"])
  if(!validPhone(out[k]))throw Error("Invalid "+k+" phone.");
 if(!validEmail(out.email))throw Error("Invalid email.");
 for(const k of ["websiteUrl","brochureUrl"])out[k]=safeUrl(out[k]);
 out.mapsUrl=safeUrl(out.mapsUrl,true);
 return out;
}
function publicFields(row){
 const fields=Object.fromEntries(KEYS.map(k=>[k,String(row?.[PROFILE_FIELDS[k][0]]||"")]));
 return {revision:Number(row?.revision||0),
  ownerApprovedPublic:row?.public_contacts_enabled===1,fields};
}
const response=(value,status=200)=>Response.json(value,{status,headers:{
 "Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
export async function clientProjectContact(request,env,session){
 if(session.role!=="client_admin")
  return response({error:"Client Admin access required."},403);
 if(!["GET","PUT"].includes(request.method))
  return response({error:"Method not allowed."},405);
 const select="SELECT * FROM project_profiles_3d WHERE project_id=?";
 const row=await env.DB.prepare(select).bind(session.projectId).first();
 if(request.method==="GET")return response(publicFields(row));
 if(session.projectStatus==="archived")return response({error:"Archived project is read-only."},409);
 if(!row)return response({error:"Project owner must initialize Profile before client editing."},409);
 const raw=await request.text();
 if(raw.length>8000)return response({error:"Contact update exceeds input limit."},413);
 let data;try{data=JSON.parse(raw);}catch{return response({error:"Malformed contact update."},400);}
 if(!data||typeof data!=="object"||Array.isArray(data)||
   Object.keys(data).sort().join(",")!=="expectedRevision,fields"||
   !Number.isSafeInteger(data.expectedRevision)||data.expectedRevision<1)
  return response({error:"Expected profile revision and contact fields are required."},400);
 let values;try{values=validate(data.fields);}
 catch(error){return response({error:error.message},400);}
 const now=new Date().toISOString(),next=data.expectedRevision+1;
 const columns=KEYS.map(k=>PROFILE_FIELDS[k][0]);
 const change=env.DB.prepare(
  "UPDATE project_profiles_3d SET "+columns.map(c=>c+"=?").join(",")+
  ",revision=revision+1,updated_by=?,updated_at=? WHERE project_id=? AND revision=? "+
  "AND EXISTS (SELECT 1 FROM projects_3d p WHERE p.id=project_id AND p.status<>'archived')"
 ).bind(...KEYS.map(k=>values[k]),session.email,now,session.projectId,data.expectedRevision);
 const audit=env.DB.prepare(
  "INSERT INTO engine_admin_audit (id,actor_email,action,project_id,target_id,details_json,created_at) "+
  "SELECT ?,?,'client.contact_updated',project_id,project_id,?,? "+
  "FROM project_profiles_3d WHERE project_id=? AND revision=? AND updated_by=? AND updated_at=?"
 ).bind(crypto.randomUUID(),session.email,JSON.stringify({fields:KEYS}),
  now,session.projectId,next,session.email,now);
 try{
  const result=await env.DB.batch([change,audit]);
  if(result[0]?.meta?.changes!==1||result[1]?.meta?.changes!==1)
   return response({error:"Contact changed in another session. Refresh before saving."},409);
 }catch(error){
  return response({error:"Client contact update failed. Refresh profile."},409);
 }
 return response({revision:next,ownerApprovedPublic:row.public_contacts_enabled===1,fields:values});
}
