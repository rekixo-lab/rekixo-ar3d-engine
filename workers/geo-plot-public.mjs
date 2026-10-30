import { validateGeoPlotCollection } from "./geo-plot-geometry.mjs";
const digest = async (value) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))).map(n => n.toString(16).padStart(2,"0")).join("");
export async function publicGeoPlotMapping(env,slug,expectedGeoReleaseId) {
  const row=await env.DB.prepare(`SELECT r.plots_json,r.sha256,r.version,r.geo_release_id,r.building_release_id,
      gr.source_building_release_id AS current_building_release_id
      FROM geo_plot_mapping_active_3d a JOIN geo_plot_mapping_releases_3d r
      ON r.id=a.mapping_release_id AND r.project_id=a.project_id AND r.experience_id=a.experience_id
      JOIN geo_experience_active_releases_3d ga ON ga.experience_id=a.experience_id AND ga.project_id=a.project_id
      JOIN geo_releases_3d gr ON gr.id=ga.geo_release_id AND gr.project_id=a.project_id
      JOIN projects_3d p ON p.id=a.project_id
      WHERE p.slug=? AND ga.geo_release_id=? AND r.geo_release_id=ga.geo_release_id
      AND r.building_release_id=gr.source_building_release_id`).bind(slug,expectedGeoReleaseId).first();
  if (!row) return null;
  if (await digest(row.plots_json)!==row.sha256) throw Error("Published plot mapping checksum mismatch.");
  const plots=validateGeoPlotCollection(JSON.parse(row.plots_json),{forPublish:true});
  return {version:row.version,geoReleaseId:row.geo_release_id,plots};
}
