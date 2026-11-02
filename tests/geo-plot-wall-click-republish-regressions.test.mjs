import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const layer=read("apps/public/src/geo/geoPlotModelOverlay.ts");
const viewer=read("apps/public/src/geo/GeoPublicDemo.tsx");
const worker=read("workers/geo-plot-mapping.mjs");
const admin=read("apps/admin/src/geo/GeoPlotMapper.tsx");

test("real 3D walls occlude hidden polygon fills and front/side outlines",()=>{
  assert.match(layer,/depthTest:true,depthWrite:false/g);
  const number=(layer.match(/depthTest:true,depthWrite:false/g)||[]).length;
  assert.equal(number,2,"both the plot fill and line must respect the depth buffer");
  assert.doesNotMatch(layer,/depthTest:false/);
  assert.match(layer,/ray\.intersectObjects\(touched,false\)/);
  assert.match(layer,/center\[0\]\+\(x-center\[0\]\)\*0\.3/);
  assert.match(layer,/center\[1\]\+\(z-center\[1\]\)\*0\.3/);
  assert.match(viewer,/placement\.anchorOffset\.add\(plotLayer\.group\)/);
  assert.doesNotMatch(viewer,/new google\.maps\.Polygon\(/);
});

test("map plot selection accepts direct tap even when Google swallows click, without hijacking pan",()=>{
  assert.match(viewer,/pointerHost\?\.addEventListener\("pointerdown",onNativePointerDown,true\)/);
  assert.match(viewer,/pointerHost\?\.addEventListener\("pointerup",onNativePointerUp,true\)/);
  assert.match(viewer,/mapClick=map\.addListener\("click"/);
  assert.match(viewer,/selectAtScreenPoint\(event\.clientX,event\.clientY\)/);
  assert.match(viewer,/selectAtScreenPoint\(coords\.x,coords\.y\)/);
  assert.match(viewer,/drift>8\|\|performance\.now\(\)-start\.time>850/);
  assert.match(viewer,/mapControlTarget\(event\.target\)/);
  assert.match(viewer,/pointerHost\.removeEventListener\("pointerdown",onNativePointerDown,true\)/);
  assert.match(viewer,/pointerHost\.removeEventListener\("pointerup",onNativePointerUp,true\)/);
  assert.match(viewer,/pickModelGeoPlot\(/);
  assert.match(viewer,/setSelectedPlot\(plotIds\.get\(id\)\|\|null\)/);
  assert.match(viewer,/<GeoPlotDetailsDrawer/);
});

test("publishing an already-live draft is idempotent without duplicate sqlite insert",()=>{
  const schema=read("database/migrations/0039_geo_plot_mapping_v1.sql");
  assert.match(schema,/UNIQUE\(experience_id,geo_release_id,draft_revision\)/);
  assert.match(worker,/const prior=await previousRelease\(\)/);
  assert.match(worker,/if\(await existingIsCurrent\(prior\)\)return state\(env,ctx\)/);
  assert.match(worker,/SQLITE_CONSTRAINT_UNIQUE\|UNIQUE constraint failed/);
  assert.match(worker,/const winner=await previousRelease\(\)/);
  assert.match(worker,/if\(await existingIsCurrent\(winner\)\)return state\(env,ctx\)/);
  assert.match(worker,/preflight\.token/);
  assert.match(worker,/body\.expectedActiveReleaseId/);
  assert.match(worker,/draft\.revision!==body\.expectedRevision/);
  assert.match(worker,/verified_revision=d\.revision/);
  assert.match(worker,/COALESCE\(\(SELECT a.mapping_release_id FROM geo_plot_mapping_active_3d/);
});

test("Admin clearly explains already-live r37/v1 and how to create the next release",()=>{
  assert.match(admin,/activeMapping\.draftRevision===state\.draft\.revision/);
  assert.match(admin,/already LIVE as Mapping v/);
  assert.match(admin,/edit any Plot/i);
  assert.match(admin,/Publish Preliminary Mapping · Editable Later/);
});
