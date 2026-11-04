// One-click material/color replacement for an already published Geo site.
// Same geometry AND unchanged WGS84 placement are proven before any mutation.
// A single atomic D1 batch activates the new Geo + matching Plot Mapping so
// customers never see a temporary 36-plot gap. Changed geometry fails closed.
import { activeGeoReleaseState } from "./geo-release-runtime.mjs";
import { releaseStateById } from "./release-runtime.mjs";
import { assertGeoPresentationManifestV1 } from "./geo-presentation-policy.mjs";
import { validateGeoPlotCollection } from "./geo-plot-geometry.mjs";
import { verifyCosmeticModelPair } from "../shared/glb-geometry-identity.js";

const encoder=new TextEncoder();
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),
  n=>n.toString(16).padStart(2,"0")).join("");
const digestText=async text=>digest(encoder.encode(text));
const validSha=sha=>typeof sha==="string"&&/^[a-f0-9]{64}$/i.test(sha);
const stable=object=>JSON.stringify(object);
const MAX_GLB=64*1024*1024;

function modelAsset(released) {
  const model=released?.manifest?.experience?.model;
  const releaseId=released?.manifest?.release?.id;
  const asset=released?.manifest?.assets?.find(a=>a.id===model?.releaseAssetId &&
    a.kind==="model"&&a.logicalId===model.id);
  if (!model||!asset||!validSha(asset.sha256)||!releaseId)
    throw Error("An immutable, SHA-256-pinned Building GLB is required.");
  return {model,asset,releaseId,version:released.manifest.release.version};
}
async function modelBytes(env,ref) {
  const row=await env.DB.prepare(`SELECT r2_key,sha256,byte_size
    FROM release_assets_3d WHERE release_id=? AND kind='model'
      AND logical_id=? AND sha256=? AND project_id=?`).bind(
      ref.releaseId,ref.model.id,ref.asset.sha256,ref.projectId).first();
  if(!row || !Number.isSafeInteger(Number(row.byte_size)) ||
    Number(row.byte_size)<=0 || Number(row.byte_size)>MAX_GLB ||
    Number(row.byte_size)!==Number(ref.asset.byteSize))
    throw Error("The immutable Building GLB is unavailable or too large to compare safely.");
  const expectedKey=`projects/${ref.projectSlug}/releases/${ref.releaseId}/models/${ref.model.id}`;
  if(row.r2_key!==expectedKey)throw Error("The Building model's project storage boundary is invalid.");
  const object=await env.MODEL_ASSETS.get(row.r2_key);
  if(!object)throw Error("The Building GLB is missing from private model storage.");
  const bytes=new Uint8Array(await object.arrayBuffer());
  if(bytes.length!==Number(row.byte_size) ||
    await digest(bytes)!==ref.asset.sha256.toLowerCase())
    throw Error("Immutable Building GLB checksum mismatch. Nothing was replaced.");
  return bytes;
}
function sourceReference(state,project) {
  const src=modelAsset(state);
  if(state.manifest.release.projectId!==project.id ||
    state.manifest.release.projectSlug!==project.slug)
    throw Error("Building release ownership mismatch.");
  return {...src,projectId:project.id,projectSlug:project.slug,
    manifestSha256:state.manifestSha256};
}
function samePlots(current,live) {
  return stable(validateGeoPlotCollection(JSON.parse(current.plots_json)))===
    stable(validateGeoPlotCollection(JSON.parse(live.plots_json)));
}
function validPlacement(manifest) {
  assertGeoPresentationManifestV1(manifest);
  const p=manifest.placement,a=manifest.modelAnchor;
  if(!p.anchor || !a.localPositionM ||
    !["entrance","main-gate","site-center","south-west-corner","custom"].includes(a.kind))
    throw Error("Existing Geo anchor is not compatible with automatic replacement.");
  return {p,a};
}
async function preview(env,project) {
  if(project.status!=="published"||!project.active_release_id)
    throw Error("Publish the new Building version before replacing Geo.");
  const active=await activeGeoReleaseState(env,project.slug);
  if(active.state!=="ok"||active.manifestKind!=="v2")
    throw Error("A healthy Geo V2 release is required for one-click replacement.");
  const newBuilding=await releaseStateById(env,project.slug,project.active_release_id);
  if(newBuilding.state!=="ok")throw Error("The active Building release failed integrity verification.");
  const oldBuilding=active.building;
  if(oldBuilding.manifest.release.id===newBuilding.manifest.release.id)
    return {alreadyCurrent:true,plotCount:0};
  const previous=sourceReference(oldBuilding,project),next=sourceReference(newBuilding,project);
  const [oldBytes,newBytes]=await Promise.all([modelBytes(env,previous),modelBytes(env,next)]);
  const geometry=await verifyCosmeticModelPair(oldBytes,newBytes);
  if(!geometry.equal) throw Error("Auto comparison could not confirm identical plotted geometry: "+
    (geometry.reason || "the visible 3D surfaces differ.")+
    " Old Geo and mapped plots were NOT changed. If you edited colors only, "+
    "re-export from the original source without changing layout.");
  // Cosmetic releases explicitly render the unchanged canonical GLB, not a
  // separately simplified Geo derivative whose vertex topology may differ.
  const {p,a}=validPlacement(active.manifest);
  const experience=await env.DB.prepare(`SELECT id,source_building_release_id,lifecycle
    FROM experiences_3d WHERE id=? AND project_id=? AND type='geo'`).bind(
      active.experienceId,project.id).first();
  const draft=await env.DB.prepare(`SELECT * FROM geo_experience_drafts_3d
    WHERE project_id=? AND experience_id=?`).bind(project.id,active.experienceId).first();
  if(!experience||experience.lifecycle!=="active"||!draft ||
    ![previous.releaseId,next.releaseId].includes(experience.source_building_release_id) ||
    ![previous.releaseId,next.releaseId].includes(draft.source_building_release_id))
    throw Error("Geo draft has another Building source. Review it before automatic replacement.");
  // Do not overwrite a separately edited, unpublished site placement. Cosmetic
  // replacement reuses the CURRENT LIVE Geo truth, not an unapproved re-fit.
  const sameGeoValues=[
    ["longitude",p.anchor.longitude],["latitude",p.anchor.latitude],
    ["altitude_m",p.anchor.altitudeM??0],["east_offset_m",p.eastOffsetM],
    ["north_offset_m",p.northOffsetM],["vertical_offset_m",p.verticalOffsetM],
    ["heading_deg",p.headingDeg],["pitch_deg",p.pitchDeg],
    ["roll_deg",p.rollDeg],["scale",p.scale]
  ].every(([column,value])=>Number(draft[column])===Number(value));
  if(!sameGeoValues||draft.height_mode!==p.heightMode)
    throw Error("An unpublished Geo placement change exists. The current live site is safe; "+
      "review or restore that Geo draft before using cosmetic-only Auto Update.");
  const mapping=await env.DB.prepare(`SELECT r.*
    FROM geo_plot_mapping_active_3d a JOIN geo_plot_mapping_releases_3d r
    ON r.id=a.mapping_release_id AND r.project_id=a.project_id AND r.experience_id=a.experience_id
    WHERE a.project_id=? AND a.experience_id=?`).bind(project.id,active.experienceId).first();
  const mapDraft=await env.DB.prepare(`SELECT * FROM geo_plot_mapping_drafts_3d
    WHERE project_id=?`).bind(project.id).first();
  let plotCount=0,commercialCount=0;
  if(mapping){
    if(mapping.geo_release_id!==active.manifest.release.id||
      mapping.building_release_id!==previous.releaseId||
      !validSha(mapping.sha256)||
      await digestText(mapping.plots_json)!==mapping.sha256 ||
      !mapDraft||mapDraft.experience_id!==active.experienceId ||
      mapDraft.geo_release_id!==mapping.geo_release_id ||
      mapDraft.building_release_id!==mapping.building_release_id ||
      !samePlots(mapDraft,mapping))
      throw Error("Unpublished Plot Mapper changes or a stale Mapping Release require review. "+
        "The existing live site is safe; no automatic overwrite will occur.");
    plotCount=validateGeoPlotCollection(JSON.parse(mapping.plots_json)).length;
    const commercial=await env.DB.prepare(`SELECT COUNT(*) AS n
      FROM geo_plot_commercial_3d WHERE project_id=? AND mapping_release_id=?`)
      .bind(project.id,mapping.id).first();
    commercialCount=Number(commercial?.n||0);
    // A paid sale/receipt is a unique financial ledger entry: never duplicate
    // it to another Mapping Release, and never silently hide it from Client Admin.
    const financial=await env.DB.prepare(`SELECT COUNT(*) AS n
      FROM geo_client_sales_3d WHERE project_id=? AND mapping_release_id=?`)
      .bind(project.id,mapping.id).first();
    if(Number(financial?.n||0)>0)
      throw Error("This project contains client sale or receipt records. Automatic Geo replacement "+
        "is blocked until its financial-ledger continuity is reviewed. Existing live plots and "+
        "payment records remain untouched.");
    const pricing=await env.DB.prepare(`SELECT quotes_json,sha256 FROM geo_plot_pricing_sheets_3d
      WHERE project_id=? AND mapping_release_id=?`).bind(project.id,mapping.id).first();
    if(pricing && await digestText(pricing.quotes_json)!==pricing.sha256)
      throw Error("Pricing sheet checksum mismatch. The current live site was not changed.");
  }else if(mapDraft && validateGeoPlotCollection(JSON.parse(mapDraft.plots_json)).length){
    throw Error("Unpublished plot boundaries cannot be overwritten by automatic replacement.");
  }
  const newAnchor=await env.DB.prepare(`SELECT id FROM geo_model_anchors_3d
    WHERE project_id=? AND experience_id=? AND source_building_release_id=?
      AND source_building_release_version=? AND kind=?
      AND x_m=? AND y_m=? AND z_m=?
    ORDER BY created_at DESC LIMIT 1`).bind(
      project.id,active.experienceId,next.releaseId,Number(next.version),
      a.kind,a.localPositionM.x,a.localPositionM.y,a.localPositionM.z).first();
  const token=await digestText(stable({
    project:project.id,activeGeo:active.manifest.release.id,
    oldGeoSha:await digestText(stable(active.manifest)),
    oldBuilding:previous.releaseId,newBuilding:next.releaseId,
    oldModel:previous.asset.sha256,newModel:next.asset.sha256,
    geometry:geometry.oldGeometry.sha256,oldMapping:mapping?.id||null,
    oldMappingSha:mapping?.sha256||null,geoDraftRevision:draft.revision,
    mapDraftRevision:mapDraft?.revision||null,sourceOfExperience:experience.source_building_release_id,
    anchor:newAnchor?.id||null
  }));
  return {
    token,alreadyCurrent:false,oldGeo:active,oldBuilding:previous,newBuilding:next,
    geometry:geometry.oldGeometry,placement:p,anchor:a,matchedAnchorId:newAnchor?.id||null,
    experience,draft,mapping,mapDraft,plotCount,commercialCount
  };
}
export async function previewCosmeticGeoReplacement(env,project){
  const plan=await preview(env,project);
  if(plan.alreadyCurrent)return {alreadyCurrent:true,eligible:false,plotCount:0};
  return {alreadyCurrent:false,eligible:true,token:plan.token,
    fromBuildingVersion:plan.oldBuilding.version,toBuildingVersion:plan.newBuilding.version,
    plotCount:plan.plotCount,commercialCount:plan.commercialCount,
    proof:plan.geometry.mode==="world-surface"
      ?"Visible 3D triangles and real-world coordinates match despite different GLB node or mesh ordering."
      :"Exact original GLB geometry, transforms and model-local coordinates match."};
}

export async function applyCosmeticGeoReplacement(env,actor,project,expectedToken){
  if(!validSha(expectedToken))
    throw Error("Use the new model comparison before applying Geo replacement.");
  // Re-read both sealed GLB bytes and all active revisions, not a stale UI claim.
  const p=await preview(env,project);
  if(p.alreadyCurrent)return {alreadyCurrent:true};
  if(p.token!==expectedToken)throw Error("Building, Geo or mapped plots changed. Compare again before replacing.");
  const {oldGeo,oldBuilding,newBuilding,experience,draft,mapping,mapDraft}=p;
  const now=new Date().toISOString();
  const newGeoId="geo_release_"+crypto.randomUUID();
  const newMappingId=mapping?"geo_plot_"+crypto.randomUUID():null;
  const anchorId=p.matchedAnchorId||"geo_anchor_"+crypto.randomUUID();
  const geoRevision=Number(draft.revision)+1;
  const mappingRevision=mapDraft?Number(mapDraft.revision)+1:null;
  const versions=await Promise.all([
    env.DB.prepare("SELECT COALESCE(MAX(version),0)+1 AS v FROM geo_releases_3d WHERE experience_id=?")
      .bind(experience.id).first(),
    mapping?env.DB.prepare("SELECT COALESCE(MAX(version),0)+1 AS v FROM geo_plot_mapping_releases_3d WHERE experience_id=?")
      .bind(experience.id).first():Promise.resolve(null)
  ]);
  const geoVersion=Number(versions[0].v),mappingVersion=versions[1]?Number(versions[1].v):null;
  const snapshot=structuredClone(oldGeo.manifest);
  snapshot.release={...snapshot.release,id:newGeoId,version:geoVersion,
    sourceDraftRevision:geoRevision,createdAt:now};
  snapshot.sourceBuilding={releaseId:newBuilding.releaseId,version:Number(newBuilding.version),
    manifestSha256:newBuilding.manifestSha256};
  snapshot.model={id:newBuilding.model.id,
    url:`/3Dprojects/api/releases/${encodeURIComponent(newBuilding.releaseId)}/models/${encodeURIComponent(newBuilding.model.id)}/model.glb?v=${encodeURIComponent(String(newBuilding.version))}`,
    mimeType:"model/gltf-binary",sha256:newBuilding.asset.sha256,variant:"building",
    preferCanonical:true};
  snapshot.modelAnchor={...snapshot.modelAnchor,id:anchorId};
  assertGeoPresentationManifestV1(snapshot);
  const manifestJson=stable(snapshot),manifestSha=await digestText(manifestJson);
  const oldGeoId=oldGeo.manifest.release.id;
  const anchor=p.anchor,pv=p.placement;
  const statements=[
    // A failing CAS aborts the ENTIRE D1 batch. No intermediate live state.
    env.DB.prepare(`INSERT INTO engine_admin_audit(id,actor_email,action,project_id,target_id,details_json,created_at)
      VALUES (?,?,?,?,?,CASE WHEN
        EXISTS(SELECT 1 FROM projects_3d WHERE id=? AND active_release_id=? AND status='published')
        AND EXISTS(SELECT 1 FROM geo_experience_active_releases_3d
          WHERE project_id=? AND experience_id=? AND geo_release_id=?)
        AND EXISTS(SELECT 1 FROM geo_experience_drafts_3d
          WHERE project_id=? AND experience_id=? AND revision=? AND source_building_release_id=?)
        AND EXISTS(SELECT 1 FROM experiences_3d
          WHERE project_id=? AND id=? AND source_building_release_id=? AND lifecycle='active')
        AND (? IS NULL OR EXISTS(SELECT 1 FROM geo_plot_mapping_active_3d
          WHERE project_id=? AND experience_id=? AND mapping_release_id=?))
        AND (? IS NULL OR EXISTS(SELECT 1 FROM geo_plot_mapping_drafts_3d
          WHERE project_id=? AND experience_id=? AND revision=? AND geo_release_id=?))
      THEN ? ELSE json_extract('INVALID_REPLACEMENT_STATE','$') END,?)`).bind(
        crypto.randomUUID(),actor.email,"geo.cosmetic_replacement_checked",project.id,newGeoId,
        project.id,newBuilding.releaseId,project.id,experience.id,oldGeoId,
        project.id,experience.id,draft.revision,draft.source_building_release_id,
        project.id,experience.id,experience.source_building_release_id,
        mapping?.id||null,project.id,experience.id,mapping?.id||null,
        mapDraft?.revision??null,project.id,experience.id,mapDraft?.revision??null,mapDraft?.geo_release_id||null,
        stable({oldGeoId,oldBuildingId:oldBuilding.releaseId,newBuildingId:newBuilding.releaseId,
          verifiedGeometrySha256:p.geometry.sha256,oldModelSha256:oldBuilding.asset.sha256,
          newModelSha256:newBuilding.asset.sha256,plots:p.plotCount,commercialRows:p.commercialCount}),
        now
      ),
    env.DB.prepare(`UPDATE geo_experience_drafts_3d SET model_anchor_id=NULL
      WHERE experience_id=? AND project_id=?`).bind(experience.id,project.id),
    env.DB.prepare(`UPDATE experiences_3d
      SET source_building_release_id=?,updated_at=? WHERE id=? AND project_id=? AND type='geo'`)
      .bind(newBuilding.releaseId,now,experience.id,project.id)
  ];
  if(!p.matchedAnchorId)statements.push(env.DB.prepare(`INSERT INTO geo_model_anchors_3d
    (id,experience_id,project_id,source_building_release_id,source_building_release_version,
      kind,name,x_m,y_m,z_m,created_by,updated_by,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      anchorId,experience.id,project.id,newBuilding.releaseId,Number(newBuilding.version),
      anchor.kind,anchor.name,anchor.localPositionM.x,anchor.localPositionM.y,anchor.localPositionM.z,
      actor.email,actor.email,now,now));
  statements.push(
    env.DB.prepare(`UPDATE geo_experience_drafts_3d SET
      source_building_release_id=?,source_building_release_version=?,
      longitude=?,latitude=?,altitude_m=?,heading_deg=?,pitch_deg=?,roll_deg=?,scale=?,
      height_mode=?,east_offset_m=?,north_offset_m=?,vertical_offset_m=?,model_anchor_id=?,
      revision=revision+1,updated_by=?,updated_at=?
      WHERE project_id=? AND experience_id=? AND revision=?`).bind(
      newBuilding.releaseId,Number(newBuilding.version),
      pv.anchor.longitude,pv.anchor.latitude,pv.anchor.altitudeM??0,
      pv.headingDeg,pv.pitchDeg,pv.rollDeg,pv.scale,
      pv.heightMode,pv.eastOffsetM,pv.northOffsetM,pv.verticalOffsetM,
      anchorId,actor.email,now,project.id,experience.id,draft.revision),
    env.DB.prepare(`INSERT INTO geo_draft_verifications_3d
      (experience_id,project_id,draft_revision,source_building_release_id,
       source_building_release_version,verified_by,verified_at)
      VALUES(?,?,?,?,?,?,?)`).bind(
        experience.id,project.id,geoRevision,newBuilding.releaseId,Number(newBuilding.version),
        actor.email,now),
    env.DB.prepare(`INSERT INTO geo_releases_3d
      (id,experience_id,project_id,version,manifest_json,manifest_sha256,
       source_draft_revision,source_building_release_id,source_building_release_version,
       created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(
        newGeoId,experience.id,project.id,geoVersion,manifestJson,manifestSha,
        geoRevision,newBuilding.releaseId,Number(newBuilding.version),actor.email,now)
  );
  if(mapping){
    statements.push(
      env.DB.prepare(`INSERT INTO geo_plot_mapping_releases_3d
        (id,project_id,experience_id,geo_release_id,building_release_id,version,
         draft_revision,plots_json,sha256,publication_mode,created_by,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
          newMappingId,project.id,experience.id,newGeoId,newBuilding.releaseId,
          mappingVersion,mappingRevision,mapping.plots_json,mapping.sha256,
          mapping.publication_mode,actor.email,now),
      env.DB.prepare(`INSERT INTO geo_plot_commercial_3d
        (project_id,mapping_release_id,plot_id,status,price_paise,currency,
         evidence_ref,public_approved,revision,updated_by,updated_at)
         SELECT project_id,?,plot_id,status,price_paise,currency,evidence_ref,
           public_approved,1,?,?
         FROM geo_plot_commercial_3d WHERE project_id=? AND mapping_release_id=?`).bind(
          newMappingId,actor.email,now,project.id,mapping.id),
      env.DB.prepare(`INSERT INTO geo_plot_commercial_events_3d
        (id,project_id,mapping_release_id,plot_id,revision,event_json,actor_email,created_at)
        SELECT lower(hex(randomblob(16))),project_id,?,plot_id,1,
          json_object('action','geometry-identical-cosmetic-replacement',
          'previousMappingReleaseId',?,'verifiedGeometrySha256',?,
          'preservedApproval',public_approved,'status',status),
          ?,?
        FROM geo_plot_commercial_3d WHERE project_id=? AND mapping_release_id=?`).bind(
          newMappingId,mapping.id,p.geometry.sha256,actor.email,now,project.id,mapping.id),
      // Private records are version-scoped, not duplicated bank transactions.
      // Preserve their values and source provenance on this new equal-geometry mapping.
      env.DB.prepare(`INSERT INTO geo_plot_pricing_sheets_3d
        (project_id,mapping_release_id,revision,quotes_json,sha256,source_ref,updated_by,updated_at)
        SELECT project_id,?,revision,quotes_json,sha256,source_ref,updated_by,updated_at
        FROM geo_plot_pricing_sheets_3d WHERE project_id=? AND mapping_release_id=?`)
        .bind(newMappingId,project.id,mapping.id),
      env.DB.prepare(`INSERT INTO geo_plot_deals_3d
        (project_id,mapping_release_id,plot_id,stage,buyer_name,buyer_phone,
         claimed_payment_paise,payment_reference,agreement_reference,
         registration_reference,evidence_reference,notes,revision,updated_by,updated_at)
        SELECT project_id,?,plot_id,stage,buyer_name,buyer_phone,
         claimed_payment_paise,payment_reference,agreement_reference,
         registration_reference,evidence_reference,notes,revision,updated_by,updated_at
        FROM geo_plot_deals_3d WHERE project_id=? AND mapping_release_id=?`)
        .bind(newMappingId,project.id,mapping.id),
      env.DB.prepare(`INSERT INTO geo_plot_deal_events_3d
        (id,project_id,mapping_release_id,plot_id,revision,event_json,actor_email,created_at)
        SELECT lower(hex(randomblob(16))),project_id,?,plot_id,revision,event_json,actor_email,created_at
        FROM geo_plot_deal_events_3d WHERE project_id=? AND mapping_release_id=?`)
        .bind(newMappingId,project.id,mapping.id),
      env.DB.prepare(`INSERT INTO geo_client_plot_details_3d
        (project_id,mapping_release_id,plot_id,owner_name,broker_name,
         booking_amount_paise,notes,revision,updated_by,updated_at)
        SELECT project_id,?,plot_id,owner_name,broker_name,
         booking_amount_paise,notes,revision,updated_by,updated_at
        FROM geo_client_plot_details_3d WHERE project_id=? AND mapping_release_id=?`)
        .bind(newMappingId,project.id,mapping.id),
      env.DB.prepare(`INSERT INTO geo_client_plot_detail_events_3d
        (id,project_id,mapping_release_id,plot_id,revision,actor_email,detail_json,created_at)
        SELECT lower(hex(randomblob(16))),project_id,?,plot_id,revision,actor_email,detail_json,created_at
        FROM geo_client_plot_detail_events_3d WHERE project_id=? AND mapping_release_id=?`)
        .bind(newMappingId,project.id,mapping.id),
      env.DB.prepare(`INSERT INTO geo_client_notices_3d
        (id,project_id,mapping_release_id,plot_id,title,body,state,revision,
         created_by,updated_by,updated_at,published_at)
        SELECT lower(hex(randomblob(16))),project_id,?,plot_id,title,body,state,revision,
          created_by,updated_by,updated_at,published_at
        FROM geo_client_notices_3d WHERE project_id=? AND mapping_release_id=?`)
        .bind(newMappingId,project.id,mapping.id),
      env.DB.prepare(`UPDATE geo_plot_mapping_drafts_3d SET
        geo_release_id=?,building_release_id=?,revision=revision+1,
        verified_revision=CASE WHEN verified_revision=revision THEN revision+1 ELSE NULL END,
        updated_by=?,updated_at=?
        WHERE project_id=? AND experience_id=? AND revision=?`).bind(
          newGeoId,newBuilding.releaseId,actor.email,now,
          project.id,experience.id,mapDraft.revision)
    );
  }else if(mapDraft){
    statements.push(env.DB.prepare(`UPDATE geo_plot_mapping_drafts_3d
      SET geo_release_id=?,building_release_id=?,revision=revision+1,
      verified_revision=NULL,updated_by=?,updated_at=?
      WHERE project_id=? AND experience_id=? AND revision=?`).bind(
        newGeoId,newBuilding.releaseId,actor.email,now,project.id,experience.id,mapDraft.revision));
  }
  statements.push(
    env.DB.prepare(`UPDATE geo_experience_active_releases_3d
      SET geo_release_id=?,updated_by=?,updated_at=?
      WHERE project_id=? AND experience_id=? AND geo_release_id=?`).bind(
        newGeoId,actor.email,now,project.id,experience.id,oldGeoId),
    ...(mapping?[env.DB.prepare(`UPDATE geo_plot_mapping_active_3d
      SET mapping_release_id=?,updated_by=?,updated_at=?
      WHERE project_id=? AND experience_id=? AND mapping_release_id=?`).bind(
        newMappingId,actor.email,now,project.id,experience.id,mapping.id)]:[]),
    env.DB.prepare(`INSERT INTO geo_release_activations_3d
      (id,experience_id,project_id,geo_release_id,previous_geo_release_id,action,actor_email,created_at)
      VALUES(?,?,?,?,?,'publish',?,?)`).bind(
        crypto.randomUUID(),experience.id,project.id,newGeoId,oldGeoId,actor.email,now),
    env.DB.prepare(`INSERT INTO engine_admin_audit
      (id,actor_email,action,project_id,target_id,details_json,created_at)
      VALUES(?,?,?,?,?,?,?)`).bind(
        crypto.randomUUID(),actor.email,"geo.cosmetic_replacement_completed",
        project.id,newGeoId,stable({previousGeo:oldGeoId,previousMapping:mapping?.id||null,
          newMapping:newMappingId,geometrySha256:p.geometry.sha256,
          plotCount:p.plotCount,commercialCount:p.commercialCount,
          commercialApprovalsPreservedByByteIdenticalGeometry:true,
          geoPlacementUnchanged:true,atomic:true}),now)
  );
  await env.DB.batch(statements);
  return {updated:true,geoReleaseVersion:geoVersion,mappingReleaseVersion:mappingVersion,
    plotCount:p.plotCount,commercialCount:p.commercialCount,geoReleaseId:newGeoId,
    mappingReleaseId:newMappingId,geometrySha256:p.geometry.sha256};
}

export async function handleEasyGeoReplacement(request,env,actor,project){
  if(request.method!=="GET" && request.method!=="POST")
    return Response.json({error:"Method not allowed."},{status:405});
  if(request.method==="POST"){
    let same=false;
    try{same=new URL(request.headers.get("Origin")||"").origin===new URL(request.url).origin;}
    catch{same=false;}
    if(!same)return Response.json({error:"Same-origin request required."},{status:403});
  }
  try{
    const body=request.method==="POST"?await request.json().catch(()=>({})):null;
    const result=request.method==="GET"
      ?await previewCosmeticGeoReplacement(env,project)
      :await applyCosmeticGeoReplacement(env,actor,project,String(body?.expectedToken||""));
    return Response.json(result,{headers:{"Cache-Control":"no-store"}});
  }catch(error){
    const message=error instanceof Error?error.message:"Automatic Geo replacement failed.";
    return Response.json({error:message},{status:
      /integrity|unavailable|missing from private model storage|failed checksum/i.test(message)?503:409,
      headers:{"Cache-Control":"no-store"}});
  }
}
