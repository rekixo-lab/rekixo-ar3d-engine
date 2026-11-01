import {activeGeoReleaseState,publicGeoExperienceFromState} from "./geo-release-runtime.mjs";
import {normalizeImageModelAlignment,evaluateImageModelAlignment} from "../shared/geo-plot-image-alignment.js";

const reply=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
const validHash=value=>typeof value==="string"&&/^[a-f0-9]{64}$/i.test(value);
const iso=()=>new Date().toISOString();
async function publishedModel(env,ctx){
  const release=await activeGeoReleaseState(env,ctx.project.slug);
  if(release.state!=="ok")throw Error("The current sealed Geo release must be valid before image alignment.");
  const experience=await publicGeoExperienceFromState(env,release);
  if(experience.geoRelease?.id!==ctx.active?.geo_release_id||
     experience.buildingRelease?.id!==ctx.active?.source_building_release_id)
    throw Error("The Geo/Building model changed. Reload the alignment workspace.");
  const model=experience.canonicalModel||experience.model;
  if(!validHash(model?.sha256))
    throw Error("An immutable canonical GLB SHA-256 is required before image alignment.");
  return model.sha256.toLowerCase();
}
async function ownedImage(env,projectId,id){
  const row=await env.DB.prepare(
    "SELECT id,sha256,kind,mime_type,byte_size,deleted_at FROM studio_assets_3d WHERE id=? AND project_id=?"
  ).bind(id,projectId).first();
  if(!row||row.deleted_at||row.kind!=="reference"||
     !["image/png","image/jpeg","image/webp"].includes(row.mime_type)||
     row.byte_size<100||row.byte_size>16*1024*1024||!validHash(row.sha256))
    throw Error("Select an owned, private, checksum-verified original masterplan reference.");
  return row;
}
async function readRow(env,projectId){
  return env.DB.prepare("SELECT * FROM geo_plot_image_alignment_drafts_3d WHERE project_id=?")
    .bind(projectId).first();
}
function asDraft(row){
  if(!row)return null;
  return {imageAssetId:row.image_asset_id,imageSha256:row.image_sha256,
    geoReleaseId:row.geo_release_id,buildingReleaseId:row.building_release_id,
    modelSha256:row.model_sha256,anchors:JSON.parse(row.control_points_json),
    checkpoints:JSON.parse(row.checkpoints_json)};
}
async function snapshot(env,ctx,modelHash){
  const row=await readRow(env,ctx.project.id);
  if(!row)return {revision:0,verifiedRevision:null,draft:null,stale:false,modelSha256:modelHash};
  const image=await env.DB.prepare(
    "SELECT sha256,deleted_at FROM studio_assets_3d WHERE id=? AND project_id=?"
  ).bind(row.image_asset_id,ctx.project.id).first();
  const stale=row.geo_release_id!==ctx.active?.geo_release_id||
    row.building_release_id!==ctx.active?.source_building_release_id||
    row.model_sha256!==modelHash||!image||image.deleted_at||image.sha256!==row.image_sha256;
  return {revision:row.revision,verifiedRevision:row.verified_revision,
    draft:asDraft(row),stale:Boolean(stale),modelSha256:modelHash};
}
async function audit(env,ctx,actor,action,details){
  await env.DB.prepare(
    "INSERT INTO engine_admin_audit(id,actor_email,action,project_id,target_id,details_json,created_at) VALUES(?,?,?,?,?,?,?)"
  ).bind(crypto.randomUUID(),actor.email,action,ctx.project.id,ctx.project.id,
    JSON.stringify(details),iso()).run();
}
async function save(env,ctx,actor,body,modelHash){
  const expected=body.expectedRevision;
  if(!Number.isInteger(expected)||expected<0)
    throw Error("The exact previous alignment draft revision is required.");
  const draft=normalizeImageModelAlignment(body.draft);
  if(draft.geoReleaseId!==ctx.active.geo_release_id||
     draft.buildingReleaseId!==ctx.active.source_building_release_id||
     draft.modelSha256!==modelHash)
    throw Error("Alignment is pinned to another Geo/Building model. Reload.");
  const image=await ownedImage(env,ctx.project.id,draft.imageAssetId);
  if(image.sha256.toLowerCase()!==draft.imageSha256)
    throw Error("Original image checksum changed. Review the approved source.");
  const old=await readRow(env,ctx.project.id);
  if((old?.revision||0)!==expected)
    throw Error("Alignment changed in another tab. Reload before saving.");
  const switched=Boolean(old&&(old.image_asset_id!==draft.imageAssetId||
    old.image_sha256!==draft.imageSha256||old.geo_release_id!==draft.geoReleaseId||
    old.building_release_id!==draft.buildingReleaseId||old.model_sha256!==draft.modelSha256));
  if(switched&&(!body.confirmSourceChange||draft.anchors.length||draft.checkpoints.length))
    throw Error("Changing source requires an explicit archived review snapshot and empty new control points.");
  const now=iso(),controls=JSON.stringify(draft.anchors),checks=JSON.stringify(draft.checkpoints);
  let stmt;
  if(expected===0){
    stmt=env.DB.prepare(`INSERT INTO geo_plot_image_alignment_drafts_3d
      (project_id,image_asset_id,image_sha256,geo_release_id,building_release_id,model_sha256,
       revision,verified_revision,control_points_json,checkpoints_json,updated_by,updated_at)
      VALUES(?,?,?,?,?,?,1,NULL,?,?,?,?) ON CONFLICT(project_id) DO NOTHING`)
    .bind(ctx.project.id,draft.imageAssetId,draft.imageSha256,draft.geoReleaseId,
      draft.buildingReleaseId,draft.modelSha256,controls,checks,actor.email,now);
  }else{
    stmt=env.DB.prepare(`UPDATE geo_plot_image_alignment_drafts_3d
      SET image_asset_id=?,image_sha256=?,geo_release_id=?,building_release_id=?,model_sha256=?,
      revision=revision+1,verified_revision=NULL,control_points_json=?,checkpoints_json=?,
      updated_by=?,updated_at=?
      WHERE project_id=? AND revision=? AND EXISTS(
        SELECT 1 FROM geo_experience_active_releases_3d ar
        JOIN geo_releases_3d gr ON gr.id=ar.geo_release_id AND gr.project_id=ar.project_id
        WHERE ar.project_id=geo_plot_image_alignment_drafts_3d.project_id
          AND ar.experience_id=? AND ar.geo_release_id=? AND gr.source_building_release_id=?)
      AND EXISTS(SELECT 1 FROM studio_assets_3d a WHERE a.id=? AND a.project_id=?
        AND a.deleted_at IS NULL AND a.sha256=?)`)
      .bind(draft.imageAssetId,draft.imageSha256,draft.geoReleaseId,draft.buildingReleaseId,
        draft.modelSha256,controls,checks,actor.email,now,ctx.project.id,expected,
        ctx.active.experience_id,ctx.active.geo_release_id,ctx.active.source_building_release_id,
        draft.imageAssetId,ctx.project.id,draft.imageSha256);
  }
  const result=await stmt.run();
  if(result.meta?.changes!==1)
    throw Error("Source or alignment revision changed during Save. Nothing was overwritten.");
  await audit(env,ctx,actor,"geo.image_alignment_saved",
    {revision:expected+1,imageAssetId:draft.imageAssetId,sourceSwitched:switched,
     anchorCount:draft.anchors.length,checkpointCount:draft.checkpoints.length});
  return snapshot(env,ctx,modelHash);
}
async function verify(env,ctx,actor,body,modelHash){
  const row=await readRow(env,ctx.project.id);
  if(!row||!Number.isInteger(body.expectedRevision)||row.revision!==body.expectedRevision)
    throw Error("Save the exact current image alignment draft before verifying.");
  const draft=normalizeImageModelAlignment(asDraft(row));
  if(draft.geoReleaseId!==ctx.active.geo_release_id||
     draft.buildingReleaseId!==ctx.active.source_building_release_id||
     draft.modelSha256!==modelHash)
    throw Error("Current Geo/Building release differs from the alignment source.");
  const image=await ownedImage(env,ctx.project.id,draft.imageAssetId);
  if(image.sha256.toLowerCase()!==draft.imageSha256)
    throw Error("The original reference image has been replaced or changed.");
  // Independent held-out points are never included in the least-squares fit.
  const assessment=evaluateImageModelAlignment(draft,{requireCheckpoints:true});
  const result=await env.DB.prepare(`UPDATE geo_plot_image_alignment_drafts_3d
    SET verified_revision=revision,updated_by=?,updated_at=?
    WHERE project_id=? AND revision=? AND image_asset_id=? AND image_sha256=?
      AND geo_release_id=? AND building_release_id=? AND model_sha256=?
      AND EXISTS(SELECT 1 FROM studio_assets_3d a WHERE a.id=geo_plot_image_alignment_drafts_3d.image_asset_id
        AND a.project_id=geo_plot_image_alignment_drafts_3d.project_id
        AND a.deleted_at IS NULL AND a.sha256=geo_plot_image_alignment_drafts_3d.image_sha256)
      AND EXISTS(SELECT 1 FROM geo_experience_active_releases_3d ar
        JOIN geo_releases_3d gr ON gr.id=ar.geo_release_id AND gr.project_id=ar.project_id
        WHERE ar.project_id=geo_plot_image_alignment_drafts_3d.project_id
          AND ar.experience_id=? AND ar.geo_release_id=? AND gr.source_building_release_id=?)`)
    .bind(actor.email,iso(),ctx.project.id,row.revision,draft.imageAssetId,draft.imageSha256,
      draft.geoReleaseId,draft.buildingReleaseId,draft.modelSha256,
      ctx.active.experience_id,draft.geoReleaseId,draft.buildingReleaseId).run();
  if(result.meta?.changes!==1)throw Error("Image or Geo source changed during verification.");
  await audit(env,ctx,actor,"geo.image_alignment_verified",
    {revision:row.revision,imageAssetId:draft.imageAssetId,maxFitMetres:assessment.maxFitMetres,
     maxCheckpointMetres:assessment.maxCheckpointMetres,reviewLimitMetres:assessment.limitMetres});
  return snapshot(env,ctx,modelHash);
}
export async function handleGeoPlotAlignment(request,env,ctx,actor){
  if(request.method!=="GET"&&request.method!=="PUT"&&request.method!=="POST")
    return reply({error:"Method not allowed."},405);
  if(request.method!=="GET"&&ctx.project.status==="archived")
    return reply({error:"Archived project is read-only."},409);
  const modelHash=await publishedModel(env,ctx);
  if(request.method==="GET")return reply(await snapshot(env,ctx,modelHash));
  const raw=await request.text();
  if(new TextEncoder().encode(raw).byteLength>48_000)
    return reply({error:"Alignment payload is too large."},413);
  let body;
  try{body=JSON.parse(raw);}catch{return reply({error:"Invalid alignment JSON."},400);}
  try{
    if(request.method==="PUT")return reply(await save(env,ctx,actor,body,modelHash));
    if(body?.action==="verify")return reply(await verify(env,ctx,actor,body,modelHash));
    return reply({error:"Unknown image alignment action."},400);
  }catch(error){
    return reply({error:error instanceof Error?error.message:"Alignment operation failed."},409);
  }
}
