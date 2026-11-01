import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {createHash,webcrypto} from "node:crypto";
import {readFileSync} from "node:fs";
import {handleGeoPlotPricingSheet} from "../workers/geo-plot-pricing.mjs";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const sha=s=>createHash("sha256").update(s).digest("hex");
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const base="https://admin.rekixo.com";
class S {
 constructor(db,sql){this.db=db;this.sql=sql;this.params=[];}
 bind(...args){this.params=args;return this;}
 async first(){return this.db.prepare(this.sql).get(...this.params)||null;}
 async all(){return {results:this.db.prepare(this.sql).all(...this.params)};}
 async run(){return {meta:{changes:this.db.prepare(this.sql).run(...this.params).changes}};}
}
class DB {
 constructor(db){this.db=db;}
 prepare(sql){return new S(this.db,sql);}
 async batch(statements){
  this.db.exec("BEGIN");
  try{const result=[];for(const statement of statements)result.push(await statement.run());
   this.db.exec("COMMIT");return result;}
  catch(error){this.db.exec("ROLLBACK");throw error;}
 }
}
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
 db.exec(read("database/migrations/0049_geo_pricing_sheet_drafts.sql"));
 const json=JSON.stringify([square]);
 db.prepare("INSERT INTO projects_3d VALUES(?)").run("p1");
 db.prepare("INSERT INTO projects_3d VALUES(?)").run("p2");
 db.prepare("INSERT INTO geo_plot_mapping_releases_3d VALUES(?,?,?,?,?,?,?)")
  .run("map1","p1","e1","g1","b1",json,sha(json));
 db.prepare("INSERT INTO geo_plot_mapping_active_3d VALUES(?,?,?)").run("p1","e1","map1");
 return {env:{DB:new DB(db)},db,
  ctx:{project:{id:"p1",status:"published"},active:{experience_id:"e1",
   geo_release_id:"g1",source_building_release_id:"b1"}},
  close:()=>db.close()};
}
const csv="plot_id,from_id,to_id,pricing_type,unit,rate,fixed_price,currency\n"+
 "1,,,fixed,,,2500000,INR\n";
const request=(method,body)=>new Request(base+"/3Dprojects/api/cloud/projects/demo/geo-plots/pricing",{
 method,headers:{"Origin":base,"Content-Type":"application/json"},
 ...(body?{body:JSON.stringify(body)}:{})
});
test("price sheet preflight is read-only, source-version bound, audited and stale revision rejected",async()=>{
 const f=fixture();
 try{
  const actor={email:"owner@demo.test"};
  const pre=await handleGeoPlotPricingSheet(request("POST",{
   action:"preflight",csv,sourceRef:"Signed rate register page 1"
  }),f.env,f.ctx,actor);
  assert.equal(pre.status,200);
  const data=(await pre.json()).preflight;
  assert.equal(data.count,1);assert.equal(data.added,1);
  assert.equal(data.mappingReleaseId,"map1");assert.equal(data.revision,0);
  assert.equal(f.db.prepare("SELECT count(*) as n FROM geo_plot_pricing_sheets_3d").get().n,0);
  const imp=await handleGeoPlotPricingSheet(request("POST",{
   action:"import",csv,sourceRef:"Signed rate register page 1",
   expectedRevision:data.revision,previewSha256:data.previewSha256
  }),f.env,f.ctx,actor);
  assert.equal(imp.status,200);
  const state=await imp.json();
  assert.equal(state.rows.length,1);
  assert.equal(state.rows[0].plotId,"1");
  assert.equal(state.rows[0].pricePaise,250000000);
  assert.equal(state.rows[0].evidenceRef,"Signed rate register page 1");
  assert.equal(state.revision,1);
  assert.equal(f.db.prepare("SELECT count(*) as n FROM engine_admin_audit").get().n,1);
  const stale=await handleGeoPlotPricingSheet(request("POST",{
   action:"import",csv,sourceRef:"Signed rate register page 1",
   expectedRevision:data.revision,previewSha256:data.previewSha256
  }),f.env,f.ctx,actor);
  assert.equal(stale.status,409);
  assert.match((await stale.json()).error,/stale/i);
  const readback=await handleGeoPlotPricingSheet(request("GET"),f.env,f.ctx,actor);
  assert.equal((await readback.json()).revision,1);
  f.db.prepare("UPDATE geo_plot_pricing_sheets_3d SET quotes_json='[]'").run();
  const tampered=await handleGeoPlotPricingSheet(request("GET"),f.env,f.ctx,actor);
  assert.equal(tampered.status,409);
  assert.match((await tampered.json()).error,/SHA-256/);
 }finally{f.close();}
});
test("pricing sheet is never imported into another project or a stale mapping release",async()=>{
 const f=fixture();
 try{
  const actor={email:"owner@demo.test"};
  const foreign={...f.ctx,project:{id:"p2",status:"published"}};
  const response=await handleGeoPlotPricingSheet(request("POST",{
   action:"preflight",csv,sourceRef:"Signed price sheet"
  }),f.env,foreign,actor);
  assert.equal(response.status,409);
  assert.match((await response.json()).error,/verified published/i);
  const previous=await handleGeoPlotPricingSheet(request("POST",{
   action:"preflight",csv,sourceRef:"Signed price sheet"
  }),f.env,f.ctx,actor);
  assert.equal(previous.status,200);
  const preview=(await previous.json()).preflight;
  f.db.prepare("DELETE FROM geo_plot_mapping_active_3d WHERE project_id='p1'").run();
  const stale=await handleGeoPlotPricingSheet(request("POST",{
   action:"import",csv,sourceRef:"Signed price sheet",
   expectedRevision:preview.revision,previewSha256:preview.previewSha256
  }),f.env,f.ctx,actor);
  assert.equal(stale.status,409);
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM geo_plot_pricing_sheets_3d").get().n,0);
 }finally{f.close();}
});
