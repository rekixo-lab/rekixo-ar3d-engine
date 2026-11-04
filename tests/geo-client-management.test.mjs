import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {listGeoCommercialState} from "../workers/geo-plot-commercial.mjs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
class DB{
 constructor(db){this.db=db;}
 prepare(sql){
  const db=this.db;
  return {bind(...args){
   return {all:async()=>({results:db.prepare(sql).all(...args)}),
    first:async()=>db.prepare(sql).get(...args)||null};
  }};
 }
}
test("All mapped Geo IDs and public-approved counters match customer release",async()=>{
 const db=new DatabaseSync(":memory:");
 try{
  db.exec("CREATE TABLE geo_plot_commercial_3d(project_id TEXT,mapping_release_id TEXT,plot_id TEXT,status TEXT,price_paise INTEGER,currency TEXT,evidence_ref TEXT,public_approved INTEGER,revision INTEGER,updated_at TEXT)");
  db.prepare("INSERT INTO geo_plot_commercial_3d VALUES('p1','r1','2','booked',NULL,'INR','signed booking',1,1,'2026-11-03')").run();
  db.prepare("INSERT INTO geo_plot_commercial_3d VALUES('p1','r1','3','sold',NULL,'INR','private unapproved',0,1,'2026-11-03')").run();
  const source={releaseId:"r1",publicationMode:"verified",plots:[
    {id:"1",area:{value:1100,unit:"sqft"}},{id:"2",area:{value:1200,unit:"sqft"}},
    {id:"3",area:{value:1300,unit:"sqft"}}]};
  const context={project:{id:"p1"}};
  const v=await listGeoCommercialState({DB:new DB(db)},context,source);
  assert.equal(v.plotCount,3);
  assert.deepEqual(v.rows.map(r=>r.plotId),["1","2","3"]);
  assert.deepEqual(v.rows.map(r=>r.status),["available","booked","available"]);
  assert.deepEqual(v.counts,{available:2,booked:1,sold:0,unreviewed:2});
  assert.equal(v.rows[2].draftStatus,"sold");
  assert.equal(v.rows[2].publicApproved,false);
  assert.equal(v.rows[0].revision,0);
  const preliminary=await listGeoCommercialState({DB:new DB(db)},context,{...source,publicationMode:"preliminary"});
  assert.deepEqual(preliminary.rows.map(r=>r.status),["available","booked","available"]);
  assert.equal(preliminary.counts.available,2);
  const foreign=await listGeoCommercialState({DB:new DB(db)},{project:{id:"p2"}},source);
  assert.deepEqual(foreign.rows.map(r=>r.status),["available","available","available"]);
 }finally{db.close();}
});
test("Geo management migration isolates mapping identity and keeps private events",()=>{
 const db=new DatabaseSync(":memory:");
 try{
  db.exec("PRAGMA foreign_keys=ON;CREATE TABLE projects_3d(id TEXT PRIMARY KEY);CREATE TABLE geo_plot_mapping_releases_3d(id TEXT PRIMARY KEY,project_id TEXT REFERENCES projects_3d(id))");
  db.exec(read("database/migrations/0055_geo_client_management.sql"));
  db.exec("INSERT INTO projects_3d VALUES('p1'),('p2');INSERT INTO geo_plot_mapping_releases_3d VALUES('r1','p1')");
  const sql="INSERT INTO geo_client_plot_details_3d(project_id,mapping_release_id,plot_id,revision,updated_by,updated_at) VALUES(?,?,'1',1,'admin','2026-11-03')";
  assert.throws(()=>db.prepare(sql).run("p2","r1"),/belong to project release/);
  db.prepare(sql).run("p1","r1");
  assert.throws(()=>db.prepare("UPDATE geo_client_plot_details_3d SET plot_id='2' WHERE project_id='p1'").run(),/identity immutable/);
  assert.ok(db.prepare("SELECT COUNT(*) AS total FROM geo_client_plot_details_3d").get().total===1);
 }finally{db.close();}
});
test("Client Admin password eye toggles and private module boundaries remain scoped",()=>{
 const ui=read("apps/admin/src/management/ProjectClientPortal.tsx");
 const api=read("workers/project-client-portal.mjs");
 const routes=read("workers/public.mjs");
 assert.equal((ui.match(/<PasswordRevealField name=/g)||[]).length,3);
 assert.match(ui,/ClientGeoPlotManagement/);
 for(const section of ["plot-details","gallery","gallery-image","notices","sales"]){
   assert.ok(api.includes(section),"Missing scoped client route "+section);
 }
 assert.match(api,/slug!==s.slug/);
 assert.match(api,/!sameOrigin\(request\)/);
 assert.match(routes,/publishedGeoPlotNotices/);
});
