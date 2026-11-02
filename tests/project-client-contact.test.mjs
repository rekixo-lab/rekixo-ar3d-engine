import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {clientProjectContact} from "../workers/project-client-contact.mjs";

const fixture=()=>{
 const sqlite=new DatabaseSync(":memory:");
 sqlite.exec(`CREATE TABLE projects_3d(id TEXT PRIMARY KEY,status TEXT);
 CREATE TABLE project_profiles_3d(
  project_id TEXT PRIMARY KEY,contact_name TEXT,address TEXT,phone_primary TEXT,
  phone_secondary TEXT,whatsapp TEXT,email TEXT,website_url TEXT,maps_url TEXT,
  brochure_url TEXT,owner_name TEXT,project_number TEXT,builder_name TEXT,
  public_contacts_enabled INTEGER,revision INTEGER,updated_by TEXT,updated_at TEXT);
 CREATE TABLE engine_admin_audit(id TEXT PRIMARY KEY,actor_email TEXT,action TEXT,
  project_id TEXT,target_id TEXT,details_json TEXT,created_at TEXT);`);
 for(const project of ["a","b"]){
  sqlite.prepare("INSERT INTO projects_3d VALUES(?,'published')").run(project);
  sqlite.prepare("INSERT INTO project_profiles_3d VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
   project,"Office","Original address","+919876543210","","","","","","",
   "Protected Owner","REG-1","Protected Builder",1,1,"owner@example.test","2026-11-01");
 }
 const prepared=sql=>({bind(...args){
  const stmt=sqlite.prepare(sql);
  return {
    async first(){return stmt.get(...args)||null;},
    async run(){return {meta:{changes:stmt.run(...args).changes}};},
    async all(){return {results:stmt.all(...args)};}
  };
 }});
 const env={DB:{prepare:prepared,async batch(statements){
  sqlite.exec("BEGIN");
  try{
   const rows=[];
   for(const stmt of statements)rows.push(await stmt.run());
   sqlite.exec("COMMIT");return rows;
  }catch(e){sqlite.exec("ROLLBACK");throw e;}
 }}};
 const session={projectId:"a",role:"client_admin",email:"admin-a@example.test",projectStatus:"published"};
 return {sqlite,env,session,close:()=>sqlite.close()};
};
const body=(update)=>new Request("https://admin.rekixo.com/3Dprojects/api/client-portal/projects/a/contact",{
 method:"PUT",headers:{"Content-Type":"application/json"},
 body:JSON.stringify(update)});
test("Client can edit whitelisted contact fields, never owner or visibility consent",async()=>{
 const f=fixture();
 try{
  const first=await clientProjectContact(new Request("https://admin.rekixo.com/x"),f.env,f.session);
  assert.equal(first.status,200);
  const p=await first.json();
  assert.equal(p.revision,1);
  assert.equal(p.ownerApprovedPublic,true);
  const fields={...p.fields,address:"Approved updated address",phonePrimary:"+91 98888 99999"};
  const updated=await clientProjectContact(body({expectedRevision:1,fields}),f.env,f.session);
  assert.equal(updated.status,200,await updated.text().then(x=>x));
  const row=f.sqlite.prepare("SELECT * FROM project_profiles_3d WHERE project_id='a'").get();
  assert.equal(row.address,"Approved updated address");
  assert.equal(row.owner_name,"Protected Owner");
  assert.equal(row.project_number,"REG-1");
  assert.equal(row.builder_name,"Protected Builder");
  assert.equal(row.public_contacts_enabled,1);
  assert.equal(row.revision,2);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS total FROM engine_admin_audit").get().total,1);
  const other=f.sqlite.prepare("SELECT address FROM project_profiles_3d WHERE project_id='b'").get();
  assert.equal(other.address,"Original address");
  const outdated=await clientProjectContact(body({expectedRevision:1,fields}),f.env,f.session);
  assert.equal(outdated.status,409,"optimistic revision denies clobber");
 }finally{f.close();}
});
test("Client cannot elevate profile consent or set owner identity",async()=>{
 const f=fixture();
 try{
  const old=(await (await clientProjectContact(new Request("https://admin.rekixo.com/x"),f.env,f.session)).json()).fields;
  for(const extra of [{publicContactsEnabled:true},{ownerName:"Hacked"},{projectNumber:"Bad"}]){
   const reply=await clientProjectContact(body({expectedRevision:1,fields:{...old,...extra}}),f.env,f.session);
   assert.equal(reply.status,400);
  }
  const viewer=await clientProjectContact(body({expectedRevision:1,fields:old}),f.env,{...f.session,role:"viewer"});
  assert.equal(viewer.status,403);
  const badUrl=await clientProjectContact(body({expectedRevision:1,fields:{...old,mapsUrl:"https://evil.google.example/maps"}}),f.env,f.session);
  assert.equal(badUrl.status,400);
  f.sqlite.prepare("UPDATE projects_3d SET status='archived' WHERE id='a'").run();
  const archived=await clientProjectContact(body({expectedRevision:1,fields:old}),f.env,{...f.session,projectStatus:"archived"});
  assert.equal(archived.status,409);
 }finally{f.close();}
});
