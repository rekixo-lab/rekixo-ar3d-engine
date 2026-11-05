import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const ui=readFileSync(new URL("../apps/admin/src/geo/GeoPlotMapper.tsx",import.meta.url),"utf8");
const css=readFileSync(new URL("../apps/admin/src/geo/geo-plot-mapper.css",import.meta.url),"utf8");

test("Manual is the default for independent Front/Back/Depth selection",()=>{
  assert.match(ui,/sideEditKind,setSideEditKind\]=useState<"auto"\|"manual">\("manual"\)/);
  assert.match(ui,/const openManualSideEditor=\(\)=>/);
  assert.match(ui,/onClick=\{openManualSideEditor\}>Change Front/);
  assert.match(ui,/onClick=\{openManualSideEditor\}>Edit Sides/);
  assert.match(ui,/Manual · Independent/);
  assert.match(ui,/Auto · Reassign/);
  assert.match(ui,/role="group" aria-label="Choose logical side"/);
});

test("Manual Start → End only stages draft preview and does not silently setWorking",()=>{
  const manual=ui.slice(ui.indexOf("const selectManualCorner="),ui.indexOf("const previewManualSides="));
  assert.match(manual,/stageGeoManualSideRange\(/);
  assert.match(manual,/setManualSideLocks\(next\)/);
  assert.match(manual,/setManualProposal\(null\)/);
  assert.doesNotMatch(manual,/setWorking\(/);
  assert.match(ui,/aria-label="Manual start corner"/);
  assert.match(ui,/aria-label="Manual end corner"/);
  assert.match(ui,/className="geo-plot-manual-corner-hit"/);
  assert.match(ui,/selectManualCorner\(i\)/);
});

test("Auto Fill Rest previews first, Apply requires confirmation and source signature",()=>{
  const propose=ui.slice(ui.indexOf("const previewManualSides="),ui.indexOf("const applyManualSides="));
  const apply=ui.slice(ui.indexOf("const applyManualSides="),ui.indexOf("const assignSideOnCanvas="));
  assert.match(propose,/proposeGeoManualSideMapping\(working,manualSideLocks\)/);
  assert.doesNotMatch(propose,/setWorking\(/);
  assert.match(apply,/!previewIsCurrent/);
  assert.match(apply,/window\.confirm\(explanation\)/);
  assert.match(apply,/applyGeoManualSideProposal\(working,manualProposal\)/);
  assert.match(apply,/setWorking\(next\)/);
  assert.match(ui,/↻ Auto Fill Rest · Preview/);
  assert.match(ui,/✓ Apply Preview/);
  assert.match(ui,/Auto-filled roles:/);
  assert.match(ui,/Plot changed\. Auto Fill Rest again before applying\./);
});

test("Auto mode edge clicks cannot fire in Manual; labels don't overlap",()=>{
  assert.match(ui,/sideEditKind!=="auto"/);
  assert.match(ui,/pointerEvents=\{mode==="side"&&sideEditKind==="auto"\?"stroke":"none"\}/);
  assert.match(ui,/showGuides&&mode!=="side"&&ROLES/);
  assert.match(ui,/Manual · tap START corner/);
  assert.match(ui,/Manual · tap END corner/);
  assert.match(css,/\.geo-plot-manual-corner-hit/);
  assert.match(css,/\.geo-plot-manual-preview\{/);
});

test("save, undo, evidence and publish controls remain protected",()=>{
  assert.match(ui,/const confirmPlotAndNext=async\(\)=>/);
  assert.match(ui,/const readBack=await callApi<MappingState>\(api\)/);
  assert.match(ui,/const undoWorkingEdit=\(\)=>/);
  assert.match(ui,/const repairWorkingSides=\(\)=>/);
  assert.match(ui,/state\.draft\.verifiedInventoryRevision!==state\.inventoryRevision/);
  assert.match(ui,/execute\("publish"\)/);
  assert.match(ui,/execute\("publish-preliminary"\)/);
});
