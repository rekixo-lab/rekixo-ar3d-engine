// Return source and share image asset IDs currently referenced by any Engine
// image masterplan draft/immutable release. Never rely solely on Building ref_count.
const TABLE_QUERIES=[
  ["masterplan_geo_drafts_3d","SELECT image_asset_id AS id FROM masterplan_geo_drafts_3d WHERE project_id=? AND image_asset_id IS NOT NULL"],
  ["masterplan_geo_releases_3d","SELECT source_asset_id AS id FROM masterplan_geo_releases_3d WHERE project_id=?"],
  ["masterplan_share_drafts_3d","SELECT card_asset_id AS id FROM masterplan_share_drafts_3d WHERE project_id=? AND card_asset_id IS NOT NULL"],
  ["masterplan_share_releases_3d","SELECT card_asset_id AS id FROM masterplan_share_releases_3d WHERE project_id=?"],
];
export async function referencedMasterplanAssetIds(env,projectId){
  const schema=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'masterplan_%_3d'").all();
  const available=new Set((schema.results||[]).map(x=>x.name));
  const ids=new Set();
  for(const [name,sql] of TABLE_QUERIES){
    if(!available.has(name))continue;
    const rows=await env.DB.prepare(sql).bind(projectId).all();
    for(const row of rows.results||[])if(row.id)ids.add(row.id);
  }
  return ids;
}
