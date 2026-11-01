import {useEffect,useMemo,useState} from "react";
import GeoBulkPricingPanel,{type GeoPriceQuote} from "./GeoBulkPricingPanel";
type Review={plotId:string;status:"available"|"booked"|"sold";
  pricePaise:number|null;currency:"INR";evidenceRef:string;
  publicApproved:boolean;revision:number;updatedAt?:string};
type Snapshot={mappingReleaseId:string|null;plotCount?:number;rows:Review[];notice?:string};
const url=(slug:string)=>"/3Dprojects/api/cloud/projects/"+
  encodeURIComponent(slug)+"/geo-plots/commercial";
async function request<T>(endpoint:string,init?:RequestInit):Promise<T>{
  const res=await fetch(endpoint,{cache:"no-store",...init,headers:{
    Accept:"application/json",...init?.headers}});
  const text=await res.text();let body:unknown;
  try{body=JSON.parse(text);}catch{throw Error("Commercial API returned invalid JSON.");}
  if(!res.ok)throw Error((body as {error?:string}).error||"Commercial request failed.");
  return body as T;
}
function paise(input:string):number|null{
  if(!input.trim())return null;
  if(!/^\d{1,10}(?:\.\d{1,2})?$/.test(input))
    throw Error("Enter nonnegative INR rupees with at most two decimal places.");
  const [rupees,decimal=""]=input.split(".");
  const amount=BigInt(rupees)*100n+BigInt(decimal.padEnd(2,"0"));
  if(amount>1000000000000n)throw Error("INR price exceeds the commercial safety limit.");
  return Number(amount);
}
export default function GeoPlotCommercialPanel({slug,mappingReleaseId,plotIds}:{
  slug:string;mappingReleaseId:string;plotIds:string[]
}){
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [plotId,setPlotId]=useState("");
  const [status,setStatus]=useState("");
  const [price,setPrice]=useState("");
  const [evidenceRef,setEvidenceRef]=useState("");
  const [approved,setApproved]=useState(false);
  const [priceQuotes,setPriceQuotes]=useState<GeoPriceQuote[]>([]);
  useEffect(()=>{
    let live=true;setSnapshot(null);setError("");
    void request<Snapshot>(url(slug)).then(data=>{
      if(live)setSnapshot(data);
    }).catch(err=>{if(live)setError(String(err));});
    return()=>{live=false;};
  },[slug,mappingReleaseId]);
  const rows=snapshot?.rows||[];
  const current=useMemo(()=>rows.find(p=>p.plotId.toLowerCase()===plotId.toLowerCase()),
    [rows,plotId]);
  const choose=(next:string)=>{
    setPlotId(next);const row=rows.find(p=>p.plotId.toLowerCase()===next.toLowerCase());
    setStatus(row?.status||"");setPrice(row?.pricePaise===null||row?.pricePaise===undefined?
      "":String(row.pricePaise/100));
    setEvidenceRef(row?.evidenceRef||"");setApproved(row?.publicApproved===true);
    setNotice("");setError("");
  };
  const save=async()=>{
    if(!snapshot||snapshot.mappingReleaseId!==mappingReleaseId||busy||!plotId||!status)return;
    try{
      const amount=paise(price),evidence=evidenceRef.trim();
      if(evidence.length<3||evidence.length>250)
        throw Error("A source/booking/sale evidence reference (3–250 characters) is required.");
      if(!window.confirm("Save current "+status.toUpperCase()+" / "+
        (amount===null?"price not supplied":"₹"+(amount/100).toFixed(2))+
        " for Plot "+plotId+"?\n"+
        "Bound to immutable mapping release "+mappingReleaseId.slice(0,16)+
        ".\n"+(approved?"PUBLIC visibility is explicitly approved.":"Remain PRIVATE and unverified for public display.")+
        "\nBuyer/receipt information is not imported or asserted."))return;
      setBusy(true);setError("");setNotice("");
      const next=await request<Snapshot>(url(slug),{
        method:"PUT",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({plotId,status,pricePaise:amount,currency:"INR",
          evidenceRef:evidence,publicApproved:approved,expectedRevision:current?.revision||0})
      });
      if(next.mappingReleaseId!==mappingReleaseId)
        throw Error("Active mapping release changed; reload before commercial review.");
      setSnapshot(next);setNotice("Owner-reviewed commercial change saved with immutable audit event.");
    }catch(err){setError(err instanceof Error?err.message:String(err));}
    finally{setBusy(false);}
  };
  const currentQuote=priceQuotes.find(q=>q.plotId.toLowerCase()===plotId.toLowerCase());
  const matched=Boolean(snapshot&&snapshot.mappingReleaseId===mappingReleaseId);
  return <details className="geo-plot-review-dashboard">
    <summary>Commercial Facts · Available / Booked / Sold / INR (owner approval)</summary>
    <p className="geo-plot-hint">Project-private evidence; only explicitly approved records
      tied to the active mapping release are public. No assumed availability,
      buyer payment status, or automatic approval on publication.</p>
    {error&&<p className="geo-plot-warning" role="alert">{error}</p>}
    {notice&&<p className="geo-plot-message" role="status">{notice}</p>}
    {!matched&&<p className="geo-plot-warning">Checking active published mapping. Editing disabled until it matches.</p>}
    {matched&&<p>{rows.length} of {plotIds.length} mapped plots have source-reviewed commercial records.</p>}
    <label>Canonical Plot ID
      <select value={plotId} disabled={!matched||busy}
        onChange={e=>choose(e.target.value)}>
        <option value="">Select a mapped plot</option>
        {plotIds.map(id=><option key={id} value={id}>Plot {id}</option>)}
      </select></label>
    <label>Owner-reviewed status
      <select value={status} disabled={!matched||busy||!plotId}
        onChange={e=>setStatus(e.target.value)}>
        <option value="">Choose a status</option>
        <option value="available">Available</option>
        <option value="booked">Booked</option>
        <option value="sold">Sold</option>
      </select></label>
    <label>Approved listing price (INR, optional)
      <input inputMode="decimal" value={price} disabled={!matched||busy||!plotId}
        placeholder="e.g. 2500000.00 — leave blank if unverified"
        onChange={e=>setPrice(e.target.value)}/></label>
    {matched&&currentQuote&&<p className="geo-plot-hint">Reviewed private CSV quote for Plot {plotId}:
      {" "}₹{(currentQuote.pricePaise/100).toLocaleString("en-IN")}.
      <button type="button" disabled={busy} onClick={()=>{
        if(!window.confirm("Prefill listing price and source evidence from the PRIVATE pricing CSV? "+
          "Existing status and public approval will NOT change until you explicitly save."))return;
        setPrice(String(currentQuote.pricePaise/100));setEvidenceRef(currentQuote.evidenceRef);
      }}>Use reviewed CSV price</button>
    </p>}
    <label>Signed/source evidence reference
      <input value={evidenceRef} maxLength={250} disabled={!matched||busy||!plotId}
        placeholder="Approval memo / agreement or source register ID"
        onChange={e=>setEvidenceRef(e.target.value)}/></label>
    <label className="geo-plot-check">
      <input type="checkbox" checked={approved} disabled={!matched||busy||!plotId}
        onChange={e=>setApproved(e.target.checked)}/>
      Explicitly approve public status / price visibility</label>
    <button type="button" disabled={!matched||busy||!plotId||!status||
      evidenceRef.trim().length<3} onClick={()=>void save()}>
      {busy?"Saving verified commercial record…":"Save Audited Commercial Record"}
    </button>
    <GeoBulkPricingPanel endpoint={"/3Dprojects/api/cloud/projects/"+
      encodeURIComponent(slug)+"/geo-plots/pricing"} mappingReleaseId={mappingReleaseId}
      onQuotes={setPriceQuotes}/>
    <p className="geo-plot-hint">Releasing a new mapping version requires a fresh Plot ID
      and source review; old commercial records do not silently migrate.
      Only an explicitly invited project client with the proper role can review private pricing and commercial values.</p>
  </details>;
}
