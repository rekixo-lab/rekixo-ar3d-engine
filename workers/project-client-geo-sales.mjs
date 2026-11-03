// Private Geo sales/receipt ledger, distinct from approved public listing status.
import {activeMap} from "./geo-plot-commercial.mjs";
const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
const uuid=v=>typeof v==="string"&&/^[0-9a-f-]{36}$/i.test(v);
const string=(v,max)=>typeof v==="string"&&v.length<=max&&!/[\x00-\x1f\x7f]/.test(v);
const money=v=>Number.isSafeInteger(v)&&v>0&&v<=1e12;
const date=v=>typeof v==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v+"T00:00:00Z"));
async function state(env,ctx,source){
 const sales=await env.DB.prepare(
  "SELECT s.id,s.plot_id AS plotId,s.buyer_name AS buyerName,s.buyer_phone AS buyerPhone,s.agreement_paise AS agreementPaise,s.state,s.revision,s.notes,s.evidence_ref AS evidenceRef,s.created_at AS createdAt,COALESCE((SELECT SUM(CASE WHEN p.kind='receipt' THEN p.amount_paise ELSE -p.amount_paise END) FROM geo_client_receipts_3d p WHERE p.sale_id=s.id),0) AS receivedPaise FROM geo_client_sales_3d s WHERE s.project_id=? AND s.mapping_release_id=? ORDER BY s.created_at DESC LIMIT 250"
 ).bind(ctx.project.id,source.releaseId).all();
 const payments=await env.DB.prepare(
  "SELECT p.id,p.sale_id AS saleId,p.kind,p.amount_paise AS amountPaise,p.paid_on AS paidOn,p.method,p.reference,p.note,p.reverses_id AS reversesId,p.created_at AS createdAt FROM geo_client_receipts_3d p JOIN geo_client_sales_3d s ON s.id=p.sale_id AND s.project_id=p.project_id WHERE p.project_id=? AND s.mapping_release_id=? ORDER BY p.created_at DESC LIMIT 500"
 ).bind(ctx.project.id,source.releaseId).all();
 const total=await env.DB.prepare(
  "SELECT COUNT(*) AS total FROM geo_client_sales_3d WHERE project_id=? AND mapping_release_id=?"
 ).bind(ctx.project.id,source.releaseId).first();
 return {mappingReleaseId:source.releaseId,sales:sales.results||[],payments:payments.results||[],totalSales:Number(total?.total||0),notice:"Private client-entered sale and receipt records; public Sold approval and bank verification are separate."};
}
async function audit(env,ctx,actor,action,target,details){
 return env.DB.prepare("INSERT INTO engine_admin_audit(id,actor_email,action,project_id,target_id,details_json,created_at) VALUES(?,?,?,?,?,?,?)")
 .bind(crypto.randomUUID(),actor.email,action,ctx.project.id,target,JSON.stringify(details),new Date().toISOString());
}
export async function clientGeoSales(request,env,ctx,actor){
 if(actor.role!=="client_admin")return json({error:"Client Admin required."},403);
 if(!["GET","POST","PUT"].includes(request.method))return json({error:"Method not allowed."},405);
 try{
  const source=await activeMap(env,ctx);
  if(!source)return json({error:"Current published Geo mapping required for private sales."},409);
  if(request.method==="GET")return json(await state(env,ctx,source));
  if(ctx.project.status==="archived")return json({error:"Archived project is read-only."},409);
  const raw=await request.text();if(raw.length>4096)return json({error:"Sales request too large."},413);
  const b=JSON.parse(raw),now=new Date().toISOString();
  if(!b||typeof b!=="object"||!uuid(b.operationId)&&request.method==="POST")
   return json({error:"An action ID is required to prevent duplicates."},400);
  if(request.method==="POST"&&b.action==="create"){
   if(!string(b.plotId,48)||!string(b.buyerName,160)||!b.buyerName.trim()||
      !string(b.buyerPhone||"",25)||!string(b.evidenceRef,250)||b.evidenceRef.trim().length<3||
      !string(b.notes||"",600)||!money(b.agreementPaise))
     return json({error:"Valid plot, buyer, agreement amount and source evidence required."},400);
   const target=source.plots.find(p=>p.id.toLowerCase()===b.plotId.toLowerCase());
   if(!target)return json({error:"Plot does not exist in current published mapping."},404);
   const phone=(b.buyerPhone||"").trim();
   if(phone&&(!/^\+?[0-9() -]{7,25}$/.test(phone)||phone.replace(/\D/g,"").length<7))
     return json({error:"Invalid buyer phone."},400);
   const id=crypto.randomUUID();
   const result=await env.DB.batch([
    env.DB.prepare("INSERT INTO geo_client_sales_3d(id,project_id,mapping_release_id,plot_id,buyer_name,buyer_phone,agreement_paise,state,revision,notes,evidence_ref,created_by,created_at,operation_id) SELECT ?,?,?,?,?,?,?,'booked',1,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM geo_plot_mapping_active_3d WHERE project_id=? AND mapping_release_id=?)")
      .bind(id,ctx.project.id,source.releaseId,target.id,b.buyerName.trim(),phone,b.agreementPaise,(b.notes||"").trim(),b.evidenceRef.trim(),actor.email,now,b.operationId,ctx.project.id,source.releaseId),
    await audit(env,ctx,actor,"geo.client_sale_booked",id,{plotId:target.id,mappingReleaseId:source.releaseId})
   ]);
   if(result[0]?.meta?.changes!==1)return json({error:"Sale could not be created. Reload."},409);
  }else if(request.method==="POST"&&b.action==="receipt"){
   if(!uuid(b.saleId)||!money(b.amountPaise)||!date(b.paidOn)||
      !["cash","upi","bank","card","other"].includes(b.method)||
      !string(b.reference||"",160)||!string(b.note||"",400))
     return json({error:"Valid receipt, payment date/method and amount required."},400);
   if(["bank","upi","card"].includes(b.method)&&String(b.reference||"").trim().length<3)
     return json({error:"Bank, UPI and card receipts require a reference."},400);
   const id=crypto.randomUUID();
   const result=await env.DB.batch([
    env.DB.prepare("INSERT INTO geo_client_receipts_3d(id,project_id,sale_id,kind,amount_paise,paid_on,method,reference,note,created_by,created_at,operation_id) SELECT ?,?,s.id,'receipt',?,?,?,?,?,?,?,? FROM geo_client_sales_3d s WHERE s.id=? AND s.project_id=? AND s.mapping_release_id=? AND s.state IN ('booked','confirmed') AND (SELECT COALESCE(SUM(CASE WHEN kind='receipt' THEN amount_paise ELSE -amount_paise END),0) FROM geo_client_receipts_3d WHERE sale_id=s.id)+?<=s.agreement_paise")
      .bind(id,ctx.project.id,b.amountPaise,b.paidOn,b.method,(b.reference||"").trim(),(b.note||"").trim(),actor.email,now,b.operationId,b.saleId,ctx.project.id,source.releaseId,b.amountPaise),
    await audit(env,ctx,actor,"geo.client_receipt_recorded",b.saleId,{mappingReleaseId:source.releaseId})
   ]);
   if(result[0]?.meta?.changes!==1)return json({error:"Receipt exceeds outstanding amount or sale is no longer active."},409);
  }else if(request.method==="POST"&&b.action==="reverse"){
   if(!uuid(b.saleId)||!uuid(b.receiptId)||!string(b.reason,400)||b.reason.trim().length<3)
     return json({error:"Valid payment and correction reason required."},400);
   const result=await env.DB.batch([
    env.DB.prepare("INSERT INTO geo_client_receipts_3d(id,project_id,sale_id,kind,amount_paise,paid_on,method,reference,note,reverses_id,created_by,created_at,operation_id) SELECT ?,?,p.sale_id,'reversal',p.amount_paise,p.paid_on,p.method,p.reference,?,p.id,?,?,? FROM geo_client_receipts_3d p JOIN geo_client_sales_3d s ON s.id=p.sale_id AND s.project_id=p.project_id WHERE p.id=? AND p.sale_id=? AND p.project_id=? AND s.mapping_release_id=? AND p.kind='receipt' AND NOT EXISTS(SELECT 1 FROM geo_client_receipts_3d x WHERE x.reverses_id=p.id)")
     .bind(crypto.randomUUID(),ctx.project.id,b.reason.trim(),actor.email,now,b.operationId,b.receiptId,b.saleId,ctx.project.id,source.releaseId),
    await audit(env,ctx,actor,"geo.client_receipt_reversed",b.receiptId,{mappingReleaseId:source.releaseId})
   ]);
   if(result[0]?.meta?.changes!==1)return json({error:"Receipt already reversed or not found."},409);
  }else if(request.method==="PUT"&&["confirm","void"].includes(b.action)){
   if(!uuid(b.saleId)||!Number.isInteger(b.expectedRevision)||b.expectedRevision<1||
      !string(b.evidenceRef,250)||b.evidenceRef.trim().length<3)
    return json({error:"Valid sale revision and evidence required."},400);
   const newState=b.action==="confirm"?"confirmed":"void";
   const where=b.action==="confirm"?"":" AND (SELECT COALESCE(SUM(CASE WHEN kind='receipt' THEN amount_paise ELSE -amount_paise END),0) FROM geo_client_receipts_3d WHERE sale_id=geo_client_sales_3d.id)=0";
   const result=await env.DB.batch([
    env.DB.prepare("UPDATE geo_client_sales_3d SET state=?,revision=revision+1,confirmed_at=?,confirmed_by=?,evidence_ref=? WHERE id=? AND project_id=? AND mapping_release_id=? AND state='booked' AND revision=?"+where+" AND EXISTS(SELECT 1 FROM geo_plot_mapping_active_3d WHERE project_id=? AND mapping_release_id=?)")
     .bind(newState,b.action==="confirm"?now:null,b.action==="confirm"?actor.email:null,b.evidenceRef.trim(),b.saleId,ctx.project.id,source.releaseId,b.expectedRevision,ctx.project.id,source.releaseId),
    await audit(env,ctx,actor,"geo.client_sale_"+newState,b.saleId,{mappingReleaseId:source.releaseId})
   ]);
   if(result[0]?.meta?.changes!==1)return json({error:"Sale changed, has outstanding receipts, or is not Booked."},409);
  }else return json({error:"Unknown sales action."},400);
  return json(await state(env,ctx,source));
 }catch(error){return json({error:error instanceof Error?error.message:"Sales operation failed."},409);}
}
