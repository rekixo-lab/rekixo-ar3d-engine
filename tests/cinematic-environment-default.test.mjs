import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

const read = (path) => fs.readFileSync(path, "utf8");

test("new Building presentation manifests receive a versioned additive cinematic profile", () => {
  const contract = read("packages/contracts/src/building-presentation-manifest-v1.ts");
  const planner = read("apps/admin/src/studio/buildingPresentationPlanner.ts");

  assert.match(contract, /interface BuildingEnvironmentProfileV1/);
  assert.match(contract, /format: "rekixo-environment-profile"/);
  assert.match(contract, /siteDataPolicy: "additive"/);
  assert.match(contract, /water: "opt-in" \| "off"/);
  assert.match(contract, /traffic: "opt-in" \| "off"/);
  assert.match(planner, /DEFAULT_BUILDING_ENVIRONMENT_PROFILE_V1/);
  assert.equal(
    (planner.match(/profile: structuredClone\(DEFAULT_BUILDING_ENVIRONMENT_PROFILE_V1\)/g) ?? []).length,
    2,
    "source-backed and generic projects must receive the same default profile",
  );
});

test("old customer releases get the default profile at runtime without rewriting their manifest", () => {
  const viewer = read("apps/public/src/viewer/Viewer3D.tsx");
  assert.match(viewer, /Historical V1 releases predate environment profiles/);
  assert.match(viewer, /buildingPresentation\?\.environment\.profile \?\?/);
  assert.match(viewer, /DEFAULT_BUILDING_ENVIRONMENT_PROFILE_V1/);
  assert.match(viewer, /buildingPresentation\?\.environment\.mode === "minimal"/);
  assert.match(viewer, /\(!includedSourceSite \|\| additiveBaseline\)/);
});

test("baseline environment layers are additive when reviewed site data is sparse", () => {
  const site = read("apps/public/src/viewer/siteEnvironment.ts");
  assert.match(site, /baselinePolicy: "empty-only" \| "always" = "empty-only"/);
  assert.match(site, /baselinePolicy === "always" \|\| elements\.length === 0/);
  assert.match(site, /includeRoad: landscapePreset !== "hillside" && !hasRoad/);
  assert.match(site, /includeSidewalk: landscapePreset !== "rural-farm" && landscapePreset !== "hillside" && !hasPath/);
  assert.match(site, /includeLawn: landscapePreset !== "rural-farm" && !hasLawn/);
  assert.match(site, /includeTrees: trees\.length === 0/);
  assert.match(site, /includePlants: false/);
  assert.match(site, /root\.userData\.presentationOnly = true/);
  assert.match(site, /createProceduralSurfaceMaterial/);
});

test("default roads, paths, ground and lawns use deterministic procedural surface detail", () => {
  const surfaces = read("apps/public/src/viewer/proceduralSurfaceMaterials.ts");
  const fallback = read("apps/public/src/viewer/presentationEnvironment.ts");
  const site = read("apps/public/src/viewer/siteEnvironment.ts");

  assert.match(surfaces, /new THREE\.DataTexture/);
  assert.match(surfaces, /textureCache\.get\(kind\)/);
  assert.match(surfaces, /textureCache\.set\(kind, texture\)/);
  assert.match(surfaces, /texture\.userData\.rekixoSharedResource = true/);
  const resourceDisposal = read("apps/public/src/viewer/viewerResources.ts");
  assert.match(resourceDisposal, /value\.userData\.rekixoSharedResource !== true/);
  assert.match(surfaces, /THREE\.SRGBColorSpace/);
  assert.doesNotMatch(surfaces, /Math\.random|fetch\(/);
  assert.match(fallback, /surfaceKindForName/);
  assert.match(site, /first\.kind === "road" \|\| first\.kind === "parking"/);
  assert.match(site, /first\.kind === "lawn" \|\| first\.kind === "garden"/);
});

test("only reviewed water-feature semantics become animated source-backed water surfaces", () => {
  const semantics = read("apps/admin/src/studio/siteSemantics.ts");
  const draft = read("apps/admin/src/studio/siteLandscapeDraft.ts");
  const contract = read("packages/contracts/src/index.ts");
  const runtimeValidation = read("packages/contracts/src/runtime-validation.ts");
  const sceneManifest = read("packages/contracts/src/scene-manifest-v2.ts");
  const siteRuntime = read("apps/public/src/viewer/publicRuntimeContext.ts");
  const site = read("apps/public/src/viewer/siteEnvironment.ts");
  const viewer = read("apps/public/src/viewer/Viewer3D.tsx");

  assert.match(semantics, /return "water"/);
  assert.match(draft, /\["garden", "lawn", "path", "road", "parking", "water"\]/);
  assert.match(contract, /\| "water"/);
  assert.match(runtimeValidation, /"water",\s*"column"/);
  assert.match(sceneManifest, /"water",\s*"column"/);
  assert.match(siteRuntime, /"water",\s*"column"/);
  assert.match(site, /const waterElements = elements\.filter\(\(item\) => item\.kind === "water"\)/);
  assert.match(site, /new THREE\.MeshPhysicalMaterial/);
  assert.match(site, /waterMaterial\.onBeforeCompile/);
  assert.match(site, /waterMotion = true/);
  assert.match(site, /surface\.material\.userData\.waterAnimationEnabled !== true/);
  assert.match(viewer, /environmentProfile\?\.preset === "cinematic-exterior" && environmentProfile\.motion\.water !== "off"/);
  assert.match(viewer, /siteEnvironment\?\.update\(delta\)/);
  assert.doesNotMatch(read("apps/public/src/viewer/presentationEnvironment.ts"), /Presentation water|generated water pool/i);
});

test("generated vegetation motion is wired to the customer render loop and respects reduced motion", () => {
  const motion = read("apps/public/src/viewer/premiumPresentationMotion.ts");
  const viewer = read("apps/public/src/viewer/Viewer3D.tsx");
  const sky = read("apps/public/src/viewer/exteriorSky.ts");

  assert.match(motion, /environmentRoot\.userData\.presentationOnly !== true/);
  assert.match(motion, /options\.reducedMotion/);
  assert.match(motion, /object\.name === "Site tree foliage"/);
  assert.match(motion, /object\.name === "Site plant foliage"/);
  assert.match(motion, /uRekixoWindTime/);
  assert.match(motion, /uRekixoWindStrength/);
  assert.match(motion, /#ifdef USE_INSTANCING/);
  assert.doesNotMatch(motion, /target\.object\.rotation\.(x|z) =/);
  assert.match(viewer, /createPremiumPresentationMotion\(siteEnvironment\.root/);
  assert.match(viewer, /presentationMotion\?\.update\(delta\)/);
  assert.match(viewer, /presentationMotion\?\.dispose\(\)/);
  assert.match(viewer, /environmentProfile\.motion\.vegetation !== "off"/);
  assert.match(sky, /createExteriorSky\(reducedMotion: boolean, driftClouds = true\)/);
  assert.match(sky, /!reducedMotion && driftClouds/);
});

test("customer camera and generated outdoor surfaces stay stable while zooming and orbiting", () => {
  const camera = read("apps/public/src/viewer/viewerCamera.ts");
  const viewer = read("apps/public/src/viewer/Viewer3D.tsx");
  const surfaces = read("apps/public/src/viewer/proceduralSurfaceMaterials.ts");
  const site = read("apps/public/src/viewer/siteEnvironment.ts");
  const fallback = read("apps/public/src/viewer/presentationEnvironment.ts");

  assert.match(camera, /export function updateCameraDepthRange/);
  assert.match(camera, /camera\.near = near/);
  assert.match(camera, /camera\.far = far/);
  assert.match(viewer, /updateCameraDepthRange\(camera, controls\.target, modelBounds\)/);
  assert.match(surfaces, /configureProceduralSurfaceTextures/);
  assert.match(surfaces, /texture\.anisotropy = configuredAnisotropy/);
  assert.match(surfaces, /texture\.repeat\.set\(4, 4\)/);
  assert.match(site, /createUniversalGrassGroundCover/);
  assert.match(site, /includeGround: false/);
  assert.match(site, /includeSurroundingGround: false/);
  assert.match(site, /configureProceduralSurfaceTextures\(renderer\)/);
  assert.match(fallback, /includeSurroundingGround\?: boolean/);
  assert.match(fallback, /if \(includeGround\)/);
  assert.match(fallback, /if \(includeSurroundingGround\)/);
});


test("customer exterior sky animates a warm sunrise with layered clouds and synchronized lighting", () => {
  const sky = read("apps/public/src/viewer/exteriorSky.ts");
  const viewer = read("apps/public/src/viewer/Viewer3D.tsx");

  assert.match(sky, /export interface ExteriorSolarState/);
  assert.match(sky, /sunriseElapsed < 45/);
  assert.match(sky, /updateSolar\(solarTime\)/);
  assert.doesNotMatch(sky, /setTimeOfDay/);
  assert.match(sky, /uniform vec3 sunDirection/);
  assert.match(sky, /uniform float goldenHour/);
  assert.match(sky, /float horizonGlow/);
  assert.match(sky, /float lowCloud/);
  assert.match(sky, /float highCloud/);
  assert.match(sky, /!reducedMotion && driftClouds/);
  assert.match(viewer, /sun\.position\.copy\(solar\.direction\)/);
  assert.match(viewer, /sun\.color\.lerpColors\(dawnSunColor, daySunColor, solar\.daylight\)/);
  assert.match(viewer, /scene\.fog\.color\.lerpColors\(dawnFogColor, dayFogColor, solar\.daylight\)/);
  assert.match(viewer, /if \(sky && !currentNight\)/);
});

test("customer exterior supports release-bound urban, suburban, farm, and hillside context presets", () => {
  const contract = read("packages/contracts/src/building-presentation-manifest-v1.ts");
  const fallback = read("apps/public/src/viewer/presentationEnvironment.ts");
  const site = read("apps/public/src/viewer/siteEnvironment.ts");
  const viewer = read("apps/public/src/viewer/Viewer3D.tsx");

  assert.match(contract, /export type BuildingEnvironmentLandscapeV1/);
  assert.match(contract, /landscape\?: BuildingEnvironmentLandscapeV1/);
  assert.match(contract, /landscape: "auto"/);
  assert.match(contract, /"rural-farm"[\s\S]*"hillside"/);
  assert.match(fallback, /export type PresentationLandscapePreset/);
  assert.match(fallback, /function addFarmFields/);
  assert.match(fallback, /function addHillsideBackdrop/);
  assert.match(fallback, /function addUrbanContext/);
  assert.match(fallback, /Presentation farm field rows/);
  assert.match(fallback, /landscape !== "rural-farm"/);
  assert.match(site, /landscapePreset: PresentationLandscapePreset = "auto"/);
  assert.match(site, /landscapePreset !== "hillside" && !hasRoad/);
  assert.match(viewer, /environmentProfile\?\.landscape \?\? "auto"/);
});

const require = createRequire(import.meta.url);
const threeUrl = pathToFileURL(
  path.join(path.dirname(require.resolve("three")), "three.module.js"),
).href;
const gateInteractionCode = ts.transpileModule(
  read("apps/public/src/viewer/siteInteractionController.ts"),
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText.replaceAll('from "three"', `from "${threeUrl}"`);
const gateInteractions = await import(
  "data:text/javascript;base64," +
  Buffer.from(gateInteractionCode).toString("base64"),
);

test("customer runtime attaches click-to-open gate leaves only for the cinematic profile", () => {
  const site = read("apps/public/src/viewer/siteEnvironment.ts");
  const viewer = read("apps/public/src/viewer/Viewer3D.tsx");
  const controller = read("apps/public/src/viewer/siteInteractionController.ts");
  assert.match(site, /function addGate\(/);
  assert.match(site, /kind: "gate-leaf"/);
  assert.match(site, /Site gate leaf left hinge/);
  assert.match(site, /Site gate leaf right hinge/);
  assert.match(viewer, /createSiteInteractionController\(\s*siteEnvironment\.root/);
  assert.match(viewer, /siteInteractionController\?\.update\(delta\)/);
  assert.match(viewer, /siteInteractionController\?\.dispose\(\)/);
  assert.match(controller, /raycaster\.intersectObject\(root, true\)/);
  assert.match(controller, /event\.stopPropagation\(\)/);
  assert.match(controller, /reducedMotion/);
});

test("generated site gate leaves open on click, animate smoothly, and restore on disposal", () => {
  const THREE = require("three");
  const root = new THREE.Group();
  const pivot = new THREE.Group();
  pivot.userData.siteInteraction = {
    kind: "gate-leaf",
    closedAngle: 0,
    openAngle: -1.4,
  };
  const leaf = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1.8, 0.08),
    new THREE.MeshStandardMaterial(),
  );
  pivot.add(leaf);
  root.add(pivot);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0.5, 5);
  camera.lookAt(0, 0.5, 0);
  camera.updateMatrixWorld(true);
  root.updateMatrixWorld(true);

  const callbacks = new Map();
  const canvas = {
    style: { cursor: "" },
    addEventListener(name, callback) { callbacks.set(name, callback); },
    removeEventListener(name) { callbacks.delete(name); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; },
  };
  const controller = gateInteractions.createSiteInteractionController(
    root,
    camera,
    canvas,
    false,
  );
  assert.equal(controller.gateCount, 1);
  let defaultPrevented = false;
  let propagationStopped = false;
  callbacks.get("click")({
    button: 0,
    clientX: 50,
    clientY: 50,
    preventDefault() { defaultPrevented = true; },
    stopPropagation() { propagationStopped = true; },
  });
  assert.equal(defaultPrevented, true);
  assert.equal(propagationStopped, true);
  controller.update(0.05);
  assert.ok(pivot.rotation.y < -0.05, "gate pivot should begin its smooth opening arc");
  controller.update(0.05);
  controller.update(0.05);
  assert.ok(pivot.rotation.y < -0.3, "gate should continue opening over multiple frames");
  controller.dispose();
  assert.equal(pivot.rotation.y, 0);
  assert.equal(callbacks.has("click"), false);
  leaf.geometry.dispose();
  leaf.material.dispose();
});


test("customer exterior keeps sunrise cinematic without exposing a time-of-day slider UI", () => {
  const viewer = read("apps/public/src/viewer/Viewer3D.tsx");
  const sky = read("apps/public/src/viewer/exteriorSky.ts");
  const styles = read("apps/public/src/styles.css");

  assert.doesNotMatch(viewer, /formatSolarTime|timeOfDayRef|solarTimeOfDay|viewer-time-of-day/);
  assert.doesNotMatch(sky, /setTimeOfDay|normalizedHour/);
  assert.ok(!styles.includes(".viewer-time-of-day"));
  const productionSmoke = read("e2e/production-floor-controls.spec.ts");
  assert.ok(productionSmoke.includes('page.locator(".viewer-time-of-day")'));
  assert.ok(productionSmoke.includes("Customer exterior must not expose the manual lighting-time slider"));
  assert.match(sky, /sunriseElapsed < 45/);
  assert.ok(viewer.includes("sun.position.copy(solar.direction)"));
});



test("exterior presentation does not generate added neighborhood building blocks", () => {
  const fallback = read("apps/public/src/viewer/presentationEnvironment.ts");
  const helperSection = fallback.slice(0, fallback.indexOf("export interface PresentationFallbackOptions"));

  assert.doesNotMatch(helperSection, /function addNeighborhoodContext|function addNeighborhoodBuilding|Presentation neighborhood windows/);
  assert.ok(fallback.includes('if (landscape === "urban") {\n    addUrbanContext(root, center, baseY, span, mobile);\n  }'));
  assert.ok(fallback.includes('const includeCars = options.includeCars ?? landscape === "urban";'));
});
