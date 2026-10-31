import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import adminWorker from "../workers/admin.mjs";
import {handleGeoPlotMappingAdmin,readPublishedGeoPlotSource,verifiedGeoPlotSourceResponse}
  from "../workers/geo-plot-mapping.mjs";

const ctx={active:{geo_release_id:"geo-v3",source_building_release_id:"building-v8"}};
const canonical="/3Dprojects/api/releases/building-v8/models/source-model/model.glb?v=8";
const experience={
  geoRelease:{id:"geo-v3"},buildingRelease:{id:"building-v8"},
  placement:{headingDeg:137,scale:1.25},
  canonicalModel:{url:canonical,sha256:"b".repeat(64),byteSize:2351234},
  model:{url:canonical,sha256:"b".repeat(64),byteSize:2351234}
};
test("Admin mapper reads verified legacy Geo source and same-origin immutable model route",async()=>{
  const response=verifiedGeoPlotSourceResponse(ctx,experience);
  assert.equal(response.status,200);
  assert.match(response.headers.get("content-type"),/application\/json/);
  const payload=await response.json();
  assert.equal(payload.geoRelease.id,"geo-v3");
  assert.equal(payload.buildingRelease.id,"building-v8");
  assert.equal(payload.canonicalModel.url,canonical);
  assert.equal(payload.placement.scale,1.25);
  assert.equal(payload.placement.headingDeg,137);
});
test("source rejects stale releases, foreign model URLs and malformed checksum",async()=>{
  const stale=verifiedGeoPlotSourceResponse(ctx,{...experience,geoRelease:{id:"old-geo"}});
  assert.equal(stale.status,409);
  assert.match((await stale.json()).error,/Geo release changed/);
  const foreign=verifiedGeoPlotSourceResponse(ctx,{
    ...experience,canonicalModel:{...experience.canonicalModel,
      url:"https://untrusted.example/model.glb"}
  });
  assert.equal(foreign.status,503);
  const mutated=verifiedGeoPlotSourceResponse(ctx,{
    ...experience,canonicalModel:{...experience.canonicalModel,sha256:"not-hash"}
  });
  assert.equal(mutated.status,503);
  assert.equal(verifiedGeoPlotSourceResponse(ctx,{...experience,model:null}).status,503);
  // Older release readers may not expose an asset checksum; original release
  // manifest integrity remains verified at the source loader.
  const old=verifiedGeoPlotSourceResponse(ctx,{
    ...experience,canonicalModel:{url:canonical,byteSize:2351234}
  });
  assert.equal(old.status,200);
});
test("published source cannot invent a Geo release if the DB schema is missing",async()=>{
  const env={DB:{prepare(){return {all:async()=>({results:[]})}}}};
  const response=await readPublishedGeoPlotSource(env,ctx,"satharai");
  assert.equal(response.status,409);
  assert.match(response.headers.get("content-type"),/application\/json/);
  assert.match((await response.json()).error,/published Geo release is required/);
});
test("Admin does not serve SPA HTML at missing API routes",async()=>{
  const url="https://admin.rekixo.com/3Dprojects/api/projects/satharai/geo-placement";
  const response=await adminWorker.fetch(new Request(url),{
    ASSETS:{fetch(){throw Error("Do not fall back to SPA for unknown Admin API.");}}
  });
  assert.equal(response.status,404);
  assert.match(response.headers.get("content-type"),/application\/json/);
  assert.match((await response.json()).error,/Unknown Engine Admin API route/);
});
test("new Geo Plot source API is protected by Admin authentication",async()=>{
  const request=new Request("https://admin.rekixo.com/3Dprojects/api/cloud/projects/satharai/geo-plots/source");
  const response=await handleGeoPlotMappingAdmin(request,{});
  assert.equal(response.status,503);
  assert.match(response.headers.get("content-type"),/application\/json/);
  assert.match((await response.json()).error,/Admin authentication/);
});
test("Geo Plot Mapper no longer requests the public-only Geo route from Admin origin",()=>{
  const source=readFileSync(new URL("../apps/admin/src/geo/GeoPlotMapper.tsx",import.meta.url),"utf8");
  const server=readFileSync(new URL("../workers/geo-plot-mapping.mjs",import.meta.url),"utf8");
  const admin=readFileSync(new URL("../workers/admin.mjs",import.meta.url),"utf8");
  assert.match(source,/geo-plots\/source/);
  assert.doesNotMatch(source,/callApi<GeoPublic>\(`\/3Dprojects\/api\/projects/);
  assert.match(source,/Geo Plot Mapper API returned a web page instead of JSON/);
  assert.match(source,/Retry loading Geo source/);
  assert.match(server,/engineAdminReadAccess/);
  assert.match(server,/activeGeoReleaseState/);
  assert.match(server,/publicGeoExperienceFromState/);
  assert.match(server,/match\[2\]==="source"/);
  assert.match(admin,/handleReleaseReadRequest/);
});
