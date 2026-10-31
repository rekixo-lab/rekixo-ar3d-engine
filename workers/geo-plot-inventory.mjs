import {normalizeGeoInventoryRows,geoInventoryDiff} from "../shared/geo-plot-inventory.js";

const reply=(value,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"no-store"}});
async function readInventory(env,projectId) {
  const row=await env.DB.prepare(
    "SELECT revision,rows_json,updated_by,updated_at FROM geo_plot_inventory_3d WHERE project_id=?"
  ).bind(projectId).first();
  return row?{revision:row.revision,rows:JSON.parse(row.rows_json),
    updatedBy:row.updated_by,updatedAt:row.updated_at}:
    {revision:0,rows:[],updatedBy:null,updatedAt:null};
}
async function mappedPlotIds(env,ctx) {
  const [draft,active]=await Promise.all([
    env.DB.prepare("SELECT plots_json FROM geo_plot_mapping_drafts_3d WHERE project_id=?")
      .bind(ctx.project.id).first(),
    env.DB.prepare(`SELECT r.plots_json FROM geo_plot_mapping_active_3d a
      JOIN geo_plot_mapping_releases_3d r ON r.id=a.mapping_release_id
       AND r.project_id=a.project_id AND r.experience_id=a.experience_id
      WHERE a.project_id=?`).bind(ctx.project.id).first()
  ]);
  const ids=[];
  for(const result of [draft,active])if(result?.plots_json){
    for(const p of JSON.parse(result.plots_json))if(typeof p.id==="string")ids.push(p.id);
  }
  return [...new Set(ids.map(x=>x.toLowerCase()))];
}
export async function handleGeoPlotInventory(request,env,ctx,actor) {
  const current=await readInventory(env,ctx.project.id);
  if(request.method==="GET")return reply(current);
  if(request.method!=="POST")return reply({error:"Method not allowed."},405);
  if(ctx.project.status==="archived")return reply({error:"Archived project is read-only."},409);
  const raw=await request.text();
  if(raw.length>2_000_000)return reply({error:"Inventory request is larger than 2 MB."},413);
  let body;
  try{body=JSON.parse(raw);}catch{return reply({error:"Invalid inventory JSON."},400);}
  if(!["preflight","import"].includes(body?.action))
    return reply({error:"Expected preflight or import inventory action."},400);
  if(!Number.isInteger(body.expectedRevision)||body.expectedRevision!==current.revision)
    return reply({error:"Inventory changed in another tab. Reload before importing."},409);
  let normalized;
  try{normalized=normalizeGeoInventoryRows(body.rows);}
  catch(error){return reply({error:error instanceof Error?error.message:"Invalid inventory rows."},400);}
  const text=JSON.stringify(normalized);
  if(new TextEncoder().encode(text).byteLength>1_900_000)
    return reply({error:"Normalized inventory exceeds storage limit."},413);
  const mappedIds=await mappedPlotIds(env,ctx);
  const diff=geoInventoryDiff(current.rows,normalized,mappedIds);
  const summary={...diff,rowCount:normalized.length,expectedRevision:current.revision,
    geometryChanged:false,publishedDataChanged:false,approvalsReset:false};
  if(body.action==="preflight")return reply({preview:summary});
  // Fail-closed: never remove an existing inventory row implicitly by omission.
  if(diff.missing.length)return reply({error:
    "CSV omitted existing inventory plot IDs. Re-include every ID before import; no existing rows were removed.",
    missingIds:diff.missing.slice(0,80)},409);
  const now=new Date().toISOString();
  const next=current.revision+1;
  let statement;
  if(current.revision===0){
    statement=env.DB.prepare(`INSERT INTO geo_plot_inventory_3d
      (project_id,revision,rows_json,updated_by,updated_at)
      VALUES (?,1,?,?,?) ON CONFLICT(project_id) DO NOTHING`)
      .bind(ctx.project.id,text,actor.email,now);
  }else{
    statement=env.DB.prepare(`UPDATE geo_plot_inventory_3d
      SET revision=revision+1,rows_json=?,updated_by=?,updated_at=?
      WHERE project_id=? AND revision=?`)
      .bind(text,actor.email,now,ctx.project.id,current.revision);
  }
  const audit=env.DB.prepare(`INSERT INTO engine_admin_audit
    (id,actor_email,action,project_id,target_id,details_json,created_at)
    SELECT ?,?,?,?,?,?,?
    WHERE EXISTS(SELECT 1 FROM geo_plot_inventory_3d
      WHERE project_id=? AND revision=? AND rows_json=? AND updated_at=?)`)
    .bind(crypto.randomUUID(),actor.email,"geo.plot_inventory_imported",
      ctx.project.id,ctx.project.id,JSON.stringify({
        revision:next,count:normalized.length,added:diff.added.length,
        changed:diff.changed.length,mappedMetadataReview:diff.mappedChanged.length
      }),now,ctx.project.id,next,text,now);
  const results=await env.DB.batch([statement,audit]);
  if(results[0]?.meta?.changes!==1||results[1]?.meta?.changes!==1)
    return reply({error:"Concurrent inventory change. Reload; no mapping data was changed."},409);
  const saved=await readInventory(env,ctx.project.id);
  if(saved.revision!==next||JSON.stringify(saved.rows)!==text)
    return reply({error:"Inventory read-back did not match uploaded source."},503);
  return reply({inventory:saved,preview:summary});
}
