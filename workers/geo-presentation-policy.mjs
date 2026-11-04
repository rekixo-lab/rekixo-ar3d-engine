const GEO_FORMAT = "rekixo.geo-presentation";
const GEO_VERSION = 1;
const CRS = "WGS84";
const LOCAL_FRAME = "ENU";
const UNITS = "m";
const HEIGHT_MODES = new Set(["ground-clamped", "ground-relative", "absolute"]);
const ANCHOR_KINDS = new Set([
  "entrance",
  "main-gate",
  "site-center",
  "south-west-corner",
  "custom",
]);

function object(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value, max = 300) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function token(value, max = 180) {
  return text(value, max) && /^[A-Za-z0-9_.-]+$/.test(value);
}

function sha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function finite(value, min = -Number.MAX_VALUE, max = Number.MAX_VALUE) {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function coordinate(value) {
  return object(value) &&
    finite(value.longitude, -180, 180) &&
    finite(value.latitude, -90, 90) &&
    (value.altitudeM === undefined || finite(value.altitudeM, -12000, 100000));
}

function localPoint(value) {
  return object(value) &&
    finite(value.x, -100000, 100000) &&
    finite(value.y, -100000, 100000) &&
    finite(value.z, -100000, 100000);
}

function normalizedUv(value) {
  return Array.isArray(value) && value.length === 2 &&
    finite(value[0], 0, 1) && finite(value[1], 0, 1);
}

function validScale(value) {
  // Geo scale is a uniform correction only. Keep validation broad here; the
  // explicit operator preview/verification gate is what authorizes a value.
  return finite(value, 0.01, 100);
}

function validateAnchor(anchor) {
  if (!object(anchor) || !token(anchor.id) || !text(anchor.name) ||
    !ANCHOR_KINDS.has(anchor.kind) || !localPoint(anchor.localPositionM))
    throw Error("Geo V2 requires one explicit Building-local model anchor in metres.");
}

function validatePlacement(placement) {
  if (!object(placement) ||
    placement.coordinateReferenceSystem !== CRS ||
    placement.localFrame !== LOCAL_FRAME ||
    placement.units !== UNITS ||
    !coordinate(placement.anchor) ||
    !HEIGHT_MODES.has(placement.heightMode) ||
    !finite(placement.eastOffsetM, -100000, 100000) ||
    !finite(placement.northOffsetM, -100000, 100000) ||
    !finite(placement.verticalOffsetM, -12000, 100000) ||
    !finite(placement.headingDeg, -360000, 360000) ||
    !finite(placement.pitchDeg, -180, 180) ||
    !finite(placement.rollDeg, -180, 180) ||
    !validScale(placement.scale))
    throw Error("Geo V2 placement must be finite WGS84 + ENU rigid alignment.");
}

function validateCalibration(calibration, pointCount) {
  if (!object(calibration) || calibration.algorithm !== "homography-v1" ||
    calibration.status !== "verified" ||
    !Number.isInteger(calibration.pointCount) || calibration.pointCount < 4 ||
    calibration.pointCount !== pointCount ||
    !finite(calibration.rmsErrorM, 0, 100000) ||
    !finite(calibration.maxErrorM, 0, 100000) ||
    calibration.maxErrorM < calibration.rmsErrorM ||
    (calibration.worstControlPointId !== undefined && !token(calibration.worstControlPointId)))
    throw Error("Geo masterplan calibration must be a verified four-point-or-better homography report.");
}

function validateOverlay(overlay) {
  if (!object(overlay) || !text(overlay.assetKey, 800) ||
    (overlay.sourceSha256 !== undefined && !sha256(overlay.sourceSha256)) ||
    !finite(overlay.opacity, 0, 1) ||
    !Array.isArray(overlay.controlPoints) || overlay.controlPoints.length < 4 ||
    overlay.controlPoints.length > 200)
    throw Error("Invalid Geo masterplan overlay.");
  const ids = new Set();
  for (const point of overlay.controlPoints) {
    if (!object(point) || !token(point.id) || ids.has(point.id) ||
      !normalizedUv(point.sourceUv) || !coordinate(point.world))
      throw Error("Invalid Geo masterplan control point.");
    ids.add(point.id);
  }
  validateCalibration(overlay.calibration, overlay.controlPoints.length);
  if (overlay.calibration.worstControlPointId &&
    !ids.has(overlay.calibration.worstControlPointId))
    throw Error("Geo calibration worst control point is outside its overlay.");
}

function validateBoundary(boundary) {
  if (!object(boundary) || !Array.isArray(boundary.points) ||
    boundary.points.length < 3 || boundary.points.length > 2000 ||
    boundary.points.some((point) => !coordinate(point)))
    throw Error("Invalid WGS84 Geo site boundary.");
}

export function assertGeoPresentationManifestV1(manifest) {
  if (!object(manifest) || manifest.format !== GEO_FORMAT || manifest.version !== GEO_VERSION)
    throw Error("Unsupported Geo presentation manifest.");
  if (!object(manifest.release) || !token(manifest.release.id) ||
    !token(manifest.release.experienceId) || !token(manifest.release.projectId) ||
    !text(manifest.release.projectSlug, 120) ||
    !Number.isInteger(manifest.release.version) || manifest.release.version < 1 ||
    !Number.isInteger(manifest.release.sourceDraftRevision) ||
    manifest.release.sourceDraftRevision < 1 ||
    !text(manifest.release.createdAt, 80) || !Number.isFinite(Date.parse(manifest.release.createdAt)))
    throw Error("Invalid Geo release identity.");
  if (!object(manifest.project) || manifest.project.id !== manifest.release.projectId ||
    manifest.project.slug !== manifest.release.projectSlug || !text(manifest.project.name))
    throw Error("Invalid Geo project snapshot.");
  if (!object(manifest.sourceBuilding) || !token(manifest.sourceBuilding.releaseId) ||
    !Number.isInteger(manifest.sourceBuilding.version) || manifest.sourceBuilding.version < 1 ||
    !sha256(manifest.sourceBuilding.manifestSha256))
    throw Error("Geo release is not pinned to an immutable Building release.");
  if (!object(manifest.model) || !token(manifest.model.id) || !text(manifest.model.url, 1000) ||
    manifest.model.mimeType !== "model/gltf-binary" ||
    !["geo-optimized", "building"].includes(manifest.model.variant) ||
    (manifest.model.sha256 !== undefined && !sha256(manifest.model.sha256)) ||
    (manifest.model.preferCanonical !== undefined &&
      typeof manifest.model.preferCanonical !== "boolean"))
    throw Error("Invalid Geo Building model reference.");
  validateAnchor(manifest.modelAnchor);
  validatePlacement(manifest.placement);
  if (manifest.masterplanOverlay !== undefined) validateOverlay(manifest.masterplanOverlay);
  if (manifest.siteBoundary !== undefined) validateBoundary(manifest.siteBoundary);
  return manifest;
}

function contextAnchor(context) {
  if (!context?.modelAnchorId || !context.modelAnchorKind || !context.modelAnchorName ||
    !finite(Number(context.modelAnchorXM), -100000, 100000) ||
    !finite(Number(context.modelAnchorYM), -100000, 100000) ||
    !finite(Number(context.modelAnchorZM), -100000, 100000))
    throw Error("Select an explicit Building model anchor before Geo verification/publish.");
  return {
    id: context.modelAnchorId,
    name: context.modelAnchorName,
    kind: context.modelAnchorKind,
    localPositionM: {
      x: Number(context.modelAnchorXM),
      y: Number(context.modelAnchorYM),
      z: Number(context.modelAnchorZM),
    },
  };
}

export function placementFromGeoContext(context) {
  if (context?.longitude === null || context?.longitude === undefined ||
    context?.latitude === null || context?.latitude === undefined)
    throw Error("Geo draft needs a WGS84 location.");
  const placement = {
    coordinateReferenceSystem: CRS,
    localFrame: LOCAL_FRAME,
    units: UNITS,
    anchor: {
      longitude: Number(context.longitude),
      latitude: Number(context.latitude),
      ...(context.heightMode === "absolute"
        ? { altitudeM: Number(context.altitudeM || 0) }
        : {}),
    },
    heightMode: context.heightMode || "ground-relative",
    eastOffsetM: Number(context.eastOffsetM || 0),
    northOffsetM: Number(context.northOffsetM || 0),
    verticalOffsetM: Number(context.verticalOffsetM || 0),
    headingDeg: Number(context.headingDeg || 0),
    pitchDeg: Number(context.pitchDeg || 0),
    rollDeg: Number(context.rollDeg || 0),
    scale: Number(context.scale || 1),
  };
  validatePlacement(placement);
  return placement;
}

export function assertGeoV2ContextReady(context) {
  if (!context?.experienceId) throw Error("Optional Geo Experience does not exist.");
  if (context.lifecycle !== "active") throw Error("Restore the Geo Experience before publication.");
  if (!Number.isInteger(Number(context.revision)) || Number(context.revision) < 1)
    throw Error("Geo draft must be saved before preview verification.");
  contextAnchor(context);
  placementFromGeoContext(context);
  return context;
}

async function loadOverlay(env, project, context) {
  const overlay = await env.DB.prepare(
    `SELECT o.id,o.asset_id,o.opacity,a.r2_key,a.sha256,
            r.algorithm,r.point_count,r.rms_error_m,r.max_error_m,
            r.worst_control_point_id,r.status
       FROM geo_overlays_3d o
       JOIN studio_assets_3d a
         ON a.id=o.asset_id AND a.project_id=o.project_id AND a.deleted_at IS NULL
       LEFT JOIN geo_calibration_reports_3d r
         ON r.overlay_id=o.id
        AND r.experience_id=o.experience_id
        AND r.project_id=o.project_id
        AND r.draft_revision=?
      WHERE o.experience_id=? AND o.project_id=?
        AND o.kind='masterplan' AND o.enabled=1
      ORDER BY o.sort_order ASC,o.created_at ASC
      LIMIT 1`,
  ).bind(Number(context.revision), context.experienceId, project.id).first();
  if (!overlay) return undefined;
  if (overlay.status !== "verified")
    throw Error("Enabled Geo masterplan overlay must have verified calibration for this draft revision.");

  const pointRows = await env.DB.prepare(
    `SELECT id,source_u,source_v,longitude,latitude,altitude_m
       FROM geo_control_points_3d
      WHERE overlay_id=? AND experience_id=? AND project_id=?
      ORDER BY sort_order ASC,created_at ASC,id ASC`,
  ).bind(overlay.id, context.experienceId, project.id).all();
  const controlPoints = (pointRows.results || []).map((point) => ({
    id: point.id,
    sourceUv: [Number(point.source_u), Number(point.source_v)],
    world: {
      longitude: Number(point.longitude),
      latitude: Number(point.latitude),
      ...(point.altitude_m === null || point.altitude_m === undefined
        ? {}
        : { altitudeM: Number(point.altitude_m) }),
    },
  }));
  const value = {
    assetKey: overlay.r2_key,
    ...(sha256(String(overlay.sha256 || "").toLowerCase())
      ? { sourceSha256: String(overlay.sha256).toLowerCase() }
      : {}),
    opacity: Number(overlay.opacity),
    controlPoints,
    calibration: {
      algorithm: overlay.algorithm,
      pointCount: Number(overlay.point_count),
      rmsErrorM: Number(overlay.rms_error_m),
      maxErrorM: Number(overlay.max_error_m),
      ...(overlay.worst_control_point_id
        ? { worstControlPointId: overlay.worst_control_point_id }
        : {}),
      status: overlay.status,
    },
  };
  validateOverlay(value);
  return value;
}

async function loadBoundary(env, project, context) {
  const row = await env.DB.prepare(
    `SELECT points_json FROM geo_site_boundaries_3d
      WHERE experience_id=? AND project_id=? AND draft_revision=?
      LIMIT 1`,
  ).bind(context.experienceId, project.id, Number(context.revision)).first();
  if (!row) return undefined;
  let points;
  try {
    points = JSON.parse(row.points_json);
  } catch {
    throw Error("Geo site boundary JSON is invalid.");
  }
  const value = { points };
  validateBoundary(value);
  return value;
}

/** Build immutable V2 Geo truth. Building remains rigid; homography is overlay-only. */
export async function buildGeoPresentationManifestV1({
  env,
  project,
  context,
  source,
  model,
  releaseId,
  version,
  createdAt,
}) {
  assertGeoV2ContextReady(context);
  if (!source || !token(source.id) || !Number.isInteger(source.version) ||
    !sha256(source.manifestSha256))
    throw Error("Geo V2 requires a checksum-pinned immutable Building release.");
  if (!model || !token(model.id) || !text(model.url, 1000) ||
    model.mimeType !== "model/gltf-binary")
    throw Error("Geo V2 requires an immutable Building GLB reference.");

  const [siteBoundary, masterplanOverlay] = await Promise.all([
    loadBoundary(env, project, context),
    loadOverlay(env, project, context),
  ]);
  const manifest = {
    format: GEO_FORMAT,
    version: GEO_VERSION,
    release: {
      id: releaseId,
      experienceId: context.experienceId,
      projectId: project.id,
      projectSlug: project.slug,
      version,
      sourceDraftRevision: Number(context.revision),
      createdAt,
    },
    project: {
      id: project.id,
      slug: project.slug,
      name: project.name,
      ...(project.location ? { location: project.location } : {}),
    },
    sourceBuilding: {
      releaseId: source.id,
      version: source.version,
      manifestSha256: source.manifestSha256,
    },
    model: {
      id: model.id,
      url: model.url,
      mimeType: "model/gltf-binary",
      ...(model.sha256 ? { sha256: model.sha256 } : {}),
      variant: model.variant === "geo-optimized" ? "geo-optimized" : "building",
    },
    modelAnchor: contextAnchor(context),
    placement: placementFromGeoContext(context),
    ...(siteBoundary ? { siteBoundary } : {}),
    ...(masterplanOverlay ? { masterplanOverlay } : {}),
    display: {
      showMasterplanByDefault: true,
      showBoundaryByDefault: true,
      showRoadsByDefault: true,
      showLabelsByDefault: true,
    },
  };
  return assertGeoPresentationManifestV1(manifest);
}

export const geoPresentationPolicy = {
  GEO_FORMAT,
  GEO_VERSION,
  CRS,
  LOCAL_FRAME,
  UNITS,
  HEIGHT_MODES,
  ANCHOR_KINDS,
};
