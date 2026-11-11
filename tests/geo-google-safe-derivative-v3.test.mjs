import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const builder = fs.readFileSync("scripts/build-geo-model-derivative.mjs", "utf8");
const runtime = fs.readFileSync("workers/release-runtime.mjs", "utf8");

test("Geo derivative v5 keeps Google-safe explicit normals and source PBR materials", () => {
  assert.match(builder, /pipeline: "core-map-v5"/);
  assert.match(runtime, /"core-map-v4", "core-map-v5"/);

  assert.doesNotMatch(builder, /palette\s*\(/);
  assert.doesNotMatch(builder, /getAttribute\("NORMAL"\)\?\.dispose\(\)/);
  assert.match(builder, /getAttribute\("NORMAL"\)/);
  assert.match(builder, /primitivesWithoutNormals !== 0/);
  assert.match(builder, /primitivesWithNormals !== stats\.primitives/);
  assert.match(builder, /sourceTextureCount === 0 && stats\.textures !== 0/);
  assert.match(builder, /materialStrategy: "source-pbr"/);
  assert.match(builder, /syntheticPaletteTexture: false/);
  assert.match(builder, /VertexLayout\.SEPARATE/);
  assert.match(builder, /setDoubleSided\(true\)/);
  assert.match(builder, /vertexLayout: "separate-tight"/);
  assert.match(builder, /doubleSidedMaterials: true/);
  assert.match(builder, /redundantByteStrideRemoved: true/);
  assert.match(builder, /Geo derivative must not retain vertex byteStride metadata/);
});

test("Geo derivative URL changes whenever rebuilt bytes change", () => {
  assert.match(runtime, /max-age=31536000, immutable/);
  assert.equal(
    runtime.includes("&geo=${encodeURIComponent(derivative.metadata.geoSha256)}"),
    true,
  );
});

test("Geo derivative v5 stays bounded, triangle-only, and frame-preserving", () => {
  assert.match(builder, /chosen\.bytes\.byteLength > 8_000_000/);
  assert.match(builder, /bytes\.byteLength <= 4_800_000/);
  assert.match(builder, /stats\.meshes <= 120/);
  assert.match(builder, /stats\.meshes > 180/);
  assert.match(builder, /primitive\.getMode\(\) !== 4/);
  assert.match(builder, /stats\.nonTrianglePrimitives !== 0/);
  assert.doesNotMatch(builder, /center\(\{ pivot: "below" \}\)/);
  assert.match(builder, /assessGeoFrameIntegrity\(sourceBounds, stats\.bounds\)/);
  assert.match(builder, /coordinateFrame: "canonical-model-local-v1"/);
  assert.match(runtime, /metadata\.frameValidation\?\.ok !== true/);
});

test("textureless source drops only texture-dependent dead attributes", () => {
  assert.match(builder, /if \(!hasTextures\)/);
  assert.match(builder, /getAttribute\("TANGENT"\)\?\.dispose\(\)/);
  assert.match(builder, /semantic\.startsWith\("TEXCOORD_"\)/);
  assert.doesNotMatch(builder, /getAttribute\("NORMAL"\).*dispose/);
});
