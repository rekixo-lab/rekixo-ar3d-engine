import test from "node:test";
import assert from "node:assert/strict";
import {performance} from "node:perf_hooks";
import {readFileSync} from "node:fs";
import {geoPathBounds,geoViewportIntersects,visibleGeoPlotPaths} from "../shared/geo-plot-viewport.js";
import {geoPlotQualityReport} from "../shared/geo-plot-stage3-review.js";
import {compareGeoPlotPublication} from "../shared/geo-plot-publication-diff.js";
import {validateGeoPlotCollection} from "../workers/geo-plot-geometry.mjs";
import {reviewGeoSiteSurvey} from "../scripts/geo-site-acceptance.mjs";
const item=(id,x,z)=>({id,corners:[[x,z],[x+10,z],[x+10,z+10],[x,z+10]],layout:"four",
 sides:Object.fromEntries(["front","depthA","back","depthB"].map((role,i)=>[role,{
  edges:[i],length:10,unit:"m",source:"Approved engineering source p2",
  verified:true,roadFacing:role==="front"}])),
 area:{value:100,unit:"sqm",source:"Approved source p2",verified:true},
 facing:"east",facingSource:"Signed north",facingVerified:true,
 planeY:0,planeSource:"Signed site plane",planeVerified:true,
 road:"20 ft road",notes:""});
function build(count){return Array.from({length:count},(_,i)=>item(String(i+1),(i%50)*10,Math.floor(i/50)*10));}
test("Viewport filter keeps crossing plot boundaries, culls far-away plots, and fails open only for unsupported dateline views",()=>{
 const path=[{lat:20,lng:80},{lat:20,lng:80.001},
  {lat:20.001,lng:80.001},{lat:20.001,lng:80}];
 const bbox=geoPathBounds(path);
 assert.equal(geoViewportIntersects(bbox,{south:20.0009,north:20.0014,west:80.0009,east:80.0014}),true);
 assert.equal(geoViewportIntersects(bbox,{south:21,north:22,west:81,east:82},0),false);
 assert.equal(geoViewportIntersects(bbox,{south:0,north:1,west:170,east:-170}),true,
  "unsupported dateline camera must not silently hide all plot overlays");
});
test("Synthetic performance budget and correctness: 500, 1,000, 2,500 canonical plots",()=>{
 for(const count of [500,1000,2500]){
  const start=performance.now(),plots=build(count);
  assert.equal(validateGeoPlotCollection(plots,{forPublish:true}).length,count);
  const quality=geoPlotQualityReport(plots,[],{geoScale:1});
  assert.equal(quality.summary.blockers,0);
  assert.equal(quality.summary.reviews,0);
  const diff=compareGeoPlotPublication(plots,plots);
  assert.equal(diff.changes.length,0);
  const prepared=plots.map(plot=>{
   const x=plot.corners[0][0]/100000+80,z=plot.corners[0][1]/100000+20;
   const path=[{lng:x,lat:z},{lng:x+.00008,lat:z},
    {lng:x+.00008,lat:z+.00008},{lng:x,lat:z+.00008}];
   return {plot,path,bounds:geoPathBounds(path)};
  });
  const shown=visibleGeoPlotPaths(prepared,
   {north:20.0003,south:20.0001,east:80.0003,west:80.0001},0);
  assert.ok(shown.length>0&&shown.length<count/5,
    "At a close-up zoom most out-of-viewport polygons must never instantiate");
  assert.equal(visibleGeoPlotPaths(prepared,null).length,count,
    "Older map runtimes without bounds must preserve legacy coverage");
  const elapsedMs=Number((performance.now()-start).toFixed(1));
  console.info("SYNTHETIC GEO SITE PERFORMANCE",JSON.stringify({
   mappedPlots:count,visibleInCloseViewport:shown.length,
   elapsedMs,source:"generated geometry; NOT measured mobile FPS"}));
  assert.ok(elapsedMs<20000,"Geo synthetic mapping diagnostics exceeded 20-second safety budget");
 }
});
const source=()=>{
 const old={imageAssetId:"asset-1",imageSha256:"a".repeat(64),
  modelSha256:"b".repeat(64),imageWidth:200,imageHeight:100,
  geoReleaseId:"geo-test",buildingReleaseId:"building-test",
  anchors:[],checkpoints:[]};
 const a=(u,v,id)=>({id,u,v,x:u*20,z:v*10,evidence:"Signed site survey control"});
 old.anchors=[a(0,0,"A1"),a(.5,0,"A2"),a(0,1,"A3"),a(.5,1,"A4")];
 old.checkpoints=[a(.2,.2,"C1"),a(.8,.8,"C2")];
 const plots=Array.from({length:10},(_,i)=>({
  id:String(i+1),corners:[
   [(i%5)*4,Math.floor(i/5)*5],
   [(i%5)*4+4,Math.floor(i/5)*5],
   [(i%5)*4+4,Math.floor(i/5)*5+5],
   [(i%5)*4,Math.floor(i/5)*5+5]]}));
 const samples=plots.map(p=>({plotId:p.id,cornerIndex:0,u:p.corners[0][0]/20,
  v:p.corners[0][1]/10,approvedArea:20,areaUnit:"sqm",
  signedSourceRef:"Synthetic survey fixture plot "+p.id}));
 return {schema:"rekixo-geo-site-field-review-v1",projectSlug:"test-only-not-satharai",
  alignment:old,geoScale:1,plots,samples};
};
test("Ten-plot field acceptance requires independent source references and rejects missing or inaccurate observations",()=>{
 const demo=source();
 const ok=reviewGeoSiteSurvey(demo);
 assert.equal(ok.passed,true);assert.equal(ok.inspected,10);
 assert.match(ok.warning,/Independent GPS/);
 assert.throws(()=>reviewGeoSiteSurvey({...demo,samples:demo.samples.slice(1)}),/TEN/);
 const incorrect=structuredClone(demo);
 incorrect.samples[0].u=.9;
 assert.equal(reviewGeoSiteSurvey(incorrect).passed,false);
 incorrect.samples[0].signedSourceRef="";
 assert.throws(()=>reviewGeoSiteSurvey(incorrect),/signed survey/);
});
test("Public GLB polygons preserve all small sites and cull large sites on map idle",()=>{
 const text=readFileSync(new URL("../apps/public/src/geo/GeoPublicDemo.tsx",import.meta.url),"utf8");
 assert.match(text,/visibleGeoPlotPaths\(preparedPaths,currentViewport\(\)\)/);
 assert.match(text,/map.addListener\("idle"/);
 assert.match(text,/mapClick\?\.remove\(\)/);
 assert.match(text,/plotLayer\?\.dispose\(\)/);
 assert.match(text,/preparedPaths.length<=160\?preparedPaths/);
 assert.doesNotMatch(text,/new google\.maps\.Polygon\(/);
 assert.match(text,/refreshPlotPolygons\?\.\(true\)/);
});
