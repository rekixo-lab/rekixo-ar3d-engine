import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {summarizeApprovedGeoPlotStatuses} from "../shared/geo-plot-status.js";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const viewer=read("apps/public/src/geo/GeoPublicDemo.tsx");
const overlay=read("apps/public/src/geo/geoPlotModelOverlay.ts");
const css=read("apps/public/src/geo/geo-public-demo.css");
const server=read("workers/geo-plot-public.mjs");
const commercialServer=read("workers/geo-plot-commercial.mjs");

test("verified Geo mapping counts only source-approved facts by canonical mapped Plot ID",()=>{
  const plots=[{id:"1"},{id:"2"},{id:"3"},{id:"4"},{id:"5"},{id:"6"}];
  const mapping={publicationMode:"verified",plots,commercial:{
    "1":{status:"available"},"2":{status:"booked"},"3":{status:"sold"},
    "4":{status:"available"},"5":{status:"invalid"},"orphan":{status:"sold"}
  }};
  const result=summarizeApprovedGeoPlotStatuses(mapping);
  assert.deepEqual([result.total,result.available,result.booked,result.sold,
    result.approved,result.pending],[6,2,1,1,4,2]);
  assert.equal(Object.getPrototypeOf(result.statusById),null);
  assert.deepEqual(Object.keys(result.statusById),["1","2","3","4"]);
  assert.equal(result.statusById["orphan"],undefined);
});

test("preliminary, missing and unapproved records are never represented as Available",()=>{
  const plots=[{id:"17"},{id:"18"},{id:"19"}];
  for(const mapping of [
    {publicationMode:"preliminary",plots,commercial:{"17":{status:"available"}}},
    {publicationMode:"verified",plots},
    {plots,commercial:{"17":{status:"sold"}}}
  ]){
    const result=summarizeApprovedGeoPlotStatuses(mapping);
    assert.equal(result.total,3);
    assert.equal(result.approved,0);
    assert.equal(result.pending,3);
    assert.deepEqual([result.available,result.booked,result.sold],[0,0,0]);
    assert.deepEqual(Object.keys(result.statusById),[]);
  }
  assert.equal(summarizeApprovedGeoPlotStatuses(null).total,0);
});

test("Status toggle is bottom-left, OFF by default, animated without option backgrounds",()=>{
  assert.match(viewer,/useState\(false\)/);
  assert.match(viewer,/GEO_STATUS_OPTIONS\.map\(/);
  assert.match(viewer,/aria-controls="geo-plot-status-options" aria-expanded=\{statusEnabled\}/);
  assert.match(viewer,/onClick=\{\(\)=>setStatusFilter\(current=>current===item\.id\?null:item\.id\)\}/);
  assert.match(viewer,/if\(statusEnabled\)setStatusFilter\(null\)/);
  assert.match(viewer,/statusSummary\.total/);
  assert.match(viewer,/statusSummary\.approved===0\?"—"/);
  assert.doesNotMatch(viewer,/Status pending verification|statuses pending verification/);
  assert.doesNotMatch(viewer,/geo-plot-status-toggle-state|geo-plot-status-pending/);
  assert.match(viewer,/aria-label=\{statusEnabled\?"Hide plot status":"Show plot status"\}/);
  assert.match(viewer,/statusSummary\.approved===0\?"—"/);
  assert.match(css,/\.geo-public-toolbar-slot\{[^}]*background:transparent !important/);
  assert.ok(css.includes(".geo-integrated-scene:not(:fullscreen) > .geo-plot-status"));
  assert.match(css,/bottom:34px;[\s\S]*?bottom:29px;/);
  assert.doesNotMatch(css,/\.geo-plot-status-toggle-state\{|\.geo-plot-status-pending\{/);
  assert.match(css,/\.geo-plot-status\{[^}]*left:12px;bottom:58px/);
  assert.match(css,/\.geo-plot-status-options\{[^}]*background:transparent/);
  assert.match(css,/\.geo-plot-status-option\{[^}]*background:transparent/);
  assert.match(css,/\.geo-plot-status-toggle\{[^}]*background:#061d27ef/);
  assert.match(css,/\.geo-plot-status\.is-open \.geo-plot-status-options/);
  assert.match(css,/prefers-reduced-motion:reduce/);
});

test("Status colors use existing GLB-local overlay and preserve map click geometry",()=>{
  assert.match(viewer,/summarizeApprovedGeoPlotStatuses\(/);
  assert.match(viewer,/data\.plotMapping\?\.geoReleaseId===data\.geoRelease\.id/);
  assert.match(viewer,/candidateLayer\.setStatusPresentation\(enabled,filter,statusSummary\.statusById\)/);
  assert.match(viewer,/overlay\?\.requestRedraw\(\)/);
  assert.match(overlay,/available:tinted\(0x1cd680/);
  assert.match(overlay,/booked:tinted\(0xf2bf25/);
  assert.match(overlay,/sold:tinted\(0xf04b58/);
  assert.match(overlay,/filter&&valid!==filter\?palette\.dim/);
  assert.match(overlay,/parts\.fill\.material=style\.fill/);
  assert.match(overlay,/parts\.outline\.material=style\.stroke/);
  assert.match(overlay,/depthTest:true,depthWrite:false/g);
  assert.match(viewer,/pickModelGeoPlot\(/);
  assert.match(viewer,/setSelectedPlot\(plotIds\.get\(id\)\|\|null\)/);
  assert.doesNotMatch(viewer,/new google\.maps\.Polygon/);
});

test("commercial facts remain approval-gated at the server, no fabricated status or private data",()=>{
  assert.match(server,/commercial=publicationMode==="verified"/);
  assert.match(server,/publicGeoCommercialForRelease/);
  assert.match(commercialServer,/public_approved=1/);
  assert.match(viewer,/selectedPlot\.area&&/);
  assert.doesNotMatch(viewer,/geo-plot-public-controls/);
  assert.doesNotMatch(css,/\.gm-style-cc\s*\{/);
});
