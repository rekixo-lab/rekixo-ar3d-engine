import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { polygonAreaSqm,polygonHasCrossings,validateGeoPlot,validateGeoPlotCollection } from "../workers/geo-plot-geometry.mjs";
const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const square={
  id:"25",corners:[[0,0],[10,0],[10,20],[0,20]],layout:"four",
  sides:{
    front:{edges:[0],length:32.8,unit:"ft",roadFacing:true,source:"Survey-2026",verified:true},
    depthA:{edges:[1],length:65.6,unit:"ft",roadFacing:false,source:"Survey-2026",verified:true},
    back:{edges:[2],length:32.8,unit:"ft",roadFacing:false,source:"Survey-2026",verified:true},
    depthB:{edges:[3],length:65.6,unit:"ft",roadFacing:false,source:"Survey-2026",verified:true}
  },
  area:{value:2152.78,unit:"sqft",source:"approved-plan",verified:true},
  facing:"north-east",facingSource:"Geo north survey",facingVerified:true,road:"23 ft road",notes:"corner site"
};
test("plot square has metre area and no invalid crossings",()=>{
  assert.equal(polygonAreaSqm(square.corners),200);
  assert.equal(polygonHasCrossings(square.corners),false);
  assert.equal(validateGeoPlot(square).corners.length,4);
});
test("self intersection, duplicate and zero-area plots are rejected",()=>{
  assert.equal(polygonHasCrossings([[0,0],[10,10],[0,10],[10,0]]),true);
  assert.throws(()=>validateGeoPlot({...square,corners:[[0,0],[10,10],[0,10],[10,0]]}),/degenerate|self-intersecting/);
  assert.throws(()=>validateGeoPlot({...square,corners:[[0,0],[10,0],[10,0],[0,20]]}),/zero-length/);
});
test("mapping rejects duplicate plot IDs case-insensitively and foreign side indices",()=>{
  assert.throws(()=>validateGeoPlotCollection([square,{...square,id:"25"}]),/Duplicate/);
  assert.throws(()=>validateGeoPlot({...square,sides:{...square.sides,front:{...square.sides.front,edges:[90]}}}),/assign front/);
  assert.throws(()=>validateGeoPlot({...square,sides:{...square.sides,back:{...square.sides.back,edges:[0]}}}),/cannot belong/);
});
test("mapping requires verified authoritative measurements to publish",()=>{
  assert.equal(validateGeoPlotCollection([square],{forPublish:true}).length,1);
  assert.throws(()=>validateGeoPlotCollection([{...square,area:{...square.area,verified:false}}],{forPublish:true}),/verify authoritative/);
  assert.throws(()=>validateGeoPlotCollection([],{forPublish:true}),/Provide 1/);
  assert.throws(()=>validateGeoPlotCollection([{...square,sides:{...square.sides,front:{...square.sides.front,source:""}}}],{forPublish:true}),/verify authoritative/);
});
test("three-corner irregular and compound side support",()=>{
  const p={...square,corners:[[0,0],[10,0],[5,10]],layout:"three",
    sides:{front:{...square.sides.front,edges:[0]},back:{...square.sides.back,edges:[1]},depthA:{...square.sides.depthA,edges:[2]}}};
  assert.equal(validateGeoPlot(p).layout,"three");
  const poly={...square,corners:[[0,0],[4,0],[10,0],[10,20],[0,20]],sides:{
    front:{...square.sides.front,edges:[0,1]},
    depthA:{...square.sides.depthA,edges:[2]},
    back:{...square.sides.back,edges:[3]},
    depthB:{...square.sides.depthB,edges:[4]}
  }};
  assert.deepEqual(validateGeoPlot(poly).sides.front.edges,[0,1]);
});
test("engine-only isolation, read-back, immutable publish and public release binding",()=>{
  const migration=read("database/migrations/0039_geo_plot_mapping_v1.sql");
  const api=read("workers/geo-plot-mapping.mjs");
  const pub=read("workers/geo-plot-public.mjs");
  const entry=read("workers/admin-entry.mjs");
  const viewer=read("apps/public/src/geo/GeoPublicDemo.tsx");
  const editor=read("apps/admin/src/geo/GeoPlotMapper.tsx");
  assert.match(migration,/geo_plot_release_immutable_update/);
  assert.doesNotMatch(migration,/CREATE TRIGGER IF NOT EXISTS geo_plot_release_immutable_delete/);
  const deletion = read("workers/project-deletion.mjs");
  assert.match(deletion,/geo_plot_mapping_active_3d/);
  assert.match(deletion,/geo_plot_mapping_releases_3d/);
  assert.match(deletion,/geo_plot_mapping_drafts_3d/);
  assert.match(migration,/geo_plot_active_owner_insert/);
  assert.match(api,/engineAdminReadAccess/);
  assert.match(api,/sameOrigin\(request\)/);
  assert.match(api,/expectedRevision/);
  assert.match(api,/verified_revision=revision/);
  assert.match(api,/geo_release_id!==ctx\.active\.geo_release_id/);
  assert.match(pub,/geo_release_id=ga\.geo_release_id/);
  assert.match(pub,/digest\(row\.plots_json\)!==row\.sha256/);
  assert.match(entry,/handleGeoPlotMappingAdmin/);
  assert.match(viewer,/geoPlotWorldPath/);
  assert.match(viewer,/setSelectedPlot\(plot\)/);
  assert.match(editor,/modelFromVerifiedSource/);
  assert.doesNotMatch(api,/rekixo-ar3d-platform/);
});

test("cannot publish unverified facing or non-consecutive irregular side segments",()=>{
  assert.throws(()=>validateGeoPlotCollection([{...square,facingVerified:false}],{forPublish:true}),/verify authoritative/);
  assert.throws(()=>validateGeoPlotCollection([{...square,facingSource:""}],{forPublish:true}),/verify authoritative/);
  const broken={...square,corners:[[0,0],[5,0],[10,0],[10,20],[0,20]],
    sides:{front:{...square.sides.front,edges:[0,2]},depthA:{...square.sides.depthA,edges:[1]},
      back:{...square.sides.back,edges:[3]},depthB:{...square.sides.depthB,edges:[4]}}};
  assert.throws(()=>validateGeoPlot(broken),/contiguous/);
});

test("Geo release changes require explicit audited reset and cannot silently rebind polygons",()=>{
  const api=read("workers/geo-plot-mapping.mjs");
  const ui=read("apps/admin/src/geo/GeoPlotMapper.tsx");
  assert.match(api,/resetForNewGeo/);
  assert.match(api,/body\.confirmation !== "RESET MAPPING " \+ ctx\.project\.slug/);
  assert.match(api,/plots_json='\[\]'/);
  assert.match(api,/geo\.plots_reset_for_new_source/);
  assert.match(ui,/window\.prompt/);
  assert.match(ui,/rebind-reset/);
});
