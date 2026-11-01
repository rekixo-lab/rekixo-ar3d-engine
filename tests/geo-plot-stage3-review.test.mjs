import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {validateGeoPlotCollection} from "../workers/geo-plot-geometry.mjs";
import {cloneUnverifiedGeoPlot,geoPlotEvidenceManifest,geoPlotQualityReport} from "../shared/geo-plot-stage3-review.js";

const side=(index,road=false)=>({edges:[index],length:10,unit:"m",source:"Signed plot survey p5",verified:true,roadFacing:road});
const previous=()=>({id:"1",corners:[[0,0],[10,0],[10,10],[0,10]],layout:"four",
  sides:{front:side(0,true),depthA:side(1),back:side(2),depthB:side(3)},
  area:{value:100,unit:"sqm",source:"Signed plot survey p5",verified:true},
  facing:"east",facingSource:"Survey north",facingVerified:true,road:"23ft road",
  planeY:0,planeSource:"Sealed model datum",planeVerified:true,notes:"Approved plot"});
const row=(id,override={})=>({id,area:110,areaUnit:"sqm",areaSource:"Approved plan sheet 2",
  front:11,back:11,depthA:10,depthB:10,lengthUnit:"m",
  measurementSource:"Approved survey sheet 2",road:"20 feet road",
  facing:"north",facingSource:"Signed north",dimensions:"11 x 10",notes:"",
  ...override});
test("Clone Previous uses next canonical inventory ID and only an explicit non-overlapping X/Z translation",()=>{
  const first=previous(), second=cloneUnverifiedGeoPlot(first,"2",10,0,[row("2")],[first]);
  assert.deepEqual(second.corners,[[10,0],[20,0],[20,10],[10,10]]);
  assert.equal(second.id,"2");
  assert.equal(second.area.value,110,"new plot approved CSV is used as source suggestion");
  assert.equal(second.area.source,"Approved plan sheet 2");
  assert.equal(second.area.verified,false);
  assert.equal(second.facing,"north");
  assert.equal(second.facingVerified,false);
  assert.equal(second.planeVerified,false);
  assert.equal(second.planeSource,"");
  assert.equal(second.road,"20 feet road");
  assert.equal(second.sides.front.length,11);
  assert.equal(second.sides.front.source,"Approved survey sheet 2");
  assert.ok(Object.values(second.sides).every(s=>!s.verified&&!s.roadFacing));
  assert.deepEqual(first,previous(),"source plot stays unchanged");
  assert.deepEqual(validateGeoPlotCollection([first,second]).map(p=>p.id),["1","2"],
    "shared perimeter is permitted but never a positive-area overlap");
  assert.throws(()=>validateGeoPlotCollection([second],{forPublish:true}),
    /verify|road-facing|site plane/i);
});
test("No CSV for new Plot ID means original signed survey source is NEVER copied as authority",()=>{
  const old=previous(), clone=cloneUnverifiedGeoPlot(old,"2",10,0,[],[old]);
  assert.equal(clone.area.source,"");
  assert.equal(clone.facingSource,"");
  assert.equal(clone.road,"");
  assert.ok(Object.values(clone.sides).every(x=>x.source===""));
  assert.ok(clone.notes.includes("Plot 1"));
});
test("Zero, invalid offsets, duplicates and overlapping clones fail before changing any draft",()=>{
  const a=previous(), snapshot=structuredClone(a);
  for(const [id,x,z,pattern] of [
    ["1",10,0,/already mapped/],["2",0,0,/non-zero/],["2",5,0,/overlaps/],
    ["2",NaN,0,/finite/],["2",Infinity,0,/finite/],["2",10001,0,/10,000/],
    ["../x",10,0,/valid new canonical/]
  ])assert.throws(()=>cloneUnverifiedGeoPlot(a,id,x,z,[],[a]),pattern);
  assert.deepEqual(a,snapshot);
});
test("Evidence manifest explicitly separates approved source, mapped text, model estimate and geo estimate",()=>{
  const original=previous(), evidence=geoPlotEvidenceManifest([original],[row("1")],1.5,{
    inventoryRevision:3,mappingRevision:8,alignmentRevision:2
  });
  assert.equal(evidence.advisoryOnly,true);
  assert.equal(evidence.plots[0].area.approvedSource.value,110);
  assert.equal(evidence.plots[0].area.modelLocalEstimateSqm,100);
  assert.equal(evidence.plots[0].area.geoScaledEstimateSqm,225);
  assert.equal(evidence.plots[0].sides.front.modelLocalEstimateM,10);
  assert.equal(evidence.plots[0].sides.front.geoScaledEstimateM,15);
  assert.equal(evidence.plots[0].sides.front.approvedSource.rawText,"11 x 10");
  assert.equal(evidence.plots[0].sides.front.approvedSource.page,null,
    "do not guess a source page from arbitrary document strings");
  assert.equal(evidence.plots[0].sides.front.approvedSource.confidence,"not_assessed",
    "do not invent OCR/survey confidence");
  assert.equal(evidence.plots[0].plane.reference,"Sealed model datum");
  assert.equal(evidence.inventoryRevision,3);
  const withPage=geoPlotEvidenceManifest([original],[row("1",{
    measurementSource:"Signed site register page 17",
    areaSource:"Approved file p. 5"
  })],1);
  assert.equal(withPage.plots[0].area.approvedSource.page,"5");
  assert.equal(withPage.plots[0].sides.front.approvedSource.page,"17");
});
test("Quality flags missing source, area/side variances, road side and stale review without overwriting plots",()=>{
  const original=previous(), p2=cloneUnverifiedGeoPlot(original,"2",10,0,[row("2")],[original]);
  const result=geoPlotQualityReport([original,p2],[row("1"),row("2"),row("3")],{
    geoScale:1.5,mappingStale:true,alignmentRevision:3,
    verifiedAlignmentRevision:2,inventoryRevision:7,verifiedInventoryRevision:6
  });
  assert.ok(result.summary.blockers>=3);
  assert.ok(result.issues.some(i=>i.field==="unmapped"&&i.plotId==="3"));
  assert.ok(result.issues.some(i=>i.field==="alignment"));
  assert.ok(result.issues.some(i=>i.field==="mapping"));
  assert.ok(result.issues.some(i=>i.field==="frontRoad"&&i.plotId==="2"));
  assert.ok(result.issues.some(i=>i.field==="areaVariance"));
  assert.ok(result.issues.some(i=>i.field==="frontVariance"));
  assert.equal(result.advisoryOnly,true);
  assert.deepEqual(original,previous());
});
test("Overlapping plots are surfaced as blockers; shared boundary is valid",()=>{
  const one=previous();
  const overlapping={...previous(),id:"2",corners:[[5,0],[15,0],[15,10],[5,10]]};
  const touch={...previous(),id:"3",corners:[[10,0],[20,0],[20,10],[10,10]]};
  assert.equal(geoPlotQualityReport([one,overlapping],[]).issues
    .filter(i=>i.field==="overlap").length,1);
  assert.equal(geoPlotQualityReport([one,touch],[]).issues
    .filter(i=>i.field==="overlap").length,0);
});
test("Quality report prioritizes blocking errors and spots crossing geometries",()=>{
  const bad={...previous(),id:"4",corners:[[0,0],[10,10],[0,10],[10,0]]};
  const result=geoPlotQualityReport([bad],[row("4")]);
  assert.ok(result.issues.some(issue=>issue.field==="geometry"&&issue.severity==="blocker"));
  const firstReview=result.issues.findIndex(issue=>issue.severity==="review");
  const lastBlock=result.issues.map(issue=>issue.severity).lastIndexOf("blocker");
  assert.ok(firstReview===-1||lastBlock<firstReview);
});
test("Review and clone are UI-only; publish and business state remain server-authoritative",()=>{
  const source=readFileSync(new URL("../apps/admin/src/geo/GeoPlotMapper.tsx",import.meta.url),"utf8");
  assert.match(source,/cloneUnverifiedGeoPlot\(previous,nextTemplateId/);
  assert.match(source,/resetWorking\(next\);setOriginalId\(null\)/);
  assert.match(source,/Download Evidence & Quality Review JSON/);
  assert.match(source,/geoPlotQualityReport\(plots,inventoryRows/);
  const helper=readFileSync(new URL("../shared/geo-plot-stage3-review.js",import.meta.url),"utf8");
  assert.doesNotMatch(helper,/fetch\(|\.run\(|INSERT INTO|UPDATE geo_plot_mapping/);
});
