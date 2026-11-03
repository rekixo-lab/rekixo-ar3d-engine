// Private project-scoped booking details. Never edit polygon geometry or sell a plot.
import {activeMap} from "./geo-plot-commercial.mjs";
const respond=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
const safe=(s,max)=>typeof s==="string"&&s.length<=max&&!/[\x00-\x1f\x7f]/.test(s);
export async function clientGeoPlotDetails(request,env,ctx,actor){
 if(!["GET","PUT"].includes(request.method))return respond({error:"Method not allowed."},405);
 if(request.method==="PUT"&&actor.role!=="client_admin")return respond({error:"Client Admin required."},403);
 try{
  const source=await activeMap(env,ctx);
  if(!source)return respond({mappingReleaseId:null,rows:[],notice:"Verified published mapping unavailable."},request.method==="GET"?200:409);
  if(request.method==="GET"){
   const r=await env.DB.prepare("SELECT plot_id AS plotId,owner_name AS ownerName,broker_name AS brokerName,booking_amount_paise AS bookingAmountPaise,notes,revision,updated_at AS updatedAt FROM geo_client_plot_details_3d WHERE project_id=? AND mapping_release_id=? ORDER BY plot_id LIMIT 2500").bind(ctx.project.id,source.releaseId).all();
   return respond({mappingReleaseId:source.releaseId,rows:r.results||[]});
  }
  if(ctx.project.status==="archived")return respond({error:"Archived project is read-only."},409);
  const raw=await request.text();
  if(raw.length>4096)return respond({error:"Details request too large."},413);
  const b=JSON.parse(raw);
  if(!b||typeof b.plotId!=="string"||!Number.isInteger(b.expectedRevision)||b.expectedRevision<0||
    !safe(b.ownerName,160)||!safe(b.brokerName,160)||!safe(b.notes,600)||
    (b.bookingAmountPaise!==null&&(!Number.isSafeInteger(b.bookingAmountPaise)||b.bookingAmountPaise<0||b.bookingAmountPaise>1e12)))
   return respond({error:"Invalid booking details or revision."},400);
  const plot=source.plots.find(p=>p.id.toLowerCase()===b.plotId.toLowerCase());
  if(!plot)return respond({error:"Plot is not in the active published mapping."},404);
  const old=await env.DB.prepare("SELECT revision FROM geo_client_plot_details_3d WHERE project_id=? AND mapping_release_id=? AND plot_id=?").bind(ctx.project.id,source.releaseId,plot.id).first();
  if(Number(old?.revision||0)!==b.expectedRevision)return respond({error:"Details changed in another session. Reload first."},409);
  const revision=b.expectedRevision+1,time=new Date().toISOString(),identity=[ctx.project.id,source.releaseId,plot.id];
  const owner=b.ownerName.trim(),broker=b.brokerName.trim(),notes=b.notes.trim();
  const guard="EXISTS(SELECT 1 FROM geo_plot_mapping_active_3d WHERE project_id=? AND mapping_release_id=?)";
  const change=b.expectedRevision===0?
   env.DB.prepare("INSERT INTO geo_client_plot_details_3d(project_id,mapping_release_id,plot_id,owner_name,broker_name,booking_amount_paise,notes,revision,updated_by,updated_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE "+guard+" AND NOT EXISTS(SELECT 1 FROM geo_client_plot_details_3d WHERE project_id=? AND mapping_release_id=? AND plot_id=?)")
   .bind(...identity,owner,broker,b.bookingAmountPaise,notes,revision,actor.email,time,ctx.project.id,source.releaseId,...identity):
   env.DB.prepare("UPDATE geo_client_plot_details_3d SET owner_name=?,broker_name=?,booking_amount_paise=?,notes=?,revision=revision+1,updated_by=?,updated_at=? WHERE project_id=? AND mapping_release_id=? AND plot_id=? AND revision=? AND "+guard)
   .bind(owner,broker,b.bookingAmountPaise,notes,actor.email,time,...identity,b.expectedRevision,ctx.project.id,source.releaseId);
  const event={plotId:plot.id,ownerName:owner,brokerName:broker,bookingAmountPaise:b.bookingAmountPaise,notes,revision};
  const results=await env.DB.batch([
   change,
   env.DB.prepare("INSERT INTO geo_client_plot_detail_events_3d(id,project_id,mapping_release_id,plot_id,revision,actor_email,detail_json,created_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM geo_client_plot_details_3d WHERE project_id=? AND mapping_release_id=? AND plot_id=? AND revision=?)")
    .bind(crypto.randomUUID(),...identity,revision,actor.email,JSON.stringify(event),time,...identity,revision),
   env.DB.prepare("INSERT INTO engine_admin_audit(id,actor_email,action,project_id,target_id,details_json,created_at) SELECT ?,?,'geo.client_plot_details_updated',?,?,?,? WHERE EXISTS(SELECT 1 FROM geo_client_plot_details_3d WHERE project_id=? AND mapping_release_id=? AND plot_id=? AND revision=?)")
    .bind(crypto.randomUUID(),actor.email,ctx.project.id,plot.id,JSON.stringify({mappingReleaseId:source.releaseId,revision}),time,...identity,revision)
  ]);
  if(results[0]?.meta?.changes!==1||results[1]?.meta?.changes!==1||results[2]?.meta?.changes!==1)
   return respond({error:"Concurrent update. Reload details."},409);
  return clientGeoPlotDetails(new Request(request.url,{method:"GET"}),env,ctx,actor);
 }catch(error){return respond({error:error instanceof Error?error.message:"Plot details unavailable."},409);}
}
