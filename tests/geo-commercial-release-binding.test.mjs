import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {normalizeGeoCommercialChange} from "../workers/geo-plot-commercial.mjs";
const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const valid={plotId:"12-A",status:"available",pricePaise:123450000,currency:"INR",
 evidenceRef:"Owner-reviewed plan document p12",publicApproved:true,expectedRevision:0};
test("Owner commercial changes need canonical ID, explicit approval and source provenance",()=>{
 assert.deepEqual(normalizeGeoCommercialChange(valid),valid);
 for(const patch of [
  {plotId:"../invalid"},{plotId:" "},{status:"unverified"},
  {status:"fake_sold"},{pricePaise:1.25},{pricePaise:-1},
  {currency:"USD"},{evidenceRef:""},{evidenceRef:{file:"fake"}},
  {publicApproved:undefined},{expectedRevision:-1}
 ]){
  assert.throws(()=>normalizeGeoCommercialChange({...valid,...patch}));
 }
 assert.equal(normalizeGeoCommercialChange({...valid,pricePaise:null}).pricePaise,null,
  "No unknown listing price may be invented.");
});
test("Geo commercial schema is project/release-bound, revisioned and append-only for real owners",()=>{
 const db=new DatabaseSync(":memory:");
 try{
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE projects_3d(id TEXT PRIMARY KEY);
    CREATE TABLE geo_plot_mapping_releases_3d(
      id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects_3d(id) ON DELETE CASCADE);`);
  db.exec(read("database/migrations/0046_geo_plot_commercial_release_bound.sql"));
  db.prepare("INSERT INTO projects_3d(id) VALUES (?)").run("p1");
  db.prepare("INSERT INTO projects_3d(id) VALUES (?)").run("p2");
  db.prepare("INSERT INTO geo_plot_mapping_releases_3d(id,project_id) VALUES(?,?)").run("r1","p1");
  db.prepare(`INSERT INTO geo_plot_commercial_3d
    (project_id,mapping_release_id,plot_id,status,price_paise,currency,
     evidence_ref,public_approved,revision,updated_by,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
    .run("p1","r1","12-A","booked",12000000,"INR","Agreement register p2",
      1,1,"owner@example.test","2026-11-01");
  assert.throws(()=>db.prepare(`INSERT INTO geo_plot_commercial_3d
    (project_id,mapping_release_id,plot_id,status,evidence_ref,revision,updated_by,updated_at)
    VALUES('p2','r1','2','sold','Fake agreement',1,'owner','2026-11-01')`).run(),
    /project|FOREIGN KEY|constraint/i);
  db.prepare(`INSERT INTO geo_plot_commercial_events_3d
    (id,project_id,mapping_release_id,plot_id,revision,event_json,actor_email,created_at)
    VALUES(?,?,?,?,?,?,?,?)`).run("event1","p1","r1","12-A",1,
      JSON.stringify({status:"booked"}),"owner@example.test","2026-11-01");
  assert.throws(()=>db.prepare("UPDATE geo_plot_commercial_events_3d SET actor_email='forged' WHERE id='event1'").run(),
    /immutable/);
  assert.throws(()=>db.prepare("DELETE FROM geo_plot_commercial_events_3d WHERE id='event1'").run(),
    /cannot be deleted/);
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM geo_plot_commercial_3d").get().total,1);
  // Project cleanup removes its sealed source release; dependent event rows
  // must not trap a legitimate isolated project deletion forever.
  db.prepare("DELETE FROM geo_plot_mapping_releases_3d WHERE id='r1'").run();
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM geo_plot_commercial_events_3d").get().total,0);
 }finally{db.close();}
});
test("Commercial owner routes require same-origin auth and published map source hashes",()=>{
 const admin=read("workers/geo-plot-mapping.mjs"),
  owner=read("workers/geo-plot-commercial.mjs"),
  publicMap=read("workers/geo-plot-public.mjs"),
  publicUI=read("apps/public/src/geo/GeoPublicDemo.tsx"),
  management=read("workers/project-management.mjs");
 assert.match(admin,/engineAdminReadAccess\(request,env\)/);
 assert.match(admin,/sameOrigin\(request\)/);
 assert.match(admin,/handleGeoPlotCommercial\(request,env,ctx,access.actor\)/);
 assert.match(owner,/if\(await sha\(row.plots_json\)!==row.sha256\)/);
 assert.match(owner,/mapping_release_id=\?/);
 assert.match(owner,/public_approved=1/);
 assert.match(owner,/source.plots.find/);
 assert.doesNotMatch(owner,/buyer_phone|buyer_name|receipt|payment_paise/);
 assert.match(publicMap,/publicGeoCommercialForRelease/);
 assert.match(publicUI,/not independently approved for this mapping release/);
 assert.match(management,/clientLoginEnabled:false/,
   "A proposed directory contact is NOT silently granted a client session.");
});
test("Existing versioned Geo poster social preview stays immutable and pinned to a real share-card version",()=>{
 const p=read("workers/project-branding.mjs");
 assert.match(p,/og:image/);
 assert.match(p,/twitter:image/);
 assert.match(p,/publicBrandingSnapshot\(env, slug, experience, requestedVersion, Boolean\(requestedVersion\)\)/);
 assert.match(p,/serveR2Object\(env.MODEL_ASSETS, key, request/);
 assert.match(p,/max-age=31536000, immutable/);
 assert.match(p,/hasShareCard/);
});
