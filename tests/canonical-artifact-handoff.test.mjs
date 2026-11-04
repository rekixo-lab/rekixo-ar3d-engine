import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { canonicalOutputHandoff } from "../workers/processing-jobs.mjs";

const processingWorker = fs.readFileSync("workers/processing-jobs.mjs", "utf8");
const processingUi = fs.readFileSync(
  "apps/admin/src/source-pack/ProcessingSpine.tsx",
  "utf8",
);

const job = {
  id: "processing_job_12345678",
  project_id: "project_12345678",
  source_pack_id: "pack_12345678",
  source_pack_manifest_sha256: "a".repeat(64),
  processor_version: "canonical-building-v1",
  state: "succeeded",
  output_manifest_sha256: "b".repeat(64),
};

function artifact(overrides = {}) {
  return {
    id: "artifact_12345678",
    processing_job_id: job.id,
    project_id: job.project_id,
    kind: "canonical-model",
    logical_id: "building-model",
    state: "ready",
    r2_key: "projects/demo/processing/pack/canonical-building-v1/attempt-1/canonical/model.glb",
    mime_type: "model/gltf-binary",
    byte_size: 4096,
    sha256: "c".repeat(64),
    failure_reason: null,
    created_at: "2026-10-06T00:00:00.000Z",
    updated_at: "2026-10-06T00:00:00.000Z",
    ...overrides,
  };
}

function manifest(overrides = {}) {
  return artifact({
    id: "artifact_manifest_12345678",
    kind: "canonical-model-manifest",
    logical_id: "canonical-model-manifest-v1",
    r2_key: "projects/demo/processing/pack/canonical-building-v1/attempt-1/canonical/model-manifest.json",
    mime_type: "application/json",
    byte_size: 1024,
    sha256: job.output_manifest_sha256,
    ...overrides,
  });
}

function nodeCatalog(overrides = {}) {
  return artifact({
    id: "artifact_node_catalog_12345678",
    kind: "node-catalog",
    logical_id: "node-catalog-v1",
    r2_key: "projects/demo/processing/pack/canonical-building-v1/attempt-1/canonical/node-catalog.json",
    mime_type: "application/json",
    byte_size: 2048,
    sha256: "e".repeat(64),
    ...overrides,
  });
}

test("canonical handoff requires one ready model and one manifest pinned to the job output SHA", () => {
  const handoff = canonicalOutputHandoff(job, [artifact(), manifest()]);
  assert.ok(handoff);
  assert.equal(handoff.processingJobId, job.id);
  assert.equal(handoff.sourcePackId, job.source_pack_id);
  assert.equal(handoff.outputManifestSha256, job.output_manifest_sha256);
  assert.equal(handoff.model.kind, "canonical-model");
  assert.equal(handoff.manifest.kind, "canonical-model-manifest");
  assert.equal(handoff.model.byteSize, 4096);
  assert.equal("nodeCatalog" in handoff, false);
});

test("canonical handoff exposes one verified node catalog additively", () => {
  const handoff = canonicalOutputHandoff(job, [artifact(), manifest(), nodeCatalog()]);
  assert.ok(handoff);
  assert.equal(handoff.nodeCatalog.kind, "node-catalog");
  assert.equal(handoff.nodeCatalog.logicalId, "node-catalog-v1");
  assert.equal(handoff.nodeCatalog.byteSize, 2048);
  assert.equal(handoff.nodeCatalog.sha256, "e".repeat(64));
});

test("canonical handoff fails closed on manifest identity mismatch", () => {
  const handoff = canonicalOutputHandoff(job, [
    artifact(),
    manifest({ sha256: "d".repeat(64) }),
  ]);
  assert.equal(handoff, null);
});

test("canonical handoff fails closed on duplicate or invalid node catalogs", () => {
  assert.equal(
    canonicalOutputHandoff(job, [
      artifact(),
      manifest(),
      nodeCatalog(),
      nodeCatalog({ id: "artifact_node_catalog_duplicate" }),
    ]),
    null,
  );
  assert.equal(
    canonicalOutputHandoff(job, [artifact(), manifest(), nodeCatalog({ sha256: null })]),
    null,
  );
  assert.equal(
    canonicalOutputHandoff(job, [artifact(), manifest(), nodeCatalog({ byte_size: null })]),
    null,
  );
});

test("canonical handoff fails closed on duplicate or cross-owned artifacts", () => {
  assert.equal(
    canonicalOutputHandoff(job, [artifact(), artifact({ id: "artifact_duplicate" }), manifest()]),
    null,
  );
  assert.equal(
    canonicalOutputHandoff(job, [
      artifact({ project_id: "project_other" }),
      manifest(),
    ]),
    null,
  );
  assert.equal(
    canonicalOutputHandoff(job, [
      artifact({ processing_job_id: "processing_job_other" }),
      manifest(),
    ]),
    null,
  );
});

test("non-terminal processing never exposes a canonical handoff", () => {
  assert.equal(
    canonicalOutputHandoff({ ...job, state: "running" }, [artifact(), manifest(), nodeCatalog()]),
    null,
  );
});

test("processing API exposes current artifacts without creating public asset URLs", () => {
  assert.match(processingWorker, /async function artifactsForJob/);
  assert.match(processingWorker, /currentArtifacts: currentArtifacts\.map\(artifactResponse\)/);
  assert.match(processingWorker, /canonicalOutput: canonicalOutputHandoff\(currentJob, currentArtifacts\)/);
  assert.match(processingWorker, /manifest\.sha256 !== job\.output_manifest_sha256/);
  assert.match(processingWorker, /item\.kind === "node-catalog"/);
  assert.match(processingWorker, /\.\.\.\(nodeCatalog \? \{ nodeCatalog \} : \{\}\)/);
  assert.doesNotMatch(processingWorker, /signedUrl|publicUrl|presigned/i);
});

test("Processing Spine shows canonical identity and blocks downstream mapping when handoff is incomplete", () => {
  assert.match(processingUi, /type CanonicalOutputHandoffV1/);
  assert.match(processingUi, /canonicalOutput\?\.nodeCatalog/);
  assert.match(processingUi, /canonicalOutput\.model\.sha256/);
  assert.match(processingUi, /Model prepared/);
  assert.match(processingUi, /processing-spine__mapper-link/);
  assert.match(processingUi, /ModelScaleReview/);
});
