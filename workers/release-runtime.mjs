import { assertReleaseAssetKey } from "./storage-boundary.mjs";
import { serveR2Object } from "./http-range.mjs";
import { validProjectSlug } from "../shared/project-slug-policy.js";
import { sanitizeBuildingPresentationForRelease } from "./building-presentation-policy.mjs";
const BASE_PATH = "/3Dprojects";
const RELEASE_BASE = `${BASE_PATH}/api/releases`;

const SECURITY_HEADERS = {
  "Content-Security-Policy-Report-Only": "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; form-action 'self'; img-src 'self' data: blob: https://*.googleapis.com https://*.gstatic.com; media-src 'self' blob:; font-src 'self' data: https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://maps.googleapis.com https://maps.gstatic.com; connect-src 'self' https://*.googleapis.com https://*.gstatic.com; worker-src 'self' blob:",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

function json(value, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  for (const [key, item] of Object.entries(SECURITY_HEADERS))
    headers.set(key, item);
  return new Response(JSON.stringify(value), { ...init, headers });
}

function serverError(error, diagnostic) {
  const requestId = crypto.randomUUID();
  console.error(`[rekixo-public:${requestId}] ${error}`, diagnostic);
  return json({ error, requestId }, { status: 500 });
}

function validToken(value, max = 180) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    /^[A-Za-z0-9_.-]+$/.test(value)
  );
}

async function digestHex(value) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return Array.from(bytes, (item) => item.toString(16).padStart(2, "0")).join("");
}

export async function releaseSchemaReady(env) {
  try {
    const tables = await env.DB.prepare(
      `SELECT COUNT(*) AS total
         FROM sqlite_master
        WHERE type='table'
          AND name IN (
            'releases_3d',
            'release_assets_3d',
            'release_activations_3d'
          )`,
    ).first();
    const column = await env.DB.prepare(
      `SELECT COUNT(*) AS total
         FROM pragma_table_info('projects_3d')
        WHERE name='active_release_id'`,
    ).first();
    return Number(tables?.total || 0) === 3 && Number(column?.total || 0) === 1;
  } catch {
    return false;
  }
}

function finiteVector3(value) {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((item) => typeof item === "number" && Number.isFinite(item))
  );
}

function validManifestScene(scene, projectId) {
  return (
    scene &&
    typeof scene === "object" &&
    !Array.isArray(scene) &&
    validToken(scene.id) &&
    scene.projectId === projectId &&
    typeof scene.name === "string" &&
    scene.name.trim().length > 0 &&
    [
      "project-navigation",
      "section",
      "wing-distance",
      "balcony",
      "typical-floor",
      "amenity",
    ].includes(scene.type) &&
    Number.isInteger(scene.sortOrder) &&
    typeof scene.enabled === "boolean" &&
    (scene.settings === undefined ||
      (scene.settings &&
        typeof scene.settings === "object" &&
        !Array.isArray(scene.settings)))
  );
}

function validateManifestShape(
  manifest,
  row,
  expectedReleaseId = row.active_release_id,
) {
  if (
    !manifest ||
    typeof manifest !== "object" ||
    Array.isArray(manifest) ||
    manifest.format !== "rekixo-release-manifest" ||
    manifest.version !== 1 ||
    !manifest.release ||
    !manifest.project ||
    !manifest.experience ||
    !Array.isArray(manifest.experience.scenes) ||
    !Array.isArray(manifest.experience.mediaFiles) ||
    !Array.isArray(manifest.assets) ||
    manifest.release.id !== expectedReleaseId ||
    manifest.release.projectId !== row.project_id ||
    manifest.release.projectSlug !== row.slug ||
    Number(manifest.release.version) !== Number(row.release_version) ||
    manifest.project.id !== row.project_id ||
    manifest.project.slug !== row.slug ||
    manifest.project.status !== "published" ||
    typeof manifest.project.name !== "string" ||
    !manifest.project.name.trim()
  )
    throw Error("Active release manifest identity is invalid.");

  if (
    manifest.experience.scenes.length > 5000 ||
    manifest.experience.scenes.some(
      (scene) => !validManifestScene(scene, row.project_id),
    )
  )
    throw Error("Active release scene payload is invalid.");

  const mediaFiles = manifest.experience.mediaFiles;
  if (
    mediaFiles.length > 5000 ||
    new Set(mediaFiles).size !== mediaFiles.length ||
    mediaFiles.some(
      (file) =>
        typeof file !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,140}$/.test(file),
    )
  )
    throw Error("Active release media list is invalid.");

  const assetIds = new Set();
  const assetKeys = new Set();
  for (const asset of manifest.assets) {
    if (
      !asset ||
      typeof asset !== "object" ||
      Array.isArray(asset) ||
      !validToken(asset.id) ||
      !["model", "media", "studio"].includes(asset.kind) ||
      !validToken(asset.logicalId, 500) ||
      typeof asset.name !== "string" ||
      !asset.name.trim() ||
      typeof asset.mimeType !== "string" ||
      !asset.mimeType.trim() ||
      !Number.isSafeInteger(asset.byteSize) ||
      asset.byteSize < 0 ||
      (asset.sha256 !== undefined &&
        (typeof asset.sha256 !== "string" ||
          !/^[a-f0-9]{64}$/.test(asset.sha256)))
    )
      throw Error("Active release asset manifest is invalid.");
    const logicalKey = `${asset.kind}:${asset.logicalId}`;
    if (assetIds.has(asset.id) || assetKeys.has(logicalKey))
      throw Error("Active release contains duplicate assets.");
    assetIds.add(asset.id);
    assetKeys.add(logicalKey);
  }

  const model = manifest.experience.model;
  if (
    model &&
    (!validToken(model.id) ||
      model.projectId !== row.project_id ||
      typeof model.name !== "string" ||
      !model.name.trim() ||
      !Number.isInteger(model.version) ||
      model.version < 1 ||
      typeof model.mimeType !== "string" ||
      !validToken(model.releaseAssetId) ||
      !assetIds.has(model.releaseAssetId))
  )
    throw Error("Active release model payload is invalid.");

  const buildingPresentation = manifest.experience.buildingPresentation;
  if (buildingPresentation !== undefined) {
    if (!model)
      throw Error("Active Building presentation is missing its immutable model.");
    const modelAsset = manifest.assets.find(
      (asset) =>
        asset.id === model.releaseAssetId &&
        asset.kind === "model" &&
        asset.logicalId === model.id,
    );
    if (!modelAsset?.sha256)
      throw Error("Active Building presentation model is not checksum pinned.");
    sanitizeBuildingPresentationForRelease(buildingPresentation, {
      modelSha256: modelAsset.sha256,
      sourceEvidence: manifest.sourceEvidence,
    });
  }

  const camera = manifest.experience.camera;
  if (
    camera &&
    (!validToken(camera.id) ||
      camera.projectId !== row.project_id ||
      typeof camera.name !== "string" ||
      !camera.name.trim() ||
      !finiteVector3(camera.position) ||
      !finiteVector3(camera.target) ||
      (camera.fov !== undefined &&
        (typeof camera.fov !== "number" ||
          !Number.isFinite(camera.fov) ||
          camera.fov <= 0 ||
          camera.fov > 180)))
  )
    throw Error("Active release camera payload is invalid.");

  const studioProject = manifest.studio?.project;
  if (
    studioProject &&
    (studioProject.schema !== 1 ||
      studioProject.id !== row.project_id ||
      studioProject.slug !== row.slug ||
      !Array.isArray(studioProject.assets) ||
      studioProject.assets.some((assetId) => !validToken(assetId)))
  )
    throw Error("Active release Studio payload is invalid.");
}

export async function activeReleaseState(env, slug) {
  if (!validProjectSlug(slug)) return { state: "invalid-slug" };
  if (!(await releaseSchemaReady(env))) return { state: "schema-missing" };

  const row = await env.DB.prepare(
    `SELECT p.id AS project_id,p.slug,p.name,p.status,p.active_release_id,
            r.version AS release_version,r.manifest_json,r.manifest_sha256,
            r.created_at AS release_created_at
       FROM projects_3d p
       LEFT JOIN releases_3d r
         ON r.id=p.active_release_id AND r.project_id=p.id
      WHERE p.slug=?
      LIMIT 1`,
  ).bind(slug).first();

  if (!row) return { state: "project-missing" };
  if (row.status !== "published") return { state: "unpublished", project: row };
  if (!row.active_release_id) return { state: "no-active", project: row };
  if (!row.manifest_json || !row.manifest_sha256)
    return { state: "corrupt", project: row, reason: "Active release row is missing." };

  const actualHash = await digestHex(row.manifest_json);
  if (actualHash !== String(row.manifest_sha256).toLowerCase())
    return {
      state: "corrupt",
      project: row,
      reason: "Active release manifest checksum mismatch.",
    };

  let manifest;
  try {
    manifest = JSON.parse(row.manifest_json);
    validateManifestShape(manifest, row);
  } catch (error) {
    return {
      state: "corrupt",
      project: row,
      reason:
        error instanceof Error
          ? error.message
          : "Active release manifest is invalid.",
    };
  }

  return {
    state: "ok",
    project: row,
    manifest,
    manifestSha256: actualHash,
  };
}

export async function releaseStateById(env, slug, releaseId) {
  if (!validProjectSlug(slug)) return { state: "invalid-slug" };
  if (!validToken(releaseId)) return { state: "invalid-release" };
  if (!(await releaseSchemaReady(env))) return { state: "schema-missing" };

  const row = await env.DB.prepare(
    `SELECT p.id AS project_id,p.slug,p.name,p.status,p.active_release_id,
            r.id AS release_id,r.version AS release_version,
            r.manifest_json,r.manifest_sha256,
            r.created_at AS release_created_at
       FROM projects_3d p
       JOIN releases_3d r
         ON r.project_id=p.id
      WHERE p.slug=? AND r.id=?
      LIMIT 1`,
  ).bind(slug, releaseId).first();

  if (!row) return { state: "release-missing" };
  if (row.status !== "published") return { state: "unpublished", project: row };
  if (!row.manifest_json || !row.manifest_sha256)
    return {
      state: "corrupt",
      project: row,
      reason: "Immutable release row is missing.",
    };

  const actualHash = await digestHex(row.manifest_json);
  if (actualHash !== String(row.manifest_sha256).toLowerCase())
    return {
      state: "corrupt",
      project: row,
      reason: "Immutable release manifest checksum mismatch.",
    };

  let manifest;
  try {
    manifest = JSON.parse(row.manifest_json);
    validateManifestShape(manifest, row, row.release_id);
  } catch (error) {
    return {
      state: "corrupt",
      project: row,
      reason:
        error instanceof Error
          ? error.message
          : "Immutable release manifest is invalid.",
    };
  }

  return {
    state: "ok",
    project: row,
    manifest,
    manifestSha256: actualHash,
  };
}

function publicWalkthroughFromStudio(manifest) {
  const scene = manifest.studio?.project?.scene;
  if (!scene || !Array.isArray(scene.rooms) || !scene.rooms.length)
    return undefined;

  const scale =
    typeof scene.scale === "number" &&
    Number.isFinite(scene.scale) &&
    scene.scale > 0
      ? scene.scale
      : 1;
  const transform =
    scene.modelTransform && typeof scene.modelTransform === "object"
      ? scene.modelTransform
      : {};
  const tx = Number.isFinite(transform.x) ? Number(transform.x) : 0;
  const ty = Number.isFinite(transform.y) ? Number(transform.y) : 0;
  const tz = Number.isFinite(transform.z) ? Number(transform.z) : 0;
  const rotationY = Number.isFinite(transform.rotationY)
    ? Number(transform.rotationY)
    : 0;
  const angle = (rotationY * Math.PI) / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);

  const toModelXZ = (x, z) => {
    const dx = (Number(x) - tx) / scale;
    const dz = (Number(z) - tz) / scale;
    return [
      dx * cosine - dz * sine,
      dx * sine + dz * cosine,
    ];
  };
  const toModelY = (y) => (Number(y) - ty) / scale;
  const floorById = new Map(
    (Array.isArray(scene.floors) ? scene.floors : [])
      .filter(
        (floor) =>
          floor &&
          typeof floor.id === "string" &&
          typeof floor.elevation === "number" &&
          Number.isFinite(floor.elevation),
      )
      .map((floor) => [floor.id, floor]),
  );

  const rooms = [];
  const roomIds = new Set();
  for (const room of scene.rooms) {
    if (
      !room ||
      typeof room.id !== "string" ||
      typeof room.floorId !== "string" ||
      typeof room.name !== "string" ||
      typeof room.unit !== "string"
    )
      continue;
    const floor = floorById.get(room.floorId);
    if (!floor) continue;

    let boundary;
    if (
      Array.isArray(room.polygon) &&
      room.polygon.length >= 3 &&
      room.polygon.every(
        (point) =>
          Array.isArray(point) &&
          point.length === 2 &&
          point.every((value) => typeof value === "number" && Number.isFinite(value)),
      )
    ) {
      boundary = room.polygon.map(([x, z]) => toModelXZ(x, z));
    } else if (
      [room.x, room.z, room.width, room.depth].every(
        (value) => typeof value === "number" && Number.isFinite(value),
      ) &&
      room.width > 0 &&
      room.depth > 0
    ) {
      boundary = [
        [room.x - room.width / 2, room.z - room.depth / 2],
        [room.x + room.width / 2, room.z - room.depth / 2],
        [room.x + room.width / 2, room.z + room.depth / 2],
        [room.x - room.width / 2, room.z + room.depth / 2],
      ].map(([x, z]) => toModelXZ(x, z));
    } else {
      continue;
    }

    const height =
      typeof room.height === "number" &&
      Number.isFinite(room.height) &&
      room.height > 0
        ? room.height / scale
        : 2.8 / scale;
    rooms.push({
      id: room.id,
      floorId: room.floorId,
      name: room.name,
      unit: room.unit,
      elevation: toModelY(floor.elevation),
      height,
      boundary,
    });
    roomIds.add(room.id);
  }
  if (!rooms.length) return undefined;

  const doors = [];
  for (const opening of Array.isArray(scene.openings) ? scene.openings : []) {
    if (
      !opening ||
      opening.reviewed !== true ||
      opening.kind !== "door" ||
      !Array.isArray(opening.roomIds) ||
      opening.roomIds.length !== 2 ||
      opening.roomIds[0] === opening.roomIds[1] ||
      !opening.roomIds.every((roomId) => roomIds.has(roomId)) ||
      typeof opening.floorId !== "string" ||
      ![opening.x, opening.y, opening.z, opening.width, opening.height, opening.rotationY].every(
        (value) => typeof value === "number" && Number.isFinite(value),
      ) ||
      opening.width <= 0 ||
      opening.height <= 0
    )
      continue;
    const [x, z] = toModelXZ(opening.x, opening.z);
    const tangentX = Math.cos((opening.rotationY * Math.PI) / 180);
    const tangentZ = -Math.sin((opening.rotationY * Math.PI) / 180);
    const localTangentX = tangentX * cosine - tangentZ * sine;
    const localTangentZ = tangentX * sine + tangentZ * cosine;
    const localRotationY =
      (Math.atan2(-localTangentZ, localTangentX) * 180) / Math.PI;
    doors.push({
      id: opening.id,
      floorId: opening.floorId,
      roomIds: [opening.roomIds[0], opening.roomIds[1]],
      x,
      y: toModelY(opening.y),
      z,
      width: opening.width / scale,
      height: opening.height / scale,
      rotationY: localRotationY,
    });
  }

  return {
    version: 1,
    metresPerUnit: scale,
    rooms,
    doors,
  };
}

function publicExperience(manifest, manifestSha256) {
  const release = manifest.release;
  const frozen = manifest.experience;
  const model = frozen.model
    ? {
        ...frozen.model,
        available: true,
        url: `${RELEASE_BASE}/${encodeURIComponent(release.id)}/models/${encodeURIComponent(
          frozen.model.id,
        )}/model.glb?v=${encodeURIComponent(String(release.version))}`,
      }
    : undefined;
  if (model) delete model.releaseAssetId;

  const walkthrough = publicWalkthroughFromStudio(manifest);
  return {
    project: manifest.project,
    scene: frozen.scenes[0],
    scenes: frozen.scenes,
    camera: frozen.camera,
    model,
    mediaBaseUrl: `${RELEASE_BASE}/${encodeURIComponent(release.id)}/media`,
    ...(frozen.buildingPresentation
      ? { buildingPresentation: structuredClone(frozen.buildingPresentation) }
      : {}),
    ...(walkthrough ? { walkthrough } : {}),
    release: {
      id: release.id,
      version: release.version,
      manifestSha256,
      createdAt: release.createdAt,
    },
  };
}

async function releaseCatalog(env) {
  if (!(await releaseSchemaReady(env)))
    return json({ releases: [], releaseSchemaReady: false });
  const rows = await env.DB.prepare(
    `SELECT p.slug,p.name,p.active_release_id AS releaseId,
            r.version,r.manifest_json,r.created_at AS createdAt
       FROM projects_3d p
       JOIN releases_3d r
         ON r.id=p.active_release_id AND r.project_id=p.id
      WHERE p.status='published'
      ORDER BY r.created_at DESC,p.slug ASC`,
  ).all();

  return json({
    releaseSchemaReady: true,
    releases: (rows.results || []).map((row) => {
      let studioAvailable = false;
      try {
        studioAvailable = Boolean(JSON.parse(row.manifest_json)?.studio?.project);
      } catch {
        studioAvailable = false;
      }
      return {
        slug: row.slug,
        name: row.name,
        releaseId: row.releaseId,
        version: Number(row.version || 1),
        createdAt: row.createdAt,
        studioAvailable,
      };
    }),
  });
}

async function activeProjectRelease(env, slug) {
  const state = await activeReleaseState(env, slug);
  if (state.state === "schema-missing" || state.state === "no-active")
    return json(
      { error: "This project does not have an immutable active release." },
      { status: 404 },
    );
  if (state.state === "project-missing" || state.state === "unpublished")
    return json({ error: "Published project not found." }, { status: 404 });
  if (state.state !== "ok")
    return serverError(
      "Active release is unavailable.",
      state.reason || state.state,
    );

  return json({
    release: {
      id: state.manifest.release.id,
      version: state.manifest.release.version,
      createdAt: state.manifest.release.createdAt,
      manifestSha256: state.manifestSha256,
    },
    experience: publicExperience(state.manifest, state.manifestSha256),
    studioAvailable: Boolean(state.manifest.studio?.project),
  });
}

async function activeStudioRelease(env, slug) {
  const state = await activeReleaseState(env, slug);
  if (state.state !== "ok") {
    if (state.state === "corrupt")
      return serverError(
        "Published Studio release is unavailable.",
        state.reason || state.state,
      );
    return json(
      { error: "Published Studio release not found." },
      { status: 404 },
    );
  }
  const project = state.manifest.studio?.project;
  if (!project)
    return json({ error: "This release has no Studio snapshot." }, { status: 404 });

  const assets = state.manifest.assets
    .filter((asset) => asset.kind === "studio")
    .map((asset) => ({
      id: asset.logicalId,
      name: asset.name,
      type: asset.mimeType,
      size: asset.byteSize,
      hash: asset.sha256,
      contentUrl: `${RELEASE_BASE}/${encodeURIComponent(
        state.manifest.release.id,
      )}/assets/${encodeURIComponent(asset.logicalId)}/content`,
    }));

  return json({
    format: "rekixo-release-studio-1",
    release: {
      id: state.manifest.release.id,
      version: state.manifest.release.version,
      createdAt: state.manifest.release.createdAt,
      manifestSha256: state.manifestSha256,
    },
    project,
    assets,
  });
}

function releaseAssetKind(pathKind) {
  if (pathKind === "models") return "model";
  if (pathKind === "media") return "media";
  if (pathKind === "assets") return "studio";
  return "";
}

function withPublicModelCors(response) {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", "GET,HEAD,OPTIONS");
  headers.set("access-control-allow-headers", "Range");
  headers.set(
    "access-control-expose-headers",
    "Accept-Ranges,Content-Range,Content-Length,ETag,X-Rekixo-SHA256",
  );
  headers.set("cross-origin-resource-policy", "cross-origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function geoDerivativeKeys(slug, releaseId, logicalId) {
  if (
    !validProjectSlug(slug) ||
    !validToken(releaseId) ||
    !validToken(logicalId, 500)
  )
    throw Error("Invalid Geo derivative identity.");
  const base =
    `projects/${slug}/releases/${releaseId}/geo-models/${logicalId}`;
  return {
    modelKey: `${base}/model.glb`,
    metadataKey: `${base}/metadata.json`,
  };
}

async function readGeoDerivativeMetadata(
  env,
  slug,
  releaseId,
  logicalId,
  sourceSha256,
) {
  const { modelKey, metadataKey } = geoDerivativeKeys(
    slug,
    releaseId,
    logicalId,
  );
  let object;
  let metadataObject;
  try {
    // Probe sequentially so a missing/failed optional derivative cannot leave
    // a second R2 promise rejecting after the caller has already fallen back.
    object = await env.MODEL_ASSETS.head(modelKey);
    if (!object) return null;
    metadataObject = await env.MODEL_ASSETS.get(metadataKey);
  } catch {
    // Geo derivatives are an optional rendering optimization. Storage/network
    // failures must fall back to the immutable source model instead of making
    // the project or integration contract unavailable.
    return null;
  }
  if (!object || !metadataObject?.body) return null;

  let metadata;
  try {
    metadata = JSON.parse(await metadataObject.text());
  } catch {
    return null;
  }
  if (
    metadata?.format !== "rekixo-geo-model-derivative" ||
    metadata?.version !== 1 ||
    !["core-map-v4", "core-map-v5"].includes(metadata?.pipeline) ||
    // V5 derivatives are generated only when the original metric frame is
    // preserved. Continue serving historical V4 derivatives without changing
    // any existing project's active release or asset pointers.
    (metadata?.pipeline === "core-map-v5" && (
      metadata.coordinateFrame !== "canonical-model-local-v1" ||
      metadata.frameValidation?.ok !== true ||
      !Number.isFinite(metadata.frameValidation?.maxDriftM) ||
      metadata.frameValidation.maxDriftM > 0.5
    )) ||
    metadata.projectSlug !== slug ||
    metadata.releaseId !== releaseId ||
    metadata.sourceModelId !== logicalId ||
    !Number.isSafeInteger(metadata.geoByteSize) ||
    metadata.geoByteSize !== object.size ||
    typeof metadata.geoSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(metadata.geoSha256) ||
    (sourceSha256 &&
      metadata.sourceSha256 &&
      metadata.sourceSha256 !== sourceSha256) ||
    !Array.isArray(metadata.extensionsRequired) ||
    metadata.extensionsRequired.length !== 0 ||
    !Array.isArray(metadata.extensionsUsed) ||
    metadata.extensionsUsed.length !== 0
  )
    return null;

  return { metadata, modelKey };
}

export async function geoModelDerivativeForReleaseState(env, state) {
  if (state?.state !== "ok") return undefined;
  const model = state.manifest?.experience?.model;
  if (!model?.id || !model.releaseAssetId) return undefined;
  const sourceAsset = state.manifest.assets.find(
    (asset) =>
      asset.id === model.releaseAssetId &&
      asset.kind === "model" &&
      asset.logicalId === model.id,
  );
  if (!sourceAsset) return undefined;

  const derivative = await readGeoDerivativeMetadata(
    env,
    state.manifest.project.slug,
    state.manifest.release.id,
    model.id,
    sourceAsset.sha256,
  );
  if (!derivative) return undefined;

  return {
    id: model.id,
    projectId: model.projectId,
    name: `${model.name} · Geo optimized`,
    version: Number(model.version || 1),
    mimeType: "model/gltf-binary",
    byteSize: derivative.metadata.geoByteSize,
    available: true,
    variant: "geo-optimized",
    sourceModelId: model.id,
    sourceSha256: derivative.metadata.sourceSha256,
    sha256: derivative.metadata.geoSha256,
    url:
      `${RELEASE_BASE}/${encodeURIComponent(
        state.manifest.release.id,
      )}/geo-models/${encodeURIComponent(model.id)}/model.glb?v=${encodeURIComponent(
        String(state.manifest.release.version),
      )}&geo=${encodeURIComponent(derivative.metadata.geoSha256)}`,
  };
}

export async function geoModelDerivativeForActiveRelease(env, state) {
  return geoModelDerivativeForReleaseState(env, state);
}

async function serveGeoModelDerivative(
  env,
  releaseId,
  logicalId,
  request,
) {
  if (!validToken(releaseId) || !validToken(logicalId, 500))
    return json({ error: "Invalid Geo derivative route." }, { status: 400 });
  if (request.method === "OPTIONS")
    return withPublicModelCors(new Response(null, { status: 204 }));
  if (request.method !== "GET" && request.method !== "HEAD")
    return json({ error: "Method not allowed." }, { status: 405 });
  if (!(await releaseSchemaReady(env)))
    return json({ error: "Release runtime is not installed." }, { status: 404 });

  const row = await env.DB.prepare(
    `SELECT a.r2_key,a.sha256,p.status,p.slug
       FROM release_assets_3d a
       JOIN releases_3d r ON r.id=a.release_id AND r.project_id=a.project_id
       JOIN projects_3d p ON p.id=r.project_id
      WHERE a.release_id=?
        AND a.kind='model'
        AND a.logical_id=?
        AND (
          p.active_release_id=r.id
          OR EXISTS (
            SELECT 1
              FROM geo_experience_active_releases_3d gar
              JOIN geo_releases_3d gr
                ON gr.id=gar.geo_release_id
               AND gr.experience_id=gar.experience_id
               AND gr.project_id=gar.project_id
              JOIN experiences_3d e
                ON e.id=gar.experience_id
               AND e.project_id=gar.project_id
               AND e.type='geo'
               AND e.lifecycle='active'
             WHERE gar.project_id=r.project_id
               AND gr.source_building_release_id=r.id
          )
        )
      LIMIT 1`,
  ).bind(releaseId, logicalId).first();

  if (!row || row.status !== "published")
    return json({ error: "Geo derivative not found." }, { status: 404 });

  try {
    assertReleaseAssetKey(
      row.slug,
      releaseId,
      "model",
      logicalId,
      row.r2_key,
    );
  } catch (error) {
    return serverError(
      "Geo derivative is unavailable.",
      error instanceof Error
        ? error.message
        : "Invalid immutable release storage key.",
    );
  }

  const derivative = await readGeoDerivativeMetadata(
    env,
    row.slug,
    releaseId,
    logicalId,
    row.sha256,
  );
  if (!derivative)
    return json({ error: "Geo derivative not found." }, { status: 404 });

  const served = await serveR2Object(
    env.MODEL_ASSETS,
    derivative.modelKey,
    request,
    {
      mimeType: "model/gltf-binary",
      cacheControl: "public, max-age=31536000, immutable",
      expectedSize: derivative.metadata.geoByteSize,
      sha256: derivative.metadata.geoSha256,
      allowRange: true,
    },
  );
  if (served.corruption)
    return serverError("Geo derivative is unavailable.", served.corruption);
  if (served.missing)
    return json({ error: "Geo derivative not found." }, { status: 404 });
  return withPublicModelCors(served.response);
}

export async function serveReleaseAsset(env, releaseId, pathKind, logicalId, request) {
  if (!validToken(releaseId) || !validToken(logicalId, 500))
    return json({ error: "Invalid release asset route." }, { status: 400 });
  const kind = releaseAssetKind(pathKind);
  if (!kind)
    return json({ error: "Unknown release asset kind." }, { status: 404 });

  if (request.method === "OPTIONS" && kind === "model")
    return withPublicModelCors(new Response(null, { status: 204 }));
  if (request.method !== "GET" && request.method !== "HEAD")
    return json({ error: "Method not allowed." }, { status: 405 });
  if (!(await releaseSchemaReady(env)))
    return json({ error: "Release runtime is not installed." }, { status: 404 });

  const row = await env.DB.prepare(
    `SELECT a.r2_key,a.mime_type,a.byte_size,a.name,a.sha256,a.source_etag,
            p.status,p.slug
       FROM release_assets_3d a
       JOIN releases_3d r ON r.id=a.release_id AND r.project_id=a.project_id
       JOIN projects_3d p ON p.id=r.project_id
      WHERE a.release_id=?
        AND a.kind=?
        AND a.logical_id=?
        AND (
          p.active_release_id=r.id
          OR (
            ?='model'
            AND EXISTS (
              SELECT 1
                FROM geo_experience_active_releases_3d gar
                JOIN geo_releases_3d gr
                  ON gr.id=gar.geo_release_id
                 AND gr.experience_id=gar.experience_id
                 AND gr.project_id=gar.project_id
                JOIN experiences_3d e
                  ON e.id=gar.experience_id
                 AND e.project_id=gar.project_id
                 AND e.type='geo'
                 AND e.lifecycle='active'
               WHERE gar.project_id=r.project_id
                 AND gr.source_building_release_id=r.id
            )
          )
        )
      LIMIT 1`,
  ).bind(releaseId, kind, logicalId, kind).first();

  if (!row || row.status !== "published")
    return json({ error: "Release asset not found." }, { status: 404 });

  try {
    assertReleaseAssetKey(
      row.slug,
      releaseId,
      kind,
      logicalId,
      row.r2_key,
    );
  } catch (error) {
    return serverError(
      "Immutable release asset is unavailable.",
      error instanceof Error
        ? error.message
        : "Invalid immutable release storage key.",
    );
  }

  const mimeType = row.mime_type || "application/octet-stream";
  const served = await serveR2Object(
    env.MODEL_ASSETS,
    row.r2_key,
    request,
    {
      mimeType,
      cacheControl: "public, max-age=31536000, immutable",
      expectedSize: Number(row.byte_size),
      sha256: row.sha256 || undefined,
      // GLB renderers (including Google Maps 3D) may probe or stream models
      // with byte-range requests. Immutable model objects are safe to range
      // because size/hash identity is pinned by the release manifest.
      allowRange:
        kind === "model" ||
        (kind === "media" && mimeType === "video/mp4"),
    },
  );
  if (served.corruption)
    return serverError(
      "Immutable release asset is unavailable.",
      served.corruption,
    );
  if (served.missing)
    return serverError(
      "Immutable release asset is unavailable.",
      "Immutable release asset is missing from storage.",
    );
  return kind === "model"
    ? withPublicModelCors(served.response)
    : served.response;
}

export async function handleReleaseReadRequest(
  request,
  env,
  url = new URL(request.url),
) {
  if (!url.pathname.startsWith(RELEASE_BASE)) return null;

  if (url.pathname === RELEASE_BASE || url.pathname === `${RELEASE_BASE}/`) {
    if (request.method !== "GET")
      return json({ error: "Method not allowed." }, { status: 405 });
    return releaseCatalog(env);
  }

  const relative = url.pathname.slice(RELEASE_BASE.length);
  const parts = relative.split("/").filter(Boolean).map(decodeURIComponent);

  if (parts[0] === "projects" && parts[1]) {
    const slug = String(parts[1]).trim().toLowerCase();
    if (!validProjectSlug(slug))
      return json({ error: "Valid project slug is required." }, { status: 400 });
    if (parts.length === 2) {
      if (request.method !== "GET")
        return json({ error: "Method not allowed." }, { status: 405 });
      return activeProjectRelease(env, slug);
    }
    if (parts.length === 3 && parts[2] === "studio") {
      if (request.method !== "GET")
        return json({ error: "Method not allowed." }, { status: 405 });
      return activeStudioRelease(env, slug);
    }
    return json({ error: "Unknown release project route." }, { status: 404 });
  }

  if (
    parts.length === 4 &&
    parts[1] === "geo-models" &&
    parts[2] &&
    parts[3] === "model.glb"
  )
    return serveGeoModelDerivative(
      env,
      parts[0],
      parts[2],
      request,
    );

  if (
    parts.length === 4 &&
    ["models", "media"].includes(parts[1]) &&
    parts[2] &&
    (parts[1] === "media"
      ? true
      : ["content", "model.glb"].includes(parts[3]))
  ) {
    if (parts[1] === "media") {
      // /{releaseId}/media/{fileName} has three path segments, handled below.
    } else {
      return serveReleaseAsset(env, parts[0], parts[1], parts[2], request);
    }
  }

  if (parts.length === 3 && parts[1] === "media")
    return serveReleaseAsset(env, parts[0], "media", parts[2], request);

  if (
    parts.length === 4 &&
    parts[1] === "assets" &&
    parts[3] === "content"
  )
    return serveReleaseAsset(env, parts[0], "assets", parts[2], request);

  if (
    parts.length === 4 &&
    parts[1] === "models" &&
    ["content", "model.glb"].includes(parts[3])
  )
    return serveReleaseAsset(env, parts[0], "models", parts[2], request);

  return json({ error: "Release route not found." }, { status: 404 });
}

export function experienceFromReleaseState(state) {
  if (state?.state !== "ok") return undefined;
  return publicExperience(state.manifest, state.manifestSha256);
}

export function experienceFromActiveReleaseState(state) {
  return experienceFromReleaseState(state);
}
