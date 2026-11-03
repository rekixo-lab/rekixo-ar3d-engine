import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const grass = fs.readFileSync("apps/public/src/viewer/grassGroundCover.ts", "utf8");
const site = fs.readFileSync("apps/public/src/viewer/siteEnvironment.ts", "utf8");
const viewer = fs.readFileSync("apps/public/src/viewer/Viewer3D.tsx", "utf8");
const documentation = fs.readFileSync("docs/UNIVERSAL-GRASS-CURVED-HORIZON.md", "utf8");

test("universal grass uses the requested real-world 1, 2 and 3 inch tiers", () => {
  assert.match(grass, /GRASS_HEIGHTS_METRES = \[0\.0254, 0\.0508, 0\.0762\]/);
  assert.match(grass, /Universal grass blades/);
  assert.match(grass, /grassBladeTierCounts/);
});

test("the lawn underlay and curved horizon stay in a bounded low-poly presentation mesh", () => {
  assert.match(grass, /createCurvedGroundGeometry/);
  assert.match(grass, /baseSegments = mobile \? 64 : 112/);
  assert.match(grass, /rings = mobile \? 22 : 36/);
  assert.match(grass, /vertexColors: true/);
  assert.match(grass, /proceduralSurfaceTexture\("grass"\)/);
  assert.match(grass, /presentationOnly = true/);
  assert.match(grass, /nonAuthoritative = true/);
});

test("grass instances avoid reviewed road, parking and path footprints", () => {
  assert.match(site, /item\.kind === "road" \|\| item\.kind === "parking" \|\| item\.kind === "path"/);
  assert.match(site, /excludedAreas: grassExcludedAreas/);
  assert.match(site, /kind: "building-footprint"/);
  assert.match(site, /const modelSize = buildingBounds\.getSize/);
  assert.match(site, /footprintBounds: buildingBounds/);
  assert.match(viewer, /deriveBuildingFootprintBounds\(/);
  assert.match(viewer, /deriveBuildingFootprintOutline\(/);
  assert.match(viewer, /false, \/\/ No flat\/curved artificial grass[\s\S]*buildingFootprintBounds,\s+buildingFootprintOutline,/);
  assert.match(site, /footprintOutline: buildingOutline/);
  assert.match(site, /width: modelSize\.x,[\s\S]*depth: modelSize\.z/);
  assert.match(grass, /excludedAreas\.some\(\(area\) => containsArea/);
  assert.match(grass, /surfaceYFor\(worldX, worldZ, groundElevation, lawnAreas\)/);
});

test("customer Building viewer does not generate a large artificial ground under any source model", () => {
  assert.match(site, /universalGroundCover = false/);
  assert.match(site, /if \(universalGroundCover && !bounds\.isEmpty\(\) && safeGround\)/);
  assert.match(viewer, /environmentProfile\?\.landscape \?\? "auto",\s+false, \/\/ No flat\/curved artificial grass/);
  assert.match(site, /includeGround: false,[\s\S]*includeSurroundingGround: false/);
});

test("implementation documents that the horizon is cosmetic rather than plot-survey geometry", () => {
  assert.match(documentation, /presentation-only/i);
  assert.match(documentation, /surveyed plot boundary/i);
  assert.match(documentation, /road|parking|path/i);
});
