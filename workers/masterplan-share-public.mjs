import { assertDraftAssetKey } from "./storage-boundary.mjs";
import { serveR2Object } from "./http-range.mjs";
async function shareState(env,slug){
  const row=await env.DB.prepare(`SELECT p.id AS project_id,p.name AS project_name,
    s.title,s.description,s.id AS share_id,s.card_sha256,s.card_asset_id,
    a.r2_key,a.mime_type,a.byte_size,a.sha256 AS asset_sha256,a.deleted_at
    FROM projects_3d p JOIN masterplan_share_active_3d active ON active.project_id=p.id
    JOIN masterplan_share_releases_3d s ON s.id=active.release_id AND s.project_id=p.id
    JOIN masterplan_geo_active_3d m ON m.project_id=p.id AND m.release_id=s.mapping_release_id
    JOIN studio_assets_3d a ON a.id=s.card_asset_id AND a.project_id=p.id
    WHERE p.slug=? AND p.status='published' AND p.project_kind='masterplan_geo' LIMIT 1`)
    .bind(slug).first();
  if(!row)return null;
  if(row.deleted_at || row.asset_sha256!==row.card_sha256 ||
      !["image/jpeg","image/webp","image/png"].includes(row.mime_type) ||
      row.byte_size>550*1024)
    return null;
  assertDraftAssetKey(slug,row.card_asset_id,row.r2_key);
  return row;
}
export async function publicMasterplanShareSnapshot(env,slug){
  const r=await shareState(env,slug);
  if(!r)return null;
  return {title:r.title,description:r.description,shareImageUrl:
    `/3Dprojects/api/projects/${encodeURIComponent(slug)}/masterplan-share-card?v=${encodeURIComponent(r.share_id)}`,
    logoUrl:"",faviconUrl:"",hasShareCard:true};
}
export async function servePublicMasterplanShareCard(request,env,slug){
  if(!["GET","HEAD"].includes(request.method))
    return Response.json({error:"Method not allowed"},{status:405});
  const row=await shareState(env,slug);
  if(!row)return Response.json({error:"Published share card unavailable."},{status:404});
  const obj=await serveR2Object(env.MODEL_ASSETS,row.r2_key,request,{
    mimeType:row.mime_type,expectedSize:row.byte_size,sha256:row.card_sha256,
    cacheControl:"public,max-age=300,must-revalidate",allowRange:false
  });
  return obj.response||Response.json({error:"Missing share card"},{status:503});
}
