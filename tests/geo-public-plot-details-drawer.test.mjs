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

test("preliminary public view retains mapped dimensions without exposing internal source notes",()=>{
  const preliminary=publicGeoPlotFacts(mapped,"preliminary");
  assert.equal(preliminary.area?.value,1000);
  assert.equal(preliminary.facing,"north");
  assert.equal(preliminary.road,"30 ft road");
  assert.equal(preliminary.notes,"");
  assert.equal(preliminary.sides.front.edges[0],0);
  assert.equal(preliminary.sides.back.length,25);
  assert.deepEqual(publicGeoPlotDiagram(preliminary).sides.map(s=>s.role),
    ["front","back","depthA","depthB"]);
  const noReview=publicGeoPlotFacts({...mapped,area:{...mapped.area,verified:false},
    facingVerified:false,sides:Object.fromEntries(Object.entries(mapped.sides)
      .map(([role,side])=>[role,{...side,verified:false}]))},"preliminary");
  assert.equal(publicGeoAreaUnits(noReview.area).length,3);
  assert.equal(publicGeoPlotDiagram(noReview).sides.length,4);
  assert.equal(noReview.facing,"north");
  assert.equal(noReview.road,"30 ft road");
  assert.equal(noReview.notes,"");
  assert.equal(noReview.area?.source,undefined);
  assert.equal(noReview.sides.front.source,undefined);
});

test("drawer only changes presentation, preserving click hit testing and camera map flow",()=>{
  assert.match(parent,/setSelectedPlot\(plotIds\.get\(id\)\|\|null\)/);
  assert.match(parent,/pickModelGeoPlot\(/);
  assert.match(parent,/<GeoPlotDetailsDrawer/);
  assert.match(parent,/plot=\{drawerOpen\?selectedPlot:null\}/);
  assert.match(parent,/onClose=\{\(\)=>setDrawerOpen\(false\)\}/);
  assert.match(parent,/commercial=\{selectedPlot\?commercial\?\.\[selectedPlot\.id\]:undefined\}/);
  assert.doesNotMatch(parent,/geo-plot-public-details--status-open/);
  assert.match(drawer,/publicGeoPlotDiagram\(shown\)/);
  assert.match(drawer,/publicGeoAreaUnits\(shown\.area\)/);
  assert.match(drawer,/data-plot-status=\{displayStatus\}/);
  assert.match(drawer,/geo-plot-drawer__status--"\+displayStatus/);
  assert.doesNotMatch(drawer,/publicationMode==="preliminary"/);
  assert.match(drawer,/publicPhone/);
  assert.match(drawer,/publicWhatsapp/);
  assert.match(drawer,/aria-hidden=\{!plot\} inert=\{!plot\}/);
  assert.match(drawer,/event\.key==="Escape"/);
});

test("plot drawer fills left map area and ends above required attribution footer",()=>{
  assert.match(css,/\.geo-plot-drawer \{[\s\S]*position:absolute;/);
  assert.match(css,/top:0;\s*bottom:30px;[\s\S]*left:0;/);
  assert.match(css,/width:min\(430px,calc\(100% - 56px\)\)/);
  assert.match(css,/@media\(max-width:640px\)[\s\S]*\.geo-plot-drawer\{top:0;bottom:30px;left:0;width:calc\(100% - 55px\);max-height:none/);
  assert.match(css,/border-left:0;[\s\S]*border-top:0;[\s\S]*border-bottom:1px solid/);
  assert.match(css,/border-radius:0 17px 0 0/);
  assert.doesNotMatch(css,/-webkit-mask-image:|mask-image:/);
  assert.match(css,/\.geo-plot-drawer__outside-dismiss \{[\s\S]*inset:0 0 30px/);
  assert.match(css,/\.geo-integrated-scene:fullscreen > \.geo-plot-drawer \{[\s\S]*top:0;[\s\S]*bottom:30px;[\s\S]*left:0;/);
  assert.match(css,/\.geo-integrated-scene:fullscreen > \.geo-plot-drawer \.geo-plot-drawer__scroll \{[\s\S]*padding-bottom:calc\(94px \+ env\(safe-area-inset-bottom,0px\)\)/);
  assert.doesNotMatch(css,/\.geo-integrated-scene:has\(> \.geo-plot-drawer\.is-open\) > \.geo-map-quick-actions \{/);
  assert.match(css,/\.geo-plot-drawer__head\{padding:12px 12px 10px\}/);
  assert.match(css,/transform:translate3d\(calc\(-100% - 16px\),0,0\)/);
  assert.match(css,/transition:transform \.26s/);
  assert.match(css,/:has\(> \.geo-plot-drawer\.is-open\) > \.geo-plot-status/);
  assert.match(css,/prefers-reduced-motion:reduce/);
  assert.doesNotMatch(css,/\.gm-style-cc\s*\{|\.gm-style a\s*\{/);
});


test("tap outside the active plot drawer closes it without picking or editing another plot",()=>{
  const start=parent.indexOf("{selectedPlot&&drawerOpen&&<button");
  const end=parent.indexOf("<GeoPlotDetailsDrawer",start);
  assert.ok(start>=0&&end>start);
  const dismiss=parent.slice(start,end);
  assert.match(dismiss,/type="button"/);
  assert.match(dismiss,/className="geo-plot-drawer__outside-dismiss"/);
  assert.match(dismiss,/aria-label="Close plot details by tapping outside"/);
  // Opening a plot happens at pointerup; a following synthesized click
  // must NOT close the newly rendered sidebar.
  assert.ok(dismiss.includes("onPointerDown={event=>{"));
  assert.ok(dismiss.includes("if(!event.isPrimary||event.button!==0)return"));
  assert.ok(dismiss.includes("event.preventDefault()"));
  assert.ok(dismiss.includes("event.stopPropagation()"));
  assert.ok(dismiss.includes("if(event.detail===0)setDrawerOpen(false)"));
  assert.ok(dismiss.includes("setDrawerOpen(false)"));
  assert.ok(!dismiss.includes("setSelectedPlot(null)"),"drawer dismissal keeps the selected GLB focus");
  assert.ok(!dismiss.includes("onClick={()=>setSelectedPlot(null)}"));
  assert.doesNotMatch(dismiss,/pickModelGeoPlot|selectAtScreenPoint/);
  assert.match(parent,/onClose=\{\(\)=>setDrawerOpen\(false\)\}/);
  assert.match(drawer,/event\.key==="Escape"/);
  assert.match(css,/\.geo-plot-drawer__outside-dismiss \{[\s\S]*z-index:14;/);
  assert.match(css,/\.geo-plot-drawer__outside-dismiss \{[\s\S]*inset:0 0 30px;/);
  assert.match(css,/\.geo-plot-drawer \{[\s\S]*z-index:15;/);
  assert.match(css,/\.geo-plot-drawer__outside-dismiss:focus-visible/);
  // Google logo/copyright remain accessible in the map footer while open.
  assert.match(css,/\.gm-style-cc,/);
  assert.match(css,/\.gm-style a\[href\*="google\.com\/maps"\]/);
});

test("customer shows entered fields only, without nil or approval banners",()=>{
  assert.doesNotMatch(drawer,/Awaiting source approval|Not published|Preliminary boundary/);
  assert.doesNotMatch(drawer,/not independently approved|approval is needed|commercial status and price are/);
  assert.doesNotMatch(drawer,/Mapped plot"\}/);
  assert.doesNotMatch(drawer,/Shape and dimensions are taken from the published plot mapping/);
  assert.match(drawer,/areas.length \? areas.map/);
  assert.match(drawer,/\) : null\}/);
  assert.match(css,/\.geo-plot-drawer__head\{padding:12px 12px 10px\}/);
  assert.match(css,/\.gm-style::after\s*\{[\s\S]*background:#071c27;/);
  assert.match(css,/\.gm-style-cc,/);
  assert.match(css,/z-index:101 !important/);
});

test("compact shape card uses one status color and prints side sizes beside polygon edges",()=>{
  // Available is a view-only fallback; a published Booked/Sold status wins.
  assert.match(drawer,/commercial\?\.status==="booked"\|\|commercial\?\.status==="sold"/);
  assert.match(drawer,/data-plot-status=\{displayStatus\}/);
  assert.match(css,/--geo-plot-shape-stroke:#1cd680/);
  assert.match(css,/\.geo-plot-drawer\[data-plot-status="booked"\]\s*\{[\s\S]*--geo-plot-shape-stroke:#f2bf25/);
  assert.match(css,/\.geo-plot-drawer\[data-plot-status="sold"\]\s*\{[\s\S]*--geo-plot-shape-stroke:#f04b58/);
  assert.match(css,/\.geo-plot-drawer__poly\{fill:var\(--geo-plot-shape-fill\);stroke:var\(--geo-plot-shape-stroke\)/);
  assert.match(css,/\.geo-plot-drawer__side-edge\{stroke:var\(--geo-plot-shape-stroke\)/);
  assert.match(css,/\.geo-plot-drawer__side-label\{fill:var\(--geo-plot-shape-stroke\)/);
  assert.match(drawer,/className="geo-plot-drawer__side-edge"/);
  assert.match(drawer,/className="geo-plot-drawer__side-label-value"/);
  assert.match(drawer,/\{side\.label\}/);
  assert.match(drawer,/\{formatMeasurement\(side\.length,side\.unit\)\}/);
  assert.doesNotMatch(drawer,/stroke=\{side\.color\}|fill=\{side\.color\}/);
  assert.doesNotMatch(drawer,/diagram\.vertexCount\+" corners"/);
  assert.doesNotMatch(drawer,/geo-plot-drawer__side-legend|geo-plot-drawer__shape-note/);
  assert.doesNotMatch(css,/geo-plot-drawer__side-legend|geo-plot-drawer__shape-note/);
  assert.doesNotMatch(drawer,/Shape and dimensions are taken from the published plot mapping/);
  assert.doesNotMatch(drawer,/Mapped Plot Shape/);
});

test("Plot Measurements section still includes all area units and Front Back Depth A/B",()=>{
  const facts=drawer.slice(drawer.indexOf('<section className="geo-plot-drawer__facts"'));
  assert.match(facts,/Plot Measurements/);
  assert.match(facts,/areas\.length \? areas\.map/);
  assert.match(facts,/formatMeasurement\(area\.value,area\.unit\)/);
  assert.match(facts,/allRoles\.map\(role=>\{/);
  assert.match(facts,/formatMeasurement\(side\.length,side\.unit\)/);
  for(const [key,label] of Object.entries({front:"Front",back:"Back",depthA:"Depth A",depthB:"Depth B"}))
    assert.match(drawer,new RegExp(key+': "'+label+'"'));
  const source=read("shared/geo-plot-detail-diagram.js");
  assert.doesNotMatch(source,/ROLE_COLORS/);
  assert.match(css,/max-height:200px;aspect-ratio:320\/210/);
  const rows=publicGeoAreaUnits({value:1325.25,unit:"sqft"});
  assert.deepEqual(rows.map(row=>row.label),["Sq. Feet","Sq. Meters","Sq. Yards"]);
});

test("real side lengths are placed by the published side-edge mapping",()=>{
  const plot={...mapped,sides:{
    front:{...mapped.sides.front,length:24.92},
    back:{...mapped.sides.back,length:24.92},
    depthA:{...mapped.sides.depthA,length:53.17},
    depthB:{...mapped.sides.depthB,length:53.17},
  }};
  const result=publicGeoPlotDiagram(plot);
  assert.deepEqual(result.sides.map(s=>[s.label,s.length,s.unit]),[
    ["Front",24.92,"ft"],["Back",24.92,"ft"],
    ["Depth A",53.17,"ft"],["Depth B",53.17,"ft"]
  ]);
  assert.ok(result.sides.every(s=>s.labelX!==null&&s.labelY!==null));
  assert.ok(result.sides.every(s=>s.labelX>=38&&s.labelX<=282&&s.labelY>=23&&s.labelY<=184));
  assert.ok(result.sides.every(s=>s.segments.length===1));
  assert.equal(result.sides.find(s=>s.role==="front").segments[0].y1,
    result.sides.find(s=>s.role==="front").segments[0].y2);
  assert.equal(result.sides.find(s=>s.role==="depthA").segments[0].x1,
    result.sides.find(s=>s.role==="depthA").segments[0].x2);
  assert.deepEqual(plot.sides.depthB.edges,[3],"diagram never remaps source edges");
});

test("plot status appears exactly once in place of shape-card heading, not below plot number",()=>{
  const head=drawer.slice(
    drawer.indexOf('<div className="geo-plot-drawer__head">'),
    drawer.indexOf('<div className="geo-plot-drawer__scroll">'));
  const card=drawer.slice(
    drawer.indexOf('<section className="geo-plot-drawer__diagram-card"'),
    drawer.indexOf('{diagram ? <>'));
  assert.match(head,/<h2>\{"Plot "\+shown\.id\}<\/h2>/);
  assert.doesNotMatch(head,/geo-plot-drawer__status/,"plot header must not duplicate the badge");
  assert.match(card,/geo-plot-drawer__section-top/);
  assert.match(card,/geo-plot-drawer__status--"\+displayStatus/);
  assert.match(card,/\{prettyStatus\(displayStatus\)\}/);
  assert.equal((drawer.match(/prettyStatus\(displayStatus\)/g)||[]).length,1,
    "only one status chip renders per selected plot");
  assert.doesNotMatch(card,/Mapped Plot Shape/);
  assert.match(css,/\.geo-plot-drawer__section-top\{[^}]*justify-content:flex-start/);
  assert.match(css,/\.geo-plot-drawer__status--available\{/);
  assert.match(css,/\.geo-plot-drawer__status--booked\{/);
  assert.match(css,/\.geo-plot-drawer__status--sold\{/);
  assert.match(drawer,/<section className="geo-plot-drawer__facts" aria-label="Plot measurements and status">/);
  assert.match(drawer,/Plot Measurements/);
});

test("four-side diagram aligns Back above, Front below and Depth B/A at the left/right",()=>{
  const output=publicGeoPlotDiagram(mapped);
  const bounds=output.pointText.split(" ").map(x=>x.split(",").map(Number));
  const minX=Math.min(...bounds.map(p=>p[0])),maxX=Math.max(...bounds.map(p=>p[0]));
  const minY=Math.min(...bounds.map(p=>p[1])),maxY=Math.max(...bounds.map(p=>p[1]));
  const byRole=Object.fromEntries(output.sides.map(s=>[s.role,s]));
  assert.equal(byRole.back.labelX,byRole.front.labelX,
    "back and front captions must be aligned to the same vertical centerline");
  assert.ok(byRole.back.labelY<minY,"Back caption must sit above the plot");
  assert.ok(byRole.front.labelY>maxY,"Front caption must sit below the plot");
  assert.ok(byRole.depthB.labelX<minX,"Depth B caption must sit left of the plot");
  assert.ok(byRole.depthA.labelX>maxX,"Depth A caption must sit right of the plot");
  assert.equal(byRole.depthA.labelY,byRole.depthB.labelY,
    "both depth captions must share a balanced mid-height");
  assert.deepEqual(output.sides.map(s=>s.label),
    ["Front","Back","Depth A","Depth B"]);
  assert.ok(output.sides.every(s=>s.labelX>=38&&s.labelX<=282&&
    s.labelY>=24&&s.labelY<=184));
});

test("Plot 18 irregular short Back edge cannot send Back label to Depth A's right column",()=>{
  // Matches the narrow five-corner visual pattern: a small slanted Back
  // segment beside the top-right corner previously pushed Back to the right.
  // The published side assignments and source measurement values remain intact.
  const plot={...mapped,id:"18",corners:[[0,0],[18,0],[20,3],[20,50],[0,50]],
    sides:{
      front:{...mapped.sides.front,edges:[3],length:21.67},
      back:{...mapped.sides.back,edges:[1],length:26.58},
      depthA:{...mapped.sides.depthA,edges:[2],length:48.25},
      depthB:{...mapped.sides.depthB,edges:[4,0],length:53.17},
    },
  };
  const original=structuredClone(plot);
  const output=publicGeoPlotDiagram(plot);
  const byRole=Object.fromEntries(output.sides.map(s=>[s.role,s]));
  const points=output.pointText.split(" ").map(x=>x.split(",").map(Number));
  assert.equal(byRole.back.labelX,byRole.front.labelX,
    "even a short diagonal Back segment must render its caption centered above");
  assert.ok(byRole.back.labelY<Math.min(...points.map(p=>p[1])));
  assert.ok(byRole.back.labelX<byRole.depthA.labelX);
  assert.equal(byRole.depthA.labelY,byRole.depthB.labelY);
  assert.deepEqual(output.sides.map(s=>[s.role,s.length]),[
    ["front",21.67],["back",26.58],["depthA",48.25],["depthB",53.17],
  ]);
  assert.deepEqual(output.sides.find(s=>s.role==="back").segments.length,1);
  assert.deepEqual(plot,original,"caption alignment must never mutate published mapped polygon data");
});

test("triangle stays geometry-based and missing dimensions create no invented captions",()=>{
  const triangle={...mapped,layout:"three",
    corners:[[0,0],[18,0],[9,19]],sides:{
      front:{...mapped.sides.front,edges:[0]},
      back:{...mapped.sides.back,edges:[1]},
      depthA:{...mapped.sides.depthA,edges:[2]},
    },
  };
  const output=publicGeoPlotDiagram(triangle);
  assert.equal(output.vertexCount,3);
  assert.equal(output.sides.length,3);
  assert.ok(output.sides.every(s=>Number.isFinite(s.labelX)&&Number.isFinite(s.labelY)));
  const missing={...mapped,sides:{...mapped.sides,back:null}};
  const display=publicGeoPlotDiagram(missing);
  assert.equal(display.sides.find(s=>s.role==="back"),undefined);
  assert.equal(display.sides.find(s=>s.role==="front").length,25);
});
