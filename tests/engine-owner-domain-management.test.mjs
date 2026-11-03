import test from "node:test";
import assert from "node:assert/strict";
import {optionalCustomerDomain} from "../workers/engine-domain-public.mjs";
import {readOwnerCredentials} from "../workers/engine-owner-account.mjs";

function database(value){
 return {DB:{prepare:()=>({bind:()=>({first:async()=>value})})}};
}
const entry={status:"active",projectStatus:"published",slug:"client-one",
 projectId:"project-one",kind:"masterplan_geo",challenge:"a".repeat(64)};
const check=async(url,row=entry)=>optionalCustomerDomain(
 new Request(url),database(row),new URL(url));

test("the standard AR3D host never depends on an optional domain record",async()=>{
 const answer=await check("https://ar3dstudio.in/3Dprojects/client-one");
 assert.equal(answer,null);
});
test("unregistered custom host fails closed instead of opening another project",async()=>{
 const answer=await check("https://other.example.com/admin",null);
 assert.equal(answer.status,404);
});
test("verified customer root resolves only the pinned project",async()=>{
 const answer=await check("https://project.example.com/");
 assert.equal(answer.status,302);
 assert.equal(answer.headers.get("location"),
  "https://project.example.com/3Dprojects/client-one/masterplan");
});
test("custom /admin remains on /admin and client API rejects another project",async()=>{
 assert.equal(await check("https://project.example.com/admin"),null);
 const wrong=await check("https://project.example.com/3Dprojects/api/projects/other-project");
 assert.equal(wrong.status,404);
 const context=await check("https://project.example.com/3Dprojects/api/domain-context");
 assert.equal(context.status,200);
 assert.equal((await context.json()).projectSlug,"client-one");
});
test("domain proof is available only for its registered pending challenge",async()=>{
 const pending={...entry,status:"pending"};
 const valid=await check("https://project.example.com/3Dprojects/api/domain-proof/"+"a".repeat(64),pending);
 assert.equal(valid.status,200);
 const invalid=await check("https://project.example.com/3Dprojects/api/domain-proof/"+"b".repeat(64),pending);
 assert.equal(invalid.status,404);
});
test("owner credential override wins over bootstrapped environment secrets",async()=>{
 const fallback={email:"original@example.com",passwordSalt:"old",passwordHash:"old"};
 const changed=await readOwnerCredentials(database({email:"new@example.com",
  passwordSalt:"newSalt",passwordHash:"newHash",version:4}),fallback);
 assert.equal(changed.email,"new@example.com");
 assert.equal(changed.passwordHash,"newHash");
 assert.equal(changed.version,4);
});
test("owner sign-in fails closed on D1 errors other than uninstalled table",async()=>{
 const env={DB:{prepare:()=>({first:async()=>{throw Error("D1 temporarily unavailable");}})}};
 await assert.rejects(()=>readOwnerCredentials(env,{email:"bootstrap@example.com"}),/temporarily unavailable/);
});
