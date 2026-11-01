import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {provisionProjectClient,revokeProjectClient} from "../workers/project-client-access.mjs";
import {handleProjectClientPortal} from "../workers/project-client-portal.mjs";
import {canProjectClient} from "../shared/project-client-roles.js";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
class MockStatement{
 constructor(db,sql){this.db=db;this.sql=sql;this.args=[];}
 bind(...args){this.args=args;return this;}
 async first(){return this.db.prepare(this.sql).get(...this.args)||null;}
 async all(){return {results:this.db.prepare(this.sql).all(...this.args)};}
 async run(){const result=this.db.prepare(this.sql).run(...this.args);return {meta:{changes:result.changes}};}
}
class MockD1{
 constructor(sqlite){this.sqlite=sqlite;}
 prepare(sql){return new MockStatement(this.sqlite,sql);}
 async batch(statements){
  this.sqlite.exec("BEGIN");
  try{const results=[];for(const statement of statements)results.push(await statement.run());
   this.sqlite.exec("COMMIT");return results;}
  catch(error){this.sqlite.exec("ROLLBACK");throw error;}
 }
}
const base="https://admin.rekixo.com";
function request(url,method="GET",data,headers={}){
 return new Request(base+url,{method,headers:{
  ...(method!=="GET"?{"Origin":base}:{}),
  ...(data?{"Content-Type":"application/json"}:{}),...headers},
  ...(data?{body:JSON.stringify(data)}:{})});
}
const portal=(env,req)=>handleProjectClientPortal(req,env,new URL(req.url));
function fixture(){
 const db=new DatabaseSync(":memory:");
 db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE projects_3d(id TEXT PRIMARY KEY,slug TEXT,name TEXT,status TEXT,project_kind TEXT);
 CREATE TABLE project_client_directory_3d(id TEXT PRIMARY KEY,project_id TEXT REFERENCES projects_3d(id) ON DELETE CASCADE,
   display_name TEXT,email TEXT,proposed_role TEXT,access_state TEXT,updated_by TEXT,updated_at TEXT);
 CREATE TABLE engine_admin_audit(id TEXT PRIMARY KEY,actor_email TEXT,action TEXT,
   project_id TEXT,target_id TEXT,details_json TEXT,created_at TEXT);`);
 db.exec(read("database/migrations/0047_scoped_project_client_access.sql"));
 for(const slug of ["demo-a","demo-b"])
  db.prepare("INSERT INTO projects_3d VALUES(?,?,?,'published','legacy')")
   .run(slug,slug,"Demo "+slug);
 for(const [id,project,role] of [["11111111-1111-4111-8111-111111111111","demo-a","viewer"],
  ["22222222-2222-4222-8222-222222222222","demo-b","approver"],
  ["33333333-3333-4333-8333-333333333333","demo-a","editor"]]){
  db.prepare("INSERT INTO project_client_directory_3d VALUES(?,?,?,?,?,'not_provisioned',NULL,NULL)")
    .run(id,project,"Client "+id,project+"@example.test",role);
 }
 return {sqlite:db,env:{DB:new MockD1(db)},actor:{email:"owner@example.test"},
   project:{id:"demo-a",slug:"demo-a",status:"published"},close:()=>db.close()};
}
test("Role policy never yields Engine Owner or another-project capabilities",()=>{
 for(const role of ["viewer","editor","approver","client_admin"]){
  assert.equal(canProjectClient(role,"project.read"),true);
  assert.equal(canProjectClient(role,"owner.all"),false);
  assert.equal(canProjectClient(role,"project.crossRead"),false);
 }
 assert.equal(canProjectClient("viewer","commercial.prepare"),false);
 assert.equal(canProjectClient("editor","commercial.prepare"),true);
 assert.equal(canProjectClient("editor","commercial.approve"),false);
 assert.equal(canProjectClient("approver","commercial.approve"),true);
});
test("Owner issues a one-use project invite; enrollment creates secure cookie, no raw bearer stored",async()=>{
 const f=fixture();
 try{
  const id="11111111-1111-4111-8111-111111111111";
  const grant=await provisionProjectClient(f.env,f.actor,f.project,{id,role:"viewer"},
   request("/3Dprojects/clients"));
  assert.match(grant.inviteUrl,/^https:\/\/admin\.rekixo\.com\/3Dprojects\/client-portal#invite=[a-f0-9]{64}$/);
  const token=grant.inviteUrl.split("invite=")[1];
  const row=f.sqlite.prepare("SELECT token_hash FROM project_client_invitations_3d").get();
  assert.notEqual(row.token_hash,token,"secrets are stored hashed only");
  const good=request("/3Dprojects/api/client-portal/enroll","POST",{
   token,email:"demo-a@example.test"});
  const response=await portal(f.env,good);
  assert.equal(response.status,200,await response.text());
  const cookie=response.headers.get("set-cookie");
  assert.match(cookie,/HttpOnly; Secure; SameSite=Strict/);
  assert.ok(!cookie.includes(token),"invite token never becomes session bearer");
  const authenticated=await portal(f.env,request(
   "/3Dprojects/api/client-portal/session","GET",undefined,{"Cookie":cookie}));
  const data=await authenticated.json();
  assert.equal(data.user.projectSlug,"demo-a");
  assert.equal(data.user.role,"viewer");
  const replay=await portal(f.env,request("/3Dprojects/api/client-portal/enroll","POST",{
   token,email:"demo-a@example.test"}));
  assert.equal(replay.status,401,"one-time grants are not reusable");
  const foreign=await portal(f.env,request(
    "/3Dprojects/api/client-portal/projects/demo-b/overview","GET",undefined,
    {"Cookie":cookie}));
  assert.equal(foreign.status,403,"client cannot browse another project");
  const mutate=await portal(f.env,request(
   "/3Dprojects/api/client-portal/projects/demo-a/commercial","PUT",{
    plotId:"1",status:"sold",publicApproved:true,
    evidenceRef:"Fake proof",expectedRevision:0},{"Cookie":cookie}));
  assert.equal(mutate.status,403,"read-only clients cannot change listing facts");
  const revoke=await revokeProjectClient(f.env,f.actor,f.project,{id});
  assert.equal(revoke.revoked,true);
  const after=await portal(f.env,request("/3Dprojects/api/client-portal/session",
    "GET",undefined,{"Cookie":cookie}));
  assert.equal((await after.json()).authenticated,false);
 }finally{f.close();}
});
test("Role and project identity are checked before invitation and every session use",async()=>{
 const f=fixture();
 try{
  assert.rejects(()=>provisionProjectClient(f.env,f.actor,f.project,{
   id:"22222222-2222-4222-8222-222222222222",role:"approver"
  },request("/3Dprojects/clients")),/enabled project directory/);
  assert.rejects(()=>provisionProjectClient(f.env,f.actor,f.project,{
   id:"33333333-3333-4333-8333-333333333333",role:"client_admin"
  },request("/3Dprojects/clients")),/match/);
  const id="33333333-3333-4333-8333-333333333333";
  const info=await provisionProjectClient(f.env,f.actor,f.project,{id,role:"editor"},
   request("/3Dprojects/clients"));
  const first=await portal(f.env,request("/3Dprojects/api/client-portal/enroll","POST",{
   token:info.inviteUrl.split("invite=")[1],email:"demo-a@example.test"}));
  assert.equal(first.status,200);
  const cookie=first.headers.get("set-cookie");
  await provisionProjectClient(f.env,f.actor,f.project,{id,role:"editor"},
   request("/3Dprojects/clients"));
  const old=await portal(f.env,request("/3Dprojects/api/client-portal/session",
   "GET",undefined,{"Cookie":cookie}));
  assert.equal((await old.json()).authenticated,false,
   "owner rotation must revoke existing sessions via epoch/version check");
  const invalidOrigin=await portal(f.env,new Request(base+"/3Dprojects/api/client-portal/enroll",{
   method:"POST",headers:{"Origin":"https://evil.example","Content-Type":"application/json"},
   body:JSON.stringify({token:info.inviteUrl.split("invite=")[1],
    email:"demo-a@example.test"})}));
  assert.equal(invalidOrigin.status,403);
 }finally{f.close();}
});
test("Owner UI can issue and revoke links but client portal has no owner routing",()=>{
 const management=read("apps/admin/src/management/ProjectManagement.tsx");
 const admin=read("workers/admin.mjs");
 const client=read("workers/project-client-portal.mjs");
 assert.match(management,/grant-client-access/);
 assert.match(management,/revoke-client-access/);
 assert.match(admin,/handleProjectClientPortal\(request,env,url\)/);
 assert.doesNotMatch(client,/engineAdminReadAccess|handleCloudAdminRequest/);
 assert.match(client,/s\.revoked_at IS NULL AND s\.expires_at/);
 assert.match(client,/g\.epoch=s\.grant_epoch/);
});
