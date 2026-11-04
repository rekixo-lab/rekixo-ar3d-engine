import {
  geoReleaseSchemaReady,
  geoReleaseInternals,
} from "./geo-release-admin.mjs";
import { planGeoMappingTransition } from "./geo-release-mapping-safety.mjs";

const {
  GEO_RELEASE_FORMAT,
  GEO_RELEASE_VERSION,
  digestHex,
  geoContext,
  buildingRelease,
  releaseSummary,
} = geoReleaseInternals;

async function validateStoredGeoRelease(
  env,
  project,
  experienceId,
  releaseId,
) {
  if (!/^geo_release_[A-Za-z0-9-]{20,100}$/.test(releaseId))
    throw Error("Invalid Geo release ID.");

  const row = await env.DB.prepare(
    `SELECT id,experience_id AS experienceId,project_id AS projectId,version,
            manifest_json AS manifestJson,manifest_sha256 AS manifestSha256,
            source_draft_revision AS sourceDraftRevision,
            source_building_release_id AS sourceBuildingReleaseId,
            source_building_release_version AS sourceBuildingReleaseVersion,
            created_by AS createdBy,created_at AS createdAt
       FROM geo_releases_3d
      WHERE id=? AND experience_id=? AND project_id=?
      LIMIT 1`,
  ).bind(releaseId, experienceId, project.id).first();
  if (!row)
    throw Error("Geo release does not belong to this Experience.");

  const actualHash = await digestHex(row.manifestJson);
  if (actualHash !== String(row.manifestSha256 || "").toLowerCase())
    throw Error("Geo release manifest checksum mismatch.");

  let manifest;
  try {
    manifest = JSON.parse(row.manifestJson);
  } catch {
    throw Error("Geo release manifest JSON is invalid.");
  }

  if (
    manifest?.format !== GEO_RELEASE_FORMAT ||
    manifest?.version !== GEO_RELEASE_VERSION ||
    manifest?.release?.id !== row.id ||
    manifest?.release?.experienceId !== experienceId ||
    manifest?.release?.projectId !== project.id ||
    manifest?.release?.projectSlug !== project.slug ||
    Number(manifest?.release?.version) !== Number(row.version) ||
    Number(manifest?.release?.sourceDraftRevision) !==
      Number(row.sourceDraftRevision) ||
    manifest?.sourceBuilding?.releaseId !== row.sourceBuildingReleaseId ||
    Number(manifest?.sourceBuilding?.version) !==
      Number(row.sourceBuildingReleaseVersion)
  )
    throw Error("Geo release manifest identity mismatch.");

  const source = await buildingRelease(
    env,
    project.id,
    row.sourceBuildingReleaseId,
  );
  if (
    !source ||
    Number(source.version) !== Number(row.sourceBuildingReleaseVersion) ||
    String(source.manifestSha256 || "").toLowerCase() !==
      String(manifest.sourceBuilding.manifestSha256 || "").toLowerCase()
  )
    throw Error("Geo release Building source integrity mismatch.");

  return releaseSummary({
    ...row,
    manifestSha256: actualHash,
    active: false,
  });
}

export async function activateGeoRelease(
  env,
  actor,
  project,
  releaseId,
  mappingGapConfirmation = "",
) {
  if (!(await geoReleaseSchemaReady(env)))
    throw Error("Immutable Geo release schema is not installed.");

  const context = await geoContext(env, project);
  if (!context?.experienceId)
    throw Error("Optional Geo Experience does not exist.");

  const release = await validateStoredGeoRelease(
    env,
    project,
    context.experienceId,
    releaseId,
  );

  if (context.activeGeoReleaseId === releaseId)
    return { ...release, active: true, unchanged: true };

  const transition=await planGeoMappingTransition(env,project,context.experienceId,
    releaseId,release.sourceBuildingReleaseId,mappingGapConfirmation);
  const now = new Date().toISOString();
  const restoreMapping=transition.matchingMappingId ? [
    env.DB.prepare(`UPDATE geo_plot_mapping_active_3d
      SET mapping_release_id=?,updated_by=?,updated_at=?
      WHERE project_id=? AND experience_id=? AND mapping_release_id=?`).bind(
      transition.matchingMappingId,actor.email,now,project.id,context.experienceId,
      transition.currentMappingId)
  ] : [];
  await env.DB.batch([
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
      now,
    ),
    ...restoreMapping,
    env.DB.prepare(
      `INSERT INTO geo_release_activations_3d
        (id,experience_id,project_id,geo_release_id,previous_geo_release_id,
         action,actor_email,created_at)
       VALUES (?,?,?,?,?,'rollback',?,?)`,
    ).bind(
      crypto.randomUUID(),
      context.experienceId,
      project.id,
      releaseId,
      context.activeGeoReleaseId || null,
      actor.email,
      now,
    ),
    env.DB.prepare(
      `INSERT INTO engine_admin_audit
        (id,actor_email,action,project_id,target_id,details_json,created_at)
       VALUES (?,?,?,?,?,?,?)`,
    ).bind(
      crypto.randomUUID(),
      actor.email,
      "geo.release_activated",
      project.id,
      releaseId,
      JSON.stringify({
        version: release.version,
        previousGeoReleaseId: context.activeGeoReleaseId || null,
        restoredMappingReleaseId: transition.matchingMappingId,
        mappingReviewGap: Boolean(transition.currentMappingId && !transition.matchingMappingId),
      }),
      now,
    ),
  ]);

  return { ...release, active: true, unchanged: false };
}
