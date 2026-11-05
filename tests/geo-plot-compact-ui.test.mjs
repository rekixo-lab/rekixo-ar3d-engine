import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const ui=readFileSync(new URL("../apps/admin/src/geo/GeoPlotMapper.tsx",import.meta.url),"utf8");
const css=readFileSync(new URL("../apps/admin/src/geo/geo-plot-mapper.css",import.meta.url),"utf8");

test("mapper opens in compact Mapping workspace; CSV and review/publish remain available",()=>{
  assert.match(ui,/useState<"sources"\|"plot"\|"quality"\|"publish">\("plot"\)/);
  assert.match(ui,/Plot Mapper workspaces/);
  for(const title of ["Mapping","CSV / Image","Review & Publish","Quality Review","Publish"])
    assert.ok(ui.includes(">"+title+"</button>"),title);
  assert.match(ui,/inspectorTab==="publish"/);
  assert.match(ui,/inspectorTab==="quality"/);
  // Sources must fetch data even when Mapping is the initial visible workspace.
  assert.match(ui,/className="geo-plot-source-workspace" hidden=\{inspectorTab!=="sources"\}/);
  assert.match(ui,/onRowsChange=\{onInventoryRowsChange\}/);
});

test("normal sidebar is summary-first, with one Save & Next and optional advanced editing",()=>{
  assert.match(ui,/Current plot summary/);
  assert.match(ui,/geo-plot-compact-dimensions/);
  assert.match(ui,/geo-plot-compact-area/);
  assert.match(ui,/geo-plot-advanced-details/);
  assert.match(ui,/advancedDetailsRef/);
  assert.match(ui,/geo-plot-inventory-browser/);
  assert.match(ui,/geo-plot-toolbar-more/);
  assert.equal((ui.match(/className="geo-plot-confirm-primary/g)||[]).length,1);
  assert.equal((ui.match(/aria-label="Change Front by tapping plot edge"/g)||[]).length,1);
  assert.equal((ui.match(/onClick=\{\(\)=>void confirmPlotAndNext\(\)\}/g)||[]).length,1);
  assert.match(ui,/role==="depthA"\?"Depth A"/);
  assert.match(ui,/Repair Sides · Keep Polygon/);
  assert.doesNotMatch(ui,/Smart sides · Plot \{working\.id\}/);
});

test("side edit tools are contextual, and untouched approvals remain guarded",()=>{
  assert.match(ui,/working&&mode==="side"&&working\.corners\.length>=3/);
  assert.match(ui,/sideCoverage&&!sideCoverage\.ok/);
  assert.match(ui,/Area mismatch \{\(Math\.abs\(variance\)\*100\)/);
  assert.match(ui,/working\.facingVerified&&working\.facingSource/);
  assert.match(ui,/Source Reconciliation/);
  assert.match(ui,/inventoryIssues\.length>0/);
  assert.match(ui,/const confirmPlotAndNext=async\(\)=>/);
  assert.match(ui,/const readBack=await callApi<MappingState>\(api\)/);
  assert.match(ui,/const repairWorkingSides=/);
  assert.match(ui,/execute\("publish-preliminary"\)/);
  assert.match(ui,/execute\("publish"\)/);
});

test("fullscreen and mobile preserve canvas, sidebar and accessible manual tools",()=>{
  assert.match(css,/\.geo-plot-compact-card\{/);
  assert.match(css,/\.geo-plot-toolbar-more-menu\{/);
  assert.match(css,/\.geo-plot-help:not\(\[open\]\)>\*:not\(summary\)/);
  assert.match(css,/\.geo-plot-advanced-details:not\(\[open\]\)>\*:not\(summary\)/);
  assert.match(css,/\.geo-plot-advanced-details/);
  assert.match(css,/grid-template-columns:minmax\(0,4fr\) minmax\(288px,1fr\)/);
  assert.match(css,/@media\(max-width:950px\)/);
  assert.match(css,/@media\(max-width:620px\)/);
  assert.match(css,/:fullscreen \.geo-plot-workspace/);
  assert.match(ui,/geo-plot-confirm-primary geo-plot-compact-save/);
  assert.match(ui,/geo-plot-shortcuts geo-plot-help/);
});
