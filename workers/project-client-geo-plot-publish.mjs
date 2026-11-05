// One atomic Client Admin action for private plot details AND public status.
// Does not create receipts, legal sales or publish private buyer/amount fields.
import {activeMap,listGeoCommercialState} from "./geo-plot-commercial.mjs";

const json=(body,status=200)=>Response.json(body,{status,headers:{
 "Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
const safe=(value,max)=>typeof value==="string"&&value.length<=max
 &&!/[\\x00-\\x1f\\x7f]/.test(value);
const money=n=>Number.isSafeInteger(n)&&n>0&&n<=1000000000000;
const uuid=value=>typeof value==="string"&&
 /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const findRevision=async(env,table,ctx,releaseId,id)=>{
 const row=await env.DB.prepare(
  "SELECT revision FROM "+table+" WHERE project_id=? AND mapping_release_id=? AND plot_id=?"
 ).bind(ctx.project.id,releaseId,id).first();
 return Number(row?.revision||0);
};

export async function clientGeoPlotPublish(request,env,ctx,actor,{allowApprove=false}={}){
 if(request.method!=="PUT")return json({error:"Method not allowed."},405);
 if(actor.role!=="client_admin"||!allowApprove)
  return json({error:"Client Admin publication permission required."},403);
 if(ctx.project.status==="archived")return json({error:"Archived project is read-only."},409);
 try{
  const raw=await request.text();
  if(raw.length>4096)return json({error:"Plot update request too large."},413);
  const b=JSON.parse(raw);
  if(!b||!["available","booked","sold"].includes(b.status)||
    typeof b.plotId!=="string"||
    !Number.isInteger(b.expectedCommercialRevision)||b.expectedCommercialRevision<0||
    !Number.isInteger(b.expectedDetailRevision)||b.expectedDetailRevision<0||
    typeof b.expectedMappingReleaseId!=="string"||
    !uuid(b.operationId)||!safe(b.ownerName,160)||!safe(b.brokerName,160))
   return json({error:"Invalid plot status, identity or expected revisions."},400);
  if(b.status!=="available"&&(!b.ownerName.trim()||!money(b.amountPaise)))
   return json({error:"Buyer name and a valid positive booking/sold amount are required."},400);
  if(b.status==="available"&&b.amountPaise!==null)
   return json({error:"Available plot must not carry a new booking or sold amount."},400);
  const source=await activeMap(env,ctx);
  if(!source||source.releaseId!==b.expectedMappingReleaseId)
   return json({error:"Published plot mapping changed. Refresh before saving."},409);
  const plot=source.plots.find(x=>x.id.toLowerCase()===b.plotId.toLowerCase());
  if(!plot)return json({error:"Plot not found in the published mapping."},404);

  const identity=[ctx.project.id,source.releaseId,plot.id];
  const oldDetail=await env.DB.prepare(
   "SELECT owner_name AS ownerName,broker_name AS brokerName,"+
   "booking_amount_paise AS bookingAmountPaise,sold_amount_paise AS soldAmountPaise,"+
   "notes,revision FROM geo_client_plot_details_3d "+
   "WHERE project_id=? AND mapping_release_id=? AND plot_id=?"
  ).bind(...identity).first();
  const oldCommercial=await env.DB.prepare(
   "SELECT price_paise AS pricePaise,revision FROM geo_plot_commercial_3d "+
   "WHERE project_id=? AND mapping_release_id=? AND plot_id=?"
  ).bind(...identity).first();
  const detailRevision=Number(oldDetail?.revision||0);
  const commercialRevision=Number(oldCommercial?.revision||0);
  if(detailRevision!==b.expectedDetailRevision||commercialRevision!==b.expectedCommercialRevision)
   return json({error:"Plot data changed in another session. Refresh before publishing."},409);

  const now=new Date().toISOString(),nextDetail=detailRevision+1,nextCommercial=commercialRevision+1;
  const owner=b.status==="available"?(oldDetail?.ownerName||""):b.ownerName.trim();
  const broker=b.status==="available"?(oldDetail?.brokerName||""):b.brokerName.trim();
  const booking=b.status==="booked"?b.amountPaise:oldDetail?.bookingAmountPaise??null;
  const sold=b.status==="sold"?b.amountPaise:oldDetail?.soldAmountPaise??null;
  // Retain legacy private notes even though the new simplified form hides them.
  const notes=oldDetail?.notes||"";
  // This is an actual system operation reference, NOT a claimed signed document.
  // The legacy commercial schema requires a nonempty audit reference.
  const auditRef="client-admin-operation:"+b.operationId;
  const detailEvent={operationId:b.operationId,plotId:plot.id,status:b.status,
   ownerName:owner,brokerName:broker,bookingAmountPaise:booking,
   soldAmountPaise:sold,detailRevision:nextDetail};
  const commercialEvent={operationId:b.operationId,plotId:plot.id,status:b.status,
   pricePaise:oldCommercial?.pricePaise??null,currency:"INR",
   evidenceRef:auditRef,sourceType:"client-admin-audit",
   publicApproved:true,revision:nextCommercial};
  const commercialSource=[ctx.project.id,source.releaseId,plot.id];

  // D1.batch executes transactionally. The first statement FAILS the batch,
  // rather than silently committing one side, if a revision/mapping changed.
  const guard=env.DB.prepare(`SELECT CASE WHEN
    EXISTS(SELECT 1 FROM geo_plot_mapping_active_3d
      WHERE project_id=? AND experience_id=? AND mapping_release_id=?)
    AND COALESCE((SELECT revision FROM geo_client_plot_details_3d
      WHERE project_id=? AND mapping_release_id=? AND plot_id=?),0)=?
    AND COALESCE((SELECT revision FROM geo_plot_commercial_3d
      WHERE project_id=? AND mapping_release_id=? AND plot_id=?),0)=?
    THEN 1 ELSE json('stale-geo-plot-revisions') END AS verified`)
   .bind(ctx.project.id,ctx.active.experience_id,source.releaseId,
    ...identity,detailRevision,...commercialSource,commercialRevision);
  const results=await env.DB.batch([
   guard,
   env.DB.prepare(`INSERT INTO geo_client_plot_details_3d
    (project_id,mapping_release_id,plot_id,owner_name,broker_name,
     booking_amount_paise,sold_amount_paise,notes,revision,updated_by,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(project_id,mapping_release_id,plot_id) DO UPDATE SET
     owner_name=excluded.owner_name,broker_name=excluded.broker_name,
     booking_amount_paise=excluded.booking_amount_paise,
     sold_amount_paise=excluded.sold_amount_paise,
     revision=excluded.revision,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
    .bind(...identity,owner,broker,booking,sold,notes,nextDetail,actor.email,now),
   env.DB.prepare(`INSERT INTO geo_plot_commercial_3d
    (project_id,mapping_release_id,plot_id,status,price_paise,currency,
     evidence_ref,public_approved,revision,updated_by,updated_at)
    VALUES (?,?,?,?,?,'INR',?,1,?,?,?)
    ON CONFLICT(project_id,mapping_release_id,plot_id) DO UPDATE SET
     status=excluded.status,evidence_ref=excluded.evidence_ref,
     public_approved=1,revision=excluded.revision,
     updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
    .bind(...identity,b.status,oldCommercial?.pricePaise??null,auditRef,nextCommercial,actor.email,now),
   env.DB.prepare(`INSERT INTO geo_client_plot_detail_events_3d
    (id,project_id,mapping_release_id,plot_id,revision,actor_email,detail_json,created_at)
    VALUES (?,?,?,?,?,?,?,?)`)
    .bind(crypto.randomUUID(),...identity,nextDetail,actor.email,JSON.stringify(detailEvent),now),
   env.DB.prepare(`INSERT INTO geo_plot_commercial_events_3d
    (id,project_id,mapping_release_id,plot_id,revision,event_json,actor_email,created_at)
    VALUES (?,?,?,?,?,?,?,?)`)
    .bind(crypto.randomUUID(),...identity,nextCommercial,JSON.stringify(commercialEvent),actor.email,now),
   env.DB.prepare(`INSERT INTO engine_admin_audit
    (id,actor_email,action,project_id,target_id,details_json,created_at)
    VALUES (?,?,'geo.client_plot_published',?,?,?,?)`)
    .bind(crypto.randomUUID(),actor.email,ctx.project.id,plot.id,
      JSON.stringify({mappingReleaseId:source.releaseId,status:b.status,
       detailRevision:nextDetail,commercialRevision:nextCommercial,
       operationId:b.operationId,privateAmountType:b.status==="sold"?"sold":
        b.status==="booked"?"booking":null}),now)
  ]);
  if(results.slice(1).some(result=>result?.meta?.changes!==1))
   return json({error:"Plot update could not be confirmed. Refresh to verify."},409);
  const commercial=await listGeoCommercialState(env,ctx,source);
  const confirmed=commercial.rows.find(r=>r.plotId===plot.id);
  if(!confirmed||confirmed.status!==b.status||!confirmed.publicApproved||
    confirmed.revision!==nextCommercial)
   return json({error:"Status was saved but public publication cannot be confirmed. Refresh."},409);
  return json({ok:true,commercial,detail:{plotId:plot.id,ownerName:owner,
    brokerName:broker,bookingAmountPaise:booking,soldAmountPaise:sold,
    notes,revision:nextDetail},confirmation:{plotId:plot.id,status:b.status,
    published:true,mappingReleaseId:source.releaseId,operationId:b.operationId,
    commercialRevision:nextCommercial,detailRevision:nextDetail}});
 }catch(error){
  return json({error:error instanceof Error?error.message:"Could not publish plot."},409);
 }
}
