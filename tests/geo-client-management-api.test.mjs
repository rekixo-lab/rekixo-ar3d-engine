import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash,randomUUID} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {clientGeoPlotDetails} from "../workers/project-client-geo-details.mjs";
import {clientGeoNotices,publishedGeoPlotNotices} from "../workers/project-client-geo-notices.mjs";
import {clientGeoSales} from "../workers/project-client-geo-sales.mjs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
class Stmt{
 constructor(db,sql){this.db=db;this.sql=sql;this.params=[];}
 bind(...p){this.params=p;return this;}
 async first(){return this.db.prepare(this.sql).get(...this.params)||null;}
 async all(){return {results:this.db.prepare(this.sql).all(...this.params)};}
 async run(){return {meta:{changes:this.db.prepare(this.sql).run(...this.params).changes}};}
}
class D1{
 constructor(db){this.db=db;}
 prepare(s){return new Stmt(this.db,s);}
 async batch(a){this.db.exec("BEGIN");try{const r=[];for(const st of a)r.push(await st.run());this.db.exec("COMMIT");return r;}catch(e){this.db.exec("ROLLBACK");throw e;}}
}
const polygon={id:"1",corners:[[0,0],[10,0],[10,10],[0,10]],layout:"four",
 sides:{front:{edges:[0],length:10,unit:"m",roadFacing:true,source:"Plan",verified:true},
 back:{edges:[2],length:10,unit:"m",roadFacing:false,source:"Plan",verified:true},
 depthA:{edges:[1],length:10,unit:"m",roadFacing:false,source:"Plan",verified:true},
 depthB:{edges:[3],length:10,unit:"m",roadFacing:false,source:"Plan",verified:true}},
 area:{value:100,unit:"sqm",source:"Plan",verified:true},facing:"east",facingSource:"Plan",
 facingVerified:true,planeY:0,planeSource:"Plan",planeVerified:true,road:"Road",notes:""};
function fixture(){
 const db=new DatabaseSync(":memory:");
 db.exec("PRAGMA foreign_keys=ON;CREATE TABLE projects_3d(id TEXT PRIMARY KEY,slug TEXT,status TEXT);"+
 "CREATE TABLE geo_plot_mapping_releases_3d(id TEXT PRIMARY KEY,project_id TEXT REFERENCES projects_3d(id),experience_id TEXT,geo_release_id TEXT,building_release_id TEXT,plots_json TEXT,sha256 TEXT,publication_mode TEXT);"+
 "CREATE TABLE geo_plot_mapping_active_3d(project_id TEXT,experience_id TEXT,mapping_release_id TEXT);"+
 "CREATE TABLE engine_admin_audit(id TEXT PRIMARY KEY,actor_email TEXT,action TEXT,project_id TEXT,target_id TEXT,details_json TEXT,created_at TEXT)");
 db.exec(read("database/migrations/0055_geo_client_management.sql"));
 db.prepare("INSERT INTO projects_3d VALUES('p1','demo','published')").run();
 db.prepare("INSERT INTO projects_3d VALUES('p2','other','published')").run();
 const src=JSON.stringify([polygon]),hash=createHash("sha256").update(src).digest("hex");
 db.prepare("INSERT INTO geo_plot_mapping_releases_3d VALUES(?,?,?,?,?,?,?,?)").run("r1","p1","e1","g1","b1",src,hash,"verified");
 db.prepare("INSERT INTO geo_plot_mapping_active_3d VALUES('p1','e1','r1')").run();
 return {db,env:{DB:new D1(db)},ctx:{project:{id:"p1",status:"published"},active:{experience_id:"e1",geo_release_id:"g1",source_building_release_id:"b1"}},actor:{email:"client@example.test",role:"client_admin"},close:()=>db.close()};
}
const req=(path,method="GET",data)=>new Request("https://ar3dstudio.in"+path,{method,headers:{"Origin":"https://ar3dstudio.in",...(data?{"Content-Type":"application/json"}:{})},...(data?{body:JSON.stringify(data)}:{})});
test("Geo client plot booking details save, conflict, and release-bound read",async()=>{
 const f=fixture();try{
  const url="/3Dprojects/api/client-portal/projects/demo/plot-details";
  let first=await clientGeoPlotDetails(req(url),f.env,f.ctx,f.actor);assert.equal(first.status,200);
  assert.deepEqual((await first.json()).rows,[]);
  const payload={plotId:"1",expectedRevision:0,ownerName:"Buyer A",brokerName:"Broker B",bookingAmountPaise:150000,notes:"Booked"};
  const added=await clientGeoPlotDetails(req(url,"PUT",payload),f.env,f.ctx,f.actor);
  assert.equal(added.status,200,await added.clone().text());
  assert.equal((await added.json()).rows[0].ownerName,"Buyer A");
  const conflict=await clientGeoPlotDetails(req(url,"PUT",payload),f.env,f.ctx,f.actor);
  assert.equal(conflict.status,409);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM geo_client_plot_details_3d WHERE project_id='p2'").get().n,0);
 }finally{f.close();}
});
test("Geo client notices are private drafts until explicitly published",async()=>{
 const f=fixture();try{
  const url="/3Dprojects/api/client-portal/projects/demo/notices";
  const form={plotId:"1",title:"Road Work",body:"The internal road is being improved.",state:"draft",expectedRevision:0};
  let res=await clientGeoNotices(req(url,"POST",form),f.env,f.ctx,f.actor);
  assert.equal(res.status,200,await res.clone().text());
  let rows=(await res.json()).notices;assert.equal(rows.length,1);
  assert.equal((await publishedGeoPlotNotices(f.env,"demo")).status,200);
  assert.equal((await (await publishedGeoPlotNotices(f.env,"demo")).json()).notices.length,0);
  res=await clientGeoNotices(req(url,"PUT",{...form,id:rows[0].id,state:"published",expectedRevision:1}),f.env,f.ctx,f.actor);
  assert.equal(res.status,200,await res.clone().text());
  assert.equal((await (await publishedGeoPlotNotices(f.env,"demo")).json()).notices.length,1);
 }finally{f.close();}
});
test("Geo client sale, payment, reversal and confirmation reconcile as private entries",async()=>{
 const f=fixture();try{
  const url="/3Dprojects/api/client-portal/projects/demo/sales";
  const sell=await clientGeoSales(req(url,"POST",{action:"create",plotId:"1",buyerName:"Client A",
   buyerPhone:"",agreementPaise:1000000,evidenceRef:"Booking note A",notes:"",operationId:randomUUID()}),f.env,f.ctx,f.actor);
  assert.equal(sell.status,200,await sell.clone().text());
  let payload=await sell.json();assert.equal(payload.sales.length,1);
  const sale=payload.sales[0];
  let pay=await clientGeoSales(req(url,"POST",{action:"receipt",saleId:sale.id,amountPaise:250000,
   paidOn:"2026-11-03",method:"upi",reference:"UPI-TEST-123",note:"",operationId:randomUUID()}),f.env,f.ctx,f.actor);
  assert.equal(pay.status,200,await pay.clone().text());payload=await pay.json();
  assert.equal(payload.sales[0].receivedPaise,250000);
  const receipt=payload.payments[0];
  pay=await clientGeoSales(req(url,"POST",{action:"reverse",saleId:sale.id,receiptId:receipt.id,
   reason:"Incorrect entry",operationId:randomUUID()}),f.env,f.ctx,f.actor);
  assert.equal(pay.status,200,await pay.clone().text());payload=await pay.json();
  assert.equal(payload.sales[0].receivedPaise,0);
  pay=await clientGeoSales(req(url,"PUT",{action:"confirm",saleId:sale.id,expectedRevision:1,evidenceRef:"Signed deed"}),f.env,f.ctx,f.actor);
  assert.equal(pay.status,200,await pay.clone().text());
  assert.equal((await pay.json()).sales[0].state,"confirmed");
 }finally{f.close();}
});
