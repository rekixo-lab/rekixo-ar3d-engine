import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(p)=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const source=read("apps/admin/src/source-pack/SourcePackReview.tsx");
const uploader=read("apps/admin/src/source-pack/SourceOriginalUploader.tsx");
const processing=read("apps/admin/src/source-pack/ProcessingSpine.tsx");
const workspace=read("apps/admin/src/building/BuildingWorkspace.tsx");

test("Building Editor has only four concise purpose-driven tabs and a small project bar",()=>{
  assert.match(workspace,/label: "3D Model"/);
  assert.match(workspace,/label: "Components"/);
  assert.match(workspace,/label: "Design"/);
  assert.match(workspace,/label: "Publish"/);
  assert.match(workspace,/building-workspace__compact-header/);
  assert.doesNotMatch(workspace,/building-workspace__flow/);
  assert.match(workspace,/<details className="building-workspace__versions/);
});
test("recent verified models identified by real SHA and explicit selection",()=>{
  assert.match(source,/sort\(\(a, b\) => b.sortOrder - a.sortOrder\)/);
  assert.match(source,/file\.capabilities\.includes\("geometry"\)/);
  assert.match(source,/file\.uploadState === "verified"/);
  assert.match(source,/Select verified 3D model/);
  assert.match(source,/proposedModel\.sha256/);
  assert.match(source,/window\.confirm\("Prepare the NEW 3D model/);
});
test("single operator action saves and seals source before private processing",()=>{
  const prepared=source.slice(source.indexOf("async function prepareModel()"));
  const save=prepared.indexOf('action: "save-review", packId: pack.id, files: nextFiles');
  // Check readiness guard includes the sealed pack authority identity.
  assert.match(source,/reviewed\.latestPack\.geometryAuthorityFileId !== candidate\.sourceFileId/);
  const seal=prepared.indexOf('action: "seal", packId: pack.id, confirm: "SEAL SOURCE PACK"');
  const process=prepared.indexOf('action: "start", sourcePackId: pack.id');
  assert.ok(save>=0 && seal>save && process>seal);
  assert.match(source,/sealed\.latestPack\.status !== "ready"/);
  assert.match(source,/current LIVE Building release, Geo mapping, Plot IDs and customer status/);
  assert.doesNotMatch(source,/action: "publish"/);
});
test("GLB upload may open a draft, FBX conversion stays available before draft",()=>{
  assert.match(uploader,/await onVerified\(files\)/);
  assert.match(uploader,/await onVerified\(\[converted\]\)/);
  assert.match(source,/uploadedFiles\.some\(\(file\) => \/\\\.glb\$\/i\.test\(file\.name\)\)/);
  assert.match(source,/current\.latestPack\?\.status === "draft"/);
  assert.match(source,/action: "start-draft"/);
  assert.match(uploader,/<details className="source-originals__history"/);
  assert.match(uploader,/<details className="source-originals__fallback"/);
});
test("UI shows only processing status and next action while keeping recovery diagnostics accessible",()=>{
  assert.match(processing,/processing-spine--compact/);
  assert.match(processing,/<details className="processing-spine__technical">/);
  assert.doesNotMatch(processing,/processing-spine__grid/);
  assert.match(source,/<details className="source-review__advanced">/);
  assert.doesNotMatch(source,/<nav className="source-review__workflow-nav"/);
  assert.doesNotMatch(source,/<section className="source-review__summary"/);
});
