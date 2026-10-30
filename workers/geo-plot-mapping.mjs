import { engineAdminReadAccess } from "./admin-cloud.mjs";
import { validateGeoPlotCollection } from "./geo-plot-geometry.mjs";
import { validProjectSlug } from "../shared/project-slug-policy.js";

const json = (value, init = {}) => Response.json(value, {headers: {"Cache-Control":"no-store"}, ...init});
const fail = (message, status = 400) => json({error:message}, {status});
const digest = async (value) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))))
  .map(n => n.toString(16).padStart(2,"0")).join("");
const currentIso = () => new Date().toISOString();
function sameOrigin(request) {
  try { return new URL(request.headers.get("origin") || "").origin === new URL(request.url).origin; }
  catch { return false; }
}
async function context(env, slug) {
  const project = await env.DB.prepare("SELECT id,slug,status FROM projects_3d WHERE slug=?").bind(slug).first();
  if (!project) return null;
  const active = await env.DB.prepare(
    `SELECT e.id AS experience_id, ar.geo_release_id, r.source_building_release_id
      FROM experiences_3d e JOIN geo_experience_active_releases_3d ar ON ar.experience_id=e.id AND ar.project_id=e.project_id
      JOIN geo_releases_3d r ON r.id=ar.geo_release_id AND r.project_id=e.project_id
     WHERE e.project_id=? AND e.type='geo' LIMIT 1`
  ).bind(project.id).first();
  return {project, active};
}
async function state(env, ctx) {
  const draft = await env.DB.prepare(
    "SELECT revision,verified_revision,plots_json,geo_release_id,building_release_id FROM geo_plot_mapping_drafts_3d WHERE project_id=?"
  ).bind(ctx.project.id).first();
  const active = await env.DB.prepare(
    `SELECT r.id,r.version,r.geo_release_id,r.building_release_id,r.sha256
       FROM geo_plot_mapping_active_3d a JOIN geo_plot_mapping_releases_3d r
       ON r.id=a.mapping_release_id AND r.project_id=a.project_id AND r.experience_id=a.experience_id
       WHERE a.project_id=?`
  ).bind(ctx.project.id).first();
  const versions = await env.DB.prepare(
    "SELECT id,version,geo_release_id AS geoReleaseId,created_at AS createdAt FROM geo_plot_mapping_releases_3d WHERE project_id=? ORDER BY version DESC LIMIT 20"
  ).bind(ctx.project.id).all();
  return {project:ctx.project, geoReleaseId:ctx.active?.geo_release_id || null,
    buildingReleaseId:ctx.active?.source_building_release_id || null,
    draft:draft ? {revision:draft.revision,verifiedRevision:draft.verified_revision,geoReleaseId:draft.geo_release_id,
      buildingReleaseId:draft.building_release_id,stale:draft.geo_release_id!==ctx.active?.geo_release_id ||
      draft.building_release_id!==ctx.active?.source_building_release_id,
      plots:JSON.parse(draft.plots_json)} : {revision:0,verifiedRevision:null,stale:false,plots:[]},
    activeMapping:active ? {id:active.id,version:active.version,geoReleaseId:active.geo_release_id,
      current:active.geo_release_id===ctx.active?.geo_release_id && active.building_release_id===ctx.active?.source_building_release_id} : null,
    releases:versions.results || []};
}
async function writeDraft(env, ctx, actor, body) {
  const expected=body.expectedRevision;
  if (!Number.isInteger(expected) || expected < 0) throw Error("Current expectedRevision required.");
  if (body.geoReleaseId!==ctx.active.geo_release_id) throw Error("Geo release changed. Reload before saving.");
  const plots=validateGeoPlotCollection(body.plots);
  const text=JSON.stringify(plots),now=currentIso();
  if (text.length>4_000_000) throw Error("Mapping exceeds the permitted storage size.");
  let result;
  if (expected===0) result=await env.DB.prepare(
    `INSERT INTO geo_plot_mapping_drafts_3d
      (project_id,experience_id,geo_release_id,building_release_id,revision,verified_revision,plots_json,updated_by,updated_at)
      VALUES (?,?,?,?,1,NULL,?,?,?) ON CONFLICT(project_id) DO NOTHING`
  ).bind(ctx.project.id,ctx.active.experience_id,ctx.active.geo_release_id,ctx.active.source_building_release_id,text,actor.email,now).run();
  else result=await env.DB.prepare(
    `UPDATE geo_plot_mapping_drafts_3d SET revision=revision+1,verified_revision=NULL,plots_json=?,updated_by=?,updated_at=?
      WHERE project_id=? AND experience_id=? AND geo_release_id=? AND building_release_id=? AND revision=?`
  ).bind(text,actor.email,now,ctx.project.id,ctx.active.experience_id,ctx.active.geo_release_id,ctx.active.source_building_release_id,expected).run();
  if (result.meta?.changes!==1) throw Error("Concurrent change or Geo release switch. Reload mapping; no data overwritten.");
  return state(env,ctx);
}
async function verify(env,ctx,actor,body) {
  const draft=await env.DB.prepare("SELECT * FROM geo_plot_mapping_drafts_3d WHERE project_id=?").bind(ctx.project.id).first();
  if (!draft || draft.revision!==body.expectedRevision || draft.geo_release_id!==ctx.active.geo_release_id)
    throw Error("Save the latest mapping against the current Geo release before verification.");
  validateGeoPlotCollection(JSON.parse(draft.plots_json),{forPublish:true});
  const res=await env.DB.prepare(
    "UPDATE geo_plot_mapping_drafts_3d SET verified_revision=revision,updated_by=?,updated_at=? WHERE project_id=? AND revision=? AND geo_release_id=?"
  ).bind(actor.email,currentIso(),ctx.project.id,draft.revision,ctx.active.geo_release_id).run();
  if (res.meta?.changes!==1) throw Error("Mapping changed during verification.");
  return state(env,ctx);
}
async function publish(env,ctx,actor,body) {
  const draft=await env.DB.prepare("SELECT * FROM geo_plot_mapping_drafts_3d WHERE project_id=?").bind(ctx.project.id).first();
  if (!draft || draft.revision!==body.expectedRevision || draft.verified_revision!==draft.revision ||
      draft.geo_release_id!==ctx.active.geo_release_id || draft.building_release_id!==ctx.active.source_building_release_id)
    throw Error("Current mapping must be saved and verified for the active Geo/Building release.");
  const plots=validateGeoPlotCollection(JSON.parse(draft.plots_json),{forPublish:true});
  const text=JSON.stringify(plots),sha=await digest(text),id="geo_plot_"+crypto.randomUUID(),now=currentIso();
  const versionRow=await env.DB.prepare("SELECT COALESCE(MAX(version),0)+1 AS version FROM geo_plot_mapping_releases_3d WHERE experience_id=?")
    .bind(ctx.active.experience_id).first();
  // Guard the source again; publishing an old Geo alignment must not activate mapping.
  const activeCheck=await context(env,ctx.project.slug);
  if (activeCheck?.active?.geo_release_id!==ctx.active.geo_release_id) throw Error("Geo release changed during publish.");
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO geo_plot_mapping_releases_3d
      (id,project_id,experience_id,geo_release_id,building_release_id,version,draft_revision,plots_json,sha256,created_by,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(id,ctx.project.id,ctx.active.experience_id,ctx.active.geo_release_id,
      ctx.active.source_building_release_id,versionRow.version,draft.revision,text,sha,actor.email,now),
    env.DB.prepare(`INSERT INTO geo_plot_mapping_active_3d(experience_id,project_id,mapping_release_id,updated_by,updated_at)
      VALUES (?,?,?,?,?) ON CONFLICT(experience_id) DO UPDATE SET
      mapping_release_id=excluded.mapping_release_id,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
      .bind(ctx.active.experience_id,ctx.project.id,id,actor.email,now),
    env.DB.prepare(`INSERT INTO engine_admin_audit(id,actor_email,action,project_id,target_id,details_json,created_at)
      VALUES (?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),actor.email,"geo.plots_published",ctx.project.id,id,
      JSON.stringify({geoReleaseId:ctx.active.geo_release_id,version:versionRow.version,plotCount:plots.length,sha}),now)
  ]);
  return state(env,ctx);
}
async function activate(env,ctx,actor,id) {
  const release=await env.DB.prepare(
    "SELECT * FROM geo_plot_mapping_releases_3d WHERE id=? AND project_id=? AND experience_id=?"
  ).bind(id,ctx.project.id,ctx.active.experience_id).first();
  if (!release || release.geo_release_id!==ctx.active.geo_release_id ||
      release.building_release_id!==ctx.active.source_building_release_id)
    throw Error("Cannot activate mapping from a different Geo or Building release.");
  if (await digest(release.plots_json)!==release.sha256) throw Error("Mapping release integrity mismatch.");
  const now=currentIso();
  await env.DB.batch([
    env.DB.prepare("UPDATE geo_plot_mapping_active_3d SET mapping_release_id=?,updated_by=?,updated_at=? WHERE project_id=? AND experience_id=?")
      .bind(id,actor.email,now,ctx.project.id,ctx.active.experience_id),
    env.DB.prepare("INSERT INTO engine_admin_audit(id,actor_email,action,project_id,target_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)")
      .bind(crypto.randomUUID(),actor.email,"geo.plots_activated",ctx.project.id,id,"{}",now)
  ]);
  return state(env,ctx);
}
export async function handleGeoPlotMappingAdmin(request,env,url=new URL(request.url)) {
  const match=url.pathname.match(/^\/3Dprojects\/api\/cloud\/projects\/([^/]+)\/geo-plots$/);
  if (!match) return null;
  const slug=decodeURIComponent(match[1]).toLowerCase();
  if (!validProjectSlug(slug)) return fail("Invalid project slug.");
  const access=await engineAdminReadAccess(request,env);
  if (!access.ok) return fail(access.error,access.status);
  try {
    const ctx=await context(env,slug);
    if (!ctx) return fail("Project not found.",404);
    if (!ctx.active) return fail("Publish a verified Geo Experience before mapping plots.",409);
    if (request.method==="GET") return json(await state(env,ctx));
    if (!["PUT","POST"].includes(request.method)) return fail("Method not allowed.",405);
    if (!sameOrigin(request)) return fail("Same-origin request required.",403);
    if (ctx.project.status==="archived") return fail("Archived project is read-only.",409);
    const body=await request.json();
    if (request.method==="PUT") return json(await writeDraft(env,ctx,access.actor,body));
    if (body.action==="verify") return json(await verify(env,ctx,access.actor,body));
    if (body.action==="publish") return json(await publish(env,ctx,access.actor,body));
    if (body.action==="activate") return json(await activate(env,ctx,access.actor,String(body.releaseId||"")));
    return fail("Unknown mapping action.");
  } catch(error) {
    return fail(error instanceof Error?error.message:"Geo Plot Mapping operation failed.",409);
  }
}
