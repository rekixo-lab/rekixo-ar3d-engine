import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NodeIO, VertexLayout } from "@gltf-transform/core";
import {
  dedup,
  flatten,
  getBounds,
  join,
  prune,
  simplify,
  weld,
} from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import { assessGeoFrameIntegrity } from "./asset-pipeline/geo-frame-integrity.mjs";

function fail(message) {
  throw new Error(message);
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function parseGlbJson(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) fail("Invalid GLB magic.");
  if (view.getUint32(4, true) !== 2) fail("Only GLB 2.0 is supported.");
  const jsonLength = view.getUint32(12, true);
  const jsonType = view.getUint32(16, true);
  if (jsonType !== 0x4e4f534a) fail("First GLB chunk must be JSON.");
  const jsonBytes = bytes.slice(20, 20 + jsonLength);
  return JSON.parse(
    new TextDecoder().decode(jsonBytes).replace(/\u0000+$/g, "").trim(),
  );
}

function componentBytes(componentType) {
  return componentType === 5120 || componentType === 5121
    ? 1
    : componentType === 5122 || componentType === 5123
      ? 2
      : componentType === 5125 || componentType === 5126
        ? 4
        : 0;
}

function typeComponents(type) {
  return {
    SCALAR: 1,
    VEC2: 2,
    VEC3: 3,
    VEC4: 4,
    MAT2: 4,
    MAT3: 9,
    MAT4: 16,
  }[type] || 0;
}

function stripRedundantVertexStrides(buffer) {
  const source = Buffer.from(buffer);
  const jsonLength = source.readUInt32LE(12);
  const jsonType = source.readUInt32LE(16);
  if (jsonType !== 0x4e4f534a) fail("First GLB chunk must be JSON.");

  const json = JSON.parse(
    source
      .subarray(20, 20 + jsonLength)
      .toString("utf8")
      .replace(/\u0000+$/g, "")
      .trim(),
  );

  for (
    let viewIndex = 0;
    viewIndex < (json.bufferViews || []).length;
    viewIndex += 1
  ) {
    const view = json.bufferViews[viewIndex];
    if (!Number.isInteger(view.byteStride)) continue;

    const users = (json.accessors || []).filter(
      (accessor) => accessor.bufferView === viewIndex,
    );
    if (users.length !== 1)
      fail(`Strided Geo vertex bufferView ${viewIndex} is shared.`);

    const accessor = users[0];
    const packed =
      componentBytes(accessor.componentType) * typeComponents(accessor.type);
    if (!packed || view.byteStride !== packed)
      fail(`Geo vertex bufferView ${viewIndex} is not tightly packed.`);
    delete view.byteStride;
  }

  const jsonBytes = Buffer.from(JSON.stringify(json), "utf8");
  const paddedJsonLength = Math.ceil(jsonBytes.length / 4) * 4;
  const jsonChunk = Buffer.alloc(paddedJsonLength, 0x20);
  jsonBytes.copy(jsonChunk);

  const binHeaderOffset = 20 + jsonLength;
  const binLength = source.readUInt32LE(binHeaderOffset);
  const binType = source.readUInt32LE(binHeaderOffset + 4);
  if (binType !== 0x004e4942) fail("GLB BIN chunk is missing.");
  const bin = source.subarray(
    binHeaderOffset + 8,
    binHeaderOffset + 8 + binLength,
  );

  const output = Buffer.alloc(
    12 + 8 + paddedJsonLength + 8 + bin.length,
  );
  output.writeUInt32LE(0x46546c67, 0);
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(paddedJsonLength, 12);
  output.writeUInt32LE(0x4e4f534a, 16);
  jsonChunk.copy(output, 20);

  const outputBinHeader = 20 + paddedJsonLength;
  output.writeUInt32LE(bin.length, outputBinHeader);
  output.writeUInt32LE(0x004e4942, outputBinHeader + 4);
  bin.copy(output, outputBinHeader + 8);
  return output;
}

async function geometryStats(buffer) {
  const io = new NodeIO();
  const document = await io.readBinary(new Uint8Array(buffer));
  const root = document.getRoot();
  const scene = root.getDefaultScene() || root.listScenes()[0];
  if (!scene) fail("Geo derivative has no scene.");

  const bounds = getBounds(scene);
  const min = [...bounds.min];
  const max = [...bounds.max];
  const centerPoint = min.map((value, index) => (value + max[index]) / 2);
  const size = min.map((value, index) => max[index] - value);

  let meshes = 0;
  let primitives = 0;
  let vertices = 0;
  let triangles = 0;
  let primitivesWithNormals = 0;
  let primitivesWithoutNormals = 0;
  let nonTrianglePrimitives = 0;
  for (const mesh of root.listMeshes()) {
    meshes += 1;
    for (const primitive of mesh.listPrimitives()) {
      primitives += 1;
      const position = primitive.getAttribute("POSITION");
      if (position) vertices += position.getCount();
      if (primitive.getAttribute("NORMAL")) primitivesWithNormals += 1;
      else primitivesWithoutNormals += 1;
      if (primitive.getMode() !== 4) nonTrianglePrimitives += 1;
      const indices = primitive.getIndices();
      triangles += indices
        ? indices.getCount() / 3
        : position
          ? position.getCount() / 3
          : 0;
    }
  }

  return {
    bounds: { min, max, center: centerPoint, size },
    meshes,
    primitives,
    vertices,
    triangles,
    materials: root.listMaterials().length,
    textures: root.listTextures().length,
    primitivesWithNormals,
    primitivesWithoutNormals,
    nonTrianglePrimitives,
  };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    redirect: "follow",
  });
  if (!response.ok) fail(`GET ${url} failed: ${response.status}`);
  return response.json();
}

async function fetchBytes(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) fail(`GET ${url} failed: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function buildCandidate(sourcePath, outputPath, ratio, error) {
  const io = new NodeIO().setVertexLayout(VertexLayout.SEPARATE);
  const document = await io.read(sourcePath);

  const root = document.getRoot();
  const sourceScene = root.getDefaultScene() || root.listScenes()[0];
  if (!sourceScene) fail("Source GLB has no scene.");
  const originalBounds = getBounds(sourceScene);
  const sourceBounds = { min: [...originalBounds.min], max: [...originalBounds.max] };
  const hasTextures = root.listTextures().length > 0;

  // Google Maps' official model sample is double-sided. Keep the map-only
  // derivative tolerant of mirrored/CAD winding while leaving the immutable
  // source GLB untouched.
  for (const material of root.listMaterials()) material.setDoubleSided(true);

  // Keep explicit source normals and source PBR materials in the map derivative.
  // Google Maps 3D is a separate renderer from our Three.js viewer, so the
  // derivative intentionally avoids relying on renderer-generated normals or a
  // synthetic palette texture. TANGENT and TEXCOORD_* are removed only when the
  // immutable source has no textures, where those attributes cannot contribute
  // to material sampling. The immutable source GLB remains untouched.
  for (const mesh of root.listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      if (!hasTextures) {
        primitive.getAttribute("TANGENT")?.dispose();
        for (const semantic of primitive.listSemantics()) {
          if (semantic.startsWith("TEXCOORD_"))
            primitive.getAttribute(semantic)?.dispose();
        }
      }
    }
  }

  await MeshoptSimplifier.ready;
  await document.transform(
    // Preserve the canonical Building origin; Geo's saved WGS84 anchor and
    // polygon mapping must never move when choosing the optimized model.
    weld(),
    dedup(),
    prune({
      keepAttributes: false,
      keepIndices: false,
      keepLeaves: false,
      keepSolidTextures: false,
    }),
    // join() only combines sibling nodes; flatten the architectural scene
    // first so repeated CAD hierarchy does not keep hundreds of tiny meshes.
    flatten(),
    join({ keepNamed: false, keepMeshes: false }),
    simplify({
      simplifier: MeshoptSimplifier,
      ratio,
      error,
      lockBorder: false,
    }),
    prune({
      keepAttributes: false,
      keepIndices: false,
      keepLeaves: false,
      keepSolidTextures: false,
    }),
  );

  await io.write(outputPath, document);
  const canonical = stripRedundantVertexStrides(fs.readFileSync(outputPath));
  fs.writeFileSync(outputPath, canonical);
  return { bytes: canonical, sourceBounds };
}

const slug = String(process.argv[2] || "").trim().toLowerCase();
const outputDir = path.resolve(process.argv[3] || "");
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
  fail("Usage: node scripts/build-geo-model-derivative.mjs <project-slug> <output-dir>");
if (!outputDir) fail("Output directory is required.");

fs.mkdirSync(outputDir, { recursive: true });
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "rekixo-geo-model-"));
const projectUrl =
  `https://ar3dstudio.in/3Dprojects/api/projects/${encodeURIComponent(slug)}`;
const payload = await fetchJson(projectUrl);
const model = payload?.model;
const release = payload?.release;
const project = payload?.project;
if (
  !project ||
  project.slug !== slug ||
  project.status !== "published" ||
  !release?.id ||
  !Number.isInteger(Number(release.version)) ||
  !model?.id ||
  model.mimeType !== "model/gltf-binary" ||
  !model.url
)
  fail("Published immutable Engine project/model contract is incomplete.");

const sourceUrl = new URL(model.url, projectUrl).toString();
const sourceBytes = await fetchBytes(sourceUrl);
const sourceJson = parseGlbJson(sourceBytes);
if ((sourceJson.extensionsRequired || []).length)
  fail("Source GLB requires unsupported glTF extensions.");

const sourcePath = path.join(workDir, "source.glb");
fs.writeFileSync(sourcePath, sourceBytes);

// Prefer a small core-GLB with few draw calls. Google recommends keeping
// complex map models around 5 MB when possible; 8 MB is our hard deployment
// ceiling so an optimization regression cannot silently ship a huge model.
// Derivative bytes are rebuildable; release-runtime content-addresses their
// public URL by geoSha256 so immutable browser/Google caches remain correct.
const attempts = [
  { ratio: 0.45, error: 0.006 },
  { ratio: 0.32, error: 0.01 },
  { ratio: 0.22, error: 0.015 },
  { ratio: 0.14, error: 0.02 },
  { ratio: 0.09, error: 0.03 },
];

let chosen = null;
for (const attempt of attempts) {
  const candidatePath = path.join(
    workDir,
    `geo-${String(attempt.ratio).replace(".", "_")}.glb`,
  );
  const { bytes, sourceBounds } = await buildCandidate(
    sourcePath,
    candidatePath,
    attempt.ratio,
    attempt.error,
  );
  const json = parseGlbJson(bytes);
  const extensionsUsed = json.extensionsUsed || [];
  const extensionsRequired = json.extensionsRequired || [];
  if (extensionsUsed.length || extensionsRequired.length) {
    console.log(
      "REKIXO_GEO_CANDIDATE_REJECTED",
      JSON.stringify({
        ratio: attempt.ratio,
        byteSize: bytes.byteLength,
        extensionsUsed,
        extensionsRequired,
      }),
    );
    continue;
  }

  const stats = await geometryStats(bytes);
  const frame = assessGeoFrameIntegrity(sourceBounds, stats.bounds);
  if (!frame.ok) {
    console.log("REKIXO_GEO_CANDIDATE_REJECTED", JSON.stringify({
      ratio: attempt.ratio, reason: "canonical-frame-drift",
      maxDriftM: frame.maxDriftM, axes: frame.axes,
    }));
    continue;
  }
  const candidate = { ...attempt, path: candidatePath, bytes, stats, sourceBounds, frame };
  console.log(
    "REKIXO_GEO_CANDIDATE",
    JSON.stringify({
      ratio: attempt.ratio,
      error: attempt.error,
      byteSize: bytes.byteLength,
      meshes: stats.meshes,
      vertices: stats.vertices,
      triangles: stats.triangles,
      materials: stats.materials,
      textures: stats.textures,
      primitivesWithNormals: stats.primitivesWithNormals,
      primitivesWithoutNormals: stats.primitivesWithoutNormals,
      nonTrianglePrimitives: stats.nonTrianglePrimitives,
      bounds: stats.bounds,
    }),
  );

  if (
    !chosen ||
    candidate.bytes.byteLength < chosen.bytes.byteLength ||
    (candidate.bytes.byteLength === chosen.bytes.byteLength &&
      candidate.stats.meshes < chosen.stats.meshes)
  )
    chosen = candidate;

  if (
    bytes.byteLength <= 4_800_000 &&
    stats.meshes <= 120 &&
    stats.primitivesWithoutNormals === 0 &&
    stats.nonTrianglePrimitives === 0
  ) {
    chosen = candidate;
    break;
  }
}

if (!chosen) fail("Geo derivative was not generated.");

const geoJson = parseGlbJson(chosen.bytes);
const required = geoJson.extensionsRequired || [];
const used = geoJson.extensionsUsed || [];
if (required.length || used.length)
  fail(
    `Geo derivative must remain core glTF without extensions. used=${used.join(",")} required=${required.join(",")}`,
  );

const geoMaterials = geoJson.materials || [];
if (
  geoMaterials.length > 0 &&
  geoMaterials.some((material) => material.doubleSided !== true)
)
  fail("Geo derivative materials must be double-sided for map compatibility.");
if (
  (geoJson.bufferViews || []).some((bufferView) =>
    Number.isInteger(bufferView.byteStride),
  )
)
  fail("Geo derivative must not retain vertex byteStride metadata.");

const stats = chosen.stats;
// Re-check the final candidate immediately before writing it to output.
const finalFrame = assessGeoFrameIntegrity(chosen.sourceBounds, stats.bounds);
if (!finalFrame.ok)
  fail("Geo derivative does not preserve the canonical Building coordinate frame.");
if (chosen.bytes.byteLength > 8_000_000)
  fail(
    `Geo derivative is still too large for reliable map rendering: ${chosen.bytes.byteLength} bytes`,
  );
if (stats.meshes > 180)
  fail(
    `Geo derivative still has too many rendered meshes: ${stats.meshes}`,
  );
if (stats.primitives < 1 || stats.triangles < 1)
  fail("Geo derivative has no rendered triangle geometry.");
if (stats.nonTrianglePrimitives !== 0)
  fail(
    `Geo derivative contains non-TRIANGLES primitives: ${stats.nonTrianglePrimitives}`,
  );
if (
  stats.primitivesWithoutNormals !== 0 ||
  stats.primitivesWithNormals !== stats.primitives
)
  fail(
    `Geo derivative must keep explicit NORMAL attributes on every primitive: with=${stats.primitivesWithNormals} without=${stats.primitivesWithoutNormals}`,
  );
const sourceTextureCount = Array.isArray(sourceJson.textures)
  ? sourceJson.textures.length
  : 0;
const sourceMaterialCount = Array.isArray(sourceJson.materials)
  ? sourceJson.materials.length
  : 0;
if (sourceTextureCount === 0 && stats.textures !== 0)
  fail(
    `Textureless source must not gain synthetic Geo textures: ${stats.textures}`,
  );
if (sourceMaterialCount > 0 && stats.materials < 1)
  fail("Geo derivative unexpectedly lost all source PBR materials.");

const releaseId = String(release.id);
const modelId = String(model.id);
const r2Base =
  `projects/${slug}/releases/${releaseId}/geo-models/${modelId}`;
const modelOut = path.join(outputDir, "model.glb");
const metadataOut = path.join(outputDir, "metadata.json");
fs.writeFileSync(modelOut, chosen.bytes);

const metadata = {
  format: "rekixo-geo-model-derivative",
  version: 1,
  pipeline: "core-map-v5",
  coordinateFrame: "canonical-model-local-v1",
  sourceBounds: chosen.sourceBounds,
  frameValidation: finalFrame,
  generator: "@gltf-transform/*@4.5.1",
  projectId: project.id,
  projectSlug: slug,
  releaseId,
  releaseVersion: Number(release.version),
  sourceModelId: modelId,
  sourceModelName: model.name,
  sourceUrl,
  sourceSha256: sha256(sourceBytes),
  sourceByteSize: sourceBytes.byteLength,
  geoSha256: sha256(chosen.bytes),
  geoByteSize: chosen.bytes.byteLength,
  simplifyRatio: chosen.ratio,
  simplifyError: chosen.error,
  compatibility: {
    explicitNormals: true,
    materialStrategy: "source-pbr",
    syntheticPaletteTexture: false,
    vertexLayout: "separate-tight",
    doubleSidedMaterials: true,
    redundantByteStrideRemoved: true,
    sourceTextureCount,
    sourceMaterialCount,
  },
  extensionsUsed: used,
  extensionsRequired: required,
  stats,
  r2Key: `${r2Base}/model.glb`,
  metadataR2Key: `${r2Base}/metadata.json`,
};
fs.writeFileSync(metadataOut, JSON.stringify(metadata, null, 2) + "\n");
console.log("REKIXO_GEO_DERIVATIVE", JSON.stringify(metadata));
