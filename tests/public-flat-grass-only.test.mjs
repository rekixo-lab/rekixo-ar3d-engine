import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
const read=path=>readFileSync(path,"utf8");

test("public customer 3D scene selects flat grass-only mode across all camera views",()=>{
  const viewer=read("apps/public/src/viewer/Viewer3D.tsx");
  const site=read("apps/public/src/viewer/siteEnvironment.ts");
  assert.match(viewer,/siteEnvironmentModule\.createArchitecturalSiteEnvironment\(/);
  assert.match(viewer,/buildingFootprintOutline,\s+clientPresentation, \/\/ Flat-grass-only/);
  assert.match(site,/grassOnlyPresentation = false/);
  assert.match(site,/if \(grassOnlyPresentation\) \{/);
  assert.match(site,/root\.userData\.environmentMode = "flat-grass-only"/);
  assert.match(site,/flatSurface: true/);
  // Customer scene exits before the non-customer site renderer can create any
  // roads, street furniture, plants, trees or extra presentation surfaces.
  const exit=site.indexOf('if (grassOnlyPresentation) {');
  const originalFallback=site.indexOf('  const shouldAddBaseline =');
  const originalBatches=site.indexOf("  addAreaBatches(root, areas);");
  assert.ok(exit>0&&exit<originalFallback&&originalFallback<originalBatches);
  const early=site.slice(exit,originalFallback);
  assert.match(early,/return \{/);
  for(const forbidden of ["addPresentationFallback(", "addAreaBatches(", "addTreeBatches(",
    "addPlantBatches(", "addGate(", "addOutdoorLights(", "addWaterSurfaces(", "addStructuralBatches("]){
    assert.equal(early.includes(forbidden),false,"No "+forbidden+" in grass-only branch");
  }
});

test("flat terrain is uniformly green, has no curved rise and protects source model footprint",()=>{
  const grass=read("apps/public/src/viewer/grassGroundCover.ts");
  const site=read("apps/public/src/viewer/siteEnvironment.ts");
  assert.match(grass,/flatSurface\?: boolean/);
  assert.match(grass,/const rise = flatSurface \? 0/);
  assert.match(grass,/const tint = flatSurface\s+\? turfNear\.clone\(\)/);
  assert.match(grass,/flatSurface \? "Flat green grass surface"/);
  assert.match(grass,/root\.userData\.flatGrassOnly = flatSurface/);
  const branch=site.split("if (grassOnlyPresentation) {")[1].split("// Basement bounds")[0];
  assert.match(branch,/footprintBounds: buildingBounds/);
  assert.match(branch,/footprintOutline: buildingOutline/);
  assert.match(branch,/kind: "building-footprint"/);
  assert.match(branch,/excludedAreas: exclusions/);
  assert.match(branch,/lawnAreas: \[\]/);
  assert.match(branch,/grassCover\?\.setNight\(night\)/);
  assert.doesNotMatch(branch,/getPublicRuntimeSiteElements\(\)\.filter|addAreaBatches\(root/);
});

test("source model and non-customer editing workflows remain untouched",()=>{
  const viewer=read("apps/public/src/viewer/Viewer3D.tsx");
  const site=read("apps/public/src/viewer/siteEnvironment.ts");
  assert.match(viewer,/scene\.add\(siteEnvironment\.root\)/);
  assert.match(site,/addAreaBatches\(root, areas\)/);
  assert.match(site,/addTreeBatches\(root, trees, mobile\)/);
  assert.match(site,/addPlantBatches\(root, plants, mobile\)/);
  assert.match(site,/const grassExcludedAreas: GrassCoverArea\[\]/);
  assert.match(site,/root\.userData\.sourceSiteGeometryIncluded = sourceSiteIncluded/);
  assert.match(viewer,/clientPresentation, \/\/ Restore grass cover in all customer camera views/);
});
