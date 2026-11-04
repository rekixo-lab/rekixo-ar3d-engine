// Coordinate-safe Geo release transitions. A new Geo release cannot silently
// hide an active immutable Plot Mapping. A historical Geo rollback can restore
// its matching sealed Plot Mapping in the same D1 transaction.
const digest = async (text) => Array.from(new Uint8Array(await crypto.subtle.digest(
  "SHA-256",new TextEncoder().encode(text))))
  .map(x=>x.toString(16).padStart(2,"0")).join("");

export async function planGeoMappingTransition(env,project,experienceId,targetGeoId,targetBuildingId,confirmation=""){
  let current;
  try {
    current=await env.DB.prepare(`SELECT a.mapping_release_id
      FROM geo_plot_mapping_active_3d a
      WHERE a.project_id=? AND a.experience_id=?`).bind(project.id,experienceId).first();
  }catch(error){
    // A pre-mapping-schema Engine project cannot have a live 3D plot map.
    if(/no such table: geo_plot_mapping_active_3d/i.test(String(error)))return {currentMappingId:null,matchingMappingId:null};
    throw error;
  }
  if(!current?.mapping_release_id)return {currentMappingId:null,matchingMappingId:null};
  const matched=await env.DB.prepare(`SELECT id,plots_json,sha256
    FROM geo_plot_mapping_releases_3d
    WHERE project_id=? AND experience_id=? AND geo_release_id=? AND building_release_id=?
    ORDER BY version DESC LIMIT 1`).bind(
    project.id,experienceId,targetGeoId,targetBuildingId).first();
  if(matched){
    if(await digest(matched.plots_json)!==matched.sha256)
      throw Error("Historical Geo mapping integrity mismatch. Cannot switch active Geo source.");
    return {currentMappingId:current.mapping_release_id,matchingMappingId:matched.id};
  }
  const exact="ALLOW GEO MAPPING GAP "+project.slug;
  if(confirmation!==exact)
    throw Error("Geo source replacement would temporarily hide published Plot Mapping and its commercial facts. "+
      "Existing Building and Geo releases are still safe. To deliberately activate an unmapped Geo source, "+
      "compare the models, archive recovery data, then type "+exact+" in the Admin confirmation. "+
      "Rebind the old polygons and verify before republishing the customer Plot Mapping.");
  return {currentMappingId:current.mapping_release_id,matchingMappingId:null};
}
