// PRIVATE project and immutable Geo mapping scoped deal evidence.
// Does not modify customer-facing Available/Booked/Sold status or price.
import {activeMap} from "./geo-plot-commercial.mjs";
const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
const valid=(value,max)=>typeof value==="string"&&value.trim().length<=max&&!/[\x00-\x1f\x7f]/.test(value);
const phoneOk=v=>!v||(/^\+?[0-9() -]{7,25}$/.test(v)&&v.replace(/\D/g,"").length>=7);
export const GEO_DEAL_STAGES=Object.freeze(["inquiry","booked","agreement_pending","agreement_done","registered","cancelled"]);
export function normalizeGeoDealChange(body){
 if(!body||typeof body!=="object"||Array.isArray(body))throw Error("Invalid private deal record.");
 if(typeof body.plotId!=="string"||!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,47}$/.test(body.plotId))
  throw Error("Canonical Geo Plot ID is required.");
 if(!GEO_DEAL_STAGES.includes(body.stage))throw Error("Select a valid private deal stage.");
 if(!Number.isInteger(body.expectedRevision)||body.expectedRevision<0)
  throw Error("Exact current deal revision required.");
 for(const [key,max] of [["buyerName",160],["buyerPhone",25],["paymentReference",250],
   ["agreementReference",250],["registrationReference",250],["evidenceReference",250],["notes",500]]){
  if(!valid(body[key]??"",max))throw Error(key+" contains invalid characters or exceeds limit.");
 }
 const buyerName=String(body.buyerName||"").trim(),buyerPhone=String(body.buyerPhone||"").trim();
 if(!phoneOk(buyerPhone))throw Error("Buyer contact must be a valid phone or blank.");
 if(["booked","agreement_pending","agreement_done","registered"].includes(body.stage)&&!buyerName)
  throw Error("Buyer name required for active booking/agreement.");
 const claimedPaymentPaise=body.claimedPaymentPaise??0;
 if(!Number.isSafeInteger(claimedPaymentPaise)||claimedPaymentPaise<0||claimedPaymentPaise>1e12)
  throw Error("Reported payment must be nonnegative INR paise.");
 const paymentReference=String(body.paymentReference||"").trim();
 const agreementReference=String(body.agreementReference||"").trim();
 const registrationReference=String(body.registrationReference||"").trim();
 const evidenceReference=String(body.evidenceReference||"").trim();
 if(evidenceReference.length<3)throw Error("Reviewed deal evidence/source reference required.");
 if(claimedPaymentPaise>0&&paymentReference.length<3)
  throw Error("A payment claim needs receipt/reference evidence; bank verification is NOT implied.");
 if(["agreement_done","registered"].includes(body.stage)&&agreementReference.length<3)
  throw Error("Agreement Done requires a signed agreement document reference.");
 if(body.stage==="registered"&&registrationReference.length<3)
  throw Error("Registration status requires registration document reference.");
 return {plotId:body.plotId,stage:body.stage,buyerName,buyerPhone,
  claimedPaymentPaise,paymentReference,agreementReference,registrationReference,
  evidenceReference,notes:String(body.notes||"").trim(),expectedRevision:body.expectedRevision};
}
async function readState(env,ctx,source){
 if(!source)return {mappingReleaseId:null,rows:[],notice:"Publish verified Geo mapping before deal records."};
 const sql="SELECT plot_id AS plotId,stage,buyer_name AS buyerName,buyer_phone AS buyerPhone,"+
 "claimed_payment_paise AS claimedPaymentPaise,payment_reference AS paymentReference,"+
 "agreement_reference AS agreementReference,registration_reference AS registrationReference,"+
 "evidence_reference AS evidenceReference,notes,revision,updated_by AS updatedBy,"+
 "updated_at AS updatedAt FROM geo_plot_deals_3d WHERE project_id=? AND mapping_release_id=? "+
 "ORDER BY plot_id COLLATE NOCASE LIMIT 2500";
 const out=await env.DB.prepare(sql).bind(ctx.project.id,source.releaseId).all();
 return {mappingReleaseId:source.releaseId,rows:out.results||[],
   notice:"Private owner-entered agreement/deal records only. Public approval and bank verification are separate."};
}
export async function handleGeoPlotDeals(request,env,ctx,actor,{allowWrite=true}={}){
 if(!["GET","PUT"].includes(request.method))return json({error:"Method not allowed."},405);
 if(request.method==="PUT"&&!allowWrite)
  return json({error:"Only authorized Client Admin/Engine Owner may record private Geo deals."},403);
 try{
  const source=await activeMap(env,ctx);
  if(request.method==="GET")return json(await readState(env,ctx,source));
  if(ctx.project.status==="archived")throw Error("Archived project deal records are read-only.");
  if(!source)throw Error("Publish verified source-bound mapping before recording deals.");
  const raw=await request.text();
  if(raw.length>8192)throw Error("Private deal request exceeds 8 KB.");
  const record=normalizeGeoDealChange(JSON.parse(raw));
  const selected=source.plots.find(x=>x.id.toLowerCase()===record.plotId.toLowerCase());
  if(!selected)throw Error("Canonical plot ID is not in verified published Geo release.");
  const old=await env.DB.prepare(
   "SELECT revision FROM geo_plot_deals_3d WHERE project_id=? AND mapping_release_id=? AND plot_id=?")
   .bind(ctx.project.id,source.releaseId,selected.id).first();
  if(Number(old?.revision||0)!==record.expectedRevision)
   throw Error("Deal changed in another Admin session. Reload before saving.");
  const next=record.expectedRevision+1,now=new Date().toISOString();
  const guard="EXISTS (SELECT 1 FROM geo_plot_mapping_active_3d a "+
   "JOIN geo_plot_mapping_releases_3d r ON r.id=a.mapping_release_id "+
   "AND r.project_id=a.project_id AND r.experience_id=a.experience_id "+
   "WHERE a.project_id=? AND a.experience_id=? AND a.mapping_release_id=? "+
   "AND r.geo_release_id=? AND r.building_release_id=?)";
  const args=[ctx.project.id,ctx.active.experience_id,source.releaseId,
    ctx.active.geo_release_id,ctx.active.source_building_release_id];
  const values=[record.stage,record.buyerName,record.buyerPhone,record.claimedPaymentPaise,
    record.paymentReference,record.agreementReference,record.registrationReference,
    record.evidenceReference,record.notes];
  const create="INSERT INTO geo_plot_deals_3d "+
    "(project_id,mapping_release_id,plot_id,stage,buyer_name,buyer_phone,claimed_payment_paise,"+
    "payment_reference,agreement_reference,registration_reference,evidence_reference,"+
    "notes,revision,updated_by,updated_at) "+
    "SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE "+guard+
    " AND NOT EXISTS(SELECT 1 FROM geo_plot_deals_3d WHERE project_id=? AND mapping_release_id=? AND plot_id=?)";
  const update="UPDATE geo_plot_deals_3d SET stage=?,buyer_name=?,buyer_phone=?,"+
    "claimed_payment_paise=?,payment_reference=?,agreement_reference=?,registration_reference=?,"+
    "evidence_reference=?,notes=?,revision=revision+1,updated_by=?,updated_at=? "+
    "WHERE project_id=? AND mapping_release_id=? AND plot_id=? AND revision=? AND "+guard;
  const change=record.expectedRevision===0?
    env.DB.prepare(create).bind(ctx.project.id,source.releaseId,selected.id,...values,
      next,actor.email,now,...args,ctx.project.id,source.releaseId,selected.id)
    :env.DB.prepare(update).bind(...values,actor.email,now,ctx.project.id,
      source.releaseId,selected.id,record.expectedRevision,...args);
  const event={...record,plotId:selected.id,revision:next,
    kind:"owner_entered_unverified_private_deal"};
  const results=await env.DB.batch([
    change,
    env.DB.prepare("INSERT INTO geo_plot_deal_events_3d "+
     "(id,project_id,mapping_release_id,plot_id,revision,event_json,actor_email,created_at) "+
     "SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM geo_plot_deals_3d "+
     "WHERE project_id=? AND mapping_release_id=? AND plot_id=? AND revision=?)")
     .bind(crypto.randomUUID(),ctx.project.id,source.releaseId,selected.id,next,
      JSON.stringify(event),actor.email,now,ctx.project.id,source.releaseId,selected.id,next),
    env.DB.prepare("INSERT INTO engine_admin_audit "+
     "(id,actor_email,action,project_id,target_id,details_json,created_at) "+
     "SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM geo_plot_deals_3d "+
     "WHERE project_id=? AND mapping_release_id=? AND plot_id=? AND revision=?)")
     .bind(crypto.randomUUID(),actor.email,"geo.private_deal_recorded",ctx.project.id,
      selected.id,JSON.stringify({stage:record.stage,hasBuyer:Boolean(record.buyerName),
       claimedPayment:record.claimedPaymentPaise>0,revision:next,
       mappingReleaseId:source.releaseId}),now,ctx.project.id,source.releaseId,selected.id,next)
  ]);
  if(results[0]?.meta?.changes!==1||results[1]?.meta?.changes!==1)
   throw Error("Geo mapping or deal record changed concurrently; reload.");
  return json(await readState(env,ctx,source));
 }catch(error){return json({error:error instanceof Error?error.message:"Private deal update failed."},409);}
}
