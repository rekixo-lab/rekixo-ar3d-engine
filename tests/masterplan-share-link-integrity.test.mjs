import test from "node:test";
import assert from "node:assert/strict";
import {publicMasterplanShareSnapshot,servePublicMasterplanShareCard} from "../workers/masterplan-share-public.mjs";
import {injectPublicBrandingMetadata} from "../workers/project-branding.mjs";
import {handleMasterplanShareAdmin} from "../workers/masterplan-share-admin.mjs";

const slug="test-layout",id="share-old";
const oldShare={
  title:"Approved Masterplan",description:"Original approved mapping and plot availability",
  share_id:id,card_sha256:"a".repeat(64),card_asset_id:"card-asset",
  asset_sha256:"a".repeat(64),r2_key:"projects/test-layout/draft-assets/card-asset",
  mime_type:"image/jpeg",byte_size:24000,deleted_at:null
};
function publicDb(){
  return {DB:{prepare(sql){
    assert.match(sql,/JOIN masterplan_geo_releases_3d m/);
    assert.match(sql,/JOIN masterplan_share_releases_3d s ON s.project_id=p.id AND s.id=\?/);
    assert.doesNotMatch(sql,/JOIN masterplan_share_active_3d active/);
    return {bind(...args){
      assert.deepEqual(args,[id,slug],"Pinned share lookup must not use the new active share");
      return {first:async()=>oldShare};
    }};
  }}};
}
test("pinned old masterplan share still resolves the old published poster",async()=>{
  const snapshot=await publicMasterplanShareSnapshot(publicDb(),slug,id);
  assert.equal(snapshot.title,oldShare.title);
  assert.equal(snapshot.hasShareCard,true);
  assert.equal(snapshot.shareImageUrl,
    "/3Dprojects/api/projects/test-layout/masterplan-share-card?v=share-old");
});
test("public HTML metadata pins old masterplan share on its canonical URL",async()=>{
  const url="https://ar3dstudio.in/3Dprojects/test-layout/masterplan?share=share-old";
  const res=await injectPublicBrandingMetadata(new Request(url),publicDb(),
    new Response("<html><head><title>Fallback</title></head><body>Viewer</body></html>",
      {headers:{"Content-Type":"text/html; charset=utf-8"}}));
  assert.equal(res.status,200);
  const html=await res.text();
  assert.match(html,/property="og:title" content="Approved Masterplan"/);
  assert.match(html,/property="og:image" content="https:\/\/ar3dstudio\.in\/3Dprojects\/api\/projects\/test-layout\/masterplan-share-card\?v=share-old"/);
  assert.match(html,/property="og:url" content="https:\/\/ar3dstudio\.in\/3Dprojects\/test-layout\/masterplan\?share=share-old"/);
});
test("admin share state returns canonical public link rather than admin hostname",async()=>{
  const env={DB:{prepare(sql){
    if(sql.includes("SELECT * FROM masterplan_share_drafts_3d"))
      return {bind(){return {first:async()=>null}}};
    if(sql.includes("FROM masterplan_share_active_3d a"))
      return {bind(){return {first:async()=>({
        id,version:2,revision:3,title:oldShare.title,
        description:oldShare.description,card_asset_id:"card-asset",
        published_at:"2026-10-31"
      })}}};
    if(sql.includes("FROM masterplan_share_releases_3d WHERE project_id=?"))
      return {bind(){return {all:async()=>({results:[]})}}};
    throw Error("Unexpected SQL "+sql);
  }}};
  const res=await handleMasterplanShareAdmin(
    new Request("https://admin.rekixo.com/3Dprojects/api/cloud/projects/test-layout/masterplan-share"),
    env,{email:"owner@example.com"},
    {id:"project-id",slug,status:"published",name:"Test Project",project_kind:"masterplan_geo"},
    [slug,"masterplan-share"]);
  assert.equal(res.status,200);
  const state=await res.json();
  assert.equal(state.shareUrl,"https://ar3dstudio.in/3Dprojects/test-layout/masterplan?share=share-old");
});

test("pinned public OpenGraph poster is actually downloadable via GET and HEAD",async()=>{
  const image=new Uint8Array(oldShare.byte_size);image.fill(42);
  let reads=0;
  const env={...publicDb(),MODEL_ASSETS:{
    async head(key){
      assert.equal(key,oldShare.r2_key);
      return {size:image.length,httpEtag:"test-immutable-poster",
        customMetadata:{sha256:oldShare.card_sha256}};
    },
    async get(key){
      assert.equal(key,oldShare.r2_key);
      reads++;
      return {body:new Blob([image],{type:"image/jpeg"}).stream()};
    }
  }};
  const url="https://ar3dstudio.in/3Dprojects/api/projects/test-layout/masterplan-share-card?v=share-old";
  const get=await servePublicMasterplanShareCard(new Request(url),env,slug);
  assert.equal(get.status,200);
  assert.equal(get.headers.get("content-type"),"image/jpeg");
  assert.equal(get.headers.get("content-length"),String(image.length));
  assert.equal((await get.arrayBuffer()).byteLength,image.length);
  const head=await servePublicMasterplanShareCard(new Request(url,{method:"HEAD"}),env,slug);
  assert.equal(head.status,200);
  assert.equal(head.headers.get("content-length"),String(image.length));
  assert.equal(reads,1,"HEAD must not download image bytes");
  const invalid=await servePublicMasterplanShareCard(
    new Request(url.replace("share-old","../../invalid")),env,slug);
  assert.equal(invalid.status,404);
});
