import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("production checker supports independently pinned historic Geo Building releases", () => {
  const verify = readFileSync(
    new URL("../scripts/verify-production-release-integrity.mjs", import.meta.url), "utf8"
  );
  // Building v3 live with Geo still pointing to Building v2 is valid. Only
  // the pinned old immutable manifest/model must pass integrity checks.
  assert.doesNotMatch(verify, /geo\.buildingRelease\.id\s*!==\s*item\.releaseId/);
  assert.match(verify, /geo\?\.release\?\.id\s*!==\s*pinnedBuilding\?\.id/);
  assert.match(verify, /checksum\(pinnedBuilding\.manifestSha256\)/);
  assert.match(verify, /checksum\(activeGeo\.manifestSha256\)/);
  assert.match(verify, /geo\?\.canonicalModel\?\.url/);
  assert.match(verify, /method: "HEAD"/);
  assert.match(verify, /pinned Building GLB is unavailable/);
});
