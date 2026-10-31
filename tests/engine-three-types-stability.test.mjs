import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { serveR2Object } from "../workers/http-range.mjs";
import { publicMasterplanResponse } from "../workers/masterplan-geo-public.mjs";
import { publicMasterplanShareSnapshot } from "../workers/masterplan-share-public.mjs";
import { handleProjectManagementAdmin } from "../workers/project-management.mjs";
import { validateMasterplanDraft } from "../workers/masterplan-geo-geometry.mjs";

const sha = text => createHash("sha256").update(text).digest("hex");
const source = {
  imageAssetId:"original-image-1",width:2400,height:1600,
  controlPoints:[
    {u:0,v:0,lat:22.7,lng:75.8,verified:true,source:"survey corner 1"},
    {u:1,v:0,lat:22.7,lng:75.801,verified:true,source:"survey corner 2"},
    {u:0,v:1,lat:22.699,lng:75.8,verified:true,source:"survey corner 3"}
  ],
  plots:[{
    id:"15",corners:[[.1,.1],[.4,.1],[.4,.3],[.1,.3]],layout:"four",
    sides:{
      front:{edges:[0],length:45,unit:"ft",source:"approved",verified:true},
      back:{edges:[1],length:45,unit:"ft",source:"approved",verified:true},
      depthA:{edges:[2],length:60,unit:"ft",source:"approved",verified:true},
      depthB:{edges:[3],length:60,unit:"ft",source:"approved",verified:true}
    },area:{value:2700,unit:"sqft",source:"approved",verified:true},
    facing:"north",facingSource:"north arrow",facingVerified:true
  }]
};
const originalHash="0".repeat(64);
const data = {
  schema:"rekixo-masterplan-geo-v1",
  image:{assetId:source.imageAssetId,width:source.width,height:source.height,
    sha256:originalHash,mimeType:"image/png"},
  controlPoints:source.controlPoints,plots:source.plots,
  calibration:validateMasterplanDraft(source,{publish:true}).calibration
};
function publicEnv(mapping){
  const mappingJSON=JSON.stringify(mapping);
  const row={
    id:"project-id",name:"Surveyed Project",location:"Indore",
    release_id:"release1",version:1,mapping_json:mappingJSON,mapping_sha256:sha(mappingJSON),
    source_asset_id:source.imageAssetId,source_sha256:originalHash,
    r2_key:"projects/example-project/draft-assets/original-image-1",
    mime_type:"image/png",byte_size:2048,asset_sha256:originalHash,deleted_at:null
  };
  return {DB:{prepare(sql){
    if(sql.includes("FROM projects_3d p JOIN masterplan_geo_active_3d"))
      return {bind(){return {first:async()=>row}}};
    if(sql.includes("FROM engine_settings_3d"))
      return {all:async()=>({results:[]})};
    throw Error("Unexpected public database query: "+sql);
  }}};
}
test("published masterplan validates a valid verified affine Geo transform",async()=>{
  const res=await publicMasterplanResponse(
    new Request("https://engine.example/3Dprojects/api/projects/example-project/masterplan"),
    publicEnv(data),"example-project","masterplan");
  assert.equal(res.status,200);
  const payload=await res.json();
  assert.equal(payload.calibration.transform.lat.length,3);
  assert.equal(payload.plots[0].id,"15");
  assert.equal(payload.image.width,2400);
});
test("published masterplan fails closed for missing, nonfinite or tampered Geo transforms",async()=>{
  const cases=[
    {...data,calibration:undefined},
    {...data,calibration:{...data.calibration,transform:{lat:[1,2,NaN],lng:[1,2,3]}}},
    {...data,calibration:{...data.calibration,transform:{...data.calibration.transform,
      lng:[...data.calibration.transform.lng.slice(0,2),data.calibration.transform.lng[2]+0.003]}}},
    {...data,image:{...data.image,mimeType:"image/svg+xml"}}
  ];
  for(const mapping of cases){
    const res=await publicMasterplanResponse(new Request(
      "https://engine.example/3Dprojects/api/projects/example-project/masterplan"),
      publicEnv(mapping),"example-project","masterplan");
    assert.equal(res.status,503,"invalid published mapping must not reach customer");
  }
});
test("strict R2 metadata binding rejects a published-image object with the wrong checksum",async()=>{
  const good="a".repeat(64),wrong="b".repeat(64);
  const bucket={head:async()=>({size:100,customMetadata:{sha256:wrong},
    httpEtag:'"test-etag"',writeHttpMetadata() {}})};
  const result=await serveR2Object(bucket,"any-key",
    new Request("https://engine.example/asset",{method:"HEAD"}),
    {mimeType:"image/png",expectedSize:100,sha256:good,verifyStoredChecksum:true});
  assert.match(result.corruption,/checksum metadata mismatch/);
  assert.equal(result.response,undefined);
  const accepted=await serveR2Object({...bucket,head:async()=>({
    size:100,customMetadata:{sha256:good},httpEtag:'"test-etag"',
    writeHttpMetadata() {}
  })},"any-key",new Request("https://engine.example/asset",{method:"HEAD"}),
  {mimeType:"image/png",expectedSize:100,sha256:good,verifyStoredChecksum:true});
  assert.equal(accepted.response.status,200);
});
test("published share preview stays available when active Plot Mapping advances",async()=>{
  const row={title:"Surveyed Masterplan",description:"New available plots",share_id:"share-v1",
    card_sha256:originalHash,card_asset_id:"card-id",asset_sha256:originalHash,
    r2_key:"projects/example-project/draft-assets/card-id",
    mime_type:"image/jpeg",byte_size:35000,deleted_at:null};
  const env={DB:{prepare(sql){
    assert.match(sql,/JOIN masterplan_geo_releases_3d m/);
    assert.doesNotMatch(sql,/JOIN masterplan_geo_active_3d m/);
    return {bind(){return {first:async()=>row}}};
  }}};
  const snapshot=await publicMasterplanShareSnapshot(env,"example-project");
  assert.match(snapshot.shareImageUrl,/masterplan-share-card\?v=share-v1/);
  assert.equal(snapshot.hasShareCard,true);
});
test("lookalike Google Maps host is blocked before writing project profile",async()=>{
  const req=new Request("https://engine.example/3Dprojects/api/cloud/projects/example-project/manage",{
    method:"PUT",headers:{"Origin":"https://engine.example","Content-Type":"application/json"},
    body:JSON.stringify({expectedRevision:0,profile:{mapsUrl:"https://maps.google.evil.com/fake"}})
  });
  const res=await handleProjectManagementAdmin(req,{}, {email:"owner@example.com"},{
    id:"project-id",slug:"example-project",status:"draft"},["example-project","manage"]);
  assert.equal(res.status,409);
  assert.match((await res.json()).error,/Google Maps HTTPS/);
});
test("authenticated asset previews are inline only when explicitly requested",()=>{
  const api=readFileSync(new URL("../workers/admin-cloud.mjs",import.meta.url),"utf8");
  const workspace=readFileSync(new URL("../apps/admin/src/masterplan/MasterplanWorkspace.tsx",import.meta.url),"utf8");
  const poster=readFileSync(new URL("../apps/admin/src/masterplan/MasterplanShareBuilder.tsx",import.meta.url),"utf8");
  const viewer=readFileSync(new URL("../apps/public/src/masterplan/MasterplanPublic.tsx",import.meta.url),"utf8");
  assert.match(api,/url\.searchParams\.get\("preview"\) === "1"/);
  assert.match(api,/Content-Disposition", inlinePreview/);
  assert.match(workspace,/contentUrl\+"\?preview=1"/);
  assert.match(poster,/contentUrl\+"\?preview=1"/);
  assert.match(viewer,/if\(!data\)return;/);
  assert.match(viewer,/visibility:fallback\?"hidden":"visible"/);
  assert.doesNotMatch(viewer,/display:fallback\?"none":"block"/);
});
