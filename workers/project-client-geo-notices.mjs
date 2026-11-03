// Project-bound, release-bound plot update drafts and explicit publication.
import {activeMap} from "./geo-plot-commercial.mjs";
const json=(value,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
const uuid=x=>typeof x==="string"&&/^[0-9a-f-]{36}$/i.test(x);
const safe=(x,max)=>typeof x==="string"&&x.length<=max&&!/[\x00-\x1f\x7f]/.test(x);
export async function clientGeoNotices(request,env,ctx,actor){
 if(!["GET","POST","PUT","DELETE"].includes(request.method))return json({error:"Method not allowed."},405);
 try{
  const source=await activeMap(env,ctx);
  if(!source)return json({mappingReleaseId:null,notices:[],notice:"Publish a source-bound mapping first."},request.method==="GET"?200:409);
  if(request.method==="GET"){
   const result=await env.DB.prepare("SELECT id,plot_id AS plotId,title,body,state,revision,updated_at AS updatedAt,published_at AS publishedAt FROM geo_client_notices_3d WHERE project_id=? AND mapping_release_id=? ORDER BY updated_at DESC LIMIT 250").bind(ctx.project.id,source.releaseId).all();
   return json({mappingReleaseId:source.releaseId,notices:result.results||[]});
  }
  if(actor.role!=="client_admin")return json({error:"Client Admin required."},403);
  if(ctx.project.status==="archived")return json({error:"Archived project is read-only."},409);
  const raw=await request.text();
  if(raw.length>4096)return json({error:"Notice too large."},413);
  const b=JSON.parse(raw),time=new Date().toISOString();
  if(request.method==="DELETE"){
   if(!uuid(b?.id)||!Number.isInteger(b.expectedRevision))return json({error:"Invalid notice."},400);
   const old=await env.DB.prepare("SELECT id FROM geo_client_notices_3d WHERE id=? AND project_id=? AND mapping_release_id=? AND state='draft' AND revision=?").bind(b.id,ctx.project.id,source.releaseId,b.expectedRevision).first();
   if(!old)return json({error:"Only current draft notices can be deleted."},409);
   const res=await env.DB.batch([
    env.DB.prepare("DELETE FROM geo_client_notices_3d WHERE id=? AND project_id=? AND mapping_release_id=? AND state='draft' AND revision=?").bind(b.id,ctx.project.id,source.releaseId,b.expectedRevision),
    env.DB.prepare("INSERT INTO engine_admin_audit(id,actor_email,action,project_id,target_id,details_json,created_at) VALUES(?,?,'geo.client_notice_deleted',?,?,?,?)").bind(crypto.randomUUID(),actor.email,ctx.project.id,b.id,JSON.stringify({mappingReleaseId:source.releaseId}),time)
   ]);
   return json({ok:res[0]?.meta?.changes===1},res[0]?.meta?.changes===1?200:409);
  }
  if(!b||!safe(b.plotId,48)||!safe(b.title,120)||!safe(b.body,1200)||!b.title.trim()||!b.body.trim()||
      !["draft","published"].includes(b.state)||!Number.isInteger(b.expectedRevision)||b.expectedRevision<0)
   return json({error:"Invalid plot notice, title, text or revision."},400);
  const plot=source.plots.find(p=>p.id.toLowerCase()===b.plotId.toLowerCase());
  if(!plot)return json({error:"Plot absent from the active published mapping."},404);
  const id=request.method==="POST"?crypto.randomUUID():b.id;
  if(request.method==="PUT"&&!uuid(id))return json({error:"Valid notice ID required."},400);
  const old=request.method==="PUT"?await env.DB.prepare("SELECT revision FROM geo_client_notices_3d WHERE id=? AND project_id=? AND mapping_release_id=?").bind(id,ctx.project.id,source.releaseId).first():null;
  if((request.method==="POST"&&b.expectedRevision!==0)||(request.method==="PUT"&&old?.revision!==b.expectedRevision))
   return json({error:"Notice changed. Reload before saving."},409);
  const title=b.title.trim(),body=b.body.trim(),published=b.state==="published"?time:null;
  const statement=request.method==="POST"?
   env.DB.prepare("INSERT INTO geo_client_notices_3d(id,project_id,mapping_release_id,plot_id,title,body,state,revision,created_by,updated_by,updated_at,published_at) SELECT ?,?,?,?,?,? ,?,1,?,?,?,? WHERE EXISTS(SELECT 1 FROM geo_plot_mapping_active_3d WHERE project_id=? AND mapping_release_id=?)")
     .bind(id,ctx.project.id,source.releaseId,plot.id,title,body,b.state,actor.email,actor.email,time,published,ctx.project.id,source.releaseId):
   env.DB.prepare("UPDATE geo_client_notices_3d SET title=?,body=?,state=?,revision=revision+1,updated_by=?,updated_at=?,published_at=CASE WHEN ?='published' THEN COALESCE(published_at,?) ELSE NULL END WHERE id=? AND project_id=? AND mapping_release_id=? AND revision=? AND plot_id=? AND EXISTS(SELECT 1 FROM geo_plot_mapping_active_3d WHERE project_id=? AND mapping_release_id=?)")
     .bind(title,body,b.state,actor.email,time,b.state,time,id,ctx.project.id,source.releaseId,b.expectedRevision,plot.id,ctx.project.id,source.releaseId);
  const res=await env.DB.batch([
   statement,
   env.DB.prepare("INSERT INTO engine_admin_audit(id,actor_email,action,project_id,target_id,details_json,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM geo_client_notices_3d WHERE id=? AND project_id=? AND mapping_release_id=?)")
    .bind(crypto.randomUUID(),actor.email,"geo.client_notice_saved",ctx.project.id,id,JSON.stringify({state:b.state,plotId:plot.id,mappingReleaseId:source.releaseId}),time,id,ctx.project.id,source.releaseId)
  ]);
  if(res[0]?.meta?.changes!==1)return json({error:"Notice changed or mapping was replaced."},409);
  return clientGeoNotices(new Request(request.url,{method:"GET"}),env,ctx,actor);
 }catch(error){return json({error:error instanceof Error?error.message:"Notice operation failed."},409);}
}
export async function publishedGeoPlotNotices(env,slug){
 const result=await env.DB.prepare("SELECT n.plot_id AS plotId,n.title,n.body,n.published_at AS publishedAt FROM geo_client_notices_3d n JOIN geo_plot_mapping_active_3d a ON a.project_id=n.project_id AND a.mapping_release_id=n.mapping_release_id JOIN projects_3d p ON p.id=n.project_id WHERE p.slug=? AND p.status='published' AND n.state='published' ORDER BY n.published_at DESC LIMIT 250").bind(slug).all();
 return json({notices:result.results||[]});
}
