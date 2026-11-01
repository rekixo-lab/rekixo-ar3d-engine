import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {stageVerifiedImageCorner} from "../shared/geo-plot-image-corner.js";
import {validateGeoPlotCollection} from "../workers/geo-plot-geometry.mjs";
const side=(i,road=false)=>({edges:[i],length:10,unit:"m",
  source:"Approved survey p5",verified:true,roadFacing:road});
const sample=(id="1",shift=0)=>({id,corners:[[shift,0],[shift+10,0],[shift+10,10],[shift,10]],
  layout:"four",sides:{front:side(0,true),depthA:side(1),back:side(2),depthB:side(3)},
  area:{value:100,unit:"sqm",source:"Approved survey p5",verified:true},
  facing:"east",facingSource:"Survey north",facingVerified:true,
  planeY:0,planeSource:"Model datum",planeVerified:true,road:"20 foot road",notes:"original"});
const map={a:10,b:0,tx:0,tz:0,imageAspect:2};
test("Verified image U/V maps to the same Building-local 3D plot corner; no separate image Plot ID",()=>{
  const first=sample();
  const result=stageVerifiedImageCorner([first],"1",0,[.005,0],map);
  assert.equal(result.plotId,"1");
  assert.equal(result.cornerIndex,0);
  assert.deepEqual(result.modelPoint,[.1,0]);
  assert.deepEqual(result.plots[0].corners[0],[.1,0]);
  assert.equal(result.plots[0].area.verified,false);
  assert.equal(result.plots[0].facingVerified,false);
  assert.equal(result.plots[0].planeVerified,false);
  assert.deepEqual(result.plots[0].sides.front.edges,[0]);
  assert.equal(result.plots[0].sides.front.verified,false);
  assert.equal(result.plots[0].sides.front.roadFacing,false);
  assert.equal(result.plots[0].area.source,"Approved survey p5");
  assert.deepEqual(first,sample(),"the original snapshot remains untouched");
  assert.equal(validateGeoPlotCollection(result.plots).length,1);
  assert.throws(()=>validateGeoPlotCollection(result.plots,{forPublish:true}),/verify|road-facing|site plane/i);
});
test("Image editing fails closed on bad UV, wrong canonical ID, invalid corner, unchanged point and model transform",()=>{
  const first=sample();
  for(const [id,index,uv,t,pattern] of [
    ["2",0,[.005,0],map,/existing canonical/],
    ["1",4,[.005,0],map,/existing plot corner/],
    ["1",0,[-.5,0],map,/U\/V range/],
    ["1",0,[0,0],map,/no geometry change/],
    ["1",0,[.005,0],{...map,a:NaN},/Building-local limits/]
  ])assert.throws(()=>stageVerifiedImageCorner([first],id,index,uv,t),pattern);
  assert.deepEqual(first,sample());
});
test("An image click cannot cross plot interiors or create invalid polygon geometry",()=>{
  const one=sample("1"),two=sample("2",10);
  assert.deepEqual(validateGeoPlotCollection([one,two]).map(p=>p.id),["1","2"]);
  assert.throws(()=>stageVerifiedImageCorner([one,two],"1",1,[.55,0],map),/overlap/i);
  assert.throws(()=>stageVerifiedImageCorner([one,two],"1",1,[0,0],map),/zero-length|duplicate/i);
  assert.deepEqual(two,sample("2",10));
});
test("Image edit UI is source-hash and independent-checkpoint gated before staging with explicit operator confirmation",()=>{
  const root=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
  const ui=root("apps/admin/src/geo/GeoPlotImageAlignmentPanel.tsx");
  const mapper=root("apps/admin/src/geo/GeoPlotMapper.tsx");
  assert.match(ui,/isVerified&&!stale&&editable&&actualImage&&imageUrl/);
  assert.match(ui,/onStageImageCorner/);
  assert.match(ui,/stageImageCorner/);
  assert.match(ui,/Edit Existing Plot Corners on Verified Image/);
  assert.match(ui,/pendingEdit/);
  assert.match(mapper,/state.alignmentRevision!==alignmentRevision/);
  assert.match(mapper,/stageVerifiedImageCorner\(plots,plotId,index,uv,transform\)/);
  assert.match(mapper,/window.confirm\("Stage Plot "/);
  assert.match(mapper,/setPlots\(staged.plots\);setDirty\(true\)/);
  const pure=root("shared/geo-plot-image-corner.js");
  assert.doesNotMatch(pure,/fetch\(|INSERT INTO|UPDATE /);
});
