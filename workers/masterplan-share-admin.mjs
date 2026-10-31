// Standalone Geo Masterplan social branding. No reuse of Building/Geo release tables.
const json=(v,status=200)=>Response.json(v,{status,headers:{"Cache-Control":"no-store"}});
const fail=(msg,status=409)=>json({error:msg},status);
const origin=req=>{try{return new URL(req.headers.get("origin")||"").origin===new URL(req.url).origin;}
  catch{return false;}};
async function imageAsset(env,project,id){
  const a=await env.DB.prepare(`SELECT id,sha256,mime_type,kind,byte_size,deleted_at
    FROM studio_assets_3d WHERE project_id=? AND id=?`).bind(project.id,id).first();
  if(!a||a.deleted_at||a.kind!=="reference"||
      !["image/jpeg","image/webp","image/png"].includes(a.mime_type)||
      a.byte_size<1024||a.byte_size>550*1024)
    throw Error("Share poster must be an owned, optimized image under 550 KB.");
  return a;
}
async function state(env,project){
  const [d,a,releases]=await Promise.all([
    env.DB.prepare("SELECT * FROM masterplan_share_drafts_3d WHERE project_id=?").bind(project.id).first(),
    env.DB.prepare(`SELECT r.id,r.version,r.revision,r.title,r.description,r.card_asset_id,
     r.published_at FROM masterplan_share_active_3d a
     JOIN masterplan_share_releases_3d r ON r.id=a.release_id AND r.project_id=a.project_id
     WHERE a.project_id=?`).bind(project.id).first(),
    env.DB.prepare(`SELECT id,version,published_at AS publishedAt
      FROM masterplan_share_releases_3d WHERE project_id=? ORDER BY version DESC LIMIT 30`)
      .bind(project.id).all(),
  ]);
  return {project:{slug:project.slug,name:project.name,status:project.status},
    draft:d?{revision:d.revision,title:d.title,description:d.description,cardAssetId:d.card_asset_id}:
      {revision:0,title:project.name,description:"",cardAssetId:null},
    active:a?{id:a.id,version:a.version,revision:a.revision,title:a.title,description:a.description,
      cardAssetId:a.card_asset_id,publishedAt:a.published_at}:null,
    history:releases.results||[],shareUrl:`https://ar3dstudio.in/3Dprojects/${encodeURIComponent(project.slug)}/masterplan${a?"?share="+encodeURIComponent(a.id):""}`};
}
async function audit(env,actor,action,project,id,detail={}){
  await env.DB.prepare(`INSERT INTO engine_admin_audit
    (id,actor_email,action,project_id,target_id,details_json,created_at)
    VALUES(?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),actor.email,action,project.id,id,
    JSON.stringify(detail),new Date().toISOString()).run();
}
export async function handleMasterplanShareAdmin(req,env,actor,project,parts){
  if(parts.length!==2||parts[1]!=="masterplan-share")return null;
  if(project.project_kind!=="masterplan_geo")return fail("Only Geo Masterplan projects may use this share workspace.",403);
  if(req.method==="GET")return json(await state(env,project));
  if(!["PUT","POST"].includes(req.method))return fail("Method not allowed.",405);
  if(!origin(req))return fail("Same-origin request required.",403);
  if(project.status==="archived")return fail("Archived project is read-only.");
  const raw=await req.text();if(raw.length>4000)return fail("Share draft too large.",413);
  let body;try{body=JSON.parse(raw);}catch{return fail("Malformed JSON.",400);}
  try{
    if(req.method==="PUT"){
      const title=String(body.title||"").trim(),description=String(body.description||"").trim();
      const id=String(body.cardAssetId||"");
      if(title.length<3||title.length>120||description.length<10||description.length>280||
         !Number.isInteger(body.expectedRevision)||body.expectedRevision<0)
        throw Error("Share title (3–120), description (10–280) and draft revision required.");
      if(id)await imageAsset(env,project,id);
      const now=new Date().toISOString();let result;
      if(body.expectedRevision===0){
        result=await env.DB.prepare(`INSERT INTO masterplan_share_drafts_3d
          (project_id,title,description,card_asset_id,revision,updated_by,updated_at)
          VALUES(?,?,?,?,1,?,?) ON CONFLICT(project_id) DO NOTHING`)
          .bind(project.id,title,description,id||null,actor.email,now).run();
      }else{
        result=await env.DB.prepare(`UPDATE masterplan_share_drafts_3d SET
          title=?,description=?,card_asset_id=?,revision=revision+1,updated_by=?,updated_at=?
          WHERE project_id=? AND revision=?`)
          .bind(title,description,id||null,actor.email,now,project.id,body.expectedRevision).run();
      }
      if(result.meta?.changes!==1)throw Error("Share draft changed. Reload.");
      await audit(env,actor,"masterplan.share_draft_saved",project,project.id);
      return json(await state(env,project));
    }
    if(req.method==="POST"&&body.action==="publish"){
      const d=await env.DB.prepare("SELECT * FROM masterplan_share_drafts_3d WHERE project_id=?")
        .bind(project.id).first();
      if(!d||d.revision!==body.expectedRevision||!d.card_asset_id)
        throw Error("Upload a share poster and Save the current draft first.");
      const existing=await env.DB.prepare(`SELECT r.id,
        EXISTS(SELECT 1 FROM masterplan_share_active_3d a
          WHERE a.project_id=r.project_id AND a.release_id=r.id) AS active
        FROM masterplan_share_releases_3d r WHERE r.project_id=? AND r.revision=?`)
        .bind(project.id,d.revision).first();
      if(existing?.active)return json(await state(env,project));
      if(existing)throw Error("This Share draft was published earlier. Activate that version from History.");
      const card=await imageAsset(env,project,d.card_asset_id);
      const mapping=await env.DB.prepare(`SELECT a.release_id FROM masterplan_geo_active_3d a
        WHERE a.project_id=?`).bind(project.id).first();
      if(!mapping)throw Error("Publish verified Geo Masterplan before sharing its customer URL.");
      const number=await env.DB.prepare("SELECT COALESCE(MAX(version),0)+1 AS v FROM masterplan_share_releases_3d WHERE project_id=?")
        .bind(project.id).first();
      const id=crypto.randomUUID(),now=new Date().toISOString();
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO masterplan_share_releases_3d
          (id,project_id,version,title,description,card_asset_id,card_sha256,mapping_release_id,
           revision,published_by,published_at)
          SELECT ?,?,?,?,?,?,?,?,?,?,?
          WHERE EXISTS(SELECT 1 FROM masterplan_share_drafts_3d d
            WHERE d.project_id=? AND d.revision=? AND d.card_asset_id=?)
          AND EXISTS(SELECT 1 FROM studio_assets_3d a WHERE a.project_id=? AND a.id=?
            AND a.sha256=? AND a.deleted_at IS NULL)
          AND EXISTS(SELECT 1 FROM masterplan_geo_active_3d WHERE project_id=? AND release_id=?)`)
          .bind(id,project.id,number.v,d.title,d.description,card.id,card.sha256,mapping.release_id,
            d.revision,actor.email,now,project.id,d.revision,card.id,
            project.id,card.id,card.sha256,project.id,mapping.release_id),
        env.DB.prepare(`INSERT INTO masterplan_share_active_3d(project_id,release_id,updated_by,updated_at)
          VALUES(?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET
          release_id=excluded.release_id,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
          .bind(project.id,id,actor.email,now),
        env.DB.prepare(`INSERT INTO engine_admin_audit
          (id,actor_email,action,project_id,target_id,details_json,created_at)
          VALUES(?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),actor.email,
            "masterplan.share_published",project.id,id,
            JSON.stringify({version:number.v,sha256:card.sha256,mappingReleaseId:mapping.release_id}),now)
      ]);
      return json(await state(env,project));
    }
    if(req.method==="POST"&&body.action==="activate"){
      const r=await env.DB.prepare(`SELECT id FROM masterplan_share_releases_3d
        WHERE id=? AND project_id=?`).bind(String(body.releaseId||""),project.id).first();
      if(!r)throw Error("Share version not found for this project.");
      const now=new Date().toISOString();
      await env.DB.prepare(`UPDATE masterplan_share_active_3d SET release_id=?,updated_by=?,updated_at=?
        WHERE project_id=?`).bind(r.id,actor.email,now,project.id).run();
      await audit(env,actor,"masterplan.share_activated",project,r.id);
      return json(await state(env,project));
    }
    return fail("Unknown share action.",400);
  }catch(e){return fail(e instanceof Error?e.message:"Share request failed.",409);}
}
