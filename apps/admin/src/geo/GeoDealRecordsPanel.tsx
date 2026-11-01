import {useEffect,useState} from "react";
type Deal={plotId:string;stage:string;buyerName:string;buyerPhone:string;
 claimedPaymentPaise:number;paymentReference:string;agreementReference:string;
 registrationReference:string;evidenceReference:string;notes:string;revision:number};
type State={mappingReleaseId:string|null;rows:Deal[];notice?:string};
type Props={endpoint:string;mappingReleaseId:string|null;plotIds:string[];canEdit?:boolean};
const stages=["inquiry","booked","agreement_pending","agreement_done","registered","cancelled"] as const;
const request=async<T,>(url:string,body?:unknown):Promise<T>=>{
 const result=await fetch(url,{method:body?"PUT":"GET",cache:"no-store",
  headers:{"Accept":"application/json",...(body?{"Content-Type":"application/json"}:{})},
  ...(body?{body:JSON.stringify(body)}:{})});
 const data=await result.json() as T&{error?:string};
 if(!result.ok)throw Error(data.error||"Private project deal operation failed.");
 return data;
};
function amountPaise(input:string){
 if(!input.trim())return 0;
 if(!/^\d{1,10}(?:\.\d{1,2})?$/.test(input))
  throw Error("Reported INR payment must contain at most two decimal digits.");
 const [r,frac=""]=input.split(".");
 const n=BigInt(r)*100n+BigInt(frac.padEnd(2,"0"));
 if(n>1000000000000n)throw Error("Reported amount exceeds the allowed INR value.");
 return Number(n);
}
export default function GeoDealRecordsPanel({endpoint,mappingReleaseId,plotIds,canEdit=true}:Props){
 const [state,setState]=useState<State|null>(null);
 const [plotId,setPlotId]=useState("");
 const [stage,setStage]=useState("inquiry");
 const [buyerName,setBuyerName]=useState("");
 const [buyerPhone,setBuyerPhone]=useState("");
 const [payment,setPayment]=useState("");
 const [paymentReference,setPaymentReference]=useState("");
 const [agreementReference,setAgreementReference]=useState("");
 const [registrationReference,setRegistrationReference]=useState("");
 const [evidenceReference,setEvidenceReference]=useState("");
 const [notes,setNotes]=useState("");
 const [error,setError]=useState("");
 const [message,setMessage]=useState("");
 const [busy,setBusy]=useState(false);
 useEffect(()=>{
  let active=true;setState(null);setError("");setPlotId("");
  if(!mappingReleaseId)return;
  void request<State>(endpoint).then(next=>{
   if(!active)return;
   if(next.mappingReleaseId!==mappingReleaseId)throw Error("Deal source release changed.");
   setState(next);
  }).catch(e=>{if(active)setError(String(e));});
  return()=>{active=false;};
 },[endpoint,mappingReleaseId]);
 const chosen=state?.rows.find(x=>x.plotId.toLowerCase()===plotId.toLowerCase());
 const select=(id:string)=>{
  setPlotId(id);const record=state?.rows.find(x=>x.plotId.toLowerCase()===id.toLowerCase());
  setStage(record?.stage||"inquiry");setBuyerName(record?.buyerName||"");
  setBuyerPhone(record?.buyerPhone||"");
  setPayment(record?.claimedPaymentPaise?String(record.claimedPaymentPaise/100):"");
  setPaymentReference(record?.paymentReference||"");
  setAgreementReference(record?.agreementReference||"");
  setRegistrationReference(record?.registrationReference||"");
  setEvidenceReference(record?.evidenceReference||"");setNotes(record?.notes||"");
  setError("");setMessage("");
 };
 const save=async()=>{
  if(!mappingReleaseId||!state||!plotId||busy)return;
  setBusy(true);setError("");setMessage("");
  try{
   const claimedPaymentPaise=amountPaise(payment);
   if(!window.confirm("Save PRIVATE deal record for Plot "+plotId+" as "+stage+"?\n"+
      "Any payment is OWNER-REPORTED and NOT bank verified. "+
      "This will not change public Booked/Sold status or a customer listing price."))return;
   const body={plotId,stage,buyerName:buyerName.trim(),buyerPhone:buyerPhone.trim(),
     claimedPaymentPaise,paymentReference:paymentReference.trim(),
     agreementReference:agreementReference.trim(),
     registrationReference:registrationReference.trim(),
     evidenceReference:evidenceReference.trim(),notes:notes.trim(),
     expectedRevision:chosen?.revision||0};
   const saved=await request<State>(endpoint,body);
   if(saved.mappingReleaseId!==mappingReleaseId)throw Error("Mapping source was replaced.");
   setState(saved);setMessage("Private deal saved with revision/audit. No public listing changed.");
  }catch(e){setError(e instanceof Error?e.message:String(e));}
  finally{setBusy(false);}
 };
 if(!mappingReleaseId)return null;
 return <details className="geo-plot-review-dashboard">
  <summary>Private Booking, Agreement & Registration Records</summary>
  <p className="geo-plot-hint">Restricted to Engine Owner and invited approved Client Admin.
    Never publicly disclosed. Reported payments are not proof of bank clearance.
    A separate commercial update is required to change public plot status.</p>
  {error&&<p role="alert" className="geo-plot-warning">{error}</p>}
  {message&&<p role="status" className="geo-plot-message">{message}</p>}
  <p>{state?.rows.length||0} private records · active Geo mapping {mappingReleaseId.slice(0,16)}</p>
  {state?.rows.map(x=><p key={x.plotId}>
   <button type="button" onClick={()=>select(x.plotId)}>Plot {x.plotId}</button>
   {" · "}{x.stage} · revision {x.revision}
  </p>)}
  {canEdit&&state&&<>
   <label>Canonical Plot ID
    <select value={plotId} onChange={e=>select(e.target.value)}>
     <option value="">Select a mapped plot</option>
     {plotIds.map(id=><option key={id} value={id}>Plot {id}</option>)}
    </select>
   </label>
   {plotId&&<>
    <label>Private deal stage<select value={stage} onChange={e=>setStage(e.target.value)}>
      {stages.map(s=><option key={s} value={s}>{s.replaceAll("_"," ")}</option>)}
     </select></label>
    <label>Buyer name (private)<input value={buyerName} maxLength={160}
     onChange={e=>setBuyerName(e.target.value)}/></label>
    <label>Buyer mobile (private)<input value={buyerPhone} maxLength={25}
      inputMode="tel" onChange={e=>setBuyerPhone(e.target.value)}/></label>
    <label>Reported payment amount (INR; not bank verified)<input value={payment}
      inputMode="decimal" onChange={e=>setPayment(e.target.value)}/></label>
    <label>Payment/receipt evidence reference<input value={paymentReference} maxLength={250}
      onChange={e=>setPaymentReference(e.target.value)}/></label>
    <label>Signed agreement reference<input value={agreementReference} maxLength={250}
      onChange={e=>setAgreementReference(e.target.value)}/></label>
    <label>Registration document reference<input value={registrationReference} maxLength={250}
      onChange={e=>setRegistrationReference(e.target.value)}/></label>
    <label>Owner-reviewed booking/deal evidence source<input value={evidenceReference} maxLength={250}
      onChange={e=>setEvidenceReference(e.target.value)}/></label>
    <label>Private deal notes<textarea value={notes} maxLength={500}
      onChange={e=>setNotes(e.target.value)}/></label>
    <button type="button" disabled={busy||evidenceReference.trim().length<3}
      onClick={()=>void save()}>Save Private Deal Record</button>
   </>}
  </>}
 </details>;
}
