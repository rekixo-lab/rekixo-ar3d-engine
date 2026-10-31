import { useCallback, useEffect, useRef, useState } from "react";
import "./project-management.css";
type Sale={id:string;plotId:string;buyerName:string;buyerPhone:string;agreementPaise:number;
  state:"booked"|"confirmed"|"void";revision:number;notes:string;sourceReleaseId:string;
  receivedPaise:number;balancePaise:number;createdAt:string};
type Payment={id:string;saleId:string;kind:"receipt"|"reversal";amountPaise:number;
  paidOn:string;method:string;reference:string;note:string;reversesId?:string|null};
type Ledger={sales:Sale[];totalSales:number;nextOffset:number|null;payments:Payment[];
  totalPayments:number;nextPaymentOffset:number|null;inventory:{mappedPlotCount:number;availablePlotIds:string[];sourceReleaseId:string|null};
  totals:{agreementPaise:number;receivedPaise:number;balancePaise:number};role:string};
const money=(paise:number)=>"₹"+(Number(paise||0)/100).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
const quote=(value:unknown)=>'"'+String(value??"").replace(/"/g,'""').replace(/^[=+@-]/,"'$&")+'"';
async function api<T>(url:string,body?:object):Promise<T>{
  const r=await fetch(url,{cache:"no-store",method:body?"POST":"GET",
    headers:body?{"Content-Type":"application/json"}:{},...(body?{body:JSON.stringify(body)}:{})});
  const data=await r.json() as T&{error?:string};
  if(!r.ok)throw Error(data.error||"Private ledger request failed.");return data;
}
export default function SalesAccounts(){
  const slug=new URLSearchParams(location.search).get("project")||"";
  const url=`/3Dprojects/api/cloud/projects/${encodeURIComponent(slug)}/sales`;
  const [state,setState]=useState<Ledger|null>(null);
  const [selected,setSelected]=useState<Sale|null>(null);
  const [selectedPayments,setSelectedPayments]=useState<Payment[]>([]);
  const [totalPayments,setTotalPayments]=useState(0);
  const [nextPaymentOffset,setNextPaymentOffset]=useState<number|null>(null);
  const [buyer,setBuyer]=useState("");const [phone,setPhone]=useState("");
  const [plotId,setPlotId]=useState("");const [agreement,setAgreement]=useState("");
  const [paymentAmount,setPaymentAmount]=useState("");const [method,setMethod]=useState("upi");
  const [reference,setReference]=useState("");const [paidOn,setPaidOn]=useState(new Date().toISOString().slice(0,10));
  const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");const [error,setError]=useState("");
  const [search,setSearch]=useState("");
  const receiptToken=useRef(crypto.randomUUID());
  const load=useCallback(async()=>{
    if(!slug){setState(null);return;}
    setState(await api<Ledger>(url));
  },[slug,url]);
  useEffect(()=>{let live=true;void load().catch(e=>{if(live)setError(String(e));});
    return()=>{live=false;};},[load]);
  const details=useCallback(async(id:string)=>{
    const value=await api<Ledger>(url+"?saleId="+encodeURIComponent(id));
    setSelected(value.sales[0]||null);setSelectedPayments(value.payments);
    setTotalPayments(value.totalPayments);setNextPaymentOffset(value.nextPaymentOffset);
  },[url]);
  async function perform(body:object,refreshSaleId?:string){
    setBusy(true);setMessage("");setError("");
    try{const result=await api<Ledger>(url,body);setState(result);
      if(refreshSaleId)await details(refreshSaleId);
      else if(selected)await details(selected.id);
      setMessage("Financial entry saved in project-private ledger.");
      return true;
    }catch(e){setError(e instanceof Error?e.message:"Ledger operation failed.");return false;}
    finally{setBusy(false);}
  }
  async function loadMore(){
    if(!state||state.nextOffset===null||busy)return;
    const offset=state.nextOffset;
    setBusy(true);setError("");
    try{
      const page=await api<Ledger>(url+"?offset="+offset);
      setState(previous=>previous?.nextOffset===offset
        ? {...page,sales:[...previous.sales,...page.sales]}:previous);
    }catch(e){setError(e instanceof Error?e.message:"Could not load more sales.");}
    finally{setBusy(false);}
  }
  async function loadMorePayments(){
    if(!selected||nextPaymentOffset===null||busy)return;
    const saleId=selected.id,offset=nextPaymentOffset;
    setBusy(true);setError("");
    try{
      const page=await api<Ledger>(url+"?saleId="+encodeURIComponent(saleId)+
        "&paymentOffset="+offset);
      if(page.nextPaymentOffset===offset)
        throw Error("Payment history pagination did not advance.");
      setSelectedPayments(previous=>[...previous,...page.payments]);
      setTotalPayments(page.totalPayments);
      setNextPaymentOffset(page.nextPaymentOffset);
    }catch(e){setError(e instanceof Error?e.message:"Could not load older payments.");}
    finally{setBusy(false);}
  }
  async function book(){
    const amount=Math.round(Number(agreement)*100);
    const ok=await perform({action:"book",plotId,buyerName:buyer,buyerPhone:phone,agreementPaise:amount});
    if(ok){setBuyer("");setPhone("");setAgreement("");setPlotId("");}
  }
  async function receipt(){
    if(!selected)return;
    const idempotencyKey=receiptToken.current;
    const ok=await perform({action:"payment",saleId:selected.id,amountPaise:Math.round(Number(paymentAmount)*100),
      paidOn,method,reference,idempotencyKey},selected.id);
    if(ok){receiptToken.current=crypto.randomUUID();setPaymentAmount("");setReference("");}
  }
  async function exportCsv(){
    if(!state||busy)return;
    setBusy(true);setError("");setMessage("");
    try{
      const expected=state.totalSales;
      const rows=[...state.sales];
      let next=state.nextOffset;
      // CSV must contain the complete private register, not merely the visible page.
      while(next!==null){
        const page=await api<Ledger>(url+"?offset="+next);
        rows.push(...page.sales);
        if(page.nextOffset===next)throw Error("Sales pagination did not advance.");
        next=page.nextOffset;
      }
      if(rows.length!==expected||new Set(rows.map(s=>s.id)).size!==rows.length)
        throw Error("Sales register changed during export. Reload and retry to avoid an incomplete CSV.");
      const lines=[["plotId","buyerName","buyerPhone","agreementPaise","receivedPaise",
        "balancePaise","state","sourceReleaseId","createdAt"].map(quote).join(","),
        ...rows.map(s=>[s.plotId,s.buyerName,s.buyerPhone,s.agreementPaise,s.receivedPaise,
          s.balancePaise,s.state,s.sourceReleaseId,s.createdAt].map(quote).join(","))];
      const object=URL.createObjectURL(new Blob([lines.join("\n")],{type:"text/csv;charset=utf-8"}));
      const a=document.createElement("a");a.href=object;a.download=slug+"-private-sales.csv";a.click();
      setTimeout(()=>URL.revokeObjectURL(object),1000);
      setMessage("Exported all "+rows.length+" private sale records.");
    }catch(e){setError(e instanceof Error?e.message:"Private CSV export failed.");}
    finally{setBusy(false);}
  }
  const active=state?.sales.filter(s=>[s.plotId,s.buyerName,s.buyerPhone]
    .some(v=>v.toLowerCase().includes(search.trim().toLowerCase())))||[];
  const reversed=new Set(selectedPayments.filter(p=>p.kind==="reversal").map(p=>p.reversesId));
  return <main className="engine-manage">
    <header><p className="eyebrow">ENGINE · PRIVATE PLOT ACCOUNTING</p>
      <h1>Sales & Accounts</h1>
      <p>Confirmed sales, payments and corrections are independent of the Polygon Mapper.
        Data is owner-only and is never made public by drawing a plot.</p></header>
    {!slug?<p>Select a Geo Masterplan project first.</p>:<>
      {error&&<p className="engine-manage-error" role="alert">{error}</p>}
      {message&&<p className="engine-manage-ok" role="status">{message}</p>}
      <section className="engine-manage-card">
        <h2>Project Ledger</h2>
        <div className="engine-manage-grid">
          <div><small>Total Confirmed/Booked Agreement</small><h2>{money(state?.totals.agreementPaise||0)}</h2></div>
          <div><small>Total Received (Net)</small><h2>{money(state?.totals.receivedPaise||0)}</h2></div>
          <div><small>Total Outstanding</small><h2>{money(state?.totals.balancePaise||0)}</h2></div>
          <div><small>Available Mapped Plots</small><h2>{state?.inventory.availablePlotIds.length||0}/{state?.inventory.mappedPlotCount||0}</h2></div>
        </div>
        <p>Sale status is explicit: Booked → Confirmed. It never changes because a payment was received or a Polygon was edited.</p>
      </section>
      <section className="engine-manage-card"><h2>Book an Approved Plot</h2>
        {!state?.inventory.sourceReleaseId?<p>Publish verified Geo Masterplan plots first.</p>:<>
          <div className="engine-manage-grid">
            <label>Available Plot<select value={plotId} onChange={e=>setPlotId(e.target.value)}>
              <option value="">Select available plot</option>
              {state.inventory.availablePlotIds.map(id=><option key={id} value={id}>{id}</option>)}
            </select></label>
            <label>Buyer Name<input value={buyer} onChange={e=>setBuyer(e.target.value)}/></label>
            <label>Buyer Phone<input value={phone} onChange={e=>setPhone(e.target.value)}/></label>
            <label>Agreement Amount (₹)<input type="number" step=".01" min=".01" value={agreement} onChange={e=>setAgreement(e.target.value)}/></label>
          </div>
          <div className="engine-manage-actions"><span>Creates a Booked record; it does not confirm a sale.</span>
            <button disabled={busy||!plotId||!buyer.trim()||!(Number(agreement)>0)} onClick={()=>void book()}>Create Booking</button>
          </div>
        </>}
      </section>
      <section className="engine-manage-card"><h2>Sales Register</h2>
        <label>Search Plot / Buyer<input value={search} onChange={e=>setSearch(e.target.value)}/></label>
        <div className="engine-manage-client-list">
          {active.map(s=><div key={s.id}><div>
            <strong>Plot {s.plotId} · {s.buyerName}</strong>
            <small>{s.state.toUpperCase()} · Agreement {money(s.agreementPaise)} · Received {money(s.receivedPaise)}
              · Balance {money(s.balancePaise)}</small>
          </div><button onClick={()=>void details(s.id)}>Open Ledger</button></div>)}
          {!active.length&&<p>No matching sales on the currently loaded pages.</p>}
        </div>
        <p>Showing {state?.sales.length||0} of {state?.totalSales||0} sales (including voided records in the export).</p>
        {state?.nextOffset!==null&&state&&<button disabled={busy}
          onClick={()=>void loadMore()}>Load More Sales</button>}
        <button disabled={busy||!state?.sales.length} onClick={()=>void exportCsv()}>Export All Private Sales CSV</button>
      </section>
      {selected&&<section className="engine-manage-card">
        <div className="engine-manage-actions"><h2>Plot {selected.plotId} · {selected.buyerName}</h2>
          <button onClick={()=>setSelected(null)}>Close</button></div>
        <p>Status {selected.state.toUpperCase()} · Agreement {money(selected.agreementPaise)} ·
          Outstanding {money(selected.balancePaise)}</p>
        {selected.state==="booked"&&<button disabled={busy} onClick={()=>{
          if(confirm("Confirm the legal sale for Plot "+selected.plotId+"?"))
            void perform({action:"confirm",saleId:selected.id,expectedRevision:selected.revision},selected.id);
        }}>Confirm Sale</button>}
        {selected.state!=="void"&&<>
          <h2>Record Payment</h2>
          <div className="engine-manage-grid">
            <label>Amount (₹)<input type="number" step=".01" min=".01" value={paymentAmount}
              onChange={e=>setPaymentAmount(e.target.value)}/></label>
            <label>Paid On<input type="date" value={paidOn} onChange={e=>setPaidOn(e.target.value)}/></label>
            <label>Method<select value={method} onChange={e=>setMethod(e.target.value)}>
              {["upi","bank","cash","card","other"].map(k=><option key={k} value={k}>{k}</option>)}</select></label>
            <label>Reference<input value={reference} onChange={e=>setReference(e.target.value)}/></label>
          </div>
          <button disabled={busy||Number(paymentAmount)<=0||Math.round(Number(paymentAmount)*100)>selected.balancePaise}
            onClick={()=>void receipt()}>Add Payment (Immutable Receipt)</button>
        </>}
        <h2>Payment History</h2>
        <p>Showing {selectedPayments.length} of {totalPayments} immutable entries.</p>
        <div className="engine-manage-client-list">
          {selectedPayments.map(p=><div key={p.id}><div>
            <strong>{p.kind==="receipt"?"Receipt":"Reversal"} · {money(p.amountPaise)}</strong>
            <small>{p.paidOn} · {p.method} · {p.reference||p.note||"No reference"}</small>
          </div>{p.kind==="receipt"&&!reversed.has(p.id)&&selected.state!=="void"&&
            <button disabled={busy} onClick={()=>{
              const reason=prompt("Explain the payment correction (minimum 6 characters):");
              if(reason&&reason.trim().length>=6)
                void perform({action:"reverse",saleId:selected.id,receiptId:p.id,reason,
                  paidOn,idempotencyKey:crypto.randomUUID()},selected.id);
            }}>Reverse</button>}</div>)}
        </div>
        {nextPaymentOffset!==null&&<button disabled={busy}
          onClick={()=>void loadMorePayments()}>Load Older Payment Entries</button>}
        {selected.state!=="void"&&selected.receivedPaise===0&&<button disabled={busy} onClick={()=>{
          const reason=prompt("Why are you voiding this booking/sale? (minimum 6 characters)");
          if(reason&&reason.trim().length>=6)void perform({action:"void",saleId:selected.id,
            expectedRevision:selected.revision,reason},selected.id);
        }}>Void Sale (No Net Payments)</button>}
      </section>}
    </>}
  </main>;
}
