// Release-bound legacy Geo plot commercial facts. Owner-only writes;
// no identifying buyer details or unsupported listing claims are made public.
import {validateGeoPlotCollection} from "./geo-plot-geometry.mjs";
const sha=async text=>Array.from(new Uint8Array(await crypto.subtle.digest(
 "SHA-256",new TextEncoder().encode(text)))).map(b=>b.toString(16).padStart(2,"0")).join("");
const reply=(body,status=200)=>Response.json(body,{status,headers:{
 "Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
const validPlotId=v=>typeof v==="string"&&/^[A-Za-z0-9][A-Za-z0-9._/-]{0,47}$/.test(v);
export function normalizeGeoCommercialChange(body){
  if(!body||typeof body!=="object"||Array.isArray(body))
    throw Error("Geo commercial fact must be an object.");
  if(!validPlotId(body.plotId))throw Error("Canonical Plot ID is required.");
  if(!["available","booked","sold"].includes(body.status))
    throw Error("Only Available, Booked or Sold are allowed after actual owner review.");
  if(!Number.isInteger(body.expectedRevision)||body.expectedRevision<0)
    throw Error("Exact current commercial revision is required.");
  if(body.pricePaise!==null&&body.pricePaise!==undefined&&
    (!Number.isSafeInteger(body.pricePaise)||body.pricePaise<0||body.pricePaise>1e12))
    throw Error("Price must be a non-negative integer in INR paise, or null.");
  if(body.currency!==undefined&&body.currency!=="INR")
    throw Error("Commercial pricing must be in INR.");
  if(typeof body.evidenceRef!=="string")throw Error("Evidence reference must be text from a reviewed source.");
  const evidenceRef=body.evidenceRef.trim();
  if(evidenceRef.length<3||evidenceRef.length>250||/[\x00-\x1f\x7f]/.test(evidenceRef))
    throw Error("Current signed/source evidence reference (3–250 characters) is required.");
  if(typeof body.publicApproved!=="boolean")
    throw Error("Explicit owner approval is required to display commercial data publicly.");
  const rawId=body.plotId;
  return {plotId:rawId,status:body.status,pricePaise:body.pricePaise??null,
    currency:"INR",evidenceRef,publicApproved:body.publicApproved,
    expectedRevision:body.expectedRevision};
}
export async function activeMap(env,ctx){
  const row=await env.DB.prepare(`SELECT r.id,r.sha256,r.plots_json
    FROM geo_plot_mapping_active_3d a
    JOIN geo_plot_mapping_releases_3d r ON r.id=a.mapping_release_id
      AND r.project_id=a.project_id AND r.experience_id=a.experience_id
    WHERE a.project_id=? AND a.experience_id=?
      AND r.geo_release_id=? AND r.building_release_id=?`)
    .bind(ctx.project.id,ctx.active.experience_id,ctx.active.geo_release_id,
      ctx.active.source_building_release_id).first();
  if(!row)return null;
  if(await sha(row.plots_json)!==row.sha256)
    throw Error("Commercial source mapping checksum mismatch; data cannot be approved.");
  return {releaseId:row.id,plots:validateGeoPlotCollection(JSON.parse(row.plots_json))};
}
async function listState(env,ctx,source){
  if(!source)return {mappingReleaseId:null,rows:[],notice:"Current verified published mapping required before commercial approval."};
  const rows=await env.DB.prepare(`SELECT plot_id AS plotId,status,price_paise AS pricePaise,
    currency,evidence_ref AS evidenceRef,public_approved AS publicApproved,
    revision,updated_at AS updatedAt
    FROM geo_plot_commercial_3d WHERE project_id=? AND mapping_release_id=?
    ORDER BY plot_id COLLATE NOCASE LIMIT 2500`)
    .bind(ctx.project.id,source.releaseId).all();
  return {mappingReleaseId:source.releaseId,plotCount:source.plots.length,
    rows:(rows.results||[]).map(r=>({...r,publicApproved:r.publicApproved===1})),
    notice:"Owner-reviewed commercial facts only. No buyer/payment ledger equivalence is implied."};
}
export async function handleGeoPlotCommercial(request,env,ctx,actor,{allowApprove=true}={}){
  if(!["GET","PUT"].includes(request.method))
    return reply({error:"Method not allowed."},405);
  try{
    const source=await activeMap(env,ctx);
    if(request.method==="GET")return reply(await listState(env,ctx,source));
    if(ctx.project.status==="archived")throw Error("Archived projects are read-only.");
    if(!source)throw Error("Publish a verified source-bound Geo mapping before commercial approval.");
    const raw=await request.text();
    if(raw.length>8192)throw Error("Commercial change exceeds request safety limit.");
    const info=normalizeGeoCommercialChange(JSON.parse(raw));
    if(info.publicApproved&&!allowApprove)
      return reply({error:"Only an owner or designated approver may approve public commercial facts."},403);
    const target=source.plots.find(p=>p.id.toLowerCase()===info.plotId.toLowerCase());
    if(!target)throw Error("Commercial Plot ID is not in the active immutable mapping.");
    const existing=await env.DB.prepare(`SELECT revision FROM geo_plot_commercial_3d
      WHERE project_id=? AND mapping_release_id=? AND plot_id=?`)
      .bind(ctx.project.id,source.releaseId,target.id).first();
    if(Number(existing?.revision||0)!==info.expectedRevision)
      throw Error("Commercial record was changed elsewhere. Reload before saving.");
    const next=info.expectedRevision+1,now=new Date().toISOString(),approved=info.publicApproved?1:0;
    const guard=`EXISTS(SELECT 1 FROM geo_plot_mapping_active_3d a
      JOIN geo_plot_mapping_releases_3d r ON r.id=a.mapping_release_id
        AND r.project_id=a.project_id AND r.experience_id=a.experience_id
      WHERE a.project_id=? AND a.experience_id=? AND a.mapping_release_id=?
        AND r.geo_release_id=? AND r.building_release_id=?)`;
    const args=[ctx.project.id,ctx.active.experience_id,source.releaseId,
      ctx.active.geo_release_id,ctx.active.source_building_release_id];
    const first=info.expectedRevision===0?
      env.DB.prepare(`INSERT INTO geo_plot_commercial_3d
        (project_id,mapping_release_id,plot_id,status,price_paise,currency,
          evidence_ref,public_approved,revision,updated_by,updated_at)
        SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ${guard}
        AND NOT EXISTS(SELECT 1 FROM geo_plot_commercial_3d
          WHERE project_id=? AND mapping_release_id=? AND plot_id=?)`)
      .bind(ctx.project.id,source.releaseId,target.id,info.status,info.pricePaise,"INR",
        info.evidenceRef,approved,next,actor.email,now,...args,
        ctx.project.id,source.releaseId,target.id)
      : env.DB.prepare(`UPDATE geo_plot_commercial_3d SET status=?,price_paise=?,
        evidence_ref=?,public_approved=?,revision=revision+1,updated_by=?,updated_at=?
        WHERE project_id=? AND mapping_release_id=? AND plot_id=? AND revision=?
          AND ${guard}`)
      .bind(info.status,info.pricePaise,info.evidenceRef,approved,actor.email,now,
        ctx.project.id,source.releaseId,target.id,info.expectedRevision,...args);
    const event={plotId:target.id,status:info.status,pricePaise:info.pricePaise,
      currency:"INR",evidenceRef:info.evidenceRef,
      publicApproved:info.publicApproved,revision:next};
    const results=await env.DB.batch([
      first,
      env.DB.prepare(`INSERT INTO geo_plot_commercial_events_3d
        (id,project_id,mapping_release_id,plot_id,revision,event_json,actor_email,created_at)
        SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM geo_plot_commercial_3d
          WHERE project_id=? AND mapping_release_id=? AND plot_id=? AND revision=?)`)
        .bind(crypto.randomUUID(),ctx.project.id,source.releaseId,target.id,next,
          JSON.stringify(event),actor.email,now,ctx.project.id,source.releaseId,target.id,next),
      env.DB.prepare(`INSERT INTO engine_admin_audit
        (id,actor_email,action,project_id,target_id,details_json,created_at)
        SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM geo_plot_commercial_3d
          WHERE project_id=? AND mapping_release_id=? AND plot_id=? AND revision=?)`)
        .bind(crypto.randomUUID(),actor.email,"geo.commercial_reviewed",ctx.project.id,
          target.id,JSON.stringify({mappingReleaseId:source.releaseId,status:info.status,
          hasPrice:info.pricePaise!==null,publicApproved:info.publicApproved,
          revision:next}),now,ctx.project.id,source.releaseId,target.id,next)
    ]);
    if(results[0]?.meta?.changes!==1||results[1]?.meta?.changes!==1)
      throw Error("Concurrent mapping or commercial revision change; reload.");
    return reply(await listState(env,ctx,source));
  }catch(error){return reply({error:error instanceof Error?error.message:"Commercial review failed."},409);}
}
export async function publicGeoCommercialForRelease(env,projectId,mappingId,plotIds){
  // This function is called only after the public Geo release/mapping checksum
  // has been verified. It returns no evidence, actors, phones or buyers.
  if(!mappingId||!Array.isArray(plotIds)||plotIds.length>2500)return {};
  const approved=await env.DB.prepare(`SELECT plot_id,status,price_paise,currency
    FROM geo_plot_commercial_3d
    WHERE project_id=? AND mapping_release_id=? AND public_approved=1
    ORDER BY plot_id COLLATE NOCASE LIMIT 2500`).bind(projectId,mappingId).all();
  const canonical=new Map(plotIds.map(id=>[id.toLowerCase(),id]));
  const publicValues={};
  for(const row of approved.results||[]){
    const id=canonical.get(String(row.plot_id).toLowerCase());
    if(id&&["available","booked","sold"].includes(row.status)&&
       (row.price_paise===null||Number.isSafeInteger(row.price_paise)))
      publicValues[id]={status:row.status,pricePaise:row.price_paise,currency:"INR"};
  }
  return publicValues;
}
