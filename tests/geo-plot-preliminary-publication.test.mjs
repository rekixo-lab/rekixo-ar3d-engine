import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {validateGeoPlotCollection} from "../workers/geo-plot-geometry.mjs";
import {publicGeoPlotFacts,preliminaryPublishPlotGuard,normalizeGeoPlotPublicationMode}
  from "../shared/geo-plot-publication-mode.js";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const plot={
  id:"1",corners:[[0,0],[10,0],[10,10],[0,10]],layout:"four",planeY:0,planeSource:"",planeVerified:false,
  sides:{
    front:{edges:[0],length:10,unit:"m",source:"",verified:false,roadFacing:false},
    depthA:{edges:[1],length:10,unit:"m",source:"",verified:false,roadFacing:false},
    back:{edges:[2],length:10,unit:"m",source:"",verified:false,roadFacing:false},
    depthB:{edges:[3],length:10,unit:"m",source:"",verified:false,roadFacing:false}
  },
  area:{value:100,unit:"sqm",source:"",verified:false},
  facing:"north",facingSource:"",facingVerified:false,road:"23 feet road",notes:"Private source note"
};
test("preliminary publish preserves valid mapped geometry while verified source gate remains strict",()=>{
  const normalized=validateGeoPlotCollection([plot]);
  assert.equal(normalized.length,1);
  assert.equal(preliminaryPublishPlotGuard(normalized,[{id:"1"}]),true);
  assert.throws(()=>validateGeoPlotCollection([plot],{forPublish:true}),/plane|verify/);
  assert.throws(()=>preliminaryPublishPlotGuard([],[]),/Map at least/);
  assert.throws(()=>preliminaryPublishPlotGuard(normalized,[{id:"2"}]),/absent from approved CSV/);
  assert.throws(()=>validateGeoPlotCollection([plot,{...plot,id:"1"}]),/Duplicate/);
  assert.throws(()=>validateGeoPlotCollection([{...plot,corners:[[0,0],[10,10],[10,0],[0,10]]}]),/self-intersecting/);
  assert.throws(()=>validateGeoPlotCollection([plot,{...plot,id:"2"}]),/overlap/);
});
test("preliminary public plot hides all unverified site facts and commercial notes",()=>{
  const pub=publicGeoPlotFacts(plot,"preliminary");
  assert.deepEqual(pub.corners,plot.corners);
  assert.equal(pub.id,"1");
  assert.equal(pub.area,null);
  assert.equal(pub.facing,null);
  assert.equal(pub.road,null);
  assert.deepEqual(pub.sides,{});
  assert.equal(pub.notes,"");
  assert.equal(Object.hasOwn(pub,"planeY"),false,"unreviewed Y must use canonical model-ground fallback");
  assert.equal(normalizeGeoPlotPublicationMode("verified"),"verified");
  assert.throws(()=>normalizeGeoPlotPublicationMode("mislabeled"),/Unknown/);
});
test("preliminary public plot may show individually verified fields but not unapproved road",()=>{
  const staged=structuredClone(plot);
  staged.area.verified=true;staged.area.source="approved masterplan";
  staged.sides.depthA.verified=true;staged.sides.depthA.source="approved drawing";
  staged.facingVerified=true;staged.facingSource="survey north";
  const pub=publicGeoPlotFacts(staged,"preliminary");
  assert.deepEqual(pub.area,{value:100,unit:"sqm"});
  assert.equal(pub.facing,"north");
  assert.deepEqual(Object.keys(pub.sides),["depthA"]);
  assert.deepEqual(pub.sides.depthA.edges,[1],"only approved side edge indices are public");
  assert.equal(pub.road,null);
  const approved=publicGeoPlotFacts({...staged,road:"23 feet road",
    sides:{...staged.sides,front:{...staged.sides.front,verified:true,
      source:"approved road drawing",roadFacing:true}}},"preliminary");
  assert.equal(approved.road,"23 feet road");
});
test("historic verified releases retain their existing content",()=>{
  const obj=publicGeoPlotFacts(plot,"verified");
  assert.equal(obj,plot);
  assert.equal(obj.road,"23 feet road");
});
test("release mode is immutable D1 metadata, owner-only CAS, old verified schema default",()=>{
  const migration=read("database/migrations/0051_geo_plot_preliminary_publication.sql");
  const server=read("workers/geo-plot-mapping.mjs");
  const published=read("workers/geo-plot-public.mjs");
  const publicUI=read("apps/public/src/geo/GeoPublicDemo.tsx");
  const admin=read("apps/admin/src/geo/GeoPlotMapper.tsx");
  assert.match(migration,/ADD COLUMN publication_mode TEXT NOT NULL DEFAULT 'verified'/);
  assert.match(migration,/CHECK\(publication_mode IN \('verified','preliminary'\)\)/);
  assert.match(server,/body\.action==="publish-preliminary"/);
  assert.match(server,/publicationMode=preliminary\?"preliminary":"verified"/);
  assert.match(server,/expectedPreflightToken/);
  assert.match(server,/expectedActiveReleaseId/);
  assert.match(server,/geo_release_id=\?/);
  assert.match(server,/d\.revision=\?/);
  assert.match(server,/verified_revision=d\.revision/);
  assert.match(server,/preliminaryPublishPlotGuard\(plots,inventory.rows\)/);
  assert.match(published,/row\.publication_mode/);
  assert.match(published,/publicGeoPlotFacts\(plot,publicationMode\)/);
  assert.match(published,/publicationMode==="verified"/);
  assert.match(read("apps/public/src/geo/GeoPlotDetailsDrawer.tsx"),/publicationMode==="preliminary"/);
  assert.match(publicUI,/<GeoPlotDetailsDrawer/);
  assert.match(admin,/Publish Preliminary Mapping · Editable Later/);
  assert.match(admin,/Publish Verified Mapping to Customer Site/);
  assert.match(admin,/action==="publish-preliminary"/);
});
