import { validateMasterplanDraft } from "./masterplan-geo-geometry.mjs";
import { assertDraftAssetKey } from "./storage-boundary.mjs";
import { serveR2Object } from "./http-range.mjs";
const digest=async text=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",
  new TextEncoder().encode(text)))).map(n=>n.toString(16).padStart(2,"0")).join("");
const err=(message,status=404)=>Response.json({error:message},{status,headers:{"Cache-Control":"no-store"}});
async function released(env,slug){
  const row=await env.DB.prepare(`SELECT p.id AS project_id,p.name,p.location,
      r.id AS release_id,r.version,r.mapping_json,r.mapping_sha256,
      r.source_asset_id,r.source_sha256,a.r2_key,a.mime_type,a.byte_size,a.sha256 AS asset_sha256,
      a.deleted_at
    FROM projects_3d p JOIN masterplan_geo_active_3d active ON active.project_id=p.id
      JOIN masterplan_geo_releases_3d r ON r.id=active.release_id AND r.project_id=p.id
      JOIN studio_assets_3d a ON a.id=r.source_asset_id AND a.project_id=p.id
    WHERE p.slug=? AND p.project_kind='masterplan_geo' AND p.status='published'
    LIMIT 1`).bind(slug).first();
  if(!row)return null;
  if(row.deleted_at || row.source_sha256!==row.asset_sha256 ||
     await digest(row.mapping_json)!==row.mapping_sha256)
    throw Error("Published masterplan source or mapping integrity mismatch.");
  const data=JSON.parse(row.mapping_json);
  const reviewed=validateMasterplanDraft({
    imageAssetId:data.image?.assetId,width:data.image?.width,height:data.image?.height,
    controlPoints:data.controlPoints,plots:data.plots},{publish:true});
  const expected=reviewed.calibration;
  const stored=data.calibration;
  // The published JSON hash alone does not prove the saved transform is
  // numerically usable. Recompute from approved controls and require an
  // exact, finite Geo transform so the customer map cannot render NaNs.
  const sameVector=(actual,verified)=>Array.isArray(actual) &&
    actual.length===3 && verified.every((value,i)=>
      typeof actual[i]==="number" && Number.isFinite(actual[i]) &&
      Math.abs(actual[i]-value)<=1e-12);
  if(data.schema!=="rekixo-masterplan-geo-v1"||
     !stored||!expected||
     !sameVector(stored.transform?.lat,expected.transform.lat)||
     !sameVector(stored.transform?.lng,expected.transform.lng)||
     !Number.isFinite(stored.maxResidualM)||
     Math.abs(stored.maxResidualM-expected.maxResidualM)>0.00001||
     !Number.isFinite(stored.sizeM?.width)||
     !Number.isFinite(stored.sizeM?.height)||
     Math.abs(stored.sizeM.width-expected.sizeM.width)>0.001||
     Math.abs(stored.sizeM.height-expected.sizeM.height)>0.001||
     row.source_asset_id!==reviewed.imageAssetId||
     data.image.sha256!==row.source_sha256||
     data.image.mimeType!==row.mime_type)
    throw Error("Published calibration/source binding is corrupt.");
  assertDraftAssetKey(slug,row.source_asset_id,row.r2_key);
  return {row,data};
}
export async function publicMasterplanResponse(request,env,slug,part){
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
    return err("Invalid project.",400);
  if(!["GET","HEAD"].includes(request.method))return err("Method not allowed.",405);
  let state;
  try{state=await released(env,slug);}
  catch(e){console.error("Masterplan public integrity failure",e);return err("Published masterplan unavailable.",503);}
  if(!state)return err("This masterplan is not published.",404);
  const {row,data}=state;
  if(part==="masterplan-image"){
    const result=await serveR2Object(env.MODEL_ASSETS,row.r2_key,request,{
      mimeType:row.mime_type,expectedSize:row.byte_size,sha256:row.source_sha256,
      cacheControl:"private,max-age=0,must-revalidate",allowRange:false,
       verifyStoredChecksum:true});
    return result.response || err("Approved masterplan image is missing or corrupted.",503);
  }
  if(part!=="masterplan")return err("Unknown masterplan route.");
  const setting=await env.DB.prepare(`SELECT key,value FROM engine_settings_3d
    WHERE key IN ('google_maps_browser_key','google_maps_map_id')`).all();
  const config=new Map((setting.results||[]).map(x=>[x.key,String(x.value||"")]));
  const apiKey=config.get("google_maps_browser_key")||String(env.GOOGLE_MAPS_BROWSER_KEY||"");
  const mapId=config.get("google_maps_map_id")||String(env.GOOGLE_MAPS_MAP_ID||"");
  const json={schema:data.schema,project:{slug,name:row.name,location:row.location||""},
    release:{id:row.release_id,version:row.version},
    image:{url:`/3Dprojects/api/projects/${encodeURIComponent(slug)}/masterplan-image?v=${encodeURIComponent(row.release_id)}`,
      width:data.image.width,height:data.image.height,sha256:row.source_sha256},
    calibration:data.calibration,plots:data.plots,
    maps:{apiKey:apiKey||null,mapId:mapId||null,configured:Boolean(apiKey&&mapId)}};
  return Response.json(json,{headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
}
