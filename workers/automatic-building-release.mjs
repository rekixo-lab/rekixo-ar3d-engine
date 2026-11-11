import { assertProjectAssetKey } from "./storage-boundary.mjs";

const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;
// Must match the canonical processor: approved large GLBs may contain 8–32 MiB
// of metadata even when their binary geometry is within the original cap.
const MAX_GLTF_JSON_BYTES = 32 * 1024 * 1024;

function validSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function sameSha(left, right) {
  return validSha256(left) && validSha256(right) &&
    String(left).toLowerCase() === String(right).toLowerCase();
}

function finiteArray(value, length) {
  return Array.isArray(value) && value.length === length &&
    value.every((entry) => typeof entry === "number" && Number.isFinite(entry));
}

function identityMatrix() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function multiplyMatrix(a, b) {
  const out = new Array(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let index = 0; index < 4; index += 1)
        out[column * 4 + row] += a[index * 4 + row] * b[column * 4 + index];
    }
  }
  return out;
}

function nodeMatrix(node) {
  if (finiteArray(node?.matrix, 16)) return [...node.matrix];
  const translation = finiteArray(node?.translation, 3) ? node.translation : [0, 0, 0];
  const rotation = finiteArray(node?.rotation, 4) ? node.rotation : [0, 0, 0, 1];
  const scale = finiteArray(node?.scale, 3) ? node.scale : [1, 1, 1];
  const [x, y, z, w] = rotation;
  const [sx, sy, sz] = scale;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  return [
    (1 - (yy + zz)) * sx,
    (xy + wz) * sx,
    (xz - wy) * sx,
    0,
    (xy - wz) * sy,
    (1 - (xx + zz)) * sy,
    (yz + wx) * sy,
    0,
    (xz + wy) * sz,
    (yz - wx) * sz,
    (1 - (xx + yy)) * sz,
    0,
    translation[0],
    translation[1],
    translation[2],
    1,
  ];
}

function transformPoint(matrix, x, y, z) {
  return {
    x: matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    y: matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    z: matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
  };
}

/** Compute the static default-scene AABB from glTF accessor min/max + node transforms. */
export function gltfSceneBounds(gltf) {
  const nodes = Array.isArray(gltf?.nodes) ? gltf.nodes : [];
  const meshes = Array.isArray(gltf?.meshes) ? gltf.meshes : [];
  const accessors = Array.isArray(gltf?.accessors) ? gltf.accessors : [];
  if (!nodes.length || !meshes.length || !accessors.length) return null;

  const referenced = new Set();
  for (const node of nodes)
    for (const child of Array.isArray(node?.children) ? node.children : [])
      if (Number.isInteger(child) && child >= 0 && child < nodes.length) referenced.add(child);

  const scenes = Array.isArray(gltf?.scenes) ? gltf.scenes : [];
  const sceneIndex = Number.isInteger(gltf?.scene) && gltf.scene >= 0 && gltf.scene < scenes.length
    ? gltf.scene
    : scenes.length
      ? 0
      : -1;
  const roots = sceneIndex >= 0
    ? (Array.isArray(scenes[sceneIndex]?.nodes) ? scenes[sceneIndex].nodes : [])
    : nodes.map((_, index) => index).filter((index) => !referenced.has(index));

  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  let points = 0;

  const expand = (point) => {
    min.x = Math.min(min.x, point.x);
    min.y = Math.min(min.y, point.y);
    min.z = Math.min(min.z, point.z);
    max.x = Math.max(max.x, point.x);
    max.y = Math.max(max.y, point.y);
    max.z = Math.max(max.z, point.z);
    points += 1;
  };

  const visit = (index, parent, stack) => {
    if (!Number.isInteger(index) || index < 0 || index >= nodes.length || stack.has(index)) return;
    const node = nodes[index];
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    const world = multiplyMatrix(parent, nodeMatrix(node));
    if (Number.isInteger(node.mesh) && node.mesh >= 0 && node.mesh < meshes.length) {
      const primitives = Array.isArray(meshes[node.mesh]?.primitives) ? meshes[node.mesh].primitives : [];
      for (const primitive of primitives) {
        const accessorIndex = primitive?.attributes?.POSITION;
        if (!Number.isInteger(accessorIndex) || accessorIndex < 0 || accessorIndex >= accessors.length) continue;
        const accessor = accessors[accessorIndex];
        if (!finiteArray(accessor?.min, 3) || !finiteArray(accessor?.max, 3)) continue;
        for (const x of [accessor.min[0], accessor.max[0]])
          for (const y of [accessor.min[1], accessor.max[1]])
            for (const z of [accessor.min[2], accessor.max[2]])
              expand(transformPoint(world, x, y, z));
      }
    }
    const nextStack = new Set(stack);
    nextStack.add(index);
    for (const child of Array.isArray(node.children) ? node.children : [])
      visit(child, world, nextStack);
  };

  for (const root of roots) visit(root, identityMatrix(), new Set());
  if (!points) return null;
  const dimensions = [max.x - min.x, max.y - min.y, max.z - min.z];
  if (dimensions.some((value) => !Number.isFinite(value) || value < 0.01 || value > 2000)) return null;
  return { min, max };
}

async function readGlbBounds(env, artifact) {
  assertProjectAssetKey(artifact.project_slug, artifact.r2_key, "processing");
  const head = await env.MODEL_ASSETS.head(artifact.r2_key);
  if (!head || Number(head.size) !== Number(artifact.byte_size))
    throw Error("Canonical release model size no longer matches durable processing metadata.");
  const metadata = head.customMetadata || {};
  if (metadata.projectId && metadata.projectId !== artifact.project_id)
    throw Error("Canonical release model storage ownership no longer matches its project.");
  if (metadata.canonicalSha256 && !sameSha(metadata.canonicalSha256, artifact.sha256))
    throw Error("Canonical release model checksum metadata no longer matches its processing artifact.");

  const headerObject = await env.MODEL_ASSETS.get(artifact.r2_key, { range: { offset: 0, length: 20 } });
  if (!headerObject) throw Error("Canonical release model header is unavailable.");
  const header = await headerObject.arrayBuffer();
  if (header.byteLength < 20) throw Error("Canonical release model GLB header is invalid.");
  const view = new DataView(header);
  if (view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(4, true) !== 2)
    throw Error("Canonical release model must be GLB 2.0.");
  if (view.getUint32(8, true) !== Number(artifact.byte_size) || view.getUint32(16, true) !== GLB_JSON_CHUNK)
    throw Error("Canonical release model GLB identity is invalid.");
  const jsonLength = view.getUint32(12, true);
  if (!jsonLength || jsonLength > MAX_GLTF_JSON_BYTES || 20 + jsonLength > Number(artifact.byte_size))
    throw Error("Canonical release model GLB JSON chunk is invalid.");
  const jsonObject = await env.MODEL_ASSETS.get(artifact.r2_key, { range: { offset: 20, length: jsonLength } });
  if (!jsonObject) throw Error("Canonical release model JSON is unavailable.");
  const text = new TextDecoder("utf-8", { fatal: true })
    .decode(new Uint8Array(await jsonObject.arrayBuffer()))
    .replace(/[\u0000\u0020\t\r\n]+$/g, "");
  let gltf;
  try {
    gltf = JSON.parse(text);
  } catch {
    throw Error("Canonical release model JSON is invalid.");
  }
  const bounds = gltfSceneBounds(gltf);
  if (!bounds) throw Error("Canonical release model does not expose trustworthy accessor bounds for automatic presentation.");
  return bounds;
}

async function readCanonicalManifest(env, artifact) {
  assertProjectAssetKey(artifact.project_slug, artifact.r2_key, "processing");
  if (!Number.isSafeInteger(Number(artifact.byte_size)) || Number(artifact.byte_size) <= 0 || Number(artifact.byte_size) > 1024 * 1024)
    throw Error("Canonical model manifest size is invalid.");
  const object = await env.MODEL_ASSETS.get(artifact.r2_key);
  if (!object) throw Error("Canonical model manifest is unavailable.");
  let manifest;
  try {
    manifest = JSON.parse(await object.text());
  } catch {
    throw Error("Canonical model manifest JSON is invalid.");
  }
  return manifest;
}

/** Resolve the immutable canonical processing output that may back a Building release. */
export async function resolveCanonicalReleaseSource(env, project, draft) {
  const reviewed = draft?.scene?.reviewedComponentBindings;
  const job = reviewed?.processingJobId
    ? await env.DB.prepare(
        `SELECT id,project_id,source_pack_id,source_pack_version,source_pack_manifest_sha256,
                processor_version,state,attempt,output_manifest_sha256
           FROM processing_jobs_3d
          WHERE id=? AND project_id=? AND state='succeeded'
          LIMIT 1`,
      ).bind(reviewed.processingJobId, project.id).first()
    : await env.DB.prepare(
        `SELECT id,project_id,source_pack_id,source_pack_version,source_pack_manifest_sha256,
                processor_version,state,attempt,output_manifest_sha256
           FROM processing_jobs_3d
          WHERE project_id=? AND state='succeeded'
          ORDER BY source_pack_version DESC,attempt DESC,finished_at DESC
          LIMIT 1`,
      ).bind(project.id).first();
  if (!job) return null;
  if (!validSha256(job.output_manifest_sha256))
    throw Error("Succeeded canonical processing job is missing its manifest checksum.");

  if (reviewed && (
    reviewed.sourcePackId !== job.source_pack_id ||
    Number(reviewed.sourcePackVersion) !== Number(job.source_pack_version) ||
    !sameSha(reviewed.sourcePackManifestSha256, job.source_pack_manifest_sha256) ||
    reviewed.processorVersion !== job.processor_version ||
    !sameSha(reviewed.outputManifestSha256, job.output_manifest_sha256)
  ))
    throw Error("Reviewed component mapping no longer matches the canonical release source.");

  const rows = await env.DB.prepare(
    `SELECT id,processing_job_id,project_id,kind,logical_id,state,r2_key,mime_type,
            byte_size,sha256
       FROM processing_artifacts_3d
      WHERE processing_job_id=? AND project_id=? AND state='ready'
        AND kind IN ('canonical-model','canonical-model-manifest')
      ORDER BY kind,logical_id,id`,
  ).bind(job.id, project.id).all();
  const artifacts = rows.results || [];
  const model = artifacts.filter((item) => item.kind === "canonical-model" && item.logical_id === "building-model");
  const manifests = artifacts.filter((item) => item.kind === "canonical-model-manifest" && item.logical_id === "canonical-model-manifest-v1");
  if (model.length !== 1 || manifests.length !== 1)
    throw Error("Canonical release source requires exactly one model and one canonical manifest artifact.");
  const modelArtifact = { ...model[0], project_slug: project.slug };
  const manifestArtifact = { ...manifests[0], project_slug: project.slug };
  if (!validSha256(modelArtifact.sha256) || !sameSha(manifestArtifact.sha256, job.output_manifest_sha256))
    throw Error("Canonical release source artifact checksums do not match the succeeded processing job.");
  if (reviewed && (
    reviewed.canonicalModelArtifactId !== modelArtifact.id ||
    !sameSha(reviewed.canonicalModelSha256, modelArtifact.sha256)
  ))
    throw Error("Reviewed component mapping canonical model no longer matches the release source.");

  const manifest = await readCanonicalManifest(env, manifestArtifact);
  if (
    manifest?.format !== "rekixo-canonical-model" ||
    manifest?.version !== 1 ||
    manifest?.project?.id !== project.id ||
    manifest?.project?.slug !== project.slug ||
    manifest?.sourcePack?.id !== job.source_pack_id ||
    Number(manifest?.sourcePack?.version) !== Number(job.source_pack_version) ||
    !sameSha(manifest?.sourcePack?.manifestSha256, job.source_pack_manifest_sha256) ||
    manifest?.processor?.version !== job.processor_version ||
    manifest?.model?.r2Key !== modelArtifact.r2_key ||
    !sameSha(manifest?.model?.sha256, modelArtifact.sha256) ||
    Number(manifest?.model?.byteSize) !== Number(modelArtifact.byte_size) ||
    manifest?.model?.coordinateSystem?.units !== "metre" ||
    manifest?.model?.coordinateSystem?.upAxis !== "+Y" ||
    manifest?.model?.coordinateSystem?.handedness !== "right"
  )
    throw Error("Canonical release manifest identity or metric coordinate policy is invalid.");

  const bounds = await readGlbBounds(env, modelArtifact);
  return { job, modelArtifact, manifest, bounds };
}

function rotateY(x, z, radians) {
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return { x: x * cosine + z * sine, z: -x * sine + z * cosine };
}

function cameraShot(kind, bounds, orientation) {
  const width = bounds.max.x - bounds.min.x;
  const height = bounds.max.y - bounds.min.y;
  const depth = bounds.max.z - bounds.min.z;
  const target = {
    x: (bounds.min.x + bounds.max.x) / 2,
    y: bounds.min.y + height * (kind === "entrance" ? 0.24 : 0.46),
    z: (bounds.min.z + bounds.max.z) / 2,
  };
  const radius = Math.max(1, Math.hypot(width, height, depth) / 2);
  const directions = {
    hero: [1, 0.12, 1],
    front: [0, 0.04, 1],
    corner: [1, 0.08, 0.72],
    entrance: [0, -0.02, 1],
    aerial: [0.72, 0.95, 0.72],
  };
  const [rawX, rawY, rawZ] = directions[kind];
  const horizontal = rotateY(rawX, rawZ, orientation);
  const length = Math.hypot(horizontal.x, rawY, horizontal.z) || 1;
  const distance = radius * (kind === "entrance" ? 2.35 : kind === "aerial" ? 3.9 : 3.55);
  return {
    id: kind,
    kind,
    position: {
      x: target.x + horizontal.x / length * distance,
      y: target.y + rawY / length * distance,
      z: target.z + horizontal.z / length * distance,
    },
    target,
    fov: kind === "entrance" ? 46 : 42,
  };
}

function sortedUnique(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value))].sort();
}

function visualMood(scene) {
  const evidence = Array.isArray(scene?.referenceImageEvidenceSet) && scene.referenceImageEvidenceSet.length
    ? scene.referenceImageEvidenceSet
    : scene?.referenceImageEvidence
      ? [scene.referenceImageEvidence]
      : [];
  if (!evidence.length) return scene?.appearance?.nightMode ? "night" : "day";
  const strongest = [...evidence].sort((a, b) => Number(b?.confidence || 0) - Number(a?.confidence || 0))[0];
  return ["day", "evening", "night"].includes(strongest?.lightingMood)
    ? strongest.lightingMood
    : "source-reference";
}

export async function buildAutomaticBuildingPresentation({ canonical, draft, sourceEvidence }) {
  if (!canonical) return undefined;
  const scene = draft?.scene || {};
  const bounds = canonical.bounds;
  const orientationDegrees = Number(scene.modelTransform?.rotationY || 0);
  if (!Number.isFinite(orientationDegrees))
    throw Error("Automatic Building presentation model orientation is invalid.");
  const appearance = scene.appearance || {
    exposure: 1,
    sunIntensity: 3.2,
    hemisphereIntensity: 2.8,
    background: "#dbe3e7",
    referenceVisual: true,
    nightMode: false,
  };
  const rooms = Array.isArray(scene.rooms) ? scene.rooms : [];
  const floors = Array.isArray(scene.floors) ? scene.floors : [];
  const siteElements = Array.isArray(scene.siteElements) ? scene.siteElements : [];
  const openings = Array.isArray(scene.openings) ? scene.openings : [];
  const landscapePreset = scene.landscapePreset ?? "auto";
  if (!["auto", "urban", "suburban", "rural-farm", "hillside"].includes(landscapePreset))
    throw Error("Invalid customer landscape preset.");
  const environmentProfile = {
    format: "rekixo-environment-profile",
    version: 1,
    preset: "cinematic-exterior",
    quality: "auto",
    landscape: landscapePreset,
    baseline: "always",
    siteDataPolicy: "additive",
    motion: {
      clouds: "drifting",
      vegetation: "subtle",
      water: "opt-in",
      traffic: "opt-in",
    },
  };
  const sourceBackedEnvironment = siteElements.some((item) => item?.origin === "cad-auto" || item?.origin === "model-cad-auto");
  const sourceBackedUnits = new Set(
    rooms
      .filter((room) => room?.unit && (room?.sourcePackSourceId || room?.sourceAssetId || room?.verified))
      .map((room) => `${room.floorId || ""}\u0000${String(room.unit).trim()}`),
  );
  const circulationCores = siteElements.filter(
    (item) => item?.reviewed === true && (item?.kind === "stair" || item?.kind === "lift"),
  ).length;
  const sceneFingerprint = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(scene)),
  ).then((digest) => Array.from(new Uint8Array(digest), (item) => item.toString(16).padStart(2, "0")).join(""));
  const orientation = orientationDegrees * Math.PI / 180;
  const shotKinds = ["hero", "front", "corner", "entrance", "aerial"];
  const materialOverrides = [...(Array.isArray(scene.materialOverrides) ? scene.materialOverrides : [])]
    .sort((a, b) => String(a?.materialName || "").localeCompare(String(b?.materialName || "")))
    .map((item) => ({
      materialName: item.materialName,
      ...(item.baseColor ? { baseColor: item.baseColor } : {}),
      ...(item.roughness !== undefined ? { roughness: item.roughness } : {}),
      ...(item.metalness !== undefined ? { metalness: item.metalness } : {}),
      ...(item.opacity !== undefined ? { opacity: item.opacity } : {}),
      ...(item.emissive ? { emissive: item.emissive } : {}),
      ...(item.emissiveIntensity !== undefined ? { emissiveIntensity: item.emissiveIntensity } : {}),
      source: "operator",
    }));

  return {
    format: "rekixo-building-presentation",
    version: 1,
    model: {
      canonicalSha256: String(canonical.modelArtifact.sha256).toLowerCase(),
      metresPerUnit: 1,
      bounds: structuredClone(bounds),
    },
    hierarchy: {
      floorCount: floors.length,
      unitCount: sourceBackedUnits.size,
      circulationCoreCount: circulationCores,
    },
    appearance: {
      mood: visualMood(scene),
      exposure: Number(appearance.exposure),
      sunIntensity: Number(appearance.sunIntensity),
      hemisphereIntensity: Number(appearance.hemisphereIntensity),
      background: appearance.background,
      referenceVisual: Boolean(appearance.referenceVisual),
    },
    materials: { mode: "source-preserving", overrides: materialOverrides },
    environment: sourceBackedEnvironment
      ? {
          mode: "source-backed",
          sourceBacked: true,
          genericDressing: false,
          profile: structuredClone(environmentProfile),
        }
      : {
          mode: "presentation-default",
          sourceBacked: false,
          genericDressing: true,
          profile: structuredClone(environmentProfile),
        },
    cameras: {
      defaultShotId: "hero",
      shots: shotKinds.map((kind) => cameraShot(kind, bounds, orientation)),
    },
    tour: {
      enabled: true,
      steps: [
        { shotId: "hero", durationMs: 2600, holdMs: 900 },
        { shotId: "front", durationMs: 2200, holdMs: 700 },
        { shotId: "corner", durationMs: 2200, holdMs: 700 },
        { shotId: "entrance", durationMs: 2000, holdMs: 700 },
        { shotId: "aerial", durationMs: 2600, holdMs: 1000 },
      ],
    },
    interactions: {
      orbit: true,
      floorExplorer: floors.length > 1,
      walkthrough: rooms.length > 0 && openings.some(
        (opening) => opening?.kind === "door" && opening?.reviewed === true &&
          Array.isArray(opening.roomIds) && opening.roomIds.length === 2,
      ),
    },
    provenance: {
      sceneFingerprint,
      sourcePackSourceIds: sortedUnique(sourceEvidence?.sourcePackSourceIds || []),
      sourceClaimIds: sortedUnique(sourceEvidence?.sourceClaimIds || []),
    },
  };
}
