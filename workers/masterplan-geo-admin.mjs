import { validateMasterplanDraft } from "./masterplan-geo-geometry.mjs";
const json=(payload,status=200)=>Response.json(payload,{status,headers:{"Cache-Control":"no-store"}});
const fail=(error,status=409)=>json({error},status);
const sha256=async value=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",
  new TextEncoder().encode(value)))).map(n=>n.toString(16).padStart(2,"0")).join("");
const utc=()=>new Date().toISOString();
const checkOrigin=request=>{
  try{return new URL(request.headers.get("origin")||"").origin===new URL(request.url).origin;}
  catch{return false;}
};
async function asset(env,project,id){
  const row=await env.DB.prepare(`SELECT id,project_id,kind,mime_type,byte_size,sha256,r2_key,deleted_at
    FROM studio_assets_3d WHERE id=? AND project_id=? LIMIT 1`).bind(id,project.id).first();
  if(!row||row.deleted_at||row.kind!=="source"||!["image/png","image/jpeg","image/webp"].includes(row.mime_type)||
      row.byte_size<100||row.byte_size>50*1024*1024)
    throw Error("Select an owned, uploaded PNG/JPEG/WebP masterplan source (max 50 MB).");
  return row;
}
async function audit(env,actor,action,project,targetId,extra={}){
  await env.DB.prepare(`INSERT INTO engine_admin_audit
   (id,actor_email,action,project_id,target_id,details_json,created_at) VALUES(?,?,?,?,?,?,?)`)
   .bind(crypto.randomUUID(),actor.email,action,project.id,targetId,JSON.stringify(extra),utc()).run();
}
async function snapshot(env,project){
  const [d,a,history]=await Promise.all([
    env.DB.prepare("SELECT * FROM masterplan_geo_drafts_3d WHERE project_id=?").bind(project.id).first(),
    env.DB.prepare(`SELECT r.id,r.version,r.draft_revision,r.mapping_sha256,r.published_at FROM masterplan_geo_active_3d a
      JOIN masterplan_geo_releases_3d r ON r.id=a.release_id AND r.project_id=a.project_id
      WHERE a.project_id=?`).bind(project.id).first(),
    env.DB.prepare(`SELECT id,version,published_at AS publishedAt
      FROM masterplan_geo_releases_3d WHERE project_id=? ORDER BY version DESC LIMIT 30`).bind(project.id).all(),
  ]);
  return {project:{id:project.id,slug:project.slug,name:project.name,location:project.location||"",
    kind:project.project_kind,status:project.status},
    draft:d?{revision:d.revision,verifiedRevision:d.verified_revision,
      imageAssetId:d.image_asset_id,width:d.source_width,height:d.source_height,
      controlPoints:JSON.parse(d.control_points_json),plots:JSON.parse(d.plots_json)}
      :{revision:0,verifiedRevision:null,imageAssetId:null,width:0,height:0,controlPoints:[],plots:[]},
    activeRelease:a?{id:a.id,version:a.version,draftRevision:a.draft_revision,
      sha256:a.mapping_sha256,publishedAt:a.published_at}:null,
    history:history.results||[]};
}
async function save(env,actor,project,body){
  if(!Number.isInteger(body.expectedRevision)||body.expectedRevision<0)
    throw Error("Expected draft revision required.");
  const draft=validateMasterplanDraft(body.draft);
  await asset(env,project,draft.imageAssetId);
  const controls=JSON.stringify(draft.controlPoints),plots=JSON.stringify(draft.plots);
  if(controls.length+plots.length>4_000_000)throw Error("Masterplan mapping exceeds 4 MB.");
  const now=utc();let result;
  if(body.expectedRevision===0){
    result=await env.DB.prepare(`INSERT INTO masterplan_geo_drafts_3d
     (project_id,image_asset_id,source_width,source_height,control_points_json,plots_json,
      revision,verified_revision,updated_by,updated_at)
     VALUES(?,?,?,?,?,?,1,NULL,?,?) ON CONFLICT(project_id) DO NOTHING`)
     .bind(project.id,draft.imageAssetId,draft.width,draft.height,controls,plots,actor.email,now).run();
  }else{
    result=await env.DB.prepare(`UPDATE masterplan_geo_drafts_3d
     SET image_asset_id=?,source_width=?,source_height=?,control_points_json=?,plots_json=?,
     revision=revision+1,verified_revision=NULL,updated_by=?,updated_at=?
     WHERE project_id=? AND revision=?`)
     .bind(draft.imageAssetId,draft.width,draft.height,controls,plots,actor.email,now,
       project.id,body.expectedRevision).run();
  }
  if(result.meta?.changes!==1)throw Error("Draft changed in another tab. Reload before saving.");
  await audit(env,actor,"masterplan.draft_saved",project,project.id,
    {revision:body.expectedRevision+1,plotCount:draft.plots.length});
  return snapshot(env,project);
}
async function loadDraft(env,project,expectedRevision){
  const d=await env.DB.prepare("SELECT * FROM masterplan_geo_drafts_3d WHERE project_id=?")
    .bind(project.id).first();
  if(!d||d.revision!==expectedRevision)throw Error("Masterplan draft changed. Reload.");
  const reviewed=validateMasterplanDraft({
    imageAssetId:d.image_asset_id,width:d.source_width,height:d.source_height,
    controlPoints:JSON.parse(d.control_points_json),plots:JSON.parse(d.plots_json)},
    {publish:true});
  // New image-masterplan releases must review the actual road-facing Front
  // before verification. Do not change the immutable public release validator:
  // historical sealed versions must remain readable and reactivatable.
  for(const plot of reviewed.plots){
    if(plot.road && plot.sides.front?.roadFacing!==true)
      throw Error("Plot "+plot.id+": select the road-facing FRONT edge and mark Road-facing before verification.");
  }
  const source=await asset(env,project,reviewed.imageAssetId);
  return {d,reviewed,source};
}
async function verify(env,actor,project,body){
  const {d}=await loadDraft(env,project,body.expectedRevision);
  const res=await env.DB.prepare(`UPDATE masterplan_geo_drafts_3d
    SET verified_revision=revision,updated_by=?,updated_at=?
    WHERE project_id=? AND revision=? AND image_asset_id=?
      AND EXISTS(SELECT 1 FROM studio_assets_3d a WHERE a.id=masterplan_geo_drafts_3d.image_asset_id
        AND a.project_id=masterplan_geo_drafts_3d.project_id AND a.deleted_at IS NULL)`)
    .bind(actor.email,utc(),project.id,d.revision,d.image_asset_id).run();
  if(res.meta?.changes!==1)throw Error("Source changed during verification.");
  await audit(env,actor,"masterplan.verified",project,project.id,{revision:d.revision});
  return snapshot(env,project);
}
async function publish(env,actor,project,body){
  const {d,reviewed,source}=await loadDraft(env,project,body.expectedRevision);
  if(d.verified_revision!==d.revision)throw Error("Save and Verify this exact revision before Publish.");
  const already=await env.DB.prepare(`SELECT r.id,
    EXISTS(SELECT 1 FROM masterplan_geo_active_3d a
      WHERE a.project_id=r.project_id AND a.release_id=r.id) AS active
    FROM masterplan_geo_releases_3d r WHERE r.project_id=? AND r.draft_revision=?`)
    .bind(project.id,d.revision).first();
  if(already?.active)return snapshot(env,project);
  if(already)throw Error("This verified draft was published earlier. Activate that release from History.");
  const mapping={schema:"rekixo-masterplan-geo-v1",
    image:{assetId:source.id,width:reviewed.width,height:reviewed.height,
      sha256:source.sha256,mimeType:source.mime_type},
    calibration:reviewed.calibration,
    controlPoints:reviewed.controlPoints,
    plots:reviewed.plots};
  const text=JSON.stringify(mapping),hash=await sha256(text);
  const next=await env.DB.prepare("SELECT COALESCE(MAX(version),0)+1 AS version FROM masterplan_geo_releases_3d WHERE project_id=?")
    .bind(project.id).first();
  const id=crypto.randomUUID(),now=utc();
  // D1 batch is atomic; source must still belong to project and draft must
  // remain precisely the verified version. The active FK rejects failed inserts.
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO masterplan_geo_releases_3d
      (id,project_id,version,source_asset_id,source_sha256,width,height,mapping_json,
       mapping_sha256,draft_revision,published_by,published_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?
      WHERE EXISTS(SELECT 1 FROM masterplan_geo_drafts_3d d
        WHERE d.project_id=? AND d.revision=? AND d.verified_revision=d.revision
          AND d.image_asset_id=? AND d.source_width=? AND d.source_height=?)
        AND EXISTS(SELECT 1 FROM studio_assets_3d a
          WHERE a.id=? AND a.project_id=? AND a.deleted_at IS NULL AND a.sha256=?)`)
       .bind(id,project.id,next.version,source.id,source.sha256,reviewed.width,reviewed.height,
         text,hash,d.revision,actor.email,now,project.id,d.revision,source.id,
         reviewed.width,reviewed.height,source.id,project.id,source.sha256),
    env.DB.prepare(`INSERT INTO masterplan_geo_active_3d(project_id,release_id,updated_by,updated_at)
      VALUES(?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET
      release_id=excluded.release_id,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
       .bind(project.id,id,actor.email,now),
    env.DB.prepare("UPDATE projects_3d SET status='published',updated_at=? WHERE id=? AND project_kind='masterplan_geo'")
      .bind(now,project.id),
    env.DB.prepare(`INSERT INTO engine_admin_audit
      (id,actor_email,action,project_id,target_id,details_json,created_at)
      VALUES(?,?,?,?,?,?,?)`)
       .bind(crypto.randomUUID(),actor.email,"masterplan.published",project.id,id,
         JSON.stringify({version:next.version,revision:d.revision,plotCount:reviewed.plots.length,
           mappingSha256:hash,sourceSha256:source.sha256}),now)
  ]);
  return snapshot(env,project);
}
async function activate(env,actor,project,body){
  const id=String(body.releaseId||"");
  const old=await env.DB.prepare(`SELECT * FROM masterplan_geo_releases_3d WHERE id=? AND project_id=?`)
    .bind(id,project.id).first();
  if(!old||await sha256(old.mapping_json)!==old.mapping_sha256)
    throw Error("Mapping release missing or failed immutable checksum verification.");
  const now=utc();
  await env.DB.batch([
    env.DB.prepare(`UPDATE masterplan_geo_active_3d SET release_id=?,updated_by=?,updated_at=?
      WHERE project_id=? AND EXISTS(SELECT 1 FROM masterplan_geo_releases_3d
      WHERE id=? AND project_id=?)`).bind(id,actor.email,now,project.id,id,project.id),
    env.DB.prepare(`INSERT INTO engine_admin_audit
      (id,actor_email,action,project_id,target_id,details_json,created_at)
      VALUES(?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),actor.email,
        "masterplan.activated",project.id,id,JSON.stringify({version:old.version}),now)
  ]);
  return snapshot(env,project);
}
export async function handleMasterplanGeoAdmin(request,env,actor,project,parts=[]){
  if(parts.length!==2||parts[1]!=="masterplan-geo")return null;
  if(project.project_kind!=="masterplan_geo")
    return fail("Masterplan Geo workspace is only available for masterplan_geo projects.",403);
  if(request.method==="GET")return json(await snapshot(env,project));
  if(!["PUT","POST"].includes(request.method))return fail("Method not allowed.",405);
  if(!checkOrigin(request))return fail("Same-origin request required.",403);
  if(project.status==="archived")return fail("Archived project is read-only.");
  const raw=await request.text();
  if(raw.length>4_500_000)return fail("Mapping request exceeds limit.",413);
  let body;try{body=JSON.parse(raw);}catch{return fail("Invalid JSON request.",400);}
  try{
    if(request.method==="PUT")return json(await save(env,actor,project,body));
    if(body.action==="verify")return json(await verify(env,actor,project,body));
    if(body.action==="publish")return json(await publish(env,actor,project,body));
    if(body.action==="activate")return json(await activate(env,actor,project,body));
    return fail("Unknown masterplan action.",400);
  }catch(e){
    const msg=e instanceof Error?e.message:"Masterplan operation failed.";
    return fail(msg,409);
  }
}
