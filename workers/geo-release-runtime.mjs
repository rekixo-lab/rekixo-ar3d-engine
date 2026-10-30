import {
  experienceFromReleaseState,
  geoModelDerivativeForReleaseState,
  releaseStateById,
} from "./release-runtime.mjs";
import { validProjectSlug } from "../shared/project-slug-policy.js";
import { assertGeoPresentationManifestV1 } from "./geo-presentation-policy.mjs";

const encoder = new TextEncoder();

async function digestHex(value) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(value)),
  );
  return Array.from(bytes, (item) => item.toString(16).padStart(2, "0")).join("");
}

function validToken(value, max = 180) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    /^[A-Za-z0-9_.-]+$/.test(value)
  );
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function validLegacyPlacement(placement) {
  return (
    placement &&
    typeof placement === "object" &&
    !Array.isArray(placement) &&
    finite(placement.longitude) &&
    placement.longitude >= -180 &&
    placement.longitude <= 180 &&
    finite(placement.latitude) &&
    placement.latitude >= -90 &&
    placement.latitude <= 90 &&
    finite(placement.altitudeM) &&
    finite(placement.headingDeg) &&
    finite(placement.pitchDeg) &&
    finite(placement.rollDeg) &&
    finite(placement.scale) &&
    placement.scale > 0
  );
}

export async function geoPublicReleaseSchemaReady(env) {
  try {
    const rows = await env.DB.prepare(
      `SELECT name
         FROM sqlite_master
        WHERE type='table'
          AND name IN (
            'experiences_3d',
            'geo_releases_3d',
            'geo_experience_active_releases_3d'
          )`,
    ).all();
    return new Set((rows.results || []).map((row) => row.name)).size === 3;
  } catch {
    return false;
  }
}

function validateLegacyGeoManifest(manifest, row) {
  if (
    !manifest ||
    typeof manifest !== "object" ||
    Array.isArray(manifest) ||
    manifest.format !== "rekixo-geo-release" ||
    manifest.version !== 1 ||
    !manifest.release ||
    !manifest.project ||
    !manifest.sourceBuilding ||
    !validLegacyPlacement(manifest.placement) ||
    manifest.release.id !== row.geo_release_id ||
    manifest.release.experienceId !== row.experience_id ||
    manifest.release.projectId !== row.project_id ||
    manifest.release.projectSlug !== row.slug ||
    Number(manifest.release.version) !== Number(row.geo_release_version) ||
    Number(manifest.release.sourceDraftRevision) !==
      Number(row.source_draft_revision) ||
    manifest.project.id !== row.project_id ||
    manifest.project.slug !== row.slug ||
    typeof manifest.project.name !== "string" ||
    !manifest.project.name.trim() ||
    manifest.sourceBuilding.releaseId !== row.source_building_release_id ||
    Number(manifest.sourceBuilding.version) !==
      Number(row.source_building_release_version) ||
    typeof manifest.sourceBuilding.manifestSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(manifest.sourceBuilding.manifestSha256)
  )
    throw Error("Active legacy Geo release manifest identity is invalid.");
}

function validateV2GeoManifest(manifest, row) {
  assertGeoPresentationManifestV1(manifest);
  if (
    manifest.release.id !== row.geo_release_id ||
    manifest.release.experienceId !== row.experience_id ||
    manifest.release.projectId !== row.project_id ||
    manifest.release.projectSlug !== row.slug ||
    Number(manifest.release.version) !== Number(row.geo_release_version) ||
    Number(manifest.release.sourceDraftRevision) !== Number(row.source_draft_revision) ||
    manifest.project.id !== row.project_id ||
    manifest.project.slug !== row.slug ||
    manifest.sourceBuilding.releaseId !== row.source_building_release_id ||
    Number(manifest.sourceBuilding.version) !== Number(row.source_building_release_version)
  )
    throw Error("Active Geo V2 release manifest identity is invalid.");
}

function validateGeoManifest(manifest, row) {
  if (manifest?.format === "rekixo.geo-presentation") {
    validateV2GeoManifest(manifest, row);
    return "v2";
  }
  validateLegacyGeoManifest(manifest, row);
  return "legacy";
}

export async function activeGeoReleaseState(env, slug) {
  if (!validProjectSlug(slug)) return { state: "invalid-slug" };
  if (!(await geoPublicReleaseSchemaReady(env)))
    return { state: "schema-missing" };

  const project = await env.DB.prepare(
    `SELECT id,slug,name,location,status
       FROM projects_3d
      WHERE slug=?
      LIMIT 1`,
  ).bind(slug).first();
  if (!project) return { state: "project-missing" };
  if (project.status !== "published")
    return { state: "unpublished", project };

  const row = await env.DB.prepare(
    `SELECT p.id AS project_id,p.slug,p.name,p.location,p.status,
            e.id AS experience_id,e.lifecycle,
            ar.geo_release_id,
            gr.version AS geo_release_version,
            gr.manifest_json,
            gr.manifest_sha256,
            gr.source_draft_revision,
            gr.source_building_release_id,
            gr.source_building_release_version,
            gr.created_at AS geo_release_created_at
       FROM projects_3d p
       JOIN experiences_3d e
         ON e.project_id=p.id
        AND e.type='geo'
        AND e.lifecycle='active'
       JOIN geo_experience_active_releases_3d ar
         ON ar.experience_id=e.id
        AND ar.project_id=e.project_id
       JOIN geo_releases_3d gr
         ON gr.id=ar.geo_release_id
        AND gr.experience_id=e.id
        AND gr.project_id=e.project_id
      WHERE p.slug=?
      LIMIT 1`,
  ).bind(slug).first();

  if (!row) return { state: "no-active", project };
  if (
    !validToken(row.geo_release_id) ||
    !row.manifest_json ||
    !row.manifest_sha256
  )
    return {
      state: "corrupt",
      project,
      reason: "Active Geo release row is incomplete.",
    };

  const actualHash = await digestHex(row.manifest_json);
  if (actualHash !== String(row.manifest_sha256).toLowerCase())
    return {
      state: "corrupt",
      project,
      reason: "Active Geo release manifest checksum mismatch.",
    };

  let manifest;
  let manifestKind;
  try {
    manifest = JSON.parse(row.manifest_json);
    manifestKind = validateGeoManifest(manifest, row);
  } catch (error) {
    return {
      state: "corrupt",
      project,
      reason:
        error instanceof Error
          ? error.message
          : "Active Geo release manifest is invalid.",
    };
  }

  const building = await releaseStateById(
    env,
    slug,
    row.source_building_release_id,
  );
  if (building.state !== "ok")
    return {
      state: "corrupt",
      project,
      reason:
        building.state === "corrupt"
          ? `Pinned Building release is corrupt: ${building.reason || "unknown"}`
          : `Pinned Building release is unavailable: ${building.state}`,
    };

  if (
    Number(building.manifest.release.version) !==
      Number(row.source_building_release_version) ||
    building.manifestSha256 !==
      String(manifest.sourceBuilding.manifestSha256).toLowerCase()
  )
    return {
      state: "corrupt",
      project,
      reason: "Active Geo release Building source integrity mismatch.",
    };

  if (manifestKind === "v2") {
    const buildingModel = building.manifest.experience?.model;
    const buildingAsset = Array.isArray(building.manifest.assets)
      ? building.manifest.assets.find((asset) =>
          asset?.id === buildingModel?.releaseAssetId &&
          asset?.kind === "model" &&
          asset?.logicalId === buildingModel?.id,
        )
      : undefined;
    if (!buildingModel || !buildingAsset ||
      manifest.model.id !== buildingModel.id ||
      (manifest.model.sha256 && manifest.model.sha256 !== buildingAsset.sha256))
      return {
        state: "corrupt",
        project,
        reason: "Active Geo V2 model no longer matches its pinned Building release.",
      };
  }

  return {
    state: "ok",
    project,
    experienceId: row.experience_id,
    manifest,
    manifestKind,
    manifestSha256: actualHash,
    building,
  };
}

function normalizedPlacement(state) {
  if (state.manifestKind === "v2") return structuredClone(state.manifest.placement);
  const legacy = state.manifest.placement;
  return {
    coordinateReferenceSystem: "WGS84",
    localFrame: "ENU",
    units: "m",
    anchor: {
      longitude: Number(legacy.longitude),
      latitude: Number(legacy.latitude),
      ...(Number.isFinite(Number(legacy.altitudeM))
        ? { altitudeM: Number(legacy.altitudeM) }
        : {}),
    },
    heightMode: "ground-relative",
    eastOffsetM: 0,
    northOffsetM: 0,
    verticalOffsetM: Number(legacy.altitudeM || 0),
    headingDeg: Number(legacy.headingDeg || 0),
    pitchDeg: Number(legacy.pitchDeg || 0),
    rollDeg: Number(legacy.rollDeg || 0),
    scale: Number(legacy.scale || 1),
  };
}

function normalizedModelAnchor(state) {
  if (state.manifestKind === "v2") return structuredClone(state.manifest.modelAnchor);
  return {
    id: "legacy-site-center",
    name: "Legacy site center",
    kind: "site-center",
    localPositionM: { x: 0, y: 0, z: 0 },
  };
}

function sourceModelAsset(state) {
  const model = state.building.manifest.experience?.model;
  if (!model) return undefined;
  return state.building.manifest.assets?.find((asset) =>
    asset?.id === model.releaseAssetId &&
    asset?.kind === "model" &&
    asset?.logicalId === model.id,
  );
}

export async function publicGeoExperienceFromState(env, state) {
  if (state?.state !== "ok") return undefined;

  const buildingExperience = experienceFromReleaseState(state.building);
  if (!buildingExperience?.model) return undefined;

  const derivative = await geoModelDerivativeForReleaseState(
    env,
    state.building,
  );
  const sourceAsset = sourceModelAsset(state);
  const derivativeMatchesSource =
    derivative?.available !== false &&
    derivative?.url &&
    (!sourceAsset?.sha256 || derivative.sourceSha256 === sourceAsset.sha256);
  const model = derivativeMatchesSource ? derivative : buildingExperience.model;

  if (
    !model?.url ||
    model.available === false ||
    model.mimeType !== "model/gltf-binary"
  )
    return undefined;

  const placement = normalizedPlacement(state);
  const modelAnchor = normalizedModelAnchor(state);
  return {
    project: buildingExperience.project,
    // Backward-compatible alias. This remains the immutable Building release.
    release: {
      id: state.building.manifest.release.id,
      version: Number(state.building.manifest.release.version),
    },
    buildingRelease: {
      id: state.building.manifest.release.id,
      version: Number(state.building.manifest.release.version),
      manifestSha256: state.building.manifestSha256,
    },
    geoRelease: {
      id: state.manifest.release.id,
      version: Number(state.manifest.release.version),
      manifestSha256: state.manifestSha256,
      manifestFormat: state.manifest.format,
      sourceDraftRevision: Number(state.manifest.release.sourceDraftRevision),
      createdAt: state.manifest.release.createdAt,
    },
    placement,
    // Compatibility fields for older UI readers during the V2 rollout.
    legacyPlacement: {
      longitude: placement.anchor.longitude,
      latitude: placement.anchor.latitude,
      altitudeM:
        placement.heightMode === "absolute"
          ? Number(placement.anchor.altitudeM || 0)
          : Number(placement.verticalOffsetM || 0),
      headingDeg: placement.headingDeg,
      pitchDeg: placement.pitchDeg,
      rollDeg: placement.rollDeg,
      scale: placement.scale,
    },
    modelAnchor,
    // Canonical source geometry is the only coordinate authority for plot
    // polygons. A Geo-optimized derivative may have a different origin.
    canonicalModel: {
      ...buildingExperience.model,
      url: buildingExperience.model.url,
      sha256: sourceAsset?.sha256,
      byteSize: sourceAsset?.byteSize ?? buildingExperience.model.byteSize,
      variant: "building",
    },
    ...(state.manifestKind === "v2" && state.manifest.siteBoundary
      ? { siteBoundary: structuredClone(state.manifest.siteBoundary) }
      : {}),
    ...(state.manifestKind === "v2" && state.manifest.masterplanOverlay
      ? { masterplanOverlay: structuredClone(state.manifest.masterplanOverlay) }
      : {}),
    ...(state.manifestKind === "v2" && state.manifest.cameras
      ? { cameras: structuredClone(state.manifest.cameras) }
      : {}),
    display:
      state.manifestKind === "v2" && state.manifest.display
        ? structuredClone(state.manifest.display)
        : {
            showMasterplanByDefault: false,
            showBoundaryByDefault: false,
            showRoadsByDefault: true,
            showLabelsByDefault: true,
          },
    runtime: {
      integratedScene: true,
      qualityTiers: [
        "photorealistic-surroundings",
        "terrain-satellite",
        "flat-satellite",
      ],
      buildingTransform: "rigid-wgs84-enu",
      overlayCalibration: "masterplan-only",
    },
    model: {
      id: model.id,
      name: model.name,
      mimeType: model.mimeType,
      byteSize: model.byteSize,
      url: model.url,
      variant: model.variant || "building",
      sha256: model.sha256 || sourceAsset?.sha256,
      ...(model.sourceSha256 ? { sourceSha256: model.sourceSha256 } : {}),
    },
  };
}
