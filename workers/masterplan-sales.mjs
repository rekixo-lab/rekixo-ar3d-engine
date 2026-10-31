// Private Engine Sales & Accounts. Owner authenticated upstream, never public.
const json=(value,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
const fail=(msg,status=409)=>json({error:msg},status);
const uuid=v=>typeof v==="string"&&/^[0-9a-f-]{36}$/i.test(v);
const positiveMoney=v=>Number.isSafeInteger(v)&&v>0&&v<=1000000000000;
const date=v=>typeof v==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&
  !Number.isNaN(Date.parse(v+"T00:00:00Z")) &&
  new Date(v+"T00:00:00Z").toISOString().slice(0,10)===v;
const text=(v,max=250)=>typeof v==="string"&&v.length<=max&&
  !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v)?v.trim():"";
const origin=req=>{try{return new URL(req.headers.get("origin")||"").origin===new URL(req.url).origin;}catch{return false;}};
const now=()=>new Date().toISOString();
async function getSales(env,project,saleId,offset=0,paymentOffset=0){
  const sql=`SELECT s.id,s.plot_id AS plotId,s.buyer_name AS buyerName,
    s.buyer_phone AS buyerPhone,s.agreement_paise AS agreementPaise,s.state,s.revision,
    s.notes,s.source_mapping_release_id AS sourceReleaseId,s.created_at AS createdAt,
    s.confirmed_at AS confirmedAt,
    COALESCE((SELECT SUM(CASE WHEN p.kind='receipt' THEN p.amount_paise ELSE -p.amount_paise END)
      FROM masterplan_sale_payments_3d p WHERE p.sale_id=s.id),0) AS receivedPaise
    FROM masterplan_sales_3d s WHERE s.project_id=?`;
  const sales=await env.DB.prepare(sql+(saleId?" AND s.id=?":"")+" ORDER BY s.created_at DESC,s.id DESC LIMIT 250 OFFSET ?")
    .bind(...(saleId?[project.id,saleId,0]:[project.id,offset])).all();
  const result=(sales.results||[]).map(s=>({...s,
    balancePaise:Number(s.agreementPaise)-Number(s.receivedPaise)}));
  let payments=[],totalPayments=0,nextPaymentOffset=null;
  if(saleId){
    const [rows,count]=await Promise.all([
      env.DB.prepare(`SELECT id,sale_id AS saleId,kind,amount_paise AS amountPaise,
        paid_on AS paidOn,method,reference,note,reverses_id AS reversesId,
        created_at AS createdAt FROM masterplan_sale_payments_3d
        WHERE project_id=? AND sale_id=? ORDER BY created_at DESC,id DESC LIMIT 250 OFFSET ?`)
        .bind(project.id,saleId,paymentOffset).all(),
      env.DB.prepare(`SELECT COUNT(*) AS total FROM masterplan_sale_payments_3d
        WHERE project_id=? AND sale_id=?`).bind(project.id,saleId).first()
    ]);
    payments=rows.results||[];
    totalPayments=Number(count?.total||0);
    nextPaymentOffset=paymentOffset+payments.length<totalPayments?paymentOffset+payments.length:null;
  }
  const current=await env.DB.prepare(`SELECT r.id,r.mapping_json FROM masterplan_geo_active_3d a
    JOIN masterplan_geo_releases_3d r ON r.id=a.release_id AND r.project_id=a.project_id
    WHERE a.project_id=?`).bind(project.id).first();
  const mapped=current?JSON.parse(current.mapping_json).plots.map(p=>p.id):[];
  // Inventory/summary must include ALL active sales, not just the first 250
  // register rows. The DB unique plot constraint protects concurrent bookings.
  const [all,ledger,count]=await Promise.all([
    env.DB.prepare(`SELECT plot_id FROM masterplan_sales_3d
      WHERE project_id=? AND state<>'void'`).bind(project.id).all(),
    env.DB.prepare(`SELECT
      COALESCE((SELECT SUM(agreement_paise) FROM masterplan_sales_3d
        WHERE project_id=? AND state<>'void'),0) AS agreementPaise,
      COALESCE((SELECT SUM(CASE WHEN p.kind='receipt' THEN p.amount_paise ELSE -p.amount_paise END)
        FROM masterplan_sale_payments_3d p
        JOIN masterplan_sales_3d s ON s.id=p.sale_id AND s.project_id=p.project_id
        WHERE s.project_id=? AND s.state<>'void'),0) AS receivedPaise`)
      .bind(project.id,project.id).first(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM masterplan_sales_3d WHERE project_id=?")
      .bind(project.id).first()
  ]);
  const occupied=new Set((all.results||[]).map(s=>s.plot_id.toLowerCase()));
  const totals={agreementPaise:Number(ledger?.agreementPaise||0),
    receivedPaise:Number(ledger?.receivedPaise||0),
    balancePaise:Number(ledger?.agreementPaise||0)-Number(ledger?.receivedPaise||0)};
  const totalSales=Number(count?.total||0);
  return {sales:result,totalSales,nextOffset:(!saleId&&offset+result.length<totalSales)?offset+result.length:null,
    payments,totalPayments,nextPaymentOffset,inventory:{
    mappedPlotCount:mapped.length,availablePlotIds:mapped.filter(id=>!occupied.has(id.toLowerCase())),
    sourceReleaseId:current?.id||null},totals,role:"owner"};
}
async function createSale(env,actor,project,body){
  const plotId=text(body.plotId,48),buyer=text(body.buyerName,160),phone=text(body.buyerPhone||"",25);
  const notes=text(body.notes||"",600),amount=body.agreementPaise;
  if(!plotId||!buyer||!positiveMoney(amount)||!notes && body.notes&&!text(body.notes,600))
    throw Error("Plot number, buyer and a positive agreement price are required.");
  if(phone && (!/^\+?[0-9() -]{7,25}$/.test(phone) || phone.replace(/\D/g,"").length<7))
    throw Error("Buyer phone is invalid.");
  const active=await env.DB.prepare(`SELECT r.id,r.mapping_json FROM masterplan_geo_active_3d a
    JOIN masterplan_geo_releases_3d r ON r.id=a.release_id AND r.project_id=a.project_id
    WHERE a.project_id=?`).bind(project.id).first();
  if(!active)throw Error("Publish verified Plot Mapping before registering a sale.");
  const plots=JSON.parse(active.mapping_json).plots;
  const plot=plots.find(p=>p.id.toLowerCase()===plotId.toLowerCase());
  if(!plot)throw Error("Plot must exist in the active published masterplan mapping.");
  const id=crypto.randomUUID(),time=now();
  const changed=await env.DB.batch([
    env.DB.prepare(`INSERT INTO masterplan_sales_3d
      (id,project_id,plot_id,source_mapping_release_id,buyer_name,buyer_phone,
       agreement_paise,state,revision,notes,created_by,created_at)
       SELECT ?,?,?,?,?,?,?,'booked',1,?,?,?
       WHERE EXISTS(SELECT 1 FROM masterplan_geo_active_3d
         WHERE project_id=? AND release_id=?)`)
       .bind(id,project.id,plot.id,active.id,buyer,phone,amount,notes,actor.email,time,
         project.id,active.id),
    env.DB.prepare(`INSERT INTO engine_admin_audit
      (id,actor_email,action,project_id,target_id,details_json,created_at)
       SELECT ?,?,'masterplan.sale_booked',?,?,?,?
       WHERE EXISTS(SELECT 1 FROM masterplan_sales_3d WHERE id=? AND project_id=?)`)
       .bind(crypto.randomUUID(),actor.email,project.id,id,
         JSON.stringify({plotId:plot.id,mappingRelease:active.id,agreementPaise:amount}),time,id,project.id)
  ]);
  if(changed[0].meta?.changes!==1)
    throw Error("Masterplan source release changed during booking. Reload inventory.");
  return id;
}
async function confirmSale(env,actor,project,body){
  if(!uuid(body.saleId)||!Number.isInteger(body.expectedRevision))
    throw Error("Sale ID and expected revision required.");
  const time=now();
  const results=await env.DB.batch([
    env.DB.prepare(`UPDATE masterplan_sales_3d
      SET state='confirmed',revision=revision+1,confirmed_by=?,confirmed_at=?
      WHERE project_id=? AND id=? AND revision=? AND state='booked'`)
      .bind(actor.email,time,project.id,body.saleId,body.expectedRevision),
    env.DB.prepare(`INSERT INTO engine_admin_audit
      (id,actor_email,action,project_id,target_id,details_json,created_at)
      SELECT ?,?,'masterplan.sale_confirmed',?,?,?,?
      FROM masterplan_sales_3d s WHERE s.id=? AND s.project_id=?
        AND s.state='confirmed' AND s.confirmed_by=? AND s.confirmed_at=?`)
      .bind(crypto.randomUUID(),actor.email,project.id,body.saleId,"{}",time,
        body.saleId,project.id,actor.email,time)
  ]);
  if(results[0].meta?.changes!==1)throw Error("Sale changed or is not booked. Reload ledger.");
}
async function addReceipt(env,actor,project,body){
  if(!uuid(body.saleId)||!positiveMoney(body.amountPaise)||!uuid(body.idempotencyKey)||
     !date(body.paidOn)||!["cash","upi","bank","card","other"].includes(body.method))
    throw Error("Valid sale, payment amount/date/method and unique request ID required.");
  const reference=text(body.reference||"",160),note=text(body.note||"",400);
  const id=crypto.randomUUID(),time=now();
  const results=await env.DB.batch([
    env.DB.prepare(`INSERT INTO masterplan_sale_payments_3d
     (id,project_id,sale_id,kind,amount_paise,paid_on,method,reference,note,reverses_id,
      idempotency_key,created_by,created_at)
     SELECT ?,?,s.id,'receipt',?,?,?,?,?,NULL,?,?,?
     FROM masterplan_sales_3d s
     WHERE s.project_id=? AND s.id=? AND s.state<>'void'
       AND ? <= s.agreement_paise-COALESCE((SELECT
          SUM(CASE WHEN p.kind='receipt' THEN p.amount_paise ELSE -p.amount_paise END)
          FROM masterplan_sale_payments_3d p WHERE p.sale_id=s.id),0)`)
      .bind(id,project.id,body.amountPaise,body.paidOn,body.method,reference,note,
        body.idempotencyKey,actor.email,time,project.id,body.saleId,body.amountPaise),
    env.DB.prepare(`INSERT INTO engine_admin_audit
      (id,actor_email,action,project_id,target_id,details_json,created_at)
       SELECT ?,?,'masterplan.payment_received',?,?,?,?
       WHERE EXISTS(SELECT 1 FROM masterplan_sale_payments_3d WHERE id=?)`)
      .bind(crypto.randomUUID(),actor.email,project.id,id,
        JSON.stringify({saleId:body.saleId,amountPaise:body.amountPaise}),time,id)
  ]);
  if(results[0].meta?.changes!==1)
    throw Error("Payment exceeds balance, sale changed, or duplicate submission. Reload ledger.");
}
async function reverseReceipt(env,actor,project,body){
  if(!uuid(body.saleId)||!uuid(body.receiptId)||!uuid(body.idempotencyKey)||
     !date(body.paidOn)||!text(body.reason,400)||text(body.reason,400).length<6)
    throw Error("Receipt ID, reversal date, at least six-character reason and unique request ID required.");
  const id=crypto.randomUUID(),time=now(),reason=text(body.reason,400);
  const res=await env.DB.batch([
    env.DB.prepare(`INSERT INTO masterplan_sale_payments_3d
      (id,project_id,sale_id,kind,amount_paise,paid_on,method,reference,note,reverses_id,
       idempotency_key,created_by,created_at)
      SELECT ?,p.project_id,p.sale_id,'reversal',p.amount_paise,?,'reversal','',?,p.id,?,?,?
      FROM masterplan_sale_payments_3d p
      JOIN masterplan_sales_3d s ON s.id=p.sale_id AND s.project_id=p.project_id
      WHERE p.id=? AND p.project_id=? AND p.sale_id=? AND p.kind='receipt'
        AND NOT EXISTS(SELECT 1 FROM masterplan_sale_payments_3d r
           WHERE r.reverses_id=p.id AND r.kind='reversal')`)
      .bind(id,body.paidOn,reason,body.idempotencyKey,actor.email,time,
        body.receiptId,project.id,body.saleId),
    env.DB.prepare(`INSERT INTO engine_admin_audit
      (id,actor_email,action,project_id,target_id,details_json,created_at)
       SELECT ?,?,'masterplan.payment_reversed',?,?,?,?
       WHERE EXISTS(SELECT 1 FROM masterplan_sale_payments_3d WHERE id=?)`)
      .bind(crypto.randomUUID(),actor.email,project.id,id,
        JSON.stringify({saleId:body.saleId,receiptId:body.receiptId,reason}),time,id)
  ]);
  if(res[0].meta?.changes!==1)throw Error("Receipt not found, already reversed, or project mismatch.");
}
async function voidSale(env,actor,project,body){
  if(!uuid(body.saleId)||!Number.isInteger(body.expectedRevision)||text(body.reason||"",300).length<6)
    throw Error("Sale revision and a correction reason (min six characters) required.");
  const time=now();
  const results=await env.DB.batch([
    env.DB.prepare(`UPDATE masterplan_sales_3d SET
      state='void',revision=revision+1,voided_by=?,voided_at=?
      WHERE id=? AND project_id=? AND revision=? AND state<>'void'
        AND 0=COALESCE((SELECT SUM(CASE WHEN p.kind='receipt' THEN p.amount_paise
        ELSE -p.amount_paise END) FROM masterplan_sale_payments_3d p WHERE p.sale_id=masterplan_sales_3d.id),0)`)
      .bind(actor.email,time,body.saleId,project.id,body.expectedRevision),
    env.DB.prepare(`INSERT INTO engine_admin_audit
      (id,actor_email,action,project_id,target_id,details_json,created_at)
      SELECT ?,?,'masterplan.sale_void',?,?,?,?
      FROM masterplan_sales_3d s WHERE s.id=? AND s.project_id=?
        AND s.state='void' AND s.voided_by=? AND s.voided_at=?`)
      .bind(crypto.randomUUID(),actor.email,project.id,body.saleId,
        JSON.stringify({reason:text(body.reason,300)}),time,
        body.saleId,project.id,actor.email,time)
  ]);
  if(results[0].meta?.changes!==1)throw Error("Sale changed or has unreversed payments. Correct receipts first.");
}
export async function handleMasterplanSalesAdmin(request,env,actor,project,parts,url){
  if(parts.length!==2||parts[1]!=="sales")return null;
  if(project.project_kind!=="masterplan_geo")return fail("Sales are limited to independent Geo Masterplan projects.",403);
  if(request.method==="GET"){
    const saleId=url.searchParams.get("saleId");
    if(saleId&&!uuid(saleId))return fail("Invalid sale identifier.",400);
    const offsetText=url.searchParams.get("offset");
    const offset=offsetText===null?0:Number(offsetText);
    if(!Number.isSafeInteger(offset)||offset<0||offset>100000)
      return fail("Invalid sales page offset.",400);
    const paymentText=url.searchParams.get("paymentOffset");
    const paymentOffset=paymentText===null?0:Number(paymentText);
    if(!Number.isSafeInteger(paymentOffset)||paymentOffset<0||paymentOffset>1000000||
       (paymentOffset!==0&&!saleId))
      return fail("Invalid payment history offset.",400);
    return json(await getSales(env,project,saleId,offset,paymentOffset));
  }
  if(request.method!=="POST")return fail("Method not allowed.",405);
  if(!origin(request))return fail("Same-origin financial write required.",403);
  if(project.status==="archived")return fail("Archived project is read-only.");
  const raw=await request.text();if(raw.length>6000)return fail("Financial request too large.",413);
  let body;try{body=JSON.parse(raw);}catch{return fail("Malformed JSON.",400);}
  try{
    let id=null;
    if(body.action==="book")id=await createSale(env,actor,project,body);
    else if(body.action==="confirm")await confirmSale(env,actor,project,body);
    else if(body.action==="payment")await addReceipt(env,actor,project,body);
    else if(body.action==="reverse")await reverseReceipt(env,actor,project,body);
    else if(body.action==="void")await voidSale(env,actor,project,body);
    else return fail("Unknown financial operation.",400);
    return json({...(await getSales(env,project,null)),savedId:id});
  }catch(e){
    if(/UNIQUE constraint failed/i.test(String(e)))return fail("Plot is already booked or request was already processed.",409);
    return fail(e instanceof Error?e.message:"Financial operation failed.",409);
  }
}
