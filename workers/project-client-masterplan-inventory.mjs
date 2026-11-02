// Read-only, project-scoped masterplan inventory for authenticated clients.
// Never return buyer identities, contact numbers, payment amounts or owner APIs.
const sha256=async value=>Array.from(new Uint8Array(await crypto.subtle.digest(
  "SHA-256",new TextEncoder().encode(value)))).map(v=>v.toString(16).padStart(2,"0")).join("");

export async function clientMasterplanInventory(env,projectId){
 const release=await env.DB.prepare(
  "SELECT r.id,r.mapping_json AS mappingJson,r.mapping_sha256 AS checksum "+
  "FROM masterplan_geo_active_3d a JOIN masterplan_geo_releases_3d r "+
  "ON r.id=a.release_id AND r.project_id=a.project_id "+
  "WHERE a.project_id=? LIMIT 1"
 ).bind(projectId).first();
 if(!release)return {releaseId:null,plotCount:0,counts:{
  available:0,booked:0,confirmed:0},plots:[],notice:"Publish verified masterplan before viewing inventory."};
 if(!release.mappingJson||await sha256(release.mappingJson)!==release.checksum)
  throw Error("Active masterplan checksum verification failed.");
 const mapping=JSON.parse(release.mappingJson);
 if(mapping.schema!=="rekixo-masterplan-geo-v1"||!Array.isArray(mapping.plots)||
    mapping.plots.length>5000||!mapping.plots.every(p=>typeof p.id==="string"&&
       p.id.length>0&&p.id.length<=80))
  throw Error("Active masterplan inventory format is invalid.");
 // Only the active, non-void ledger status is exposed, never PII or money.
 const rows=await env.DB.prepare(
  "SELECT plot_id AS plotId,state FROM masterplan_sales_3d "+
  "WHERE project_id=? AND state IN ('booked','confirmed')"
 ).bind(projectId).all();
 const states=new Map();
 for(const row of rows.results||[])
  states.set(String(row.plotId).toLowerCase(),row.state);
 const counts={available:0,booked:0,confirmed:0};
 const plots=mapping.plots.map(p=>{
  const status=states.get(p.id.toLowerCase())||"available";
  counts[status]++;
  return {id:p.id,status};
 });
 return {releaseId:release.id,plotCount:plots.length,counts,plots,
  notice:"Private inventory summary. Sales, receipt verification and mapping remain owner-controlled."};
}
