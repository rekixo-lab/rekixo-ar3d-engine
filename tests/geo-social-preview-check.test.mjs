import test from "node:test";
import assert from "node:assert/strict";
import {verifyGeoSocialPreview} from "../scripts/geo-social-preview-check.mjs";
const source="https://ar3dstudio.in/3Dprojects/demo-a/geo?share=version5";
const poster="https://ar3dstudio.in/3Dprojects/api/projects/demo-a/branding/share-card?experience=geo&v=version5";
const html='<html><head><meta property="og:url" content="'+source+'">'+
  '<meta property="og:title" content="Approved Plot Demo">'+
  '<meta property="og:description" content="View verified Geo building.">'+
  '<meta property="og:image" content="'+poster+'"></head></html>';
const bytes=new Uint8Array(128);
bytes.set([82,73,70,70],0);bytes.set([87,69,66,80],8);
const fetcher=async address=>{
 if(address===source)return new Response(html,{headers:{"Content-Type":"text/html"}});
 if(address===poster)return new Response(bytes,{headers:{"Content-Type":"image/webp",
   "Content-Length":"128"}});
 return new Response("missing",{status:404});
};
test("Crawler receives public, version-pinned social image bytes with correct MIME",async()=>{
 const report=await verifyGeoSocialPreview(source,fetcher);
 assert.equal(report.ok,true);
 assert.equal(report.imageMime,"image/webp");
 assert.equal(report.imageBytes,128);
 assert.equal(report.version,"version5");
});
test("Crawler fails on private HTTP URLs, stale versions, wrong image MIME or missing poster bytes",async()=>{
 await assert.rejects(()=>verifyGeoSocialPreview("http://evil.test/3Dprojects/x/geo",fetcher),/HTTPS/);
 const stale=async address=>{
  if(address===source)return new Response(html.replace("v=version5","v=old"),{
   headers:{"Content-Type":"text/html"}});
  return fetcher(address);
 };
 await assert.rejects(()=>verifyGeoSocialPreview(source,stale),/immutable share version/);
 const wrong=async address=>address===poster?
  new Response("not an image",{headers:{"Content-Type":"text/html"}}):fetcher(address);
 await assert.rejects(()=>verifyGeoSocialPreview(source,wrong),/image MIME/);
 const bad=async address=>address===poster?
  new Response(new Uint8Array(128),{headers:{"Content-Type":"image/webp"}}):fetcher(address);
 await assert.rejects(()=>verifyGeoSocialPreview(source,bad),/invalid header/);
});
