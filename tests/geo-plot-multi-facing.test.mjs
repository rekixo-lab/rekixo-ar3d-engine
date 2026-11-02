import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {GEO_COMPASS_DIRECTIONS,suggestGeoSideFacing,geoPlotFacingEntries} from "../shared/geo-plot-facing.js";
import {validateGeoPlot} from "../workers/geo-plot-geometry.mjs";
import {publicGeoPlotFacts} from "../shared/geo-plot-publication-mode.js";
const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const base={
  id:"21",corners:[[0,0],[10,0],[10,20],[0,20]],layout:"four",
  sides:{
    front:{edges:[0],roadFacing:true,length:10,unit:"m",source:"survey",verified:true},
    depthA:{edges:[1],roadFacing:false,length:20,unit:"m",source:"survey",verified:true},
    back:{edges:[2],roadFacing:false,length:10,unit:"m",source:"survey",verified:true},
    depthB:{edges:[3],roadFacing:false,length:20,unit:"m",source:"survey",verified:true},
  },
  area:{value:200,unit:"sqm",source:"survey",verified:true},
  facing:"north",facingSource:"",facingVerified:false,
  road:"",notes:"internal-only",planeY:0,planeSource:"survey",planeVerified:true,
};
test("eight precise cardinal and intercardinal compass labels and arrows",()=>{
  assert.deepEqual(GEO_COMPASS_DIRECTIONS.map(x=>x.arrow),["↑","↗","→","↘","↓","↙","←","↖"]);
  assert.deepEqual(GEO_COMPASS_DIRECTIONS.map(x=>x.id),[
    "north","north-east","east","south-east","south","south-west","west","north-west"]);
  assert.equal(suggestGeoSideFacing(base.corners,[0],0),"north");
  assert.equal(suggestGeoSideFacing(base.corners,[1],0),"east");
  assert.equal(suggestGeoSideFacing(base.corners,[2],0),"south");
  assert.equal(suggestGeoSideFacing(base.corners,[3],0),"west");
  assert.equal(suggestGeoSideFacing(base.corners,[0],45),"north-east");
  assert.equal(suggestGeoSideFacing(base.corners,[0],90),"east");
  assert.equal(suggestGeoSideFacing(base.corners,[0],180),"south");
  assert.equal(suggestGeoSideFacing(base.corners,[0],270),"west");
  assert.equal(suggestGeoSideFacing(base.corners,[0],-45),"north-west");
});
test("single double triple road-facing sides; default north never invents road access",()=>{
  const none=structuredClone(base);
  for(const role of Object.keys(none.sides))none.sides[role].roadFacing=false;
  assert.deepEqual(geoPlotFacingEntries(none,0),[],"blank editor defaults are not a confirmed facing");
  assert.deepEqual(geoPlotFacingEntries(base,0).map(x=>x.label),["North"]);
  const double=structuredClone(base);double.sides.depthA.roadFacing=true;
  assert.deepEqual(geoPlotFacingEntries(double,0).map(x=>x.arrow+" "+x.label),[
    "↑ North","→ East"]);
  const triple=structuredClone(double);triple.sides.back.roadFacing=true;
  assert.deepEqual(geoPlotFacingEntries(triple,0).map(x=>x.arrow+" "+x.label),[
    "↑ North","↓ South","→ East"]);
  assert.equal(geoPlotFacingEntries(triple,0).length,3);
  assert.deepEqual(geoPlotFacingEntries(triple,90).map(x=>x.direction),["east","west","south"]);
});
test("manual compass per side overrides Geo suggestion and is never invented",()=>{
  const chosen=structuredClone(base);
  chosen.sides.depthA.roadFacing=true;
  chosen.sides.depthA.facingDirection="south-east";
  const normalized=validateGeoPlot(chosen);
  assert.equal(normalized.sides.depthA.facingDirection,"south-east");
  assert.deepEqual(geoPlotFacingEntries(normalized,0).map(x=>x.label),["North","South-East"]);
  const publicPrelim=publicGeoPlotFacts(normalized,"preliminary");
  assert.equal(publicPrelim.sides.depthA.facingDirection,"south-east");
  assert.equal(publicPrelim.sides.depthA.source,undefined,"private evidence must remain hidden");
  assert.equal(publicPrelim.notes,"");
  assert.deepEqual(geoPlotFacingEntries(publicPrelim,0).map(x=>x.label),["North","South-East"]);
  const notRoad=structuredClone(chosen);notRoad.sides.depthA.roadFacing=false;
  assert.equal(validateGeoPlot(notRoad).sides.depthA.facingDirection,undefined);
  const invalid=structuredClone(chosen);invalid.sides.depthA.facingDirection="NORTHO";
  assert.throws(()=>validateGeoPlot(invalid),/invalid depthA compass-facing/);
  assert.deepEqual(geoPlotFacingEntries({sides:base.sides,corners:[]},0),[]);
});
test("older single-facing approved mapping is readable, but no fake north from blank editor",()=>{
  const old=structuredClone(base);
  old.sides.front.roadFacing=false;
  old.facingVerified=true;old.facingSource="approved plan";
  old.facing="south-west";
  assert.deepEqual(geoPlotFacingEntries(old,0).map(x=>x.label),["South-West"]);
  old.facingVerified=false;
  assert.deepEqual(geoPlotFacingEntries(old,0),[]);
  old.sides.front.roadFacing=true;
  assert.deepEqual(geoPlotFacingEntries(old,0).map(x=>x.label),["North"]);
});
test("irregular and reverse-wound polygons resolve outward Geo normals safely",()=>{
  const pentagon=[[0,0],[4,0],[10,0],[10,10],[0,10]];
  assert.equal(suggestGeoSideFacing(pentagon,[0,1],0),"north");
  assert.equal(suggestGeoSideFacing([...base.corners].reverse(),[2],0),"north");
  assert.equal(suggestGeoSideFacing(pentagon,[99],0),null);
  assert.equal(suggestGeoSideFacing([[0,0],[0,0],[0,0]],[0],0),null);
  assert.equal(suggestGeoSideFacing(base.corners,[0],NaN),null);
});
test("Geo Mapper, public payload and SVG diagram preserve compass arrow contracts",()=>{
  const admin=read("apps/admin/src/geo/GeoPlotMapper.tsx");
  const viewer=read("apps/public/src/geo/GeoPlotDetailsDrawer.tsx");
  const parent=read("apps/public/src/geo/GeoPublicDemo.tsx");
  const helper=read("shared/geo-plot-facing.js");
  const policy=read("shared/geo-plot-publication-mode.js");
  const geometry=read("workers/geo-plot-geometry.mjs");
  const ops=read("shared/geo-plot-source-operations.js");
  assert.match(admin,/Geo Facing Compass · Road-Facing Sides/);
  assert.match(admin,/GEO_COMPASS_DIRECTIONS\.map\(item=>/);
  assert.match(admin,/chooseGeoFacing\(role,item\.id\)/);
  assert.match(admin,/suggestGeoSideFacing\(working\.corners,side\.edges/);
  assert.match(admin,/facingDirection:direction\|\|undefined/);
  assert.match(admin,/FacingDirection/);
  assert.match(viewer,/geoPlotFacingEntries\(shown,geoHeadingDeg\)/);
  assert.match(viewer,/geo-plot-drawer__facing-arrow/);
  assert.match(viewer,/markerEnd="url\(#geo-facing-arrow-tip\)"/);
  assert.match(viewer,/geo-plot-drawer__facing-label/);
  assert.match(viewer,/facings\.map\(face=>face\.arrow\+" "\+face\.label\)/);
  assert.match(parent,/geoHeadingDeg=\{data\.placement\.headingDeg\}/);
  assert.match(helper,/const localEast=outwardX,localNorth=-outwardZ/);
  assert.match(policy,/facingDirection:side\.facingDirection/);
  assert.match(geometry,/invalid "\+role\+" compass-facing direction/);
  assert.match(ops,/facingDirection:undefined/);
  assert.doesNotMatch(viewer,/style=\{\{color:"red"/);
});
