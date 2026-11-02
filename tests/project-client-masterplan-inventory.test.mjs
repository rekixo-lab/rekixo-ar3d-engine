import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {clientMasterplanInventory} from "../workers/project-client-masterplan-inventory.mjs";

const hash=async body=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",
 new TextEncoder().encode(body)))).map(v=>v.toString(16).padStart(2,"0")).join("");
const fixture=async()=>{
 const db=new DatabaseSync(":memory:");
 db.exec(`
 CREATE TABLE masterplan_geo_releases_3d(id TEXT PRIMARY KEY,project_id TEXT,mapping_json TEXT,mapping_sha256 TEXT);
 CREATE TABLE masterplan_geo_active_3d(project_id TEXT PRIMARY KEY,release_id TEXT);
 CREATE TABLE masterplan_sales_3d(project_id TEXT,plot_id TEXT,state TEXT,
  buyer_name TEXT,buyer_phone TEXT,agreement_paise INTEGER);`);
 for(const slug of ["site-a","site-b"]){
  const mapping=JSON.stringify({schema:"rekixo-masterplan-geo-v1",
    plots:[{id:"1"},{id:"2"},{id:"3"}]});
  db.prepare("INSERT INTO masterplan_geo_releases_3d VALUES(?,?,?,?)")
   .run(slug+"-release",slug,mapping,await hash(mapping));
  db.prepare("INSERT INTO masterplan_geo_active_3d VALUES(?,?)")
   .run(slug,slug+"-release");
 }
 db.prepare("INSERT INTO masterplan_sales_3d VALUES(?,?,?,?,?,?)").run(
  "site-a","1","booked","Secret Buyer","+919999888877",45670000);
 db.prepare("INSERT INTO masterplan_sales_3d VALUES(?,?,?,?,?,?)").run(
  "site-a","2","confirmed","Secret Person","+918888777766",98765400);
 db.prepare("INSERT INTO masterplan_sales_3d VALUES(?,?,?,?,?,?)").run(
  "site-b","3","booked","Another Buyer","+917777666655",12000);
 const env={DB:{prepare(sql){
   return {bind(...args){
     return {async first(){return db.prepare(sql).get(...args)||null;},
      async all(){return {results:db.prepare(sql).all(...args)}}};
   }};
 }}};
 return {db,env};
};

test("Client inventory only includes same-project counts, no buyers or payments",async()=>{
 const f=await fixture();
 try{
  const a=await clientMasterplanInventory(f.env,"site-a");
  assert.deepEqual(a.counts,{available:1,booked:1,confirmed:1});
  assert.deepEqual(a.plots.map(x=>[x.id,x.status]),
   [["1","booked"],["2","confirmed"],["3","available"]]);
  assert.equal(a.releaseId,"site-a-release");
  const b=await clientMasterplanInventory(f.env,"site-b");
  assert.deepEqual(b.counts,{available:2,booked:1,confirmed:0});
  const raw=JSON.stringify(a);
  for(const secret of ["Secret Buyer","Secret Person","9999888877","45670000"])
   assert.ok(!raw.includes(secret),"private buyer or money data leaked");
 }finally{f.db.close();}
});

test("Client inventory fails closed on altered or unknown masterplan source",async()=>{
 const f=await fixture();
 try{
  f.db.prepare("UPDATE masterplan_geo_releases_3d SET mapping_json=? WHERE id='site-a-release'")
   .run(JSON.stringify({schema:"rekixo-masterplan-geo-v1",plots:[{id:"tampered"}]}));
  await assert.rejects(clientMasterplanInventory(f.env,"site-a"),/checksum/);
  const missing=await clientMasterplanInventory(f.env,"unknown");
  assert.equal(missing.plotCount,0);
  assert.deepEqual(missing.plots,[]);
 }finally{f.db.close();}
});
