// Owner-authenticated GEO mapping recovery manifest, not a Cloudflare R2 byte
// backup and never a substitute for a full D1/R2 point-in-time export.
// Deliberately excludes buyer and private payment ledgers.
const sha256=async raw=>Array.from(new Uint8Array(await crypto.subtle.digest(
  "SHA-256",new TextEncoder().encode(raw)))).map(b=>b.toString(16).padStart(2,"0")).join("");
async function ownedRows(db,sql,projectId){
  const q=await db.prepare(sql).bind(projectId).all();
  return q.results||[];
}
export async function projectGeoRecoveryManifest(env,ctx){
  if(!ctx?.project?.id||!ctx.active)throw Error("A verified project-owned Geo release is required.");
  const id=ctx.project.id;
  const [draft,inventory,alignment,active,releases,assets,geoReleases]=await Promise.all([
    env.DB.prepare("SELECT * FROM geo_plot_mapping_drafts_3d WHERE project_id=?").bind(id).first(),
    env.DB.prepare("SELECT * FROM geo_plot_inventory_3d WHERE project_id=?").bind(id).first(),
    env.DB.prepare("SELECT * FROM geo_plot_image_alignment_drafts_3d WHERE project_id=?").bind(id).first(),
    env.DB.prepare("SELECT * FROM geo_plot_mapping_active_3d WHERE project_id=?").bind(id).first(),
    ownedRows(env.DB,"SELECT * FROM geo_plot_mapping_releases_3d WHERE project_id=? ORDER BY version ASC LIMIT 201",id),
    ownedRows(env.DB,"SELECT id,r2_key,sha256,byte_size,kind,mime_type FROM studio_assets_3d WHERE project_id=? AND deleted_at IS NULL LIMIT 2501",id),
    ownedRows(env.DB,"SELECT id,source_building_release_id FROM geo_releases_3d WHERE project_id=? LIMIT 201",id)
  ]);
  if(releases.length>200||assets.length>2500||geoReleases.length>200)
    throw Error("Geo recovery snapshot exceeds protected export pagination limits. Use a full offline D1/R2 export instead.");
  if(active&&!releases.some(r=>r.id===active.mapping_release_id))
    throw Error("Active mapping release not present in project-bound recovery history.");
  for(const row of releases){
    if(row.project_id!==id||await sha256(row.plots_json)!==row.sha256)
      throw Error("Historical published Geo mapping release integrity failed. Refuse recovery manifest.");
  }
  for(const row of assets){
    if(!/^[a-f0-9]{64}$/i.test(row.sha256)||!row.r2_key)
      throw Error("Project asset reference missing immutable SHA-256 or R2 key.");
  }
  // Scan all project-owned R2 keys, not merely the studio_assets table:
  // published GLBs, media derivatives and share-card versions must be recoverable.
  // This remains a checksum/reference index; actual object bytes are exported by
  // the authorized offline CLI and independently rechecked.
  const prefix="projects/"+ctx.project.slug+"/";
  const known=new Map(assets.map(a=>[a.r2_key,a.sha256?.toLowerCase()||null]));
  const r2Objects=[];let cursor;
  do{
    const page=await env.MODEL_ASSETS.list({prefix,limit:1000,...(cursor?{cursor}:{})});
    if(!page||!Array.isArray(page.objects))
      throw Error("Full project R2 index is unavailable; recovery manifest refused.");
    for(const item of page.objects){
      if(!item.key.startsWith(prefix)||item.key.includes("..")||item.key.includes("\\"))
        throw Error("R2 project prefix containment failed during recovery scan.");
      r2Objects.push({key:item.key,size:item.size,
        etag:item.etag||null,knownSha256:known.get(item.key)||null});
      if(r2Objects.length>10000)
        throw Error("R2 object scan exceeds 10,000 project assets; use paginated operator backup.");
    }
    if(page.truncated&&!page.cursor)throw Error("R2 pagination cursor missing.");
    cursor=page.truncated?page.cursor:undefined;
  }while(cursor);
  for(const row of assets)if(!r2Objects.some(o=>o.key===row.r2_key))
    throw Error("Referenced R2 object is missing from project archive: "+row.id);
  const payload={project:{id,slug:ctx.project.slug,projectKind:ctx.project.project_kind,
       status:ctx.project.status},activeGeo:{
       experienceId:ctx.active.experience_id,geoReleaseId:ctx.active.geo_release_id,
       buildingReleaseId:ctx.active.source_building_release_id},
     r2Objects,
     draft:draft||null,inventory:inventory||null,alignment:alignment||null,
     activeMapping:active||null,mappingReleases:releases,geoReleases,assets};
  const body=JSON.stringify(payload);
  if(new TextEncoder().encode(body).byteLength>8_000_000)
    throw Error("Geo recovery manifest exceeds 8 MB; use offline complete D1/R2 backup.");
  return {schema:"rekixo-geo-project-recovery-manifest-v1",
    createdAt:new Date().toISOString(),projectSlug:ctx.project.slug,
    recoveryScope:"project-owned Geo metadata and immutable mapping releases",
    completeness:"METADATA_AND_R2_REFERENCES_ONLY",
    warnings:[
      "Restore is isolated-only; no production database or release activation is performed.",
      "R2 object bytes are NOT included in this manifest; use the offline cloud backup CLI to download and checksum every indexed key.",
      "Buyer/payment data, external services and Cloudflare configuration require separate protected backups."
    ],sha256:await sha256(body),payload};
}
