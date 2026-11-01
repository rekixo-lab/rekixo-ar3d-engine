import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {createHash,webcrypto} from "node:crypto";
import {normalizeGeoDealChange,handleGeoPlotDeals} from "../workers/geo-plot-deals.mjs";
import {canProjectClient} from "../shared/project-client-roles.js";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const sha=s=>createHash("sha256").update(s).digest("hex");
const normal={plotId:"1",stage:"booked",buyerName:"Demo Customer",buyerPhone:"+91 9876543210",
 claimedPaymentPaise:0,paymentReference:"",agreementReference:"",
 registrationReference:"",evidenceReference:"Owner booking register page 1",
 notes:"Demo only",expectedRevision:0};
test("private deals require owner-reviewed evidence; agreement, registration and reported payment cannot be invented",()=>{
 assert.deepEqual(normalizeGeoDealChange(normal),normal);
 for(const patch of [
  {plotId:"../broken"},{stage:"sold"},{buyerName:""},
  {buyerPhone:"abc"},{claimedPaymentPaise:-1},{claimedPaymentPaise:1.25},
  {claimedPaymentPaise:10000,paymentReference:""},{evidenceReference:""},
  {stage:"agreement_done",agreementReference:""},
  {stage:"registered",agreementReference:"AG-1",registrationReference:""}
 ]){
  assert.throws(()=>normalizeGeoDealChange({...normal,...patch}));
 }
 assert.equal(normalizeGeoDealChange({...normal,stage:"registered",
  agreementReference:"AG-1",registrationReference:"REG-2"}).stage,"registered");
});
test("only invited Approver/Client Admin can read buyer records, only Client Admin may write",()=>{
 assert.equal(canProjectClient("viewer","deals.read"),false);
 assert.equal(canProjectClient("editor","deals.read"),false);
 assert.equal(canProjectClient("approver","deals.read"),true);
 assert.equal(canProjectClient("approver","deals.write"),false);
 assert.equal(canProjectClient("client_admin","deals.read"),true);
 assert.equal(canProjectClient("client_admin","deals.write"),true);
 assert.equal(canProjectClient("client_admin","owner.all"),false);
 const portal=read("workers/project-client-portal.mjs");
 assert.match(portal,/deals.write/);
 assert.match(portal,/handleGeoPlotDeals/);
 assert.match(portal,/slug!==s.slug/);
 const pub=read("workers/public.mjs");
 assert.doesNotMatch(pub,/geo-plot-deals|geo_plot_deals_3d/);
});
test("private deal tables reject cross-project source and event rewrite",()=>{
 const db=new DatabaseSync(":memory:");
 try{
  db.exec("PRAGMA foreign_keys=ON;"+
    "CREATE TABLE projects_3d(id TEXT PRIMARY KEY);"+
    "CREATE TABLE geo_plot_mapping_releases_3d("+
     "id TEXT PRIMARY KEY,project_id TEXT REFERENCES projects_3d(id) ON DELETE CASCADE);");
  db.exec(read("database/migrations/0050_private_geo_plot_deals.sql"));
  db.exec("INSERT INTO projects_3d VALUES('p1');"+
   "INSERT INTO projects_3d VALUES('p2');"+
   "INSERT INTO geo_plot_mapping_releases_3d VALUES('m1','p1')");
  const sql="INSERT INTO geo_plot_deals_3d "+
   "(project_id,mapping_release_id,plot_id,stage,evidence_reference,revision,updated_by,updated_at) "+
   "VALUES(?,?,?,'booked','Owner booking memo',1,'owner','now')";
  assert.throws(()=>db.prepare(sql).run("p2","m1","1"),/foreign|another project/i);
  db.prepare(sql).run("p1","m1","1");
  assert.throws(()=>db.prepare(
   "UPDATE geo_plot_deals_3d SET revision=0 WHERE project_id='p1'").run(),/revision|constraint/i);
  db.prepare("INSERT INTO geo_plot_deal_events_3d VALUES(?,?,?,?,?,?,?,?)")
   .run("ev1","p1","m1","1",1,"{}","owner","now");
  assert.throws(()=>db.prepare(
   "UPDATE geo_plot_deal_events_3d SET event_json='{\"fake\":true}' WHERE id='ev1'").run(),
   /immutable/);
  db.prepare("DELETE FROM geo_plot_mapping_releases_3d WHERE id='m1'").run();
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM geo_plot_deals_3d").get().count,0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM geo_plot_deal_events_3d").get().count,0);
 }finally{db.close();}
});
const square={
 id:"1",corners:[[0,0],[10,0],[10,10],[0,10]],layout:"four",
 sides:{
  front:{edges:[0],length:32.808,unit:"ft",roadFacing:true,source:"Approved plan",verified:true},
  depthA:{edges:[1],length:32.808,unit:"ft",roadFacing:false,source:"Approved plan",verified:true},
  back:{edges:[2],length:32.808,unit:"ft",roadFacing:false,source:"Approved plan",verified:true},
  depthB:{edges:[3],length:32.808,unit:"ft",roadFacing:false,source:"Approved plan",verified:true}
 },
 area:{value:100,unit:"sqm",source:"CAD area schedule",verified:true},
 facing:"east",facingSource:"Survey",facingVerified:true,planeY:0,
 planeSource:"Measured",planeVerified:true,road:"30ft road",notes:""
};
class Statement{
 constructor(db,sql){this.db=db;this.sql=sql;this.params=[];}
 bind(...args){this.params=args;return this;}
 async first(){return this.db.prepare(this.sql).get(...this.params)||null;}
 async all(){return {results:this.db.prepare(this.sql).all(...this.params)};}
 async run(){return {meta:{changes:this.db.prepare(this.sql).run(...this.params).changes}};}
}
class DB{
 constructor(db){this.db=db;}
 prepare(sql){return new Statement(this.db,sql);}
 async batch(steps){
  this.db.exec("BEGIN");
  try{const out=[];for(const step of steps)out.push(await step.run());
   this.db.exec("COMMIT");return out;}
  catch(e){this.db.exec("ROLLBACK");throw e;}
 }
}
function fixture(){
 const db=new DatabaseSync(":memory:");
 db.exec("PRAGMA foreign_keys=ON;"+
  "CREATE TABLE projects_3d(id TEXT PRIMARY KEY);"+
  "CREATE TABLE geo_plot_mapping_releases_3d("+
    "id TEXT PRIMARY KEY,project_id TEXT REFERENCES projects_3d(id) ON DELETE CASCADE,"+
    "experience_id TEXT,geo_release_id TEXT,building_release_id TEXT,"+
    "plots_json TEXT,sha256 TEXT);"+
  "CREATE TABLE geo_plot_mapping_active_3d(project_id TEXT,experience_id TEXT,mapping_release_id TEXT);"+
  "CREATE TABLE engine_admin_audit(id TEXT,actor_email TEXT,action TEXT,project_id TEXT,"+
    "target_id TEXT,details_json TEXT,created_at TEXT);");
 db.exec(read("database/migrations/0050_private_geo_plot_deals.sql"));
 const plots=JSON.stringify([square]);
 db.prepare("INSERT INTO projects_3d VALUES(?)").run("p1");
 db.prepare("INSERT INTO geo_plot_mapping_releases_3d VALUES(?,?,?,?,?,?,?)")
  .run("m1","p1","e1","g1","b1",plots,sha(plots));
 db.prepare("INSERT INTO geo_plot_mapping_active_3d VALUES(?,?,?)").run("p1","e1","m1");
 return {db,env:{DB:new DB(db)},ctx:{project:{id:"p1",status:"published"},
   active:{experience_id:"e1",geo_release_id:"g1",source_building_release_id:"b1"}}};
}
const request=(method,body)=>new Request("https://admin.rekixo.com/3Dprojects/api/cloud/projects/demo/geo-plots/deals",
 {method,headers:{"Origin":"https://admin.rekixo.com","Content-Type":"application/json"},
 ...(body?{body:JSON.stringify(body)}:{})});
test("private deal write appends audit, conflicts fail and no commercial/public status changes",async()=>{
 const f=fixture();
 try{
  const actor={email:"owner@demo.test"};
  const forbidden=await handleGeoPlotDeals(request("PUT",normal),f.env,f.ctx,actor,
   {allowWrite:false});
  assert.equal(forbidden.status,403);
  const first=await handleGeoPlotDeals(request("PUT",normal),f.env,f.ctx,actor);
  assert.equal(first.status,200);
  const payload=await first.json();
  assert.equal(payload.rows[0].stage,"booked");
  assert.equal(payload.rows[0].buyerName,"Demo Customer");
  assert.equal(payload.rows[0].revision,1);
  assert.equal(f.db.prepare("SELECT count(*) as n FROM geo_plot_deal_events_3d").get().n,1);
  assert.equal(f.db.prepare("SELECT count(*) as n FROM engine_admin_audit").get().n,1);
  const replay=await handleGeoPlotDeals(request("PUT",normal),f.env,f.ctx,actor);
  assert.equal(replay.status,409);
  const update=await handleGeoPlotDeals(request("PUT",{
   ...normal,stage:"agreement_done",agreementReference:"Signed agreement DOC-1",expectedRevision:1
  }),f.env,f.ctx,actor);
  assert.equal(update.status,200);
  assert.equal((await update.json()).rows[0].revision,2);
  assert.equal(f.db.prepare("SELECT count(*) as n FROM geo_plot_deal_events_3d").get().n,2);
  assert.doesNotMatch(read("workers/geo-plot-deals.mjs"),/UPDATE geo_plot_commercial_3d/);
 }finally{f.db.close();}
});
