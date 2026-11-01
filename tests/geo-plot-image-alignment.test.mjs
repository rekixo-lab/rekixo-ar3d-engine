import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {normalizeImageModelAlignment,evaluateImageModelAlignment,
 imagePointToModel,modelPointToImage} from "../shared/geo-plot-image-alignment.js";

const sha="c".repeat(64);
const sample=(u,v,key)=>({id:key,u,v,x:120+80*(2*u)-20*v,z:-40+20*(2*u)+80*v,
  evidence:"Signed 2026 survey, site landmark "+key});
const fresh=()=>({imageAssetId:"source-uuid-1",imageSha256:sha,imageWidth:2000,imageHeight:1000,
  geoReleaseId:"geo-release-1",buildingReleaseId:"building-release-1",modelSha256:sha,
  anchors:[sample(.1,.1,"F1"),sample(.85,.15,"F2"),sample(.15,.8,"F3"),sample(.8,.7,"F4")],
  checkpoints:[sample(.65,.85,"C1"),sample(.4,.35,"C2")]});
test("independently withheld checkpoints prove the same image-to-Building-XZ alignment",()=>{
  const draft=fresh();
  const qa=evaluateImageModelAlignment(draft,{requireCheckpoints:true});
  assert.equal(qa.verifiedReady,true);
  assert.ok(qa.maxFitMetres<1e-8);
  assert.ok(qa.maxCheckpointMetres<1e-8);
  const uv=modelPointToImage(qa.transform,[142,16]);
  const xz=imagePointToModel(qa.transform,uv);
  assert.ok(Math.hypot(xz[0]-142,xz[1]-16)<1e-8);
  assert.equal(normalizeImageModelAlignment(draft).imageSha256,sha);
});
test("held-out checkpoint is never fitted into transform; wrong landmark fails closed",()=>{
  const d=fresh(),original=evaluateImageModelAlignment(d);
  d.checkpoints[0].x+=5;
  const qa=evaluateImageModelAlignment(d);
  assert.equal(qa.verifiedReady,false);
  assert.ok(qa.maxCheckpointMetres>qa.limitMetres);
  assert.deepEqual(qa.transform,original.transform);
  assert.throws(()=>evaluateImageModelAlignment(d,{requireCheckpoints:true}),/independently verified/);
});
test("rectangular source image requires actual pixel aspect for correct transform",()=>{
  const draft=fresh();
  assert.equal(evaluateImageModelAlignment(draft,{requireCheckpoints:true}).verifiedReady,true);
  const distorted={...draft,imageWidth:1000,imageHeight:1000};
  const qa=evaluateImageModelAlignment(distorted);
  assert.equal(qa.verifiedReady,false,"A normalized-square distortion must never silently pass.");
});
test("three nearly collinear anchors never pass geometry review",()=>{
  const d=fresh();d.anchors=[
    sample(.1,.2,"F1"),sample(.5,.2,"F2"),sample(.9,.2,"F3")];
  assert.throws(()=>evaluateImageModelAlignment(d),/non-collinear/);
});
test("checkpoints are required, separately distributed and have cited source evidence",()=>{
  const d=fresh();d.checkpoints=[];
  assert.equal(evaluateImageModelAlignment(d).verifiedReady,false);
  assert.throws(()=>evaluateImageModelAlignment(d,{requireCheckpoints:true}),/checkpoints/);
  const nearby=fresh();
  nearby.checkpoints=[sample(.6,.6,"C1"),sample(.605,.605,"C2")];
  assert.equal(evaluateImageModelAlignment(nearby).verifiedReady,false);
  nearby.checkpoints[0].evidence="";
  assert.throws(()=>normalizeImageModelAlignment(nearby),/evidence/);
});
test("rejects cross-source assumptions, nonfinite model positions and duplicate image points",()=>{
  const a=fresh();a.modelSha256="not_sha";
  assert.throws(()=>normalizeImageModelAlignment(a),/SHA-256/);
  const b=fresh();b.anchors[1].x=Infinity;
  assert.throws(()=>normalizeImageModelAlignment(b),/finite image/);
  const c=fresh();c.checkpoints[0].u=c.anchors[0].u;c.checkpoints[0].v=c.anchors[0].v;
  assert.throws(()=>normalizeImageModelAlignment(c),/same image location/);
  const d=fresh();d.anchors[1].id="F1";
  assert.throws(()=>normalizeImageModelAlignment(d),/unique/);
  const e=fresh();e.imageHeight=0;
  assert.throws(()=>normalizeImageModelAlignment(e),/width\/height/);
});
test("Stage 2 alignment does not alter existing releases or commercial plot data",()=>{
  const root=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
  const migration=root("database/migrations/0045_geo_plot_image_alignment_draft.sql");
  const worker=root("workers/geo-plot-image-alignment.mjs");
  const route=root("workers/geo-plot-mapping.mjs");
  const deletion=root("workers/project-deletion.mjs");
  assert.match(migration,/CREATE TABLE IF NOT EXISTS geo_plot_image_alignment_drafts_3d/);
  assert.match(migration,/ADD COLUMN verified_alignment_revision/);
  assert.doesNotMatch(migration,/ALTER TABLE geo_plot_mapping_releases_3d|ALTER TABLE geo_plot_mapping_active_3d/);
  assert.match(worker,/WHERE project_id=\? AND revision=\?/);
  assert.match(worker,/verified_revision=revision/);
  assert.match(worker,/requireCheckpoints:true/);
  assert.match(worker,/Changing source requires an explicit/);
  assert.match(worker,/image_sha256=geo_plot_image_alignment_drafts_3d.image_sha256/);
  assert.doesNotMatch(worker,/UPDATE geo_plot_mapping_active_3d|INSERT INTO geo_plot_mapping_releases_3d|UPDATE masterplan_sales_3d/);
  assert.match(route,/source\|inventory\|alignment/);
  assert.match(route,/requireCurrentImageAlignmentReview\(env,ctx\)/);
  assert.match(route,/verified_alignment_revision/);
  assert.match(deletion,/DELETE FROM geo_plot_image_alignment_drafts_3d/);
});
test("Image pairing lives inside the existing Geo studio and is read-only until independently verified",()=>{
  const source=readFileSync(new URL("../apps/admin/src/geo/GeoPlotMapper.tsx",import.meta.url),"utf8");
  const panel=readFileSync(new URL("../apps/admin/src/geo/GeoPlotImageAlignmentPanel.tsx",import.meta.url),"utf8");
  assert.match(source,/GeoPlotImageAlignmentPanel/);
  assert.match(source,/mode==="align"/);
  assert.match(source,/alignmentPickRef.current/);
  assert.match(panel,/downloadAsset\(selected\)/);
  assert.match(panel,/Download Private Review JSON/);
  assert.match(panel,/Pair Independent Checkpoint/);
  assert.match(panel,/isVerified/);
  assert.match(panel,/modelPointToImage/);
});
