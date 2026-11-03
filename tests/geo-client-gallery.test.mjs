import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {clientGeoGallery} from "../workers/project-client-geo-gallery.mjs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
class Stmt{
 constructor(db,sql){this.db=db;this.sql=sql;this.args=[];}
 bind(...args){this.args=args;return this;}
 async all(){return {results:this.db.prepare(this.sql).all(...this.args)};}
 async first(){return this.db.prepare(this.sql).get(...this.args)||null;}
 async run(){return {meta:{changes:this.db.prepare(this.sql).run(...this.args).changes}};}
}
class DB{
 constructor(db){this.db=db;}
 prepare(s){return new Stmt(this.db,s);}
 async batch(items){this.db.exec("BEGIN");try{const r=[];for(const x of items)r.push(await x.run());this.db.exec("COMMIT");return r;}catch(e){this.db.exec("ROLLBACK");throw e;}}
}
test("Private Geo image gallery uploads, reads and deletes by authenticated project",async()=>{
 const db=new DatabaseSync(":memory:");
 const objects=new Map();
 try{
  db.exec("PRAGMA foreign_keys=ON;CREATE TABLE projects_3d(id TEXT PRIMARY KEY);CREATE TABLE geo_plot_mapping_releases_3d(id TEXT PRIMARY KEY,project_id TEXT);CREATE TABLE engine_admin_audit(id TEXT PRIMARY KEY,actor_email TEXT,action TEXT,project_id TEXT,target_id TEXT,details_json TEXT,created_at TEXT)");
  db.exec(read("database/migrations/0055_geo_client_management.sql"));
  db.exec("INSERT INTO projects_3d VALUES('p1'),('p2')");
  const env={DB:new DB(db),MODEL_ASSETS:{
    put:async(key,bytes)=>{objects.set(key,bytes);},
    get:async key=>objects.has(key)?{body:objects.get(key)}:null,
    delete:async key=>objects.delete(key)
  }};
  const project={id:"p1",status:"published"},actor={email:"client@example.test",role:"client_admin"};
  const base="https://ar3dstudio.in/3Dprojects/api/client-portal/projects/demo";
  const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/xAAAAABJRU5ErkJggg==","base64");
  const form=new FormData();form.append("file",new File([png],"tiny.png",{type:"image/png"}));form.append("caption","Preview");
  let upload=await clientGeoGallery(new Request(base+"/gallery",{method:"POST",body:form}),env,project,actor,"gallery");
  assert.equal(upload.status,201,await upload.clone().text());
  assert.equal(objects.size,1);
  const list=await clientGeoGallery(new Request(base+"/gallery"),env,project,actor,"gallery");
  const data=await list.json();assert.equal(data.images.length,1);
  const image=await clientGeoGallery(new Request(base+"/gallery-image?id="+data.images[0].id),env,project,actor,"gallery-image");
  assert.equal(image.status,200);
  assert.deepEqual(Buffer.from(await image.arrayBuffer()),png);
  const foreign=await clientGeoGallery(new Request(base+"/gallery-image?id="+data.images[0].id),env,{id:"p2"},actor,"gallery-image");
  assert.equal(foreign.status,404);
  const removed=await clientGeoGallery(new Request(base+"/gallery",{method:"DELETE",body:JSON.stringify({id:data.images[0].id})}),env,project,actor,"gallery");
  assert.equal(removed.status,200);
  assert.equal(objects.size,0);
 }finally{db.close();}
});
