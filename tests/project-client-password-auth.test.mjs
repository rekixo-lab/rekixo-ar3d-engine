import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {ownerProvisionClientPassword,ownerCreateClientPassword} from "../workers/project-client-passwords.mjs";
import {handleProjectClientPortal} from "../workers/project-client-portal.mjs";
const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
class Stmt {
 constructor(db,sql){this.db=db;this.sql=sql;this.args=[];}
 bind(...args){this.args=args;return this;}
 async first(){return this.db.prepare(this.sql).get(...this.args)||null;}
 async run(){const row=this.db.prepare(this.sql).run(...this.args);return {meta:{changes:row.changes}};}
 async all(){return {results:this.db.prepare(this.sql).all(...this.args)};}
}
class D1 {
 constructor(db){this.db=db;}
 prepare(sql){return new Stmt(this.db,sql);}
 async batch(items){
  this.db.exec("BEGIN");
  try{const result=[];for(const item of items)result.push(await item.run());
   this.db.exec("COMMIT");return result;}
  catch(error){this.db.exec("ROLLBACK");throw error;}
 }
}
function fixture(){
 const sqlite=new DatabaseSync(":memory:");
 sqlite.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE projects_3d(id TEXT PRIMARY KEY,slug TEXT,name TEXT,status TEXT,project_kind TEXT);
 CREATE TABLE project_client_directory_3d(
  id TEXT PRIMARY KEY,project_id TEXT REFERENCES projects_3d(id),display_name TEXT,
  email TEXT,phone TEXT,proposed_role TEXT,access_state TEXT,
  notes TEXT DEFAULT '',created_by TEXT DEFAULT '',created_at TEXT DEFAULT '',
  updated_by TEXT,updated_at TEXT);
 CREATE TABLE engine_admin_audit(id TEXT PRIMARY KEY,actor_email TEXT,action TEXT,
  project_id TEXT,target_id TEXT,details_json TEXT,created_at TEXT);`);
 sqlite.exec(read("database/migrations/0047_scoped_project_client_access.sql"));
 sqlite.exec(read("database/migrations/0052_project_client_password_access.sql"));
 for(const slug of ["demo-a","demo-b"]){
  sqlite.prepare("INSERT INTO projects_3d VALUES(?,?,?,'published','building')").run(slug,slug,slug);
  sqlite.prepare("INSERT INTO project_client_directory_3d "+
   "(id,project_id,display_name,email,phone,proposed_role,access_state,updated_by,updated_at) "+
   "VALUES(?,?,?,?,?,'client_admin','not_provisioned',?,?)")
   .run(slug==="demo-a"?"11111111-1111-4111-8111-111111111111":
    "22222222-2222-4222-8222-222222222222",slug,"Client "+slug,
    slug+"@example.test","+919876543210","owner@example.test","2026-11-02");
 }
 return {sqlite,env:{DB:new D1(sqlite)},project:{id:"demo-a",slug:"demo-a",status:"published"},
  clientId:"11111111-1111-4111-8111-111111111111",
  owner:{email:"owner@example.test"},close:()=>sqlite.close()};
}
const base="https://ar3dstudio.in";
const req=(path,method="GET",data,cookie)=>{
 const headers={...(method!=="GET"?{"Origin":base}:{}),
   ...(data?{"Content-Type":"application/json"}:{}),...(cookie?{"Cookie":cookie}:{})};
 return new Request(base+path,{method,headers,...(data?{body:JSON.stringify(data)}:{})});
};
const api=(env,request)=>handleProjectClientPortal(request,env,new URL(request.url));
test("Owner creates client, grant and password atomically; duplicate login leaves no orphan record",async()=>{
 const f=fixture();
 try{
  const created=await ownerCreateClientPassword(f.env,f.owner,f.project,{
   displayName:"Another Client",email:"owner2@example.test",phone:"+919888777666",
   notes:"Client owner",loginType:"mobile"
  });
  assert.equal(created.loginId,"+919888777666");
  const directory=f.sqlite.prepare("SELECT * FROM project_client_directory_3d WHERE id=?")
   .get(created.clientId);
  assert.equal(directory.display_name,"Another Client");
  const grant=f.sqlite.prepare("SELECT * FROM project_client_grants_3d WHERE client_id=?")
   .get(created.clientId);
  assert.equal(grant.active,1);
  assert.equal(grant.role,"client_admin");
  const before=f.sqlite.prepare("SELECT COUNT(*) AS total FROM project_client_directory_3d").get().total;
  await assert.rejects(ownerCreateClientPassword(f.env,f.owner,f.project,{
   displayName:"Duplicate Number",phone:"+919888777666",email:"another@example.test",
   loginType:"mobile"
  }),/UNIQUE/);
  const after=f.sqlite.prepare("SELECT COUNT(*) AS total FROM project_client_directory_3d").get().total;
  assert.equal(after,before,"failed login creation must rollback directory too");
 }finally{f.close();}
});
test("Owner provisions independent project-bound Mobile Login ID and temporary password",async()=>{
 const f=fixture();
 try{
  const details=await ownerProvisionClientPassword(f.env,f.owner,f.project,f.clientId,"mobile");
  assert.equal(details.loginId,"+919876543210");
  assert.equal(details.loginType,"mobile");
  assert.match(details.password,/^(?=.*[A-Za-z])(?=.*[0-9])[A-Za-z0-9]{12,}$/);
  const row=f.sqlite.prepare("SELECT * FROM project_client_passwords_3d WHERE client_id=?").get(f.clientId);
  assert.equal(row.project_id,"demo-a");
  assert.equal(row.login_id,details.loginId);
  assert.equal(row.must_change_password,1);
  assert.notEqual(row.password_hash,details.password);
  assert.equal(row.password_hash.length,64);
  assert.equal(row.password_salt.length,32);
  const leaked=f.sqlite.prepare("SELECT details_json FROM engine_admin_audit LIMIT 1").get().details_json;
  assert.ok(!leaked.includes(details.password),"audit logs never store passwords");
  const b=f.sqlite.prepare("SELECT COUNT(*) AS n FROM project_client_passwords_3d WHERE project_id='demo-b'").get();
  assert.equal(b.n,0);
 }finally{f.close();}
});
test("First sign-in forces password change, then new password grants scoped dashboard",async()=>{
 const f=fixture();
 try{
  const creds=await ownerProvisionClientPassword(f.env,f.owner,f.project,f.clientId,"mobile");
  const foreign=await api(f.env,req("/3Dprojects/api/client-portal/login","POST",{
   projectSlug:"demo-b",loginId:creds.loginId,password:creds.password}));
  assert.equal(foreign.status,401);
  const denied=await api(f.env,req("/3Dprojects/api/client-portal/login","POST",{
   projectSlug:"demo-a",loginId:creds.loginId,password:"wrong-password123"}));
  assert.equal(denied.status,401);
  const reply=await api(f.env,req("/3Dprojects/api/client-portal/login","POST",{
   projectSlug:"demo-a",loginId:"9876543210",password:creds.password}));
  assert.equal(reply.status,200,await reply.clone().text());
  assert.equal((await reply.json()).mustChangePassword,true);
  const cookie=reply.headers.get("set-cookie");
  assert.match(cookie,/HttpOnly; Secure; SameSite=Strict/);
  const session=await api(f.env,req("/3Dprojects/api/client-portal/session?project=demo-a","GET",null,cookie));
  const who=await session.json();
  assert.equal(who.authenticated,true);
  assert.equal(who.user.mustChangePassword,true);
  assert.equal(who.user.projectSlug,"demo-a");
  const blocked=await api(f.env,req("/3Dprojects/api/client-portal/projects/demo-a/overview","GET",null,cookie));
  assert.equal(blocked.status,403);
  const foreignSession=await api(f.env,req("/3Dprojects/api/client-portal/session?project=demo-b","GET",null,cookie));
  assert.equal((await foreignSession.json()).authenticated,false);
  const updated=await api(f.env,req("/3Dprojects/api/client-portal/change-password","POST",{
   oldPassword:creds.password,newPassword:"ClientStrong9876"},cookie));
  assert.equal(updated.status,200,await updated.text());
  assert.match(updated.headers.get("set-cookie")||"",/Max-Age=0/);
  const expired=await api(f.env,req("/3Dprojects/api/client-portal/session?project=demo-a","GET",null,cookie));
  assert.equal((await expired.json()).authenticated,false);
  const old=await api(f.env,req("/3Dprojects/api/client-portal/login","POST",{
   projectSlug:"demo-a",loginId:creds.loginId,password:creds.password}));
  assert.equal(old.status,401);
  const again=await api(f.env,req("/3Dprojects/api/client-portal/login","POST",{
   projectSlug:"demo-a",loginId:creds.loginId,password:"ClientStrong9876"}));
  assert.equal(again.status,200,await again.text());
  assert.equal((await again.json()).mustChangePassword,false);
 }finally{f.close();}
});
test("Owner password reset revokes active sessions and replaces old login secret",async()=>{
 const f=fixture();
 try{
  const initial=await ownerProvisionClientPassword(f.env,f.owner,f.project,f.clientId,"email");
  assert.equal(initial.loginId,"demo-a@example.test");
  const signed=await api(f.env,req("/3Dprojects/api/client-portal/login","POST",{
    projectSlug:"demo-a",loginId:initial.loginId,password:initial.password}));
  assert.equal(signed.status,200);
  const cookie=signed.headers.get("set-cookie");
  const reset=await ownerProvisionClientPassword(f.env,f.owner,f.project,f.clientId,"email");
  assert.notEqual(reset.password,initial.password);
  const expired=await api(f.env,req("/3Dprojects/api/client-portal/session?project=demo-a","GET",null,cookie));
  assert.equal((await expired.json()).authenticated,false);
  const old=await api(f.env,req("/3Dprojects/api/client-portal/login","POST",{
    projectSlug:"demo-a",loginId:initial.loginId,password:initial.password}));
  assert.equal(old.status,401);
  const fresh=await api(f.env,req("/3Dprojects/api/client-portal/login","POST",{
    projectSlug:"demo-a",loginId:reset.loginId,password:reset.password}));
  assert.equal(fresh.status,200);
 }finally{f.close();}
});
