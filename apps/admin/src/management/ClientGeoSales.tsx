import {useEffect,useState} from "react";
type Sale={id:string;plotId:string;buyerName:string;buyerPhone:string;agreementPaise:number;
 state:"booked"|"confirmed"|"void";revision:number;receivedPaise:number;notes:string;createdAt:string};
type Receipt={id:string;saleId:string;kind:"receipt"|"reversal";amountPaise:number;
 paidOn:string;method:string;reference:string;reversesId?:string|null;createdAt:string};
type Data={sales:Sale[];payments:Receipt[];totalSales:number;notice:string};
const money=(n:number)=>"₹"+(n/100).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
const amount=(text:string)=>{
 if(!/^\d{1,10}(?:\.\d{1,2})?$/.test(text.trim()))throw Error("Enter a valid rupee amount.");
 const [a,b=""]=text.trim().split(".");
 const p=Number(BigInt(a)*100n+BigInt(b.padEnd(2,"0")));
 if(!Number.isSafeInteger(p)||p<1||p>1e12)throw Error("Amount out of range.");
 return p;
};
export default function ClientGeoSales({slug,plotIds}:{slug:string;plotIds:string[]}){
 const url="/3Dprojects/api/client-portal/projects/"+encodeURIComponent(slug)+"/sales";
 const [data,setData]=useState<Data>({sales:[],payments:[],totalSales:0,notice:""});
 const [error,setError]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
 const [selected,setSelected]=useState("");
 const [plot,setPlot]=useState(""),[buyer,setBuyer]=useState(""),[phone,setPhone]=useState("");
 const [price,setPrice]=useState(""),[evidence,setEvidence]=useState(""),[notes,setNotes]=useState("");
 const [payAmount,setPayAmount]=useState(""),[payDate,setPayDate]=useState(new Date().toISOString().slice(0,10));
 const [payMethod,setPayMethod]=useState("upi"),[payReference,setPayReference]=useState(""),[payNote,setPayNote]=useState("");
 const [decisionEvidence,setDecisionEvidence]=useState("");
 const fetchData=async()=>{const res=await fetch(url,{credentials:"same-origin",cache:"no-store"});
   const j=await res.json() as Data&{error?:string};
   if(!res.ok)throw Error(j.error||"Sales unavailable");setData(j);};
 useEffect(()=>{let live=true;void fetch(url,{credentials:"same-origin",cache:"no-store"})
   .then(async r=>{const d=await r.json() as Data&{error?:string};if(!r.ok)throw Error(d.error||"Sales unavailable");if(live)setData(d)})
   .catch(e=>{if(live)setError(String(e))});return()=>{live=false};},[url]);
 const sale=data.sales.find(s=>s.id===selected);
 const receipts=data.payments.filter(p=>p.saleId===selected);
 const reversed=new Set(receipts.filter(p=>p.reversesId).map(p=>p.reversesId));
 const active=new Set(data.sales.filter(s=>s.state!=="void").map(s=>s.plotId.toLowerCase()));
 async function act(method:"POST"|"PUT",payload:object){
  setBusy(true);setError("");setMessage("");
  try{
   const response=await fetch(url,{method,credentials:"same-origin",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({...payload,...(method==="POST"?{operationId:crypto.randomUUID()}:{})})});
   const j=await response.json() as Data&{error?:string};
   if(!response.ok)throw Error(j.error||"Sales operation failed");
   setData(j);setMessage("Saved and verified from the private sales ledger.");
  }catch(e){setError(e instanceof Error?e.message:"Unable to save.");}
  finally{setBusy(false);}
 }
 async function createSale(){
  try{
   if(!plot||!buyer.trim()||evidence.trim().length<3)throw Error("Plot, buyer and source evidence required.");
   await act("POST",{action:"create",plotId:plot,buyerName:buyer,buyerPhone:phone,
    agreementPaise:amount(price),evidenceRef:evidence,notes});
   setPlot("");setBuyer("");setPhone("");setPrice("");setEvidence("");setNotes("");
  }catch(e){setError(e instanceof Error?e.message:"Invalid sale");}
 }
 async function addPayment(){
  if(!sale)return;
  try{await act("POST",{action:"receipt",saleId:sale.id,amountPaise:amount(payAmount),paidOn:payDate,
     method:payMethod,reference:payReference,note:payNote});
    setPayAmount("");setPayReference("");setPayNote("");
  }catch(e){setError(e instanceof Error?e.message:"Invalid payment");}
 }
 async function changeSale(action:"confirm"|"void"){
  if(!sale||decisionEvidence.trim().length<3)return;
  if(!window.confirm((action==="void"?"Void":"Confirm")+" this private sale? Public Plot status is unchanged."))return;
  await act("PUT",{action,saleId:sale.id,expectedRevision:sale.revision,evidenceRef:decisionEvidence});
  setDecisionEvidence("");
 }
 async function reverse(p:Receipt){
  const reason=window.prompt("Why was this receipt entered incorrectly?","");
  if(!reason||reason.trim().length<3)return;
  if(!window.confirm("Reverse receipt "+money(p.amountPaise)+"? This is an accounting correction, not a bank refund."))return;
  await act("POST",{action:"reverse",saleId:p.saleId,receiptId:p.id,reason});
 }
 return <section className="engine-client-admin-card client-geo-sales">
  <h2>Sales & Accounts</h2><p>Private buyer records, booking agreements, receipts and corrections.</p>
  {error&&<p className="engine-manage-error" role="alert">{error}</p>}
  {message&&<p className="engine-manage-ok" role="status">{message}</p>}
  <div className="client-geo-sales-stats">
   <div><span>Sale records</span><strong>{data.totalSales}</strong></div>
   <div><span>Agreement total</span><strong>{money(data.sales.filter(s=>s.state!=="void").reduce((sum,s)=>sum+s.agreementPaise,0))}</strong></div>
   <div><span>Received</span><strong>{money(data.sales.filter(s=>s.state!=="void").reduce((sum,s)=>sum+s.receivedPaise,0))}</strong></div>
  </div>
  <div className="client-geo-editor-grid">
   <label>Book mapped plot<select value={plot} onChange={e=>setPlot(e.target.value)}>
    <option value="">Choose available plot</option>{plotIds.filter(id=>!active.has(id.toLowerCase())).map(id=><option key={id} value={id}>{id}</option>)}
   </select></label>
   <label>Buyer Name<input maxLength={160} value={buyer} onChange={e=>setBuyer(e.target.value)}/></label>
   <label>Buyer Mobile<input maxLength={25} value={phone} onChange={e=>setPhone(e.target.value)}/></label>
   <label>Agreement Value (₹)<input inputMode="decimal" value={price} onChange={e=>setPrice(e.target.value)}/></label>
   <label>Signed/source reference<input maxLength={250} value={evidence} onChange={e=>setEvidence(e.target.value)}/></label>
   <label>Private Notes<input maxLength={600} value={notes} onChange={e=>setNotes(e.target.value)}/></label>
  </div>
  <button type="button" disabled={busy||!plot||!buyer.trim()||evidence.trim().length<3} onClick={()=>void createSale()}>
   Create booking</button>
  <p className="client-geo-info">Recording a private booking does not automatically mark the public plot Booked or Sold.</p>
  <div className="client-geo-sale-list">
   {data.sales.map(s=><button type="button" key={s.id} className={selected===s.id?"is-active":""}
    onClick={()=>{setSelected(s.id);setDecisionEvidence("");}}>
    <strong>Plot {s.plotId}</strong><span>{s.buyerName}</span><span>{s.state}</span>
    <span>{money(s.agreementPaise)}</span><span>Received: {money(s.receivedPaise)}</span>
   </button>)}
   {!data.sales.length&&<p>No sale records yet.</p>}
  </div>
  {sale&&<section className="client-geo-editor">
   <h3>Plot {sale.plotId} · {sale.buyerName}</h3>
   <p>Agreement {money(sale.agreementPaise)} · Received {money(sale.receivedPaise)} ·
    Balance {money(Math.max(0,sale.agreementPaise-sale.receivedPaise))}</p>
   {sale.state==="booked"&&<>
    <label>Confirmation evidence / cancellation reason<input value={decisionEvidence}
     maxLength={250} onChange={e=>setDecisionEvidence(e.target.value)}/></label>
    <div className="engine-client-admin-actions">
     <button type="button" disabled={busy||decisionEvidence.trim().length<3}
      onClick={()=>void changeSale("confirm")}>Confirm private sale</button>
     <button type="button" disabled={busy||sale.receivedPaise!==0||decisionEvidence.trim().length<3}
      onClick={()=>void changeSale("void")}>Void booking</button>
    </div>
   </>}
   {sale.state!=="void"&&<div className="client-geo-editor-grid">
    <label>Payment Amount (₹)<input inputMode="decimal" value={payAmount}
     onChange={e=>setPayAmount(e.target.value)}/></label>
    <label>Paid On<input type="date" value={payDate} onChange={e=>setPayDate(e.target.value)}/></label>
    <label>Method<select value={payMethod} onChange={e=>setPayMethod(e.target.value)}>
     <option value="upi">UPI</option><option value="cash">Cash</option><option value="bank">Bank</option>
     <option value="card">Card</option><option value="other">Other</option>
    </select></label>
    <label>Receipt Reference<input value={payReference} maxLength={160} onChange={e=>setPayReference(e.target.value)}/></label>
    <label>Payment Note<input value={payNote} maxLength={400} onChange={e=>setPayNote(e.target.value)}/></label>
    <button type="button" disabled={busy||!payAmount||!payDate} onClick={()=>void addPayment()}>Record payment</button>
   </div>}
   <h4>Payment history</h4>
   {receipts.map(p=><div className="client-geo-payment" key={p.id}>
    <span>{p.kind==="reversal"?"Reversed":"Receipt"} · {money(p.amountPaise)} · {p.method} · {p.paidOn}</span>
    {p.kind==="receipt"&&!reversed.has(p.id)&&<button disabled={busy} type="button" onClick={()=>void reverse(p)}>Undo</button>}
   </div>)}
  </section>}
  <p className="client-geo-info">Private ledger entries are not bank confirmations. Public sale approval is controlled separately.</p>
 </section>;
}
