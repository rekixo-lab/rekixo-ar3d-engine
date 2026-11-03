import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

const read=(file)=>readFileSync(file,"utf8");

test("public Building frontend does not add the four evenly spaced decorative entrance pots",()=>{
  const fallback=read("apps/public/src/viewer/presentationEnvironment.ts");
  const site=read("apps/public/src/viewer/siteEnvironment.ts");
  assert.match(fallback,/const includePlants = options\.includePlants \?\? false/);
  assert.match(site,/includePlants: false, \/\/ Never add the four synthetic entrance-side pots/);
  assert.match(site,/includePlants: false, \/\/ Keep the frontage clear across every camera preset/);
  // Source-backed foliage is still rendered only when supplied by the immutable Studio site release.
  assert.match(site,/const plants = elements\.filter\(\(item\) => item\.kind === "plant"\)/);
  assert.match(site,/addPlantBatches\(root, plants, mobile\)/);
});

test("customer building keeps green grass but excludes artificial flat slabs and entrance pots",()=>{
  const site=read("apps/public/src/viewer/siteEnvironment.ts");
  const viewer=read("apps/public/src/viewer/Viewer3D.tsx");
  assert.match(site,/universalGroundCover = presentation/);
  assert.match(site,/if \(universalGroundCover && !bounds\.isEmpty\(\) && safeGround\)/);
  assert.match(viewer,/environmentProfile\?\.landscape \?\? "auto",\s+clientPresentation,/);
  assert.match(site,/includeGround: false,[\s\S]*includeSurroundingGround: false/);
  // Keep existing green lawn strips and the reviewed landscape; never cover an entrance.
  assert.match(site,/includeLawn: landscapePreset !== "rural-farm" && !hasLawn/);
  assert.match(site,/addAreaBatches\(root, areas\)/);
  assert.match(site,/gates\.forEach\(\(item\) => addGate\(root, item, mobile\)\)/);
});

test("all public exterior shots share the same source-preserving Building scene",()=>{
  const viewer=read("apps/public/src/viewer/Viewer3D.tsx");
  const site=read("apps/public/src/viewer/siteEnvironment.ts");
  assert.match(viewer,/siteEnvironment = siteEnvironmentModule\.createArchitecturalSiteEnvironment\(/);
  assert.match(viewer,/scene\.add\(siteEnvironment\.root\)/);
  assert.match(site,/root\.userData\.sourceSiteGeometryIncluded = sourceSiteIncluded/);
});
