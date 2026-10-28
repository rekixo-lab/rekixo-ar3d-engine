import { releaseSchemaReady } from "./release-runtime.mjs";
import { validateStoredBindingTargets } from "./reviewed-component-binding-policy.mjs";
import {
  assertDraftAssetKey,
  assertProjectAssetKey,
  assertReleaseAssetKey,
} from "./storage-boundary.mjs";
import {
  publicStudioSnapshot,
  validateStudioDraft,
} from "./studio-draft-validation.mjs";
import { sanitizeBuildingPresentationForRelease } from "./building-presentation-policy.mjs";
import {
  buildAutomaticBuildingPresentation,
  resolveCanonicalReleaseSource,
} from "./automatic-building-release.mjs";

const RELEASE_FORMAT = "rekixo-release-manifest";
const RELEASE_VERSION = 1;

function parseJson(value, fallback) {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function validSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function validReviewedBindingToken(value, max = 200) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    /^[A-Za-z0-9_.-]+$/.test(value)
  );
}

function sameSha(left, right) {
  return (
    validSha256(left) &&
    validSha256(right) &&
    String(left).toLowerCase() === String(right).toLowerCase()
  );
}

export async function validateReviewedBindingsForRelease(env, project, draft) {
  const block = draft?.scene?.reviewedComponentBindings;
  if (block === undefined) return undefined;

  validateStoredBindingTargets(draft, block);
  if (
    !validReviewedBindingToken(block.processingJobId) ||
    !validReviewedBindingToken(block.sourcePackId) ||
    !Number.isInteger(block.sourcePackVersion) ||
    block.sourcePackVersion < 1 ||
    !validSha256(block.sourcePackManifestSha256) ||
    !validReviewedBindingToken(block.processorVersion) ||
    !validSha256(block.outputManifestSha256) ||
    !validReviewedBindingToken(block.canonicalModelArtifactId) ||
    !validSha256(block.canonicalModelSha256) ||
    !validReviewedBindingToken(block.nodeCatalogArtifactId) ||
    !validSha256(block.nodeCatalogSha256) ||
    !Number.isInteger(block.reviewedAgainstDraftRevision) ||
    block.reviewedAgainstDraftRevision < 0 ||
    typeof block.reviewedBy !== "string" ||
    !block.reviewedBy.trim() ||
    block.reviewedBy.length > 320 ||
    typeof block.reviewedAt !== "string" ||
    !Number.isFinite(Date.parse(block.reviewedAt))
  )
    throw Error("Reviewed component bindings provenance metadata is invalid.");

  const job = await env.DB.prepare(
    `SELECT id,project_id,source_pack_id,source_pack_version,
            source_pack_manifest_sha256,processor_version,state,
            output_manifest_sha256
       FROM processing_jobs_3d
      WHERE id=? AND project_id=?
      LIMIT 1`,
  ).bind(block.processingJobId, project.id).first();
  if (!job || job.state !== "succeeded")
    throw Error(
      "Reviewed component bindings processing job is no longer a succeeded project-owned job.",
    );
  if (
    job.source_pack_id !== block.sourcePackId ||
    Number(job.source_pack_version) !== Number(block.sourcePackVersion) ||
    !sameSha(job.source_pack_manifest_sha256, block.sourcePackManifestSha256) ||
    job.processor_version !== block.processorVersion ||
    !sameSha(job.output_manifest_sha256, block.outputManifestSha256)
  )
    throw Error(
      "Reviewed component bindings processing provenance no longer matches durable processing state.",
    );

  const artifactRows = await env.DB.prepare(
    `SELECT id,processing_job_id,project_id,kind,logical_id,state,sha256
       FROM processing_artifacts_3d
      WHERE processing_job_id=? AND project_id=? AND state='ready'
        AND id IN (?,?)
      ORDER BY id ASC`,
  ).bind(
    job.id,
    project.id,
    block.canonicalModelArtifactId,
    block.nodeCatalogArtifactId,
  ).all();
  const artifacts = artifactRows.results || [];
  const model = artifacts.find(
    (item) =>
      item.id === block.canonicalModelArtifactId &&
      item.kind === "canonical-model" &&
      item.logical_id === "building-model",
  );
  const catalog = artifacts.find(
    (item) =>
      item.id === block.nodeCatalogArtifactId &&
      item.kind === "node-catalog" &&
      item.logical_id === "node-catalog-v1",
  );
  if (
    !model ||
    !catalog ||
    artifacts.length !== 2 ||
    !sameSha(model.sha256, block.canonicalModelSha256) ||
    !sameSha(catalog.sha256, block.nodeCatalogSha256)
  )
    throw Error(
      "Reviewed component bindings canonical artifact provenance no longer matches durable processing state.",
    );

  const canonicalSha = String(block.canonicalModelSha256).toLowerCase();
  for (const binding of block.bindings) {
    const match = /^node:([a-f0-9]{64}):(0|[1-9][0-9]{0,8})$/i.exec(
      String(binding.nodeId || ""),
    );
    if (!match || match[1].toLowerCase() !== canonicalSha)
      throw Error(
        "Reviewed component binding node identity no longer matches the canonical model checksum.",
      );
  }

  return block;
}

function safeSegment(value) {
  const safe = String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/g, "_")
    .slice(0, 180);
  if (!safe || safe === "." || safe === "..")
    throw Error("Invalid release asset segment.");
  return safe;
}

function mediaFileName(sourceKey, slug) {
  const prefix = `projects/${slug}/media/`;
  if (!String(sourceKey || "").startsWith(prefix))
    throw Error("Release media is outside the selected project.");
  const name = String(sourceKey).slice(prefix.length);
  if (!name || name.includes("/") || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,140}$/.test(name))
    throw Error("Release media key is not a direct project media file.");
  return name;
}

function collectMediaKeys(value, slug, out = new Set()) {
  if (typeof value === "string") {
    if (value.startsWith(`projects/${slug}/media/`)) out.add(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectMediaKeys(item, slug, out);
    return out;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectMediaKeys(item, slug, out);
  }
  return out;
}

function sourceEvidenceFromDraft(draft) {
  const sourcePackSourceIds = new Set();
  const sourceClaimIds = new Set();
  if (!draft) return { sourcePackSourceIds: [], sourceClaimIds: [] };
  const scenes = [
    draft.scene,
    ...(Array.isArray(draft.releases)
      ? draft.releases.map((release) => release?.scene)
      : []),
  ].filter(Boolean);
  for (const scene of scenes) {
    for (const room of Array.isArray(scene.rooms) ? scene.rooms : []) {
      if (typeof room.sourcePackSourceId === "string" && room.sourcePackSourceId)
        sourcePackSourceIds.add(room.sourcePackSourceId);
      for (const claimId of Array.isArray(room.sourceClaimIds)
        ? room.sourceClaimIds
        : []) {
        if (typeof claimId === "string" && claimId) sourceClaimIds.add(claimId);
      }
    }
  }
  return {
    sourcePackSourceIds: [...sourcePackSourceIds].sort(),
    sourceClaimIds: [...sourceClaimIds].sort(),
  };
}

async function digestHex(value) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return Array.from(digest, (item) => item.toString(16).padStart(2, "0")).join("");
}

async function currentExperience(env, project) {
  const [sceneResult, camera, model] = await Promise.all([
    env.DB.prepare(
      `SELECT id,project_id,name,type,model_id,camera_preset_id,
              settings_json,sort_order,enabled
         FROM scenes_3d
        WHERE project_id=? AND enabled=1
        ORDER BY sort_order ASC,id ASC`,
    ).bind(project.id).all(),
    env.DB.prepare(
      `SELECT id,project_id,name,position_json,target_json,fov
         FROM camera_presets_3d
        WHERE project_id=? AND is_default=1
        LIMIT 1`,
    ).bind(project.id).first(),
    env.DB.prepare(
      `SELECT id,project_id,name,asset_key,source_filename,mime_type,
              byte_size,version
         FROM models_3d
        WHERE project_id=? AND is_active=1
        ORDER BY version DESC
        LIMIT 1`,
    ).bind(project.id).first(),
  ]);

  return {
    scenes: (sceneResult.results || []).map((row) => ({
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      type: row.type,
      modelId: row.model_id ?? undefined,
      cameraPresetId: row.camera_preset_id ?? undefined,
      sortOrder: Number(row.sort_order || 0),
      enabled: Boolean(row.enabled),
      settings: parseJson(row.settings_json, {}),
    })),
    camera: camera
      ? {
          id: camera.id,
          projectId: camera.project_id,
          name: camera.name,
          position: parseJson(camera.position_json, [6, 4, 8]),
          target: parseJson(camera.target_json, [0, 0, 0]),
          fov: Number(camera.fov || 45),
        }
      : undefined,
    model: model
      ? {
          id: model.id,
          projectId: model.project_id,
          name: model.name,
          version: Number(model.version || 1),
          byteSize:
            model.byte_size === null || model.byte_size === undefined
              ? undefined
              : Number(model.byte_size),
          sourceFilename: model.source_filename ?? undefined,
          mimeType: model.mime_type || "model/gltf-binary",
          sourceKey: model.asset_key,
        }
      : undefined,
  };
}

async function cloudDraftForRelease(env, project) {
  const row = await env.DB.prepare(
    `SELECT revision,draft_json,updated_at
       FROM studio_drafts_3d
      WHERE project_id=?
      LIMIT 1`,
  ).bind(project.id).first();
  if (!row) return undefined;
  let draft;
  try {
    draft = JSON.parse(row.draft_json);
  } catch {
    throw Error("Cloud draft is corrupted; release creation stopped.");
  }
  try {
    validateStudioDraft(draft, project);
  } catch (error) {
    throw Error(
      `Cloud draft validation failed; release creation stopped: ${
        error instanceof Error ? error.message : "invalid Studio draft"
      }`,
    );
  }
  try {
    await validateReviewedBindingsForRelease(env, project, draft);
  } catch (error) {
    throw Error(
      `Reviewed component bindings validation failed; release creation stopped: ${
        error instanceof Error ? error.message : "invalid reviewed component bindings"
      }`,
    );
  }
  return {
    revision: Number(row.revision),
    updatedAt: row.updated_at,
    draft,
  };
}

async function studioAssetRows(env, projectId) {
  const result = await env.DB.prepare(
    `SELECT id,project_id,kind,name,mime_type,byte_size,sha256,r2_key
       FROM studio_assets_3d
      WHERE project_id=? AND deleted_at IS NULL
      ORDER BY created_at ASC,id ASC`,
  ).bind(projectId).all();
  return result.results || [];
}

async function copyImmutableObject(
  env,
  {
    sourceKey,
    targetKey,
    project,
    releaseId,
    releaseVersion,
    kind,
    logicalId,
    name,
    mimeType,
    sha256,
  },
) {
  if (await env.MODEL_ASSETS.head(targetKey))
    throw Error("Immutable release object key already exists.");

  const source = await env.MODEL_ASSETS.get(sourceKey);
  if (!source)
    throw Error(`Release source asset is missing: ${name}`);

  const sourceHash =
    validSha256(sha256)
      ? String(sha256).toLowerCase()
      : validSha256(source.customMetadata?.sha256)
        ? String(source.customMetadata.sha256).toLowerCase()
        : undefined;
  const sourceEtag = String(source.httpEtag || source.etag || "").replace(/^"|"$/g, "");

  const result = await env.MODEL_ASSETS.put(targetKey, source.body, {
    httpMetadata: {
      ...(source.httpMetadata || {}),
      contentType:
        mimeType ||
        source.httpMetadata?.contentType ||
        "application/octet-stream",
    },
    customMetadata: {
      projectId: project.id,
      projectSlug: project.slug,
      releaseId,
      releaseVersion: String(releaseVersion),
      releaseKind: kind,
      logicalId,
      ...(sourceHash ? { sha256: sourceHash } : {}),
      ...(sourceEtag ? { sourceEtag } : {}),
    },
  });

  if (!result || Number(result.size) !== Number(source.size)) {
    await env.MODEL_ASSETS.delete(targetKey).catch(() => {});
    throw Error(`Immutable release copy failed verification: ${name}`);
  }

  return {
    manifest: {
      id: crypto.randomUUID(),
      kind,
      logicalId,
      name,
      mimeType:
        mimeType ||
        source.httpMetadata?.contentType ||
        "application/octet-stream",
      byteSize: Number(source.size),
      ...(sourceHash ? { sha256: sourceHash } : {}),
      ...(sourceEtag ? { sourceEtag } : {}),
    },
    database: {
      kind,
      logicalId,
      name,
      mimeType:
        mimeType ||
        source.httpMetadata?.contentType ||
        "application/octet-stream",
      byteSize: Number(source.size),
      sha256: sourceHash ?? null,
      sourceEtag: sourceEtag || null,
      r2Key: targetKey,
    },
  };
}

export async function listProjectReleases(env, project) {
  if (!(await releaseSchemaReady(env)))
    throw Error("Immutable release schema is not installed.");
  const rows = await env.DB.prepare(
    `SELECT r.id,r.version,r.manifest_sha256 AS manifestSha256,
            r.source_draft_revision AS sourceDraftRevision,
            r.created_by AS createdBy,r.created_at AS createdAt,
            CASE WHEN p.active_release_id=r.id THEN 1 ELSE 0 END AS active
       FROM releases_3d r
       JOIN projects_3d p ON p.id=r.project_id
      WHERE r.project_id=?
      ORDER BY r.version DESC`,
  ).bind(project.id).all();
  return (rows.results || []).map((row) => ({
    id: row.id,
    version: Number(row.version),
    manifestSha256: row.manifestSha256,
    sourceDraftRevision:
      row.sourceDraftRevision === null || row.sourceDraftRevision === undefined
        ? undefined
        : Number(row.sourceDraftRevision),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    active: Boolean(row.active),
  }));
}

export async function buildAndActivateRelease(
  env,
  actor,
  project,
  expectedDraftRevision,
  requireCanonicalSource = false,
) {
  if (!(await releaseSchemaReady(env)))
    throw Error("Immutable release schema is not installed.");
  if (project.status === "archived")
    throw Error("Restore the project before publishing a release.");

  const currentProject = await env.DB.prepare(
    `SELECT id,slug,name,location,status,cover_asset_key,active_release_id
       FROM projects_3d
      WHERE id=?
      LIMIT 1`,
  ).bind(project.id).first();
  if (!currentProject || currentProject.slug !== project.slug)
    throw Error("Project identity changed before release creation.");

  const [experience, cloudDraft, studioAssets, versionRow] = await Promise.all([
    currentExperience(env, currentProject),
    cloudDraftForRelease(env, currentProject),
    studioAssetRows(env, currentProject.id),
    env.DB.prepare(
      "SELECT COALESCE(MAX(version),0)+1 AS version FROM releases_3d WHERE project_id=?",
    ).bind(currentProject.id).first(),
  ]);

  if (
    expectedDraftRevision !== undefined &&
    expectedDraftRevision !== null &&
    Number(expectedDraftRevision) !== Number(cloudDraft?.revision)
  )
    throw Error("Cloud draft revision changed before publish.");

  if (!experience.scenes.length && !experience.model && !cloudDraft)
    throw Error("Nothing publishable is available for this project.");

  // First-release plotting path is explicit and fail-closed. Never fall back
  // to an empty Studio or legacy model if canonical provenance is unavailable.
  if (requireCanonicalSource) {
    if (!cloudDraft || experience.model ||
        cloudDraft.draft?.scene?.modelId ||
        cloudDraft.draft?.scene?.publishModelId ||
        currentProject.active_release_id ||
        Number(versionRow?.version || 1) !== 1)
      throw Error("First canonical site release requires a new, unpublished project with a Studio draft and no alternate model.");
    const approvedCanonical = await resolveCanonicalReleaseSource(
      env, currentProject, cloudDraft.draft,
    );
    if (!approvedCanonical)
      throw Error("Verified succeeded canonical model and manifest are required for site release.");
  }

  const version = Number(versionRow?.version || 1);
  const releaseId = `release_${crypto.randomUUID()}`;
  const createdAt = new Date().toISOString();
  const releaseAssets = [];
  const createdKeys = [];

  try {
    const mediaKeys = new Set();
    if (currentProject.cover_asset_key)
      collectMediaKeys(currentProject.cover_asset_key, currentProject.slug, mediaKeys);
    for (const scene of experience.scenes)
      collectMediaKeys(scene.settings, currentProject.slug, mediaKeys);

    const explicitStudioPublishModelId =
      cloudDraft?.draft?.scene?.publishModelId;
    let frozenModel;
    if (experience.model && !explicitStudioPublishModelId) {
      assertProjectAssetKey(
        currentProject.slug,
        experience.model.sourceKey,
        "models",
      );
      const targetKey = `projects/${currentProject.slug}/releases/${releaseId}/models/${safeSegment(
        experience.model.id,
      )}`;
      assertReleaseAssetKey(
        currentProject.slug,
        releaseId,
        "model",
        experience.model.id,
        targetKey,
      );
      const copied = await copyImmutableObject(env, {
        sourceKey: experience.model.sourceKey,
        targetKey,
        project: currentProject,
        releaseId,
        releaseVersion: version,
        kind: "model",
        logicalId: experience.model.id,
        name: experience.model.name,
        mimeType: experience.model.mimeType,
      });
      createdKeys.push(targetKey);
      releaseAssets.push(copied);
      frozenModel = {
        id: experience.model.id,
        projectId: currentProject.id,
        name: experience.model.name,
        version: experience.model.version,
        byteSize: copied.manifest.byteSize,
        sourceFilename: experience.model.sourceFilename,
        mimeType: copied.manifest.mimeType,
        releaseAssetId: copied.manifest.id,
      };
    }

    const mediaFiles = [];
    for (const sourceKey of [...mediaKeys].sort()) {
      assertProjectAssetKey(currentProject.slug, sourceKey, "media");
      const fileName = mediaFileName(sourceKey, currentProject.slug);
      const targetKey = `projects/${currentProject.slug}/releases/${releaseId}/media/${fileName}`;
      assertReleaseAssetKey(
        currentProject.slug,
        releaseId,
        "media",
        fileName,
        targetKey,
      );
      const copied = await copyImmutableObject(env, {
        sourceKey,
        targetKey,
        project: currentProject,
        releaseId,
        releaseVersion: version,
        kind: "media",
        logicalId: fileName,
        name: fileName,
        mimeType: undefined,
      });
      createdKeys.push(targetKey);
      releaseAssets.push(copied);
      mediaFiles.push(fileName);
    }

    const studioById = new Map(studioAssets.map((asset) => [asset.id, asset]));
    const publicStudioProject = cloudDraft
      ? publicStudioSnapshot(cloudDraft.draft)
      : undefined;
    if (publicStudioProject) {
      for (const assetId of publicStudioProject.assets) {
        const asset = studioById.get(assetId);
        if (!asset)
          throw Error(`Cloud draft asset metadata is missing: ${assetId}`);
        assertDraftAssetKey(currentProject.slug, asset.id, asset.r2_key);
        const targetKey = `projects/${currentProject.slug}/releases/${releaseId}/studio/${safeSegment(
          asset.id,
        )}`;
        assertReleaseAssetKey(
          currentProject.slug,
          releaseId,
          "studio",
          asset.id,
          targetKey,
        );
        const copied = await copyImmutableObject(env, {
          sourceKey: asset.r2_key,
          targetKey,
          project: currentProject,
          releaseId,
          releaseVersion: version,
          kind: "studio",
          logicalId: asset.id,
          name: asset.name,
          mimeType: asset.mime_type,
          sha256: asset.sha256,
        });
        createdKeys.push(targetKey);
        releaseAssets.push(copied);
      }
    }

    const studioReleaseModelId =
      cloudDraft?.draft?.scene?.publishModelId ??
      cloudDraft?.draft?.scene?.modelId;
    if (!frozenModel && studioReleaseModelId) {
      const studioModel = studioById.get(studioReleaseModelId);
      if (!studioModel && explicitStudioPublishModelId)
        throw Error("Studio release model asset metadata is missing.");
      if (studioModel) {
        if (!/\.glb$/i.test(String(studioModel.name || "")))
          throw Error("Studio customer release model must be a self-contained GLB.");
        assertDraftAssetKey(
          currentProject.slug,
          studioModel.id,
          studioModel.r2_key,
        );
        const targetKey = `projects/${currentProject.slug}/releases/${releaseId}/models/${safeSegment(
          studioModel.id,
        )}`;
        assertReleaseAssetKey(
          currentProject.slug,
          releaseId,
          "model",
          studioModel.id,
          targetKey,
        );
        const copied = await copyImmutableObject(env, {
          sourceKey: studioModel.r2_key,
          targetKey,
          project: currentProject,
          releaseId,
          releaseVersion: version,
          kind: "model",
          logicalId: studioModel.id,
          name: studioModel.name,
          mimeType: studioModel.mime_type,
          sha256: studioModel.sha256,
        });
        createdKeys.push(targetKey);
        releaseAssets.push(copied);
        frozenModel = {
          id: studioModel.id,
          projectId: currentProject.id,
          name: studioModel.name,
          version,
          byteSize: copied.manifest.byteSize,
          sourceFilename: studioModel.name,
          mimeType: copied.manifest.mimeType,
          releaseAssetId: copied.manifest.id,
        };
        if (explicitStudioPublishModelId && experience.scenes.length) {
          experience.scenes = experience.scenes.map((scene) =>
            scene.modelId
              ? { ...scene, modelId: studioModel.id }
              : scene,
          );
        }
      }
    }

    let automaticCanonical = null;
    if (!frozenModel && cloudDraft) {
      automaticCanonical = await resolveCanonicalReleaseSource(
        env,
        currentProject,
        cloudDraft.draft,
      );
      if (automaticCanonical) {
        const canonicalModelId = "canonical_building";
        const targetKey = `projects/${currentProject.slug}/releases/${releaseId}/models/${canonicalModelId}`;
        assertReleaseAssetKey(
          currentProject.slug,
          releaseId,
          "model",
          canonicalModelId,
          targetKey,
        );
        const copied = await copyImmutableObject(env, {
          sourceKey: automaticCanonical.modelArtifact.r2_key,
          targetKey,
          project: currentProject,
          releaseId,
          releaseVersion: version,
          kind: "model",
          logicalId: canonicalModelId,
          name: "Canonical Building",
          mimeType: "model/gltf-binary",
          sha256: automaticCanonical.modelArtifact.sha256,
        });
        createdKeys.push(targetKey);
        releaseAssets.push(copied);
        frozenModel = {
          id: canonicalModelId,
          projectId: currentProject.id,
          name: "Canonical Building",
          version,
          byteSize: copied.manifest.byteSize,
          sourceFilename:
            automaticCanonical.manifest.geometryAuthority?.filename ?? "canonical-model.glb",
          mimeType: copied.manifest.mimeType,
          releaseAssetId: copied.manifest.id,
        };
        experience.scenes = experience.scenes.map((scene) =>
          scene.modelId ? { ...scene, modelId: canonicalModelId } : scene,
        );
      }
    }

    if (frozenModel && !experience.scenes.length) {
      experience.scenes.push({
        id: `release_scene_${currentProject.id}`,
        projectId: currentProject.id,
        name: "Project Navigation",
        type: "project-navigation",
        modelId: frozenModel.id,
        sortOrder: 10,
        enabled: true,
        settings: {
          status: "ready",
          source: automaticCanonical
            ? "canonical-processing-release"
            : "immutable-studio-release",
        },
      });
    }

    const sourceEvidence = sourceEvidenceFromDraft(cloudDraft?.draft);
    const presentationCandidate = cloudDraft?.draft?.scene?.buildingPresentation;
    let buildingPresentation;
    if (presentationCandidate !== undefined || automaticCanonical) {
      if (!frozenModel)
        throw Error("Building presentation requires an immutable release model.");
      const frozenModelAsset = releaseAssets
        .map((asset) => asset.manifest)
        .find(
          (asset) =>
            asset.kind === "model" &&
            asset.id === frozenModel.releaseAssetId,
        );
      if (!validSha256(frozenModelAsset?.sha256))
        throw Error(
          "Building presentation requires a SHA-256 pinned immutable release model.",
        );
      const candidate = presentationCandidate !== undefined
        ? presentationCandidate
        : await buildAutomaticBuildingPresentation({
            canonical: automaticCanonical,
            draft: cloudDraft?.draft,
            sourceEvidence,
          });
      buildingPresentation = sanitizeBuildingPresentationForRelease(
        candidate,
        {
          modelSha256: String(frozenModelAsset.sha256).toLowerCase(),
          sourceEvidence,
        },
      );
    }

    const manifest = {
      format: RELEASE_FORMAT,
      version: RELEASE_VERSION,
      release: {
        id: releaseId,
        projectId: currentProject.id,
        projectSlug: currentProject.slug,
        version,
        createdAt,
        ...(cloudDraft ? { sourceDraftRevision: cloudDraft.revision } : {}),
      },
      project: {
        id: currentProject.id,
        slug: currentProject.slug,
        name: currentProject.name,
        ...(currentProject.location
          ? { location: currentProject.location }
          : {}),
        status: "published",
      },
      experience: {
        scenes: experience.scenes,
        ...(experience.camera ? { camera: experience.camera } : {}),
        ...(frozenModel ? { model: frozenModel } : {}),
        ...(buildingPresentation ? { buildingPresentation } : {}),
        mediaFiles,
      },
      ...(publicStudioProject
        ? { studio: { project: publicStudioProject } }
        : {}),
      sourceEvidence,
      assets: releaseAssets.map((asset) => asset.manifest),
    };

    const manifestJson = JSON.stringify(manifest);
    const manifestSha256 = await digestHex(manifestJson);
    const assetStatements = releaseAssets.map((asset) =>
      env.DB.prepare(
        `INSERT INTO release_assets_3d
          (release_id,project_id,kind,logical_id,name,mime_type,byte_size,
           sha256,source_etag,r2_key,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      ).bind(
        releaseId,
        currentProject.id,
        asset.database.kind,
        asset.database.logicalId,
        asset.database.name,
        asset.database.mimeType,
        asset.database.byteSize,
        asset.database.sha256,
        asset.database.sourceEtag,
        asset.database.r2Key,
        createdAt,
      ),
    );

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO releases_3d
          (id,project_id,version,manifest_json,manifest_sha256,
           source_draft_revision,created_by,created_at)
          VALUES (?,?,?,?,?,?,?,?)`,
      ).bind(
        releaseId,
        currentProject.id,
        version,
        manifestJson,
        manifestSha256,
        cloudDraft?.revision ?? null,
        actor.email,
        createdAt,
      ),
      ...assetStatements,
      env.DB.prepare(
        `UPDATE projects_3d
            SET active_release_id=?,status='published',updated_at=?
          WHERE id=?`,
      ).bind(releaseId, createdAt, currentProject.id),
      env.DB.prepare(
        `INSERT INTO release_activations_3d
          (id,project_id,release_id,previous_release_id,action,actor_email,created_at)
          VALUES (?,?,?,?,?,?,?)`,
      ).bind(
        crypto.randomUUID(),
        currentProject.id,
        releaseId,
        currentProject.active_release_id ?? null,
        "publish",
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
        "release.published",
        currentProject.id,
        releaseId,
        JSON.stringify({
          version,
          manifestSha256,
          sourceDraftRevision: cloudDraft?.revision ?? null,
          assetCount: releaseAssets.length,
          previousReleaseId: currentProject.active_release_id ?? null,
        }),
        createdAt,
      ),
    ]);

    return {
      id: releaseId,
      version,
      manifestSha256,
      sourceDraftRevision: cloudDraft?.revision,
      createdAt,
      active: true,
      assetCount: releaseAssets.length,
    };
  } catch (error) {
    await Promise.all(
      createdKeys.map((key) => env.MODEL_ASSETS.delete(key).catch(() => {})),
    );
    throw error;
  }
}

async function verifyReleaseIntegrity(env, project, releaseId) {
  const release = await env.DB.prepare(
    `SELECT id,project_id,version,manifest_json,
            manifest_sha256 AS manifestSha256
       FROM releases_3d
      WHERE id=? AND project_id=?
      LIMIT 1`,
  ).bind(releaseId, project.id).first();
  if (!release) throw Error("Release does not belong to this project.");

  const actualHash = await digestHex(release.manifest_json);
  if (actualHash !== String(release.manifestSha256 || "").toLowerCase())
    throw Error("Release manifest checksum mismatch.");

  let manifest;
  try {
    manifest = JSON.parse(release.manifest_json);
  } catch {
    throw Error("Release manifest JSON is invalid.");
  }
  if (
    manifest?.format !== RELEASE_FORMAT ||
    manifest?.version !== RELEASE_VERSION ||
    manifest?.release?.id !== releaseId ||
    manifest?.release?.projectId !== project.id ||
    manifest?.release?.projectSlug !== project.slug ||
    Number(manifest?.release?.version) !== Number(release.version) ||
    manifest?.project?.id !== project.id ||
    manifest?.project?.slug !== project.slug
  )
    throw Error("Release manifest identity mismatch.");

  const rows = await env.DB.prepare(
    `SELECT kind,logical_id AS logicalId,byte_size AS byteSize,
            sha256,r2_key AS r2Key
       FROM release_assets_3d
      WHERE release_id=? AND project_id=?
      ORDER BY kind,logical_id`,
  ).bind(releaseId, project.id).all();
  const assets = rows.results || [];
  if (assets.length !== (manifest.assets?.length || 0))
    throw Error("Release asset metadata count mismatch.");

  const manifestByKey = new Map(
    (manifest.assets || []).map((asset) => [
      `${asset.kind}:${asset.logicalId}`,
      asset,
    ]),
  );
  for (const row of assets) {
    const asset = manifestByKey.get(`${row.kind}:${row.logicalId}`);
    if (
      !asset ||
      Number(asset.byteSize) !== Number(row.byteSize) ||
      (asset.sha256 ?? null) !== (row.sha256 ?? null)
    )
      throw Error("Release asset manifest metadata mismatch.");
  }

  for (let index = 0; index < assets.length; index += 20) {
    const chunk = assets.slice(index, index + 20);
    await Promise.all(
      chunk.map(async (asset) => {
        assertReleaseAssetKey(
          project.slug,
          releaseId,
          asset.kind,
          asset.logicalId,
          asset.r2Key,
        );
        const object = await env.MODEL_ASSETS.head(asset.r2Key);
        if (!object)
          throw Error(`Release asset is missing from storage: ${asset.logicalId}`);
        if (Number(object.size) !== Number(asset.byteSize))
          throw Error(`Release asset size mismatch: ${asset.logicalId}`);
        const metadataSha = object.customMetadata?.sha256;
        if (
          asset.sha256 &&
          metadataSha &&
          String(metadataSha).toLowerCase() !== String(asset.sha256).toLowerCase()
        )
          throw Error(`Release asset checksum metadata mismatch: ${asset.logicalId}`);
      }),
    );
  }

  return {
    id: release.id,
    version: Number(release.version),
    manifestSha256: actualHash,
  };
}

export async function activateExistingRelease(env, actor, project, releaseId) {
  if (!(await releaseSchemaReady(env)))
    throw Error("Immutable release schema is not installed.");

  const current = await env.DB.prepare(
    "SELECT active_release_id,status FROM projects_3d WHERE id=? LIMIT 1",
  ).bind(project.id).first();
  const release = await verifyReleaseIntegrity(
    env,
    project,
    releaseId,
  );
  if (current?.active_release_id === releaseId)
    return {
      id: release.id,
      version: Number(release.version),
      manifestSha256: release.manifestSha256,
      active: true,
      unchanged: true,
    };

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE projects_3d
          SET active_release_id=?,status='published',updated_at=?
        WHERE id=?`,
    ).bind(releaseId, now, project.id),
    env.DB.prepare(
      `INSERT INTO release_activations_3d
        (id,project_id,release_id,previous_release_id,action,actor_email,created_at)
        VALUES (?,?,?,?,?,?,?)`,
    ).bind(
      crypto.randomUUID(),
      project.id,
      releaseId,
      current?.active_release_id ?? null,
      "rollback",
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
      "release.activated",
      project.id,
      releaseId,
      JSON.stringify({
        version: Number(release.version),
        previousReleaseId: current?.active_release_id ?? null,
      }),
      now,
    ),
  ]);

  return {
    id: release.id,
    version: Number(release.version),
    manifestSha256: release.manifestSha256,
    active: true,
    unchanged: false,
  };
}
