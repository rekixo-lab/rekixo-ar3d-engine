import assert from "node:assert/strict";
import test from "node:test";

import { assessGeoFrameIntegrity } from "../scripts/asset-pipeline/geo-frame-integrity.mjs";

const source = {
  min: [-428, -18.3, -203],
  max: [235, 132, 200],
};

test("Geo derivative retains an off-center canonical site in model-local metres", () => {
  const result = assessGeoFrameIntegrity(source, structuredClone(source));
  assert.equal(result.ok, true);
  assert.equal(result.maxDriftM, 0);
  assert.equal(result.axes.length, 3);
});

test("Geo derivative rejects prior automatic recentering and ground normalization", () => {
  const moved = {
    min: [-331.5, 0, -201.5],
    max: [331.5, 150.3, 201.5],
  };
  const result = assessGeoFrameIntegrity(source, moved);
  assert.equal(result.ok, false);
  assert.ok(result.maxDriftM > 18);
  assert.equal(result.axes.some((axis) => !axis.ok), true);
});

test("Geo derivative allows tiny geometric simplification but not metre-scale drift", () => {
  const sourceSmall = { min: [-2, -1, -5], max: [8, 14, 5] };
  const safe = { min: [-1.96, -1.03, -4.95], max: [7.98, 14.02, 4.98] };
  assert.equal(assessGeoFrameIntegrity(sourceSmall, safe).ok, true);
  const unsafe = structuredClone(safe);
  unsafe.max[1] += 0.5;
  assert.equal(assessGeoFrameIntegrity(sourceSmall, unsafe).ok, false);
});

test("Geo derivative frame validation fails closed for malformed bounds", () => {
  assert.throws(
    () => assessGeoFrameIntegrity(source, { min: [0, 0, Infinity], max: [1, 1, 1] }),
    /Invalid min geo bounds/,
  );
  assert.throws(
    () => assessGeoFrameIntegrity({ min: [2, 0, 0], max: [1, 1, 1] }, source),
    /Inverted geo bounds/,
  );
});
