import {
  geoReleaseSchemaReady,
  geoReleaseInternals,
} from "./geo-release-admin.mjs";
import {
  assertGeoBuildingSource,
  requireGeoDraftReady,
  requireProductionVectorMapId,
} from "./geo-release-verify.mjs";
import { buildGeoPresentationManifestV1 } from "./geo-presentation-policy.mjs";
import { planGeoMappingTransition } from "./geo-release-mapping-safety.mjs";

const {
  digestHex,
  geoContext,
  verificationForCurrentDraft,
  geoV2AlignmentSchemaReady,
} = geoReleaseInternals;

export async function publishGeoRelease(
  env,
  actor,
  project,
  expectedDraftRevision,
  mappingGapConfirmation = "",
) {
  if (!(await geoReleaseSchemaReady(env)))
    throw Error("Immutable Geo release schema is not installed.");
  if (!(await geoV2AlignmentSchemaReady(env)))
    throw Error("Geo V2 alignment schema is required before publishing a new Geo release.");
  if (project.status === "archived")
    throw Error("Restore the project before publishing Geo.");

  await requireProductionVectorMapId(env);
  const context = await geoContext(env, project);
  await requireGeoDraftReady(env, context);
  if (Number(context.revision) !== Number(expectedDraftRevision))
    throw Error("Geo draft changed before publish.");

  const verification = await verificationForCurrentDraft(env, project, context);
  if (!verification)
    throw Error("Verify the current Geo preview before publishing.");

  const existing = await env.DB.prepare(
    `SELECT id,version
       FROM geo_releases_3d
      WHERE experience_id=?
        AND project_id=?
        AND source_draft_revision=?
      LIMIT 1`,
  ).bind(
    context.experienceId,
    project.id,
    Number(context.revision),
  ).first();
  if (existing)
    throw Error(
      `Geo Release v${Number(existing.version)} already exists for this draft. Activate it from release history if needed.`,
    );

  const source = await assertGeoBuildingSource(env, project, context);
  const next = await env.DB.prepare(
    `SELECT COALESCE(MAX(version),0)+1 AS version
       FROM geo_releases_3d
      WHERE experience_id=? AND project_id=?`,
  ).bind(context.experienceId, project.id).first();
  const version = Number(next?.version || 1);
  const releaseId = `geo_release_${crypto.randomUUID()}`;
  const createdAt = new Date().toISOString();
  const manifest = await buildGeoPresentationManifestV1({
    env,
    project,
    context,
    source,
    model: source.model,
    releaseId,
    version,
    createdAt,
  });
  const manifestJson = JSON.stringify(manifest);
  const manifestSha256 = await digestHex(manifestJson);
  const previousReleaseId = context.activeGeoReleaseId || null;
  // A newly published Geo release gets a different immutable identity. Never
  // silently detach an existing live Plot Mapping without owner acknowledgement.
  const mappingTransition=await planGeoMappingTransition(
    env,project,context.experienceId,releaseId,source.id,mappingGapConfirmation);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO geo_releases_3d
        (id,experience_id,project_id,version,manifest_json,manifest_sha256,
         source_draft_revision,source_building_release_id,
         source_building_release_version,created_by,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      releaseId,
      context.experienceId,
      project.id,
      version,
      manifestJson,
      manifestSha256,
      Number(context.revision),
      source.id,
      source.version,
      actor.email,
      createdAt,
    ),
    env.DB.prepare(
      `INSERT INTO geo_experience_active_releases_3d
        (experience_id,project_id,geo_release_id,updated_by,updated_at)
       VALUES (?,?,?,?,?)
       ON CONFLICT(experience_id) DO UPDATE SET
         project_id=excluded.project_id,
         geo_release_id=excluded.geo_release_id,
         updated_by=excluded.updated_by,
         updated_at=excluded.updated_at`,
    ).bind(
      context.experienceId,
      project.id,
      releaseId,
      actor.email,
      createdAt,
    ),
    env.DB.prepare(
      `INSERT INTO geo_release_activations_3d
        (id,experience_id,project_id,geo_release_id,previous_geo_release_id,
         action,actor_email,created_at)
       VALUES (?,?,?,?,?,'publish',?,?)`,
    ).bind(
      crypto.randomUUID(),
      context.experienceId,
      project.id,
      releaseId,
      previousReleaseId,
      actor.email,
      createdAt,
    ),
    env.DB.prepare(
      `INSERT INTO engine_admin_audit
        (id,actor_email,action,project_id,target_id,details_json,created_at)
       VALUES (?,?,?,?,?,?,?)`,
    ).bind(
      crypto.randomUUID(),
      actor.email,
      "geo.release_published",
      project.id,
      releaseId,
      JSON.stringify({
        version,
        manifestFormat: manifest.format,
        manifestSha256,
        sourceDraftRevision: Number(context.revision),
        sourceBuildingReleaseId: source.id,
        sourceBuildingReleaseVersion: source.version,
        sourceBuildingManifestSha256: source.manifestSha256,
        modelAnchorId: manifest.modelAnchor.id,
        coordinateReferenceSystem: manifest.placement.coordinateReferenceSystem,
        localFrame: manifest.placement.localFrame,
        previousGeoReleaseId: previousReleaseId,
        previousPlotMappingId: mappingTransition.currentMappingId,
        mappingReviewGap: Boolean(mappingTransition.currentMappingId),
      }),
      createdAt,
    ),
  ]);

  return {
    id: releaseId,
    experienceId: context.experienceId,
    projectId: project.id,
    version,
    manifestSha256,
    sourceDraftRevision: Number(context.revision),
    sourceBuildingReleaseId: source.id,
    sourceBuildingReleaseVersion: source.version,
    manifestFormat: manifest.format,
    createdBy: actor.email,
    createdAt,
    active: true,
  };
}
