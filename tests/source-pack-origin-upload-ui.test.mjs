import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");

test("authenticated source reads do not incorrectly require Origin while mutations still do", () => {
  for (const file of [
    "workers/source-pack-review.mjs",
    "workers/source-classification.mjs",
    "workers/processing-jobs.mjs",
    "workers/model-scale-review.mjs",
  ]) {
    const code = read(file);
    assert.match(code, /request.method !== "GET" && !sameOrigin\(request\)/, file);
    assert.match(code, /engineAdminReadAccess\(request, env\)/, file);
  }
  const mapper = read("workers/component-mapper-data.mjs");
  assert.match(mapper, /request.method !== "GET"/);
  assert.match(mapper, /engineAdminReadAccess\(request, env\)/);
  assert.doesNotMatch(mapper, /if \(!sameOrigin\(request\)\)/);
});

test("Source Pack UI offers immutable original upload via resumable and verified pipeline", () => {
  const page = read("apps/admin/src/source-pack/SourcePackReview.tsx");
  const uploader = read("apps/admin/src/source-pack/SourceOriginalUploader.tsx");
  assert.match(page, /<SourceOriginalUploader/);
  assert.match(uploader, /crypto.subtle.digest\("SHA-256"/);
  assert.match(uploader, /source-files/);
  assert.match(uploader, /uploadedParts/);
  assert.match(uploader, /\/parts\/\$\{partNumber\}/);
  assert.match(uploader, /\/complete/);
  assert.match(uploader, /\/verify/);
  assert.match(uploader, /source-classification/);
  assert.match(uploader, /disabled=\{locked \|\| busy \|\| !slug\}/);
});

test("Dashboard does not misrepresent failed Source Pack requests as Not Started", () => {
  const code = read("apps/admin/src/dashboard/EngineDashboard.tsx");
  assert.match(code, /sourcePackError/);
  assert.match(code, /API ERROR/);
  assert.doesNotMatch(code, /if \(!response.ok\) return \{ latestPack: null \}/);
});
