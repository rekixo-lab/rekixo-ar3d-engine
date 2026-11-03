// Private project gallery with verified image bytes, scoped DB entries and R2 objects.
const json=(value,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
const uuid=v=>typeof v==="string"&&/^[0-9a-f-]{36}$/i.test(v);
const types={"image/jpeg":"jpg","image/png":"png","image/webp":"webp"};
function matchesBytes(mime,bytes){
 if(mime==="image/jpeg")return bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 if(mime==="image/png")return [137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v);
 if(mime==="image/webp")return String.fromCharCode(...bytes.slice(0,4))==="RIFF"&&
   String.fromCharCode(...bytes.slice(8,12))==="WEBP";
 return false;
}
const audit=(env,actor,projectId,id,action)=>env.DB.prepare(
 "INSERT INTO engine_admin_audit(id,actor_email,action,project_id,target_id,details_json,created_at) VALUES(?,?,?,?,?,?,?)"
).bind(crypto.randomUUID(),actor.email,action,projectId,id,"{}",new Date().toISOString());
export async function clientGeoGallery(request,env,project,actor,section){
 if(section==="gallery-image"){
  if(request.method!=="GET")return json({error:"Method not allowed."},405);
  const id=new URL(request.url).searchParams.get("id");
  if(!uuid(id))return json({error:"Invalid image ID."},400);
  const row=await env.DB.prepare("SELECT r2_key AS key,mime FROM geo_client_gallery_3d WHERE id=? AND project_id=? AND deleted_at IS NULL").bind(id,project.id).first();
  if(!row||!row.key.startsWith("projects/"+project.id+"/client-gallery/"))return json({error:"Image not found."},404);
  const object=await env.MODEL_ASSETS.get(row.key);
  if(!object)return json({error:"Image unavailable."},404);
  return new Response(object.body,{status:200,headers:{"Content-Type":row.mime,"Cache-Control":"private,no-store","X-Content-Type-Options":"nosniff"}});
 }
 if(request.method==="GET"){
  const found=await env.DB.prepare("SELECT id,caption,mime,size_bytes AS sizeBytes,created_at AS createdAt FROM geo_client_gallery_3d WHERE project_id=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 10").bind(project.id).all();
  return json({images:found.results||[],maxImages:10});
 }
 if(actor.role!=="client_admin")return json({error:"Client Admin required."},403);
 if(project.status==="archived")return json({error:"Archived project is read-only."},409);
 if(request.method==="POST"){
  if(Number(request.headers.get("content-length")||0)>9*1024*1024)return json({error:"File too large."},413);
  const count=await env.DB.prepare("SELECT COUNT(*) AS n FROM geo_client_gallery_3d WHERE project_id=? AND deleted_at IS NULL").bind(project.id).first();
  if(Number(count?.n||0)>=10)return json({error:"Gallery limit of 10 images reached."},409);
  const form=await request.formData();
  const upload=form.get("file"),caption=String(form.get("caption")||"").trim();
  if(!(upload instanceof File)||!(upload.type in types)||upload.size<1||upload.size>8388608||
     caption.length>160||/[\x00-\x1f\x7f]/.test(caption))return json({error:"Choose JPG, PNG or WebP up to 8 MB, with short caption."},400);
  const bytes=new Uint8Array(await upload.arrayBuffer());
  if(!matchesBytes(upload.type,bytes))return json({error:"Image content does not match file type."},400);
  const id=crypto.randomUUID(),key="projects/"+project.id+"/client-gallery/"+id+"."+types[upload.type];
  await env.MODEL_ASSETS.put(key,bytes,{httpMetadata:{contentType:upload.type}});
  try{
   const now=new Date().toISOString();
   const result=await env.DB.batch([
    env.DB.prepare("INSERT INTO geo_client_gallery_3d(id,project_id,r2_key,mime,size_bytes,caption,created_by,created_at) SELECT ?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM geo_client_gallery_3d WHERE project_id=? AND deleted_at IS NULL)<10")
      .bind(id,project.id,key,upload.type,upload.size,caption,actor.email,now,project.id),
    audit(env,actor,project.id,id,"geo.client_gallery_uploaded")
   ]);
   if(result[0]?.meta?.changes!==1)throw Error("Gallery limit or concurrent upload. Retry.");
  }catch(error){
   await env.MODEL_ASSETS.delete(key);
   return json({error:error instanceof Error?error.message:"Gallery upload failed."},409);
  }
  return json({ok:true,id},201);
 }
 if(request.method==="DELETE"){
  const raw=await request.text();
  if(raw.length>500)return json({error:"Invalid gallery request."},400);
  const body=JSON.parse(raw);
  if(!uuid(body?.id))return json({error:"Invalid image ID."},400);
  const row=await env.DB.prepare("SELECT r2_key AS key FROM geo_client_gallery_3d WHERE id=? AND project_id=? AND deleted_at IS NULL").bind(body.id,project.id).first();
  if(!row)return json({error:"Image not found."},404);
  const result=await env.DB.batch([
   env.DB.prepare("UPDATE geo_client_gallery_3d SET deleted_at=? WHERE id=? AND project_id=? AND deleted_at IS NULL")
    .bind(new Date().toISOString(),body.id,project.id),
   audit(env,actor,project.id,body.id,"geo.client_gallery_deleted")
  ]);
  if(result[0]?.meta?.changes!==1)return json({error:"Image was already deleted."},409);
  try{await env.MODEL_ASSETS.delete(row.key);}catch(error){console.error("Tombstoned image cleanup pending",error);}
  return json({ok:true});
 }
 return json({error:"Method not allowed."},405);
}
