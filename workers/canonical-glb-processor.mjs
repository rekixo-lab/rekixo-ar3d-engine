import { sourceFileKey } from "./source-upload-policy.mjs";
import {
  FBX_MODEL_PROCESSOR_EXECUTION,
  MAX_FBX_PROCESSOR_INPUT_BYTES,
  convertFbxWithModelProcessor,
  fbxModelProcessorCapability,
} from "./fbx-model-processor-adapter.mjs";
import {
  NODE_CATALOG_FORMAT,
  NODE_CATALOG_VERSION,
  buildNodeCatalogData,
} from "./node-catalog.mjs";

export const CANONICAL_MODEL_FORMAT = "rekixo-canonical-model";
export const CANONICAL_MODEL_VERSION = 1;

const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;
// Bound the glTF JSON chunk separately from the 512 MiB original-model limit.
// Large CAD/Blender exports can contain >8 MiB of node/mesh metadata.
const MAX_GLB_JSON_BYTES = 32 * 1024 * 1024;
const MAX_WORKER_CANONICAL_BYTES = 512 * 1024 * 1024;
const STALE_RUNNER_MS = 15 * 60 * 1000;
const MODEL_MIME = "model/gltf-binary";

function processingError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function objectEtag(object) {
  return String(object?.httpEtag || object?.etag || "");
}

function hex(bytes) {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function objectSha256(object) {
  const checksum = object?.checksums?.sha256;
  return checksum ? hex(checksum) : "";
}

async function sha256Text(value) {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

export function parseGlbHeader(bytes, expectedByteSize) {
  const buffer = bytes instanceof ArrayBuffer
    ? bytes
    : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  if (buffer.byteLength < 20)
    throw processingError("INVALID_GLB", "Geometry authority is too small to be a GLB 2.0 file.");

  const view = new DataView(buffer);
  const magic = view.getUint32(0, true);
  const version = view.getUint32(4, true);
  const declaredLength = view.getUint32(8, true);
  const jsonChunkLength = view.getUint32(12, true);
  const jsonChunkType = view.getUint32(16, true);

  if (magic !== GLB_MAGIC)
    throw processingError("INVALID_GLB", "Geometry authority does not contain the GLB magic header.");
  if (version !== 2)
    throw processingError("UNSUPPORTED_GLB_VERSION", `GLB version ${version} is not supported; GLB 2.0 is required.`);
  if (declaredLength !== expectedByteSize)
    throw processingError("GLB_LENGTH_MISMATCH", "GLB declared byte length does not match the verified source identity.");
  if (jsonChunkType !== GLB_JSON_CHUNK)
    throw processingError("INVALID_GLB", "GLB first chunk must be the JSON chunk.");
  if (jsonChunkLength <= 0 || jsonChunkLength > MAX_GLB_JSON_BYTES)
    throw processingError("GLB_JSON_LIMIT", "GLB JSON chunk is empty or exceeds the 32 MiB validation limit.");
  if (20 + jsonChunkLength > expectedByteSize)
    throw processingError("INVALID_GLB", "GLB JSON chunk exceeds the declared file length.");

  return { version, declaredLength, jsonChunkLength };
}

function externalUri(uri) {
  return typeof uri === "string" && uri.length > 0 && !uri.startsWith("data:");
}

export function inspectGlbJson(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw processingError("INVALID_GLTF_JSON", "GLB JSON root must be an object.");
  const asset = value.asset;
  if (!asset || typeof asset !== "object" || !String(asset.version || "").startsWith("2"))
    throw processingError("UNSUPPORTED_GLTF_VERSION", "Canonical Building processing requires glTF 2.x metadata.");

  const externalBuffers = Array.isArray(value.buffers)
    ? value.buffers.filter((item) => externalUri(item?.uri))
    : [];
  const externalImages = Array.isArray(value.images)
    ? value.images.filter((item) => externalUri(item?.uri))
    : [];
  if (externalBuffers.length || externalImages.length)
    throw processingError(
      "EXTERNAL_GLTF_DEPENDENCY",
      "Canonical GLB must be self-contained; external buffer or image URIs are not allowed.",
    );

  const count = (name) => (Array.isArray(value[name]) ? value[name].length : 0);
  const requiredExtensions = Array.isArray(value.extensionsRequired)
    ? value.extensionsRequired.filter((item) => typeof item === "string").slice(0, 100)
    : [];

  return {
    assetVersion: String(asset.version),
    generator: typeof asset.generator === "string" ? asset.generator.slice(0, 300) : null,
    statistics: {
      sceneCount: count("scenes"),
      nodeCount: count("nodes"),
      meshCount: count("meshes"),
      materialCount: count("materials"),
      textureCount: count("textures"),
      imageCount: count("images"),
      animationCount: count("animations"),
    },
    requiredExtensions,
  };
}

async function readGlbInspectionAtKey(env, r2Key, expectedByteSize, canonicalModelSha256) {
  const headerObject = await env.MODEL_ASSETS.get(r2Key, {
    range: { offset: 0, length: 20 },
  });
  if (!headerObject)
    throw processingError("CANONICAL_MODEL_MISSING", "Canonical GLB is missing from R2.");
  const header = parseGlbHeader(await headerObject.arrayBuffer(), Number(expectedByteSize));

  const jsonObject = await env.MODEL_ASSETS.get(r2Key, {
    range: { offset: 20, length: header.jsonChunkLength },
  });
  if (!jsonObject)
    throw processingError("CANONICAL_MODEL_MISSING", "Canonical GLB JSON chunk could not be read from R2.");
  const jsonBytes = new Uint8Array(await jsonObject.arrayBuffer());
  const text = new TextDecoder("utf-8", { fatal: true })
    .decode(jsonBytes)
    .replace(/[\u0000\u0020\t\r\n]+$/g, "");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw processingError("INVALID_GLTF_JSON", "Canonical GLB JSON chunk is not valid UTF-8 JSON.");
  }
  return {
    ...inspectGlbJson(parsed),
    nodeCatalog: buildNodeCatalogData(parsed, canonicalModelSha256),
  };
}

async function jobById(env, jobId) {
  return env.DB.prepare(`SELECT * FROM processing_jobs_3d WHERE id=? LIMIT 1`)
    .bind(jobId)
    .first();
}

async function claimJob(env, jobId) {
  const now = new Date().toISOString();
  const staleBefore = new Date(Date.now() - STALE_RUNNER_MS).toISOString();
  const result = await env.DB.prepare(
    `UPDATE processing_jobs_3d
        SET state='running',
            started_at=COALESCE(started_at,?),
            heartbeat_at=?,
            updated_at=?
      WHERE id=?
        AND (
          state='queued'
          OR (state='running' AND (heartbeat_at IS NULL OR heartbeat_at<?))
        )`,
  ).bind(now, now, now, jobId, staleBefore).run();
  if (Number(result?.meta?.changes || 0) <= 0) return null;
  return jobById(env, jobId);
}

async function touchHeartbeat(env, jobId) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE processing_jobs_3d
        SET heartbeat_at=?,updated_at=?
      WHERE id=? AND state='running'`,
  ).bind(now, now, jobId).run();
}

async function processingContext(env, job) {
  return env.DB.prepare(
    `SELECT project.slug AS project_slug,
            project.name AS project_name,
            pack.status AS source_pack_status,
            pack.operator_approved AS source_pack_operator_approved,
            pack.geometry_authority_file_id,
            pack.manifest_sha256 AS current_pack_manifest_sha256,
            source.id AS source_id,
            source.filename,
            source.media_type,
            source.byte_size,
            source.sha256,
            source.r2_key,
            source.upload_state,
            source.source_etag
       FROM projects_3d project
       JOIN source_packs_3d pack
         ON pack.id=? AND pack.project_id=project.id
       JOIN source_files_3d source
         ON source.id=pack.geometry_authority_file_id
        AND source.project_id=project.id
      WHERE project.id=?
      LIMIT 1`,
  ).bind(job.source_pack_id, job.project_id).first();
}

export function geometryAuthorityFormat(context) {
  const filename = String(context?.filename || "").toLowerCase();
  const mediaType = String(context?.media_type || "").toLowerCase();
  if (filename.endsWith(".glb")) return "glb";
  if (filename.endsWith(".fbx")) return "fbx";
  if (mediaType === MODEL_MIME) return "glb";
  return null;
}

function assertPinnedContext(job, context) {
  if (!context)
    throw processingError("PROCESSING_INPUT_MISSING", "Pinned Source Pack processing input could not be resolved.");
  if (
    !["ready", "superseded"].includes(context.source_pack_status) ||
    Number(context.source_pack_operator_approved) !== 1 ||
    context.current_pack_manifest_sha256 !== job.source_pack_manifest_sha256
  )
    throw processingError("SOURCE_PACK_IDENTITY_MISMATCH", "Pinned Source Pack identity no longer matches the sealed snapshot.");
  if (context.upload_state !== "verified")
    throw processingError("GEOMETRY_AUTHORITY_NOT_VERIFIED", "Geometry authority must remain a verified immutable source original.");
  if (!context.geometry_authority_file_id || context.geometry_authority_file_id !== context.source_id)
    throw processingError("GEOMETRY_AUTHORITY_MISSING", "Sealed Source Pack geometry authority is missing.");

  const format = geometryAuthorityFormat(context);
  if (!format)
    throw processingError(
      "UNSUPPORTED_GEOMETRY_AUTHORITY_FORMAT",
      "Canonical Building processing supports verified self-contained GLB and capability-gated FBX geometry authority only. SKP and other formats remain fail-closed.",
    );

  if (format === "glb" && Number(context.byte_size) > MAX_WORKER_CANONICAL_BYTES)
    throw processingError(
      "WORKER_CANONICAL_SIZE_LIMIT",
      "GLB exceeds the 512 MiB Worker-native canonicalization boundary.",
    );
  if (format === "fbx" && Number(context.byte_size) > MAX_FBX_PROCESSOR_INPUT_BYTES)
    throw processingError(
      "FBX_PROCESSOR_INPUT_LIMIT",
      "FBX exceeds the 64 MiB isolated model-processor boundary.",
    );
  return format;
}

async function assertSourceObject(env, job, context) {
  const expectedKey = sourceFileKey(context.project_slug, context.source_id, context.sha256);
  if (context.r2_key !== expectedKey)
    throw processingError("SOURCE_STORAGE_BOUNDARY_MISMATCH", "Verified source R2 key does not match its project-scoped content address.");

  const object = await env.MODEL_ASSETS.head(context.r2_key);
  if (!object)
    throw processingError("SOURCE_OBJECT_MISSING", "Verified geometry authority is missing from R2.");
  if (Number(object.size) !== Number(context.byte_size))
    throw processingError("SOURCE_SIZE_MISMATCH", "R2 geometry authority size does not match the verified source record.");
  const metadata = object.customMetadata || {};
  if (
    metadata.projectId !== job.project_id ||
    metadata.sourceFileId !== context.source_id ||
    metadata.sha256 !== context.sha256
  )
    throw processingError("SOURCE_METADATA_MISMATCH", "R2 geometry authority ownership metadata does not match the verified source record.");
  if (!context.source_etag || objectEtag(object) !== String(context.source_etag))
    throw processingError("SOURCE_ETAG_MISMATCH", "R2 geometry authority ETag no longer matches the verified source record.");
}

async function latestScaleReview(env, job, context) {
  return env.DB.prepare(
    `SELECT id,status,metres_per_source_unit,approved_by,approved_at,diagnostic_json,created_at
       FROM model_scale_reviews_3d
      WHERE project_id=?
        AND source_pack_id=?
        AND source_file_id=?
        AND source_sha256=?
      ORDER BY created_at DESC,id DESC
      LIMIT 1`,
  ).bind(job.project_id, job.source_pack_id, context.source_id, context.sha256).first();
}

async function approvedScaleDecision(env, job, context) {
  const review = await latestScaleReview(env, job, context);
  if (!review || review.status !== "approved") return null;
  const metresPerSourceUnit = Number(review.metres_per_source_unit);
  if (!Number.isFinite(metresPerSourceUnit) || metresPerSourceUnit <= 0)
    throw processingError(
      "APPROVED_SCALE_DECISION_INVALID",
      "Approved scale review does not contain a valid metres-per-source-unit value.",
    );
  return { id: review.id, metresPerSourceUnit };
}

async function recordScaleReviewRequired(env, job, context, reason) {
  const details =
    reason?.details && typeof reason.details === "object" && !Array.isArray(reason.details)
      ? reason.details
      : {};
  const diagnostic = JSON.stringify({
    code: "FBX_SCALE_REVIEW_REQUIRED",
    policy: String(details.policy || "unknown").slice(0, 120),
    reason: String(details.reason || "metric-sanity-review").slice(0, 160),
    scaleBasis: String(details.scaleBasis || "declared-fbx-unit").slice(0, 80),
    rawDimensions: Array.isArray(details.rawDimensions) ? details.rawDimensions.slice(0, 3) : [],
    canonicalDimensionsM: Array.isArray(details.canonicalDimensionsM)
      ? details.canonicalDimensionsM.slice(0, 3)
      : [],
    sourceUnitScaleFactorCmPerUnit: Number(details.sourceUnitScaleFactorCmPerUnit),
    appliedMetreScale: Number(details.appliedMetreScale),
    minLargestDimensionM: Number(details.minLargestDimensionM),
    maxLargestDimensionM: Number(details.maxLargestDimensionM),
  });
  const now = new Date().toISOString();
  const reviewId = `scale_review_${crypto.randomUUID()}`;
  await env.DB.prepare(
    `INSERT OR IGNORE INTO model_scale_reviews_3d
      (id,processing_job_id,project_id,source_pack_id,source_file_id,source_sha256,
       diagnostic_json,status,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,'pending',?,?)`,
  ).bind(
    reviewId,
    job.id,
    job.project_id,
    job.source_pack_id,
    context.source_id,
    context.sha256,
    diagnostic,
    now,
    now,
  ).run();
  return env.DB.prepare(
    `SELECT id,status,diagnostic_json,created_at
       FROM model_scale_reviews_3d
      WHERE processing_job_id=? LIMIT 1`,
  ).bind(job.id).first();
}

async function ensureCanonicalGlbSourceObject(env, job, context, modelKey) {
  const existing = await env.MODEL_ASSETS.head(modelKey);
  const metadata = existing?.customMetadata || {};
  if (
    existing &&
    Number(existing.size) === Number(context.byte_size) &&
    metadata.processingJobId === job.id &&
    metadata.sourceSha256 === context.sha256 &&
    metadata.processorVersion === job.processor_version
  )
    return;

  const sourceObject = await env.MODEL_ASSETS.get(context.r2_key);
  if (!sourceObject?.body)
    throw processingError("SOURCE_OBJECT_MISSING", "Verified geometry authority body could not be read from R2.");
  await env.MODEL_ASSETS.put(modelKey, sourceObject.body, {
    httpMetadata: { contentType: MODEL_MIME },
    customMetadata: {
      projectId: job.project_id,
      sourcePackId: job.source_pack_id,
      processingJobId: job.id,
      processorVersion: job.processor_version,
      sourceFileId: context.source_id,
      sourceSha256: context.sha256,
      canonicalSha256: context.sha256,
      artifactKind: "canonical-model",
      canonicalization: "source-glb-preserved",
    },
  });

  const written = await env.MODEL_ASSETS.head(modelKey);
  if (!written || Number(written.size) !== Number(context.byte_size))
    throw processingError("CANONICAL_MODEL_WRITE_FAILED", "Canonical GLB could not be durably verified after the R2 write.");
}

async function canonicalizeGlbSource(env, job, context) {
  const modelKey = `${job.artifact_prefix}canonical/model.glb`;
  await ensureCanonicalGlbSourceObject(env, job, context, modelKey);
  const inspection = await readGlbInspectionAtKey(
    env,
    modelKey,
    Number(context.byte_size),
    context.sha256,
  );
  return {
    modelKey,
    byteSize: Number(context.byte_size),
    sha256: context.sha256,
    inspection,
    execution: "cloudflare-worker-glb-v1",
    geometryTransform: "preserved",
    validationDetails: {},
  };
}

async function canonicalizeFbxSource(env, job, context) {
  const capability = await fbxModelProcessorCapability(env);
  if (!capability.available)
    throw processingError(
      "FBX_PROCESSOR_UNAVAILABLE",
      `FBX canonical processor capability is unavailable (${capability.reason || "unknown"}).`,
    );
  if (
    capability.execution !== FBX_MODEL_PROCESSOR_EXECUTION ||
    capability.outputUnits !== "metre" ||
    capability.reviewedScaleDecisions !== "supported"
  )
    throw processingError(
      "FBX_PROCESSOR_CAPABILITY_MISMATCH",
      "FBX model processor did not advertise the required canonical metre and reviewed-scale execution contract.",
    );

  const scaleDecision = await approvedScaleDecision(env, job, context);
  const sourceObject = await env.MODEL_ASSETS.get(context.r2_key);
  if (!sourceObject?.body)
    throw processingError("SOURCE_OBJECT_MISSING", "Verified FBX geometry authority body could not be read from R2.");

  const conversion = await convertFbxWithModelProcessor(
    env,
    {
      sourceFileId: context.source_id,
      sourcePackId: job.source_pack_id,
      processingJobId: job.id,
      sourceSha256: context.sha256,
      sourceName: context.filename,
      byteSize: Number(context.byte_size),
      scaleDecision,
    },
    sourceObject.body,
  );

  const modelKey = `${job.artifact_prefix}canonical/model.glb`;
  try {
    const written = await env.MODEL_ASSETS.put(modelKey, conversion.body, {
      httpMetadata: { contentType: MODEL_MIME },
      customMetadata: {
        projectId: job.project_id,
        sourcePackId: job.source_pack_id,
        processingJobId: job.id,
        processorVersion: job.processor_version,
        sourceFileId: context.source_id,
        sourceSha256: context.sha256,
        canonicalSha256: conversion.sha256,
        artifactKind: "canonical-model",
        canonicalization:
          conversion.scaleBasis === "reviewed-operator"
            ? "fbx-reviewed-scale-normalized"
            : "fbx-unit-normalized",
        scaleBasis: conversion.scaleBasis,
        ...(conversion.scaleDecisionId
          ? { scaleDecisionId: conversion.scaleDecisionId }
          : {}),
      },
      sha256: conversion.sha256,
    });
    if (!written)
      throw processingError("CANONICAL_MODEL_WRITE_FAILED", "Canonical FBX-derived GLB was not stored in R2.");

    const stored = await env.MODEL_ASSETS.head(modelKey);
    const metadata = stored?.customMetadata || {};
    if (
      !stored ||
      Number(stored.size) !== Number(conversion.byteSize) ||
      objectSha256(stored) !== conversion.sha256 ||
      metadata.projectId !== job.project_id ||
      metadata.sourcePackId !== job.source_pack_id ||
      metadata.processingJobId !== job.id ||
      metadata.sourceFileId !== context.source_id ||
      metadata.sourceSha256 !== context.sha256 ||
      metadata.canonicalSha256 !== conversion.sha256 ||
      metadata.scaleBasis !== conversion.scaleBasis ||
      (conversion.scaleDecisionId && metadata.scaleDecisionId !== conversion.scaleDecisionId)
    )
      throw processingError(
        "CANONICAL_MODEL_INTEGRITY_MISMATCH",
        "Canonical FBX-derived GLB failed R2 size, checksum, ownership, or scale provenance verification.",
      );

    const inspection = await readGlbInspectionAtKey(
      env,
      modelKey,
      Number(conversion.byteSize),
      conversion.sha256,
    );
    return {
      modelKey,
      byteSize: Number(conversion.byteSize),
      sha256: conversion.sha256,
      inspection,
      execution: conversion.execution,
      geometryTransform: "unit-normalized",
      validationDetails: {
        coordinatePolicy: conversion.coordinatePolicy,
        sourceUnitScaleFactorCmPerUnit: conversion.sourceUnitScaleFactorCmPerUnit,
        appliedMetreScale: conversion.appliedMetreScale,
        scaleBasis: conversion.scaleBasis,
        scaleDecisionId: conversion.scaleDecisionId,
        scaleSanity: conversion.scaleSanity,
        scaleSanityPolicy: conversion.scaleSanityPolicy,
        rawDimensions: conversion.rawDimensions,
        canonicalDimensionsM: conversion.canonicalDimensionsM,
      },
    };
  } catch (reason) {
    await env.MODEL_ASSETS.delete(modelKey).catch(() => {});
    throw reason;
  }
}

async function markFailed(env, job, reason) {
  const code = String(reason?.code || "CANONICAL_PROCESSING_FAILED").slice(0, 120);
  const message = String(reason instanceof Error ? reason.message : reason || "Canonical processing failed.").slice(0, 500);
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `UPDATE processing_jobs_3d
        SET state='failed',failure_code=?,failure_reason=?,finished_at=?,heartbeat_at=?,updated_at=?
      WHERE id=? AND state='running'`,
  ).bind(code, message, now, now, now, job.id).run();
  if (Number(result?.meta?.changes || 0) > 0) {
    await env.DB.prepare(
      `INSERT INTO engine_admin_audit
        (id,actor_email,action,project_id,target_id,details_json,created_at)
       VALUES (?,?,?,?,?,?,?)`,
    ).bind(
      crypto.randomUUID(),
      job.requested_by,
      "processing.job_failed",
      job.project_id,
      job.id,
      JSON.stringify({ code, reason: message, attempt: Number(job.attempt) }),
      now,
    ).run();
  }
}

async function finalizeSuccess(env, job, context, canonical) {
  const modelKey = canonical.modelKey;
  const manifestKey = `${job.artifact_prefix}canonical/model-manifest.json`;
  const nodeCatalogKey = `${job.artifact_prefix}canonical/node-catalog.json`;
  const processedAt = job.started_at || job.requested_at;
  const manifest = {
    format: CANONICAL_MODEL_FORMAT,
    version: CANONICAL_MODEL_VERSION,
    project: { id: job.project_id, slug: context.project_slug },
    sourcePack: {
      id: job.source_pack_id,
      version: Number(job.source_pack_version),
      manifestSha256: job.source_pack_manifest_sha256,
    },
    processor: { version: job.processor_version, execution: canonical.execution },
    geometryAuthority: {
      sourceFileId: context.source_id,
      filename: context.filename,
      mediaType: context.media_type,
      byteSize: Number(context.byte_size),
      sha256: context.sha256,
    },
    model: {
      r2Key: modelKey,
      mimeType: MODEL_MIME,
      byteSize: Number(canonical.byteSize),
      sha256: canonical.sha256,
      gltfVersion: canonical.inspection.assetVersion,
      sourceGenerator: canonical.inspection.generator,
      coordinateSystem: { units: "metre", upAxis: "+Y", handedness: "right" },
      statistics: canonical.inspection.statistics,
      requiredExtensions: canonical.inspection.requiredExtensions,
      validation: {
        glbHeader: "validated",
        selfContained: true,
        sourceIdentity: "verified",
        geometryTransform: canonical.geometryTransform,
        ...canonical.validationDetails,
      },
    },
    processedAt,
  };
  const nodeCatalog = {
    format: NODE_CATALOG_FORMAT,
    version: NODE_CATALOG_VERSION,
    project: { id: job.project_id, slug: context.project_slug },
    sourcePack: {
      id: job.source_pack_id,
      version: Number(job.source_pack_version),
      manifestSha256: job.source_pack_manifest_sha256,
    },
    processingJob: { id: job.id, processorVersion: job.processor_version },
    canonicalModel: { r2Key: modelKey, sha256: canonical.sha256 },
    ...canonical.inspection.nodeCatalog,
    generatedAt: processedAt,
  };
  const manifestJson = JSON.stringify(manifest);
  const manifestSha256 = await sha256Text(manifestJson);
  const nodeCatalogJson = JSON.stringify(nodeCatalog);
  const nodeCatalogSha256 = await sha256Text(nodeCatalogJson);

  await env.MODEL_ASSETS.put(manifestKey, manifestJson, {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
    customMetadata: {
      projectId: job.project_id,
      sourcePackId: job.source_pack_id,
      processingJobId: job.id,
      processorVersion: job.processor_version,
      sha256: manifestSha256,
      artifactKind: "canonical-model-manifest",
    },
  });
  await env.MODEL_ASSETS.put(nodeCatalogKey, nodeCatalogJson, {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
    customMetadata: {
      projectId: job.project_id,
      sourcePackId: job.source_pack_id,
      processingJobId: job.id,
      processorVersion: job.processor_version,
      canonicalSha256: canonical.sha256,
      sha256: nodeCatalogSha256,
      artifactKind: "node-catalog",
    },
  });

  await touchHeartbeat(env, job.id);
  const now = new Date().toISOString();
  const metadataJson = JSON.stringify({
    sourcePackManifestSha256: job.source_pack_manifest_sha256,
    sourceFileId: context.source_id,
    sourceSha256: context.sha256,
    canonicalSha256: canonical.sha256,
    processorVersion: job.processor_version,
    execution: canonical.execution,
    scaleBasis: canonical.validationDetails.scaleBasis ?? null,
    scaleDecisionId: canonical.validationDetails.scaleDecisionId ?? null,
    appliedMetreScale: canonical.validationDetails.appliedMetreScale ?? null,
  });
  const manifestMetadataJson = JSON.stringify({
    format: CANONICAL_MODEL_FORMAT,
    version: CANONICAL_MODEL_VERSION,
    processorVersion: job.processor_version,
    canonicalSha256: canonical.sha256,
    scaleDecisionId: canonical.validationDetails.scaleDecisionId ?? null,
  });
  const nodeCatalogMetadataJson = JSON.stringify({
    format: NODE_CATALOG_FORMAT,
    version: NODE_CATALOG_VERSION,
    processorVersion: job.processor_version,
    canonicalSha256: canonical.sha256,
  });
  const results = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO processing_artifacts_3d
        (id,processing_job_id,project_id,kind,logical_id,state,r2_key,mime_type,byte_size,sha256,metadata_json,created_at,updated_at)
       VALUES (?,?,?,?,?,'ready',?,?,?,?,?,?,?)`,
    ).bind(
      `artifact_${job.id}_canonical_model`,
      job.id,
      job.project_id,
      "canonical-model",
      "building-model",
      modelKey,
      MODEL_MIME,
      Number(canonical.byteSize),
      canonical.sha256,
      metadataJson,
      now,
      now,
    ),
    env.DB.prepare(
      `INSERT INTO processing_artifacts_3d
        (id,processing_job_id,project_id,kind,logical_id,state,r2_key,mime_type,byte_size,sha256,metadata_json,created_at,updated_at)
       VALUES (?,?,?,?,?,'ready',?,?,?,?,?,?,?)`,
    ).bind(
      `artifact_${job.id}_canonical_manifest`,
      job.id,
      job.project_id,
      "canonical-model-manifest",
      "canonical-model-manifest-v1",
      manifestKey,
      "application/json",
      new TextEncoder().encode(manifestJson).byteLength,
      manifestSha256,
      manifestMetadataJson,
      now,
      now,
    ),
    env.DB.prepare(
      `INSERT INTO processing_artifacts_3d
        (id,processing_job_id,project_id,kind,logical_id,state,r2_key,mime_type,byte_size,sha256,metadata_json,created_at,updated_at)
       VALUES (?,?,?,?,?,'ready',?,?,?,?,?,?,?)`,
    ).bind(
      `artifact_${job.id}_node_catalog`,
      job.id,
      job.project_id,
      "node-catalog",
      "node-catalog-v1",
      nodeCatalogKey,
      "application/json",
      new TextEncoder().encode(nodeCatalogJson).byteLength,
      nodeCatalogSha256,
      nodeCatalogMetadataJson,
      now,
      now,
    ),
    env.DB.prepare(
      `UPDATE processing_jobs_3d
          SET state='succeeded',failure_code=NULL,failure_reason=NULL,
              finished_at=?,heartbeat_at=?,output_manifest_json=?,output_manifest_sha256=?,updated_at=?
        WHERE id=? AND state='running'`,
    ).bind(now, now, manifestJson, manifestSha256, now, job.id),
    env.DB.prepare(
      `INSERT INTO engine_admin_audit
        (id,actor_email,action,project_id,target_id,details_json,created_at)
       VALUES (?,?,?,?,?,?,?)`,
    ).bind(
      crypto.randomUUID(),
      job.requested_by,
      "processing.job_succeeded",
      job.project_id,
      job.id,
      JSON.stringify({
        attempt: Number(job.attempt),
        execution: canonical.execution,
        canonicalModelKey: modelKey,
        canonicalModelSha256: canonical.sha256,
        nodeCatalogKey,
        nodeCatalogSha256,
        outputManifestSha256: manifestSha256,
        scaleBasis: canonical.validationDetails.scaleBasis ?? null,
        scaleDecisionId: canonical.validationDetails.scaleDecisionId ?? null,
      }),
      now,
    ),
  ]);

  if (Number(results?.[3]?.meta?.changes || 0) <= 0)
    throw processingError("PROCESSING_STATE_RACE", "Processing job state changed before canonical output could be finalized.");
  return manifest;
}

export async function executeCanonicalProcessingJob(env, jobId) {
  if (!env?.DB || !env?.MODEL_ASSETS || !jobId) return { executed: false };
  const job = await claimJob(env, jobId);
  if (!job) return { executed: false };

  let context = null;
  try {
    context = await processingContext(env, job);
    const format = assertPinnedContext(job, context);
    await assertSourceObject(env, job, context);
    await touchHeartbeat(env, job.id);

    const canonical =
      format === "glb"
        ? await canonicalizeGlbSource(env, job, context)
        : await canonicalizeFbxSource(env, job, context);

    await touchHeartbeat(env, job.id);
    const manifest = await finalizeSuccess(env, job, context, canonical);
    return { executed: true, state: "succeeded", manifest };
  } catch (reason) {
    if (reason?.code === "FBX_SCALE_REVIEW_REQUIRED" && context) {
      await recordScaleReviewRequired(env, job, context, reason);
    }
    await markFailed(env, job, reason);
    return {
      executed: true,
      state: "failed",
      failureCode: String(reason?.code || "CANONICAL_PROCESSING_FAILED"),
    };
  }
}

export function scheduleCanonicalProcessingJob(env, ctx, jobId) {
  if (!jobId || typeof ctx?.waitUntil !== "function") return false;
  ctx.waitUntil(executeCanonicalProcessingJob(env, jobId));
  return true;
}
