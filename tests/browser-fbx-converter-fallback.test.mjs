import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

test("Browser GLB fallback requires operator scale review and never overwrites FBX", () => {
  const code = fs.readFileSync("apps/admin/src/source-pack/browserFbxConverter.ts", "utf8");
  const uploader = fs.readFileSync("apps/admin/src/source-pack/SourceOriginalUploader.tsx", "utf8");
  assert.match(code, /FBXLoader/);
  assert.match(code, /GLTFExporter/);
  assert.match(code, /SHA-256/);
  assert.match(code, /originalUnitScaleFactor \/ 100/);
  assert.match(code, /reviewedDimensions/);
  assert.match(code, /2\u20132000 m sanity range/);
  assert.match(code, /materialCache/);
  assert.match(code, /materialIndex/);
  assert.match(code, /sourceSha256: analysis.inputSha256/);
  assert.match(code, /-reviewed\.glb/);
  assert.match(uploader, /exportReviewedBrowserGlb/);
  assert.match(uploader, /reviewConfirmed/);
  assert.match(uploader, /Generate & verify reviewed GLB/);
  assert.match(uploader, /await completeOriginal\(slug, converted, setProgress\)/);
  assert.match(uploader, /setReviewConfirmed\(false\)/);
});
