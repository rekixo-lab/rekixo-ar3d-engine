import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  CANONICAL_MODEL_FORMAT,
  CANONICAL_MODEL_VERSION,
  inspectGlbJson,
  parseGlbHeader,
} from "../workers/canonical-glb-processor.mjs";

const processor = fs.readFileSync("workers/canonical-glb-processor.mjs", "utf8");
const spine = fs.readFileSync("workers/processing-jobs.mjs", "utf8");
const entry = fs.readFileSync("workers/admin-entry.mjs", "utf8");
const contract = fs.readFileSync(
  "packages/contracts/src/canonical-model-manifest-v1.ts",
  "utf8",
);
const contractIndex = fs.readFileSync("packages/contracts/src/index.ts", "utf8");

function glbHeader({ version = 2, byteLength = 128, jsonLength = 64, jsonType = 0x4e4f534a } = {}) {
  const bytes = new Uint8Array(20);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, version, true);
  view.setUint32(8, byteLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, jsonType, true);
  return bytes;
}

test("canonical GLB header parser pins GLB 2.0 and verified source length", () => {
  assert.deepEqual(parseGlbHeader(glbHeader(), 128), {
    version: 2,
    declaredLength: 128,
    jsonChunkLength: 64,
  });
  assert.throws(
    () => parseGlbHeader(glbHeader({ version: 1 }), 128),
    /GLB version 1 is not supported/,
  );
  assert.throws(
    () => parseGlbHeader(glbHeader({ byteLength: 127 }), 128),
    /declared byte length does not match/,
  );
});

test("large client GLBs admit bounded 13 MiB JSON without dropping validation", () => {
  const sourceBytes = 148_874_960;
  const actualJson = 12_966_136; // Shreem Palace's verified original GLB header.
  assert.deepEqual(parseGlbHeader(glbHeader({
    byteLength: sourceBytes, jsonLength: actualJson,
  }), sourceBytes), {
    version: 2,
    declaredLength: sourceBytes,
    jsonChunkLength: actualJson,
  });

  assert.throws(
    () => parseGlbHeader(glbHeader({
      byteLength: 40 * 1024 * 1024,
      jsonLength: 33 * 1024 * 1024,
    }), 40 * 1024 * 1024),
    /32 MiB validation limit/,
  );
  const release = fs.readFileSync("workers/automatic-building-release.mjs", "utf8");
  assert.match(release, /MAX_GLTF_JSON_BYTES = 32 \* 1024 \* 1024/);
});

test("canonical GLB inspection rejects external dependencies instead of guessing", () => {
  const valid = inspectGlbJson({
    asset: { version: "2.0", generator: "fixture" },
    buffers: [{ byteLength: 4 }],
    images: [{ bufferView: 0, mimeType: "image/png" }],
    scenes: [{}],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [] }],
    materials: [{}],
    textures: [{}],
    extensionsRequired: ["EXT_meshopt_compression"],
  });
  assert.equal(valid.assetVersion, "2.0");
  assert.equal(valid.statistics.meshCount, 1);
  assert.deepEqual(valid.requiredExtensions, ["EXT_meshopt_compression"]);

  assert.throws(
    () => inspectGlbJson({ asset: { version: "2.0" }, buffers: [{ uri: "mesh.bin" }] }),
    /self-contained/,
  );
  assert.throws(
    () => inspectGlbJson({ asset: { version: "2.0" }, images: [{ uri: "texture.png" }] }),
    /self-contained/,
  );
});

test("Phase 2A executor revalidates immutable source identity and stays reconstruction-free", () => {
  assert.equal(CANONICAL_MODEL_FORMAT, "rekixo-canonical-model");
  assert.equal(CANONICAL_MODEL_VERSION, 1);
  assert.match(processor, /sourceFileKey\(context\.project_slug, context\.source_id, context\.sha256\)/);
  assert.match(processor, /context\.upload_state !== "verified"/);
  assert.match(processor, /metadata\.projectId !== job\.project_id/);
  assert.match(processor, /metadata\.sourceFileId !== context\.source_id/);
  assert.match(processor, /metadata\.sha256 !== context\.sha256/);
  assert.match(processor, /SOURCE_ETAG_MISMATCH/);
  assert.match(processor, /UNSUPPORTED_GEOMETRY_AUTHORITY_FORMAT/);
  assert.match(processor, /EXTERNAL_GLTF_DEPENDENCY/);
  assert.doesNotMatch(processor, /Draw Wall|Create Room|reconstruct|buildingReconstructionPlan/);
  assert.doesNotMatch(processor, /UPDATE\s+source_files_3d/i);
  assert.doesNotMatch(processor, /UPDATE\s+source_packs_3d/i);
  assert.doesNotMatch(processor, /releases_3d|geo_releases_3d/);
});

test("Phase 2A writes only attempt-scoped derived artifacts and terminal manifest", () => {
  assert.match(processor, /\$\{job\.artifact_prefix\}canonical\/model\.glb/);
  assert.match(processor, /\$\{job\.artifact_prefix\}canonical\/model-manifest\.json/);
  assert.match(processor, /MODEL_ASSETS\.put\(modelKey/);
  assert.match(processor, /kind,logical_id,state,r2_key,mime_type,byte_size,sha256/);
  assert.match(processor, /"canonical-model"/);
  assert.match(processor, /"canonical-model-manifest"/);
  assert.match(processor, /SET state='succeeded'/);
  assert.match(processor, /output_manifest_json=\?,output_manifest_sha256=\?/);
  assert.match(processor, /processing\.job_succeeded/);
  assert.match(processor, /processing\.job_failed/);
});

test("processing API schedules durable execution on start and polling recovery", () => {
  assert.match(spine, /scheduleCanonicalProcessingJob/);
  assert.match(spine, /scheduleCanonicalProcessingJob\(env, ctx, state\.currentJob\?\.id\)/);
  assert.match(spine, /scheduleCanonicalProcessingJob\(env, ctx, queued\.job\.id\)/);
  assert.match(entry, /handleProcessingRequest\(request, env, url, ctx\)/);
  assert.match(processor, /state='queued'/);
  assert.match(processor, /state='running'/);
  assert.match(processor, /heartbeat_at IS NULL OR heartbeat_at<\?/);
});

test("canonical model contract is additive and exported", () => {
  assert.match(contract, /CANONICAL_MODEL_MANIFEST_FORMAT = "rekixo-canonical-model"/);
  assert.match(contract, /geometryAuthority:/);
  assert.match(contract, /coordinateSystem:/);
  assert.match(contract, /geometryTransform: "preserved"/);
  assert.match(contractIndex, /export \* from "\.\/canonical-model-manifest-v1"/);
});
