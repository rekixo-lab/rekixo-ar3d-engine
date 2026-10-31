import test from "node:test";
import assert from "node:assert/strict";
import {handleMasterplanSalesAdmin} from "../workers/masterplan-sales.mjs";

const project={id:"masterplan-project",slug:"sample",project_kind:"masterplan_geo",status:"published"};
const actor={email:"engine-owner@example.com"};
const base="https://admin.example/3Dprojects/api/cloud/projects/sample/sales";
const makeSale=i=>({
  id:"00000000-0000-4000-8000-"+String(i).padStart(12,"0"),
  plotId:String(i),buyerName:"Buyer "+i,buyerPhone:"",agreementPaise:10000,
  state:"confirmed",revision:2,notes:"",sourceReleaseId:"release-1",
  createdAt:"2026-10-31T00:00:00.000Z",confirmedAt:"2026-10-31T00:00:00.000Z",
  receivedPaise:0
});
function paginatedDB(rows){
  return {prepare(sql){
    return {bind(...args){
      return {
        async all(){
          if(sql.includes("FROM masterplan_sales_3d s WHERE s.project_id=?")){
            const offset=args.at(-1);
            return {results:rows.slice(offset,offset+250)};
          }
          if(sql.includes("SELECT plot_id FROM masterplan_sales_3d"))
            return {results:rows.map(s=>({plot_id:s.plotId}))};
          throw Error("Unexpected list query: "+sql);
        },
        async first(){
          if(sql.includes("FROM masterplan_geo_active_3d a"))
            return {id:"release-1",mapping_json:JSON.stringify({plots:rows.map(s=>({id:s.plotId}))})};
          if(sql.includes("AS receivedPaise")&&sql.includes("AS agreementPaise"))
            return {agreementPaise:rows.length*10000,receivedPaise:0};
          if(sql.includes("SELECT COUNT(*) AS total FROM masterplan_sales_3d"))
            return {total:rows.length};
          throw Error("Unexpected single-row query: "+sql);
        }
      };
    }};
  }};
}
test("private register paginates beyond 250 without hiding financial records",async()=>{
  const env={DB:paginatedDB(Array.from({length:251},(_,i)=>makeSale(i+1)))};
  const firstReq=new Request(base);
  const firstRes=await handleMasterplanSalesAdmin(firstReq,env,actor,project,
    ["sample","sales"],new URL(firstReq.url));
  assert.equal(firstRes.status,200);
  const first=await firstRes.json();
  assert.equal(first.sales.length,250);
  assert.equal(first.totalSales,251);
  assert.equal(first.nextOffset,250);
  assert.equal(first.totals.agreementPaise,2510000);
  const lastReq=new Request(base+"?offset=250");
  const lastRes=await handleMasterplanSalesAdmin(lastReq,env,actor,project,
    ["sample","sales"],new URL(lastReq.url));
  assert.equal(lastRes.status,200);
  const last=await lastRes.json();
  assert.equal(last.sales.length,1);
  assert.equal(last.nextOffset,null);
  assert.equal(new Set([...first.sales,...last.sales].map(s=>s.id)).size,251);
});
test("private ledger rejects invalid page offsets",async()=>{
  for(const offset of ["-1","2.5","Infinity","not-a-number","100001"]){
    const req=new Request(base+"?offset="+encodeURIComponent(offset));
    const res=await handleMasterplanSalesAdmin(req,{DB:{}},actor,project,
      ["sample","sales"],new URL(req.url));
    assert.equal(res.status,400,offset);
  }
});
test("confirm and void audit writes are in the same transaction as the sale change",async()=>{
  const saleId="00000000-0000-4000-8000-000000000001";
  for(const [action,expectedAudit] of [
    ["confirm","masterplan.sale_confirmed"],["void","masterplan.sale_void"]
  ]){
    let batches=0;
    const env={DB:{
      prepare(sql){return {bind(...args){return {sql,args};}};},
      async batch(statements){
        batches++;
        assert.equal(statements.length,2);
        assert.match(statements[0].sql,/UPDATE masterplan_sales_3d/);
        assert.match(statements[1].sql,/INSERT INTO engine_admin_audit/);
        assert.ok(statements[1].sql.includes(expectedAudit));
        // An audit insert failure must abort the entire D1 transaction.
        throw Error("audit insert failed");
      }
    }};
    const req=new Request(base,{method:"POST",headers:{
      Origin:"https://admin.example","Content-Type":"application/json"
    },body:JSON.stringify({action,saleId,expectedRevision:1,reason:"Duplicate entry correction"})});
    const res=await handleMasterplanSalesAdmin(req,env,actor,project,
      ["sample","sales"],new URL(req.url));
    assert.equal(batches,1);
    assert.equal(res.status,409);
    assert.match((await res.json()).error,/audit insert failed/);
  }
});
