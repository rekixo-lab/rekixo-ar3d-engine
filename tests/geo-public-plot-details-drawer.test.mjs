import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { publicGeoPlotDiagram, publicGeoAreaUnits } from "../shared/geo-plot-detail-diagram.js";
import { publicGeoPlotFacts } from "../shared/geo-plot-publication-mode.js";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const parent=read("apps/public/src/geo/GeoPublicDemo.tsx");
const drawer=read("apps/public/src/geo/GeoPlotDetailsDrawer.tsx");
const css=read("apps/public/src/geo/geo-plot-details-drawer.css");

const mapped={
  id:"18",layout:"four",
  corners:[[0,0],[25,0],[25,40],[0,40]],
  area:{value:1000,unit:"sqft",source:"reviewed",verified:true},
  sides:{
    front:{edges:[0],length:25,unit:"ft",roadFacing:true,source:"reviewed",verified:true},
    depthA:{edges:[1],length:40,unit:"ft",roadFacing:false,source:"reviewed",verified:true},
    back:{edges:[2],length:25,unit:"ft",roadFacing:false,source:"",verified:false},
    depthB:{edges:[3],length:40,unit:"ft",roadFacing:false,source:"reviewed",verified:true},
  },facing:"north",facingVerified:true,facingSource:"reviewed",
  road:"30 ft road",notes:"Private draft",
};

test("diagram is a proportional transform of the real published polygon, not a rectangular placeholder",()=>{
  const output=publicGeoPlotDiagram(mapped);
  assert.ok(output);
  assert.equal(output.vertexCount,4);
  const points=output.pointText.split(" ").map(p=>p.split(",").map(Number));
  assert.equal(points.length,4);
  assert.equal(new Set(points.map(p=>p.join(","))).size,4);
  const width=Math.max(...points.map(p=>p[0]))-Math.min(...points.map(p=>p[0]));
  const height=Math.max(...points.map(p=>p[1]))-Math.min(...points.map(p=>p[1]));
  assert.ok(Math.abs(width/height-25/40)<.01);
  assert.deepEqual(output.sides.map(s=>s.role),["front","back","depthA","depthB"]);
  assert.equal(output.sides.find(s=>s.role==="front").segments.length,1);
  assert.ok(output.sides.every(s=>s.labelX!==null&&Number.isFinite(s.labelY)));
  assert.deepEqual(mapped.corners,[[0,0],[25,0],[25,40],[0,40]],
    "presentation must not mutate source polygon");
});

test("irregular and triangular geometry keep exact vertex and edge semantics",()=>{
  const irregular={...mapped,
    corners:[[0,0],[20,0],[26,8],[18,21],[0,21]],
    sides:{...mapped.sides,front:{...mapped.sides.front,edges:[0,1]}}
  };
  const plot=publicGeoPlotDiagram(irregular);
  assert.equal(plot.vertexCount,5);
  assert.equal(plot.sides.find(s=>s.role==="front").segments.length,2);
  const triangle={...mapped,layout:"three",corners:[[0,0],[20,0],[10,12]],
    sides:{front:mapped.sides.front,back:{...mapped.sides.back,edges:[1]},
      depthA:{...mapped.sides.depthA,edges:[2]}}};
  assert.deepEqual(publicGeoPlotDiagram(triangle).sides.map(s=>s.label),
    ["Front","Back","Depth"]);
  assert.equal(publicGeoPlotDiagram({...mapped,corners:[[1,1],[1,1],[1,1]]}),null);
  assert.equal(publicGeoPlotDiagram({...mapped,corners:[[0,0],[Infinity,1],[2,1]]}),null);
  assert.equal(publicGeoPlotDiagram({...mapped,corners:[]}),null);
});

test("display area comes only from approved public source area and converts units accurately",()=>{
  const rows=publicGeoAreaUnits({value:1000,unit:"sqft"});
  assert.deepEqual(rows.map(r=>r.unit),["sqft","sqm","sqyd"]);
  assert.ok(Math.abs(rows[0].value-1000)<1e-9);
  assert.ok(Math.abs(rows[1].value-92.90304)<1e-9);
  assert.ok(Math.abs(rows[2].value-111.1111111)<.0001);
  assert.deepEqual(publicGeoAreaUnits(null),[]);
  assert.deepEqual(publicGeoAreaUnits({value:0,unit:"sqm"}),[]);
  assert.deepEqual(publicGeoAreaUnits({value:99,unit:"modelUnits"}),[]);
});

test("preliminary public state displays no unreviewed area, sides, facing, road or private notes",()=>{
  const preliminary=publicGeoPlotFacts(mapped,"preliminary");
  assert.equal(preliminary.area?.value,1000);
  assert.equal(preliminary.facing,"north");
  assert.equal(preliminary.road,"30 ft road");
  assert.equal(preliminary.notes,"");
  assert.equal(preliminary.sides.front.edges[0],0);
  assert.equal(preliminary.sides.back,undefined);
  assert.ok(publicGeoPlotDiagram(preliminary).sides.every(s=>s.role!=="back"));
  const noReview=publicGeoPlotFacts({...mapped,area:{...mapped.area,verified:false},
    facingVerified:false,sides:Object.fromEntries(Object.entries(mapped.sides)
      .map(([role,side])=>[role,{...side,verified:false}]))},"preliminary");
  assert.deepEqual(publicGeoAreaUnits(noReview.area),[]);
  assert.deepEqual(publicGeoPlotDiagram(noReview).sides,[]);
  assert.equal(noReview.facing,null);
  assert.equal(noReview.road,null);
  assert.equal(noReview.notes,"");
});

test("drawer only changes presentation, preserving click hit testing and camera map flow",()=>{
  assert.match(parent,/setSelectedPlot\(plotIds\.get\(id\)\|\|null\)/);
  assert.match(parent,/pickModelGeoPlot\(/);
  assert.match(parent,/<GeoPlotDetailsDrawer/);
  assert.match(parent,/plot=\{selectedPlot\}/);
  assert.match(parent,/onClose=\{\(\)=>setSelectedPlot\(null\)\}/);
  assert.match(parent,/commercial=\{selectedPlot\?data\.plotMapping\?\.commercial\?\.\[selectedPlot\.id\]:undefined\}/);
  assert.doesNotMatch(parent,/geo-plot-public-details--status-open/);
  assert.match(drawer,/publicGeoPlotDiagram\(shown\)/);
  assert.match(drawer,/publicGeoAreaUnits\(shown\.area\)/);
  assert.match(drawer,/commercial\?prettyStatus\(commercial\.status\):"Mapped plot"/);
  assert.match(drawer,/publicationMode==="preliminary"/);
  assert.match(drawer,/publicPhone/);
  assert.match(drawer,/publicWhatsappHref/);
  assert.match(drawer,/aria-hidden=\{!plot\} inert=\{!plot\}/);
  assert.match(drawer,/event\.key==="Escape"/);
});

test("plot drawer fills map from left/top/bottom while retaining the right strip and required attribution",()=>{
  assert.match(css,/\.geo-plot-drawer \{[\s\S]*position:absolute;/);
  assert.match(css,/top:0;\s*bottom:0;\s*left:0;/);
  assert.match(css,/width:min\(430px,calc\(100% - 56px\)\)/);
  assert.match(css,/@media\(max-width:640px\)[\s\S]*\.geo-plot-drawer\{top:0;bottom:0;left:0;width:calc\(100% - 55px\);max-height:none/);
  assert.match(css,/border-left:0;[\s\S]*border-top:0;[\s\S]*border-bottom:0;/);
  assert.match(css,/border-radius:0 17px 0 0/);
  assert.match(css,/-webkit-mask-image:linear-gradient\(to bottom,#000 0,#000 calc\(100% - 30px\),transparent/);
  assert.match(css,/mask-image:linear-gradient\(to bottom,#000 0,#000 calc\(100% - 30px\),transparent/);
  assert.match(css,/\.geo-integrated-scene:fullscreen > \.geo-plot-drawer \{[\s\S]*top:0;[\s\S]*bottom:0;[\s\S]*left:0;/);
  assert.match(css,/\.geo-integrated-scene:fullscreen > \.geo-plot-drawer \.geo-plot-drawer__scroll \{[\s\S]*padding-bottom:calc\(94px \+ env\(safe-area-inset-bottom,0px\)\)/);
  assert.match(css,/\.geo-integrated-scene:has\(> \.geo-plot-drawer\.is-open\) > \.geo-map-quick-actions \{[\s\S]*z-index:20;/);
  assert.match(css,/\.geo-plot-drawer__head\{padding:60px 12px 10px\}/);
  assert.match(css,/transform:translate3d\(calc\(-100% - 16px\),0,0\)/);
  assert.match(css,/transition:transform \.26s/);
  assert.match(css,/:has\(> \.geo-plot-drawer\.is-open\) > \.geo-plot-status/);
  assert.match(css,/prefers-reduced-motion:reduce/);
  assert.doesNotMatch(css,/\.gm-style-cc\s*\{|\.gm-style a\s*\{/);
});


test("unapproved customer facts are explained without suggesting the entire site is unpublished",()=>{
  assert.match(drawer,/Awaiting source approval/);
  assert.match(drawer,/Preliminary boundary: only individually reviewed measurements/);
  assert.match(drawer,/Availability and price appear only after verified mapping and owner approval/);
  assert.doesNotMatch(drawer,/<b>Not published<\/b>/);
});
