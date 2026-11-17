import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mapper = readFileSync("apps/admin/src/geo/GeoMapper3DV2.tsx","utf8");
const simple = readFileSync("apps/admin/src/geo/GeoSimplePlacementTools.tsx","utf8");
const css = readFileSync("apps/admin/src/geo/geo-v2.css","utf8");
const aligned = readFileSync("apps/admin/src/geo/GeoGuidedRigidAlignment.tsx","utf8");

test("Fullscreen opens on simple model adjustment instead of the technical 4-point panel",()=>{
  assert.match(mapper,/setEditorTab\("fine"\)/);
  assert.match(mapper,/\["fine", "Adjust model"\]/);
  assert.match(mapper,/focusMode && editorTab === "fine" \? <GeoSimplePlacementTools/);
  assert.match(mapper,/onMatchPoints=\{\(\) => setEditorTab\("corners"\)\}/);
  assert.match(mapper,/\["position", "Advanced"\]/);
});

test("Size slider updates same unsaved scale used for full Geo preview, not viewport zoom or GLB",()=>{
  assert.match(simple,/aria-label="Model size on satellite map"/);
  assert.match(simple,/min="0\.05" max="3" step="0\.01"/);
  assert.match(simple,/onChange=\{\(event\) => onScale\(event\.target\.value\)\}/);
  assert.match(mapper,/onScale=\{\(value\) => patch\("scale", value\)\}/);
  assert.match(mapper,/form\.scale/);
  assert.match(mapper,/scale: formatFormNumber\(nextScale, 6\)/);
  assert.doesNotMatch(simple,/\bpublishGeoRelease\b|\bsaveGeoV2\b|\.glb/);
});

test("Size adjustment is intuitive and uniform, preserving older advanced survey controls",()=>{
  for(const factor of ["0.5","0.9","1.1","2"])
    assert.ok(simple.includes("scaleMultiplier: "+factor));
  for(const field of ["northM","eastM","headingDeg"])
    assert.ok(simple.includes(field));
  assert.match(aligned,/Reviewed site measurements · permit 0\.1–5× scale/);
  assert.match(mapper,/GeoGuidedRigidAlignment/);
  assert.match(mapper,/disabled=\{busy \|\| Boolean\(verificationBlocker\)\}/);
  assert.match(mapper,/disabled=\{busy \|\| !publishReady\}/);
});

test("Bad P1–P4 fit is visibly flagged and cannot silently auto-publish",()=>{
  assert.match(simple,/solveGeoGuidedRigidAlignment/);
  assert.match(simple,/fit\.errorM > 2/);
  assert.match(simple,/fit\.errorM <= 2/);
  assert.match(simple,/onApplyMeasuredFit\(fit\.solution!\)/);
  assert.match(mapper,/onApplyMeasuredFit=\{applyGuidedSolution\}/);
  assert.match(simple,/role="alert"/);
  assert.match(simple,/Re-pick matching corners/);
  assert.match(simple,/Nothing is published automatically/);
  assert.match(css,/\.geo-v2-simple-warning/);
});
