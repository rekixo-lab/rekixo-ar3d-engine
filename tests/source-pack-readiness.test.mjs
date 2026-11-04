import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const compile = (path) =>
  ts.transpileModule(fs.readFileSync(path, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

const asUrl = (code) =>
  "data:text/javascript;base64," + Buffer.from(code).toString("base64");

const { evaluateSourcePackReadiness } = await import(
  asUrl(compile("apps/admin/src/studio/sourcePackReadiness.ts")),
);

function asset(id, name, type = "application/octet-stream") {
  const blob = new Blob(["fixture"], { type });
  return {
    id,
    projectId: "project-1",
    name,
    type,
    size: blob.size,
    hash: "a".repeat(64),
    blob,
  };
}

function project(modelId) {
  return {
    id: "project-1",
    name: "Acceptance project",
    location: "",
    referenceUrl: "",
    brief: "",
    assets: [],
    scene: {
      version: 1,
      modelId,
      modelTransform: { x: 0, y: 0, z: 0, rotationY: 0 },
      scale: 1,
      floors: [{ id: "floor-0", name: "Ground", elevation: 0 }],
      rooms: [],
      furniture: [],
      walls: [],
      openings: [],
      referenceLayers: [],
      materialOverrides: [],
      lighting: {},
    },
  };
}

test("six-role customer source pack is ready for generic automatic building", () => {
  const files = [
    asset("fbx", "building-source.fbx"),
    asset("dwg", "architectural-first-floor.dwg", "image/vnd.dwg"),
    asset("skb", "design-backup.skb"),
    asset("pdf", "brochure-floor-plan.pdf", "application/pdf"),
    asset("jpg", "exterior-reference.jpg", "image/jpeg"),
    asset("drs", "render-scene.drs", "application/json"),
  ];
  const fusion = {
    createdAt: new Date().toISOString(),
    items: [
      {
        assetId: "fbx",
        name: "building-source.fbx",
        extension: "fbx",
        kind: "authoring-model",
        support: "partial",
        capabilities: ["geometry"],
        findings: [],
        warnings: [],
      },
      {
        assetId: "dwg",
        name: "architectural-first-floor.dwg",
        extension: "dwg",
        kind: "cad",
        support: "needs-conversion",
        capabilities: ["walls"],
        findings: [],
        warnings: [],
      },
      {
        assetId: "skb",
        name: "design-backup.skb",
        extension: "skb",
        kind: "sketchup",
        support: "needs-conversion",
        capabilities: ["materials"],
        findings: [],
        warnings: [],
      },
      {
        assetId: "pdf",
        name: "brochure-floor-plan.pdf",
        extension: "pdf",
        kind: "drawing",
        support: "evidence-only",
        capabilities: ["dimensions"],
        findings: [],
        warnings: [],
      },
      {
        assetId: "jpg",
        name: "exterior-reference.jpg",
        extension: "jpg",
        kind: "visual-reference",
        support: "evidence-only",
        capabilities: ["visual-style"],
        findings: [],
        warnings: [],
      },
      {
        assetId: "drs",
        name: "render-scene.drs",
        extension: "drs",
        kind: "metadata",
        support: "partial",
        capabilities: ["metadata"],
        findings: [],
        warnings: [],
      },
    ],
    facts: [],
    readySources: 0,
    partialSources: 1,
    evidenceOnlySources: 0,
    needsConversionSources: 2,
    reviewCount: 0,
    conflicts: [],
    recommendedActions: [],
  };

  const result = evaluateSourcePackReadiness(project("fbx"), files, fusion);
  assert.equal(result.completeSupportPack, true);
  assert.equal(result.sourceIntegrityReady, true);
  assert.equal(result.pipelineState, "ready");
  assert.equal(result.autoBuildReady, true);
  assert.equal(result.blockingIssues.length, 0);
  assert.equal(result.roles.filter((role) => role.present).length, 6);
  assert.ok(result.reviewIssues.some((issue) => /DWG/.test(issue)));
  assert.ok(result.reviewIssues.some((issue) => /SketchUp/.test(issue)));
});

test("source-record integrity failure blocks automatic building", () => {
  const model = asset("fbx", "building.fbx");
  model.hash = "not-a-sha256";
  const result = evaluateSourcePackReadiness(project("fbx"), [model]);
  assert.equal(result.sourceIntegrityReady, false);
  assert.equal(result.pipelineState, "blocked");
  assert.equal(result.autoBuildReady, false);
  assert.ok(
    result.blockingIssues.some((issue) => /integrity checks/.test(issue)),
  );
});

test("multiple unselected 3D sources block one-click automatic building without guessing", () => {
  const files = [
    asset("fbx-1", "building-a.fbx"),
    asset("fbx-2", "building-b.fbx"),
  ];
  const result = evaluateSourcePackReadiness(project(undefined), files);
  assert.equal(result.autoBuildReady, false);
  assert.ok(
    result.blockingIssues.some((issue) =>
      /Multiple 3D models/.test(issue),
    ),
  );
});

test("one CAD source can start model-less AutoBuild without inventing a 3D model", () => {
  const files = [asset("dxf", "ground-floor.dxf", "application/dxf")];
  const result = evaluateSourcePackReadiness(project(undefined), files);
  assert.equal(result.sourceIntegrityReady, true);
  assert.equal(result.pipelineState, "ready");
  assert.equal(result.autoBuildReady, true);
  assert.equal(result.blockingIssues.length, 0);
  assert.ok(result.reviewIssues.some((issue) => /No 3D model/.test(issue)));
});

test("multiple CAD sources reach model-less AutoBuild only for semantic floor-role validation", () => {
  const files = [
    asset("dxf-1", "ground-floor.dxf", "application/dxf"),
    asset("dxf-2", "first-floor.dxf", "application/dxf"),
  ];
  const result = evaluateSourcePackReadiness(project(undefined), files);
  assert.equal(result.pipelineState, "ready");
  assert.equal(result.autoBuildReady, true);
  assert.equal(result.blockingIssues.length, 0);
  assert.ok(
    result.reviewIssues.some((issue) => /unique explicit floor identity/.test(issue)),
  );
});

test("source-pack readiness stays generic and does not encode customer names or hashes", () => {
  const source = fs.readFileSync(
    "apps/admin/src/studio/sourcePackReadiness.ts",
    "utf8",
  );
  assert.doesNotMatch(source, /jyoti|paradise|source-profile|sha256/i);
  assert.match(source, /completeSupportPack/);
  assert.match(source, /autoBuildReady/);
  assert.match(source, /DWG/);
  assert.match(source, /SketchUp/);
});

test("Automatic Engine browser smoke enforces the source-decision product boundary", () => {
  const review = fs.readFileSync(
    "apps/admin/src/source-pack/SourcePackReview.tsx",
    "utf8",
  );
  const e2e = fs.readFileSync("e2e/automatic-engine-entry.spec.ts", "utf8");

  assert.match(review, /Use This Model & Prepare/);
  assert.match(review, /geometry-authority/);
  assert.match(review, /current LIVE Building release, Geo mapping, Plot IDs and customer status/);
  assert.match(e2e, /3D Model/);
  assert.match(e2e, /Source Pack/);
  assert.match(e2e, /Smart 3D project builder/);
  assert.match(e2e, /3D editor tools/);
});
