import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const server = readFileSync("workers/source-pack-review.mjs", "utf8");
const ui = readFileSync("apps/admin/src/source-pack/SourcePackReview.tsx", "utf8");

test("resetting an unsealed source review is opt-in and preserves source originals", () => {
  assert.match(server, /body\.action === "abandon-draft"/);
  assert.match(server, /body\.confirm !== "DISCARD DRAFT"/);
  assert.match(server, /pack\.status !== "draft"/);
  assert.match(server, /Number\(pack\.operator_approved\) !== 0/);
  assert.match(server, /pack\.manifest_sha256/);
  assert.match(server, /DELETE FROM source_packs_3d/);
  assert.match(server, /WHERE id=\? AND project_id=\? AND status='draft'/);
  assert.doesNotMatch(server, /DELETE FROM source_files_3d/);
  assert.match(server, /await audit\(env, actor, "source\.pack_draft_discarded"/);
});

test("review without selectable GLB offers a recoverable non-destructive action", () => {
  assert.match(ui, /!modelOptions\.length/);
  assert.match(ui, /Discard Unsealed Review & Unlock Upload/);
  assert.match(ui, /"abandon-draft", packId: pack\.id/);
  assert.match(ui, /window\.confirm/);
  assert.match(ui, /Verified DAE/gi);
  assert.match(ui, /locked=\{pack\?\.status === "draft"\}/);
});
