import {useEffect,useMemo,useRef,useState} from "react";
type Status="available"|"booked"|"sold";
type Row={plotId:string;status:Status;draftStatus?:Status|null;revision:number;pricePaise:number|null;
 publicApproved:boolean;evidenceRef:string;hasReview?:boolean;area?:{value:number;unit:string}|null};
export type GeoCommercialState={mappingReleaseId:string|null;plotCount?:number;publicationMode?:string;
 rows:Row[];counts?:{available:number;booked:number;sold:number;unreviewed:number};notice?:string};
type Details={plotId:string;ownerName:string;brokerName:string;
 bookingAmountPaise:number|null;soldAmountPaise:number|null;notes:string;revision:number};
type Draft={ownerName:string;brokerName:string;bookingAmount:string;soldAmount:string};
type Published={plotId:string;status:Status};
type PublishResponse={ok:boolean;commercial:GeoCommercialState;detail:Details;
 confirmation:{plotId:string;status:Status;published:boolean;
 mappingReleaseId:string;commercialRevision:number;detailRevision:number;operationId:string}};
const ROOT="/3Dprojects/api/client-portal";
async function api<T>(url:string,method="GET",data?:object):Promise<T>{
 const r=await fetch(ROOT+url,{method,credentials:"same-origin",cache:"no-store",
  headers:{"Accept":"application/json",...(data?{"Content-Type":"application/json"}:{})},
  ...(data?{body:JSON.stringify(data)}:{})});
 const j=await r.json() as T&{error?:string};if(!r.ok)throw Error(j.error||"Request failed");return j;
}
const rupees=(paise:number|null)=>paise===null?"—":"₹"+(paise/100).toLocaleString("en-IN",{maximumFractionDigits:2});
const savedStatus=(row:Row):Status=>row.draftStatus||row.status;
const emptyDraft=():Draft=>({ownerName:"",brokerName:"",bookingAmount:"",soldAmount:""});
const snapshot=(draft:Draft,status:Status)=>JSON.stringify({draft,status});
const displayStatus=(status:Status)=>status[0].toUpperCase()+status.slice(1);
const formatStored=(paise:number|null|undefined)=>paise==null?"":String(paise/100);
function toPaise(value:string){
 if(!/^\d{1,10}(?:\.\d{1,2})?$/.test(value.trim()))
  throw Error("Enter a positive amount in rupees with up to 2 decimal places.");
 const [whole,cents=""]=value.trim().split(".");
 const paise=Number(BigInt(whole)*100n+BigInt(cents.padEnd(2,"0")));
 if(!Number.isSafeInteger(paise)||paise<=0||paise>1e12)
  throw Error("Amount must be greater than zero and within the allowed limit.");
 return paise;
}
const fromDetail=(detail?:Details):Draft=>({
 ownerName:detail?.ownerName||"",brokerName:detail?.brokerName||"",
 bookingAmount:formatStored(detail?.bookingAmountPaise),
 soldAmount:formatStored(detail?.soldAmountPaise)
});
const OPTIONS:ReadonlyArray<{value:Status;label:string}>=([
 {value:"available",label:"Available"},{value:"booked",label:"Booked"},{value:"sold",label:"Sold"}
]);

export default function ClientGeoPlotManagement({slug,commercial,canEdit,canApprove,onCommercialChange}:{
 slug:string;commercial:GeoCommercialState;canEdit:boolean;canApprove:boolean;
 onCommercialChange:(next:GeoCommercialState)=>void}){
 const [details,setDetails]=useState<Details[]>([]);
 const [query,setQuery]=useState("");
 const [filter,setFilter]=useState<"all"|Status>("all");
 const [page,setPage]=useState(0);
 const [selected,setSelected]=useState("");
 const headingRef=useRef<HTMLHeadingElement|null>(null);
 const [form,setForm]=useState<Draft>(emptyDraft);
 const [status,setStatus]=useState<Status>("available");
 const [baseline,setBaseline]=useState("");
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [published,setPublished]=useState<Published|null>(null);
 const [toast,setToast]=useState<(Published&{at:number})|null>(null);
 const path="/projects/"+encodeURIComponent(slug);

 useEffect(()=>{
  let active=true;
  void api<{mappingReleaseId:string|null;rows:Details[]}>(path+"/plot-details")
   .then(data=>{
    if(!active)return;
    if(data.mappingReleaseId!==commercial.mappingReleaseId){
     setError("Mapping changed. Refresh this project before editing.");return;
    }
    setDetails(data.rows);
   })
   .catch(e=>{if(active)setError(e instanceof Error?e.message:"Plot details unavailable.");});
  return()=>{active=false;};
 },[path,commercial.mappingReleaseId]);
 useEffect(()=>{
  if(!toast)return;
  const timer=window.setTimeout(()=>setToast(current=>current?.at===toast.at?null:current),5500);
  return()=>window.clearTimeout(timer);
 },[toast]);

 const byId=useMemo(()=>new Map(details.map(d=>[d.plotId.toLowerCase(),d])),[details]);
 const filtered=useMemo(()=>commercial.rows.filter(r=>
  (filter==="all"||savedStatus(r)===filter)&&
  r.plotId.toLowerCase().includes(query.trim().toLowerCase())
 ),[commercial.rows,query,filter]);
 const pageSize=100,totalPages=Math.max(1,Math.ceil(filtered.length/pageSize));
 const visibleRows=filtered.slice(page*pageSize,(page+1)*pageSize);
 const editingVisible=visibleRows.some(row=>row.plotId===selected);
 const chosen=commercial.rows.find(row=>row.plotId===selected);
 const detail=chosen?byId.get(chosen.plotId.toLowerCase()):undefined;
 const isDirty=Boolean(chosen)&&snapshot(form,status)!==baseline;
 const canPublish=canEdit&&canApprove;
 const activeAmount=status==="sold"?form.soldAmount:form.bookingAmount;
 const validAmount=status==="available"||/^\d{1,10}(?:\.\d{1,2})?$/.test(activeAmount.trim())
  &&Number(activeAmount)>0&&Number(activeAmount)<=1e10;

 useEffect(()=>{
  if(!editingVisible||!headingRef.current)return;
  const reduced=window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  headingRef.current.scrollIntoView({
   block:"nearest",inline:"nearest",behavior:reduced?"auto":"smooth"
  });
 },[selected,editingVisible]);

 const clearFeedback=()=>{setError("");setPublished(null);};
 function choose(row:Row){
  if(busy)return;
  if(isDirty&&selected&&!window.confirm("Discard unsaved plot changes?"))return;
  if(row.plotId===selected){
   setSelected("");clearFeedback();return;
  }
  const next=fromDetail(byId.get(row.plotId.toLowerCase()));
  const nextStatus=savedStatus(row);
  setSelected(row.plotId);setForm(next);setStatus(nextStatus);
  setBaseline(snapshot(next,nextStatus));clearFeedback();
 }
 const setDraft=(key:keyof Draft,value:string)=>{
  setForm(previous=>({...previous,[key]:value}));
  clearFeedback();
 };
 const selectStatus=(value:Status)=>{
  setStatus(value);clearFeedback();
 };
 const reload=async()=>{
  if(busy)return;
  const [privateData,publicData]=await Promise.all([
   api<{mappingReleaseId:string|null;rows:Details[]}>(path+"/plot-details"),
   api<GeoCommercialState>(path+"/commercial")
  ]);
  if(privateData.mappingReleaseId!==publicData.mappingReleaseId||
    publicData.mappingReleaseId!==commercial.mappingReleaseId)
   throw Error("Mapping changed. Reload this project.");
  setDetails(privateData.rows);onCommercialChange(publicData);
  if(selected&&!isDirty){
   const updated=privateData.rows.find(row=>row.plotId.toLowerCase()===selected.toLowerCase());
   const publicRow=publicData.rows.find(row=>row.plotId.toLowerCase()===selected.toLowerCase());
   if(publicRow){
    const next=fromDetail(updated),nextStatus=savedStatus(publicRow);
    setForm(next);setStatus(nextStatus);setBaseline(snapshot(next,nextStatus));
   }
  }
  setError("");
 };

 async function publish(){
  if(!chosen||!canPublish||busy||!isDirty)return;
  if(status!=="available"&&!form.ownerName.trim()){
   setError("Enter Owner / Buyer Name to publish a booking or sale.");return;
  }
  let amountPaise:number|null=null;
  try{if(status!=="available")amountPaise=toPaise(activeAmount);}
  catch(e){setError(e instanceof Error?e.message:"Invalid amount.");return;}
  if(!commercial.mappingReleaseId){
   setError("The active mapping is unavailable. Refresh the project.");return;
  }
  setBusy(true);setError("");setPublished(null);
  try{
   const response=await api<PublishResponse>(path+"/plot-publish","PUT",{
    plotId:chosen.plotId,status,ownerName:status==="available"?"":form.ownerName,
    brokerName:status==="available"?"":form.brokerName,
    amountPaise,expectedMappingReleaseId:commercial.mappingReleaseId,
    expectedCommercialRevision:chosen.revision,
    expectedDetailRevision:detail?.revision||0,
    operationId:crypto.randomUUID()
   });
   const confirmed=response.commercial.rows.find(row=>row.plotId.toLowerCase()===chosen.plotId.toLowerCase());
   if(!response.ok||!response.confirmation.published||
      response.confirmation.plotId.toLowerCase()!==chosen.plotId.toLowerCase()||
      response.confirmation.status!==status||
      response.confirmation.mappingReleaseId!==commercial.mappingReleaseId||
      !confirmed||confirmed.status!==status||!confirmed.publicApproved||
      confirmed.revision!==response.confirmation.commercialRevision||
      response.detail.revision!==response.confirmation.detailRevision)
    throw Error("Server could not confirm the public status. Refresh and check.");
   onCommercialChange(response.commercial);
   setDetails(rows=>{
    const other=rows.filter(row=>row.plotId.toLowerCase()!==chosen.plotId.toLowerCase());
    return [...other,response.detail];
   });
   setBaseline(snapshot(form,status));
   const success={plotId:chosen.plotId,status};
   setPublished(success);setToast({...success,at:Date.now()});
  }catch(e){setError(e instanceof Error?e.message:"Plot could not be published.");}
  finally{setBusy(false);}
 }

 return <section className="client-geo-manage">
  <div className="client-geo-toolbar">
   <div><h2>Plot Management</h2><p>{commercial.plotCount||0} mapped plots · Manage public status and private buyer details in one step</p></div>
   <input aria-label="Search plot number" placeholder="Search plot number" value={query}
    onChange={e=>{setQuery(e.target.value);setPage(0);}}/>
   <select aria-label="Filter by status" value={filter}
    onChange={e=>{setFilter(e.target.value as typeof filter);setPage(0);}}>
    <option value="all">All statuses</option>
    <option value="available">Available</option>
    <option value="booked">Booked</option>
    <option value="sold">Sold</option>
   </select>
   <button type="button" disabled={busy} onClick={()=>void reload().catch(e=>setError(String(e)))}>Refresh</button>
  </div>
  {commercial.notice&&<p className="client-geo-info">{commercial.notice}</p>}
  {!editingVisible&&error&&<p className="engine-manage-error" role="alert">{error}</p>}
  <div className="client-geo-list" aria-label="All published plots">
   <div className="client-geo-table-heading">
    <span>Plot</span><span>Area</span><span>Owner / Buyer</span>
    <span>Amount</span><span>Broker</span><span>Status</span><span/>
   </div>
   {visibleRows.map(row=>{
    const current=byId.get(row.plotId.toLowerCase()),liveStatus=savedStatus(row);
    const editing=selected===row.plotId;
    const amount=liveStatus==="booked"?current?.bookingAmountPaise??null
     :liveStatus==="sold"?current?.soldAmountPaise??null:null;
    return <div key={row.plotId} className={"client-geo-entry"+(editing?" is-editing":"")}>
     <button type="button" className={"client-geo-table-row"+(editing?" is-active":"")}
      aria-expanded={editing} aria-controls={editing?"client-geo-editor-"+row.plotId:undefined}
      onClick={()=>choose(row)}>
      <strong>{row.plotId}</strong>
      <span>{row.area?.value?row.area.value.toLocaleString("en-IN")+" "+row.area.unit:"—"}</span>
      <span>{liveStatus==="available"?"—":current?.ownerName||"—"}</span>
      <span>{rupees(amount)}</span><span>{liveStatus==="available"?"—":current?.brokerName||"—"}</span>
      <span className={"client-geo-status "+liveStatus}>{displayStatus(liveStatus)}
       {(liveStatus!==row.status||!row.publicApproved)&&row.hasReview
        ?<small> · Live: {displayStatus(row.status)}</small>:null}
      </span>
      <span className="client-geo-edit-indicator">{editing?"Close ↑":"Edit ↓"}</span>
     </button>
     {editing&&chosen&&<section id={"client-geo-editor-"+row.plotId}
      className="client-geo-editor client-geo-editor--inline"
      aria-label={"Edit plot "+chosen.plotId}>
      <header><h3 ref={headingRef}>Editing Plot {chosen.plotId}</h3>
       <span>Live: <b className={"client-geo-status "+chosen.status}>{displayStatus(chosen.status)}</b></span>
      </header>
      <fieldset className="client-geo-status-chooser">
       <legend>Plot Status</legend>
       <div className="client-geo-status-choices">
        {OPTIONS.map(option=><label key={option.value}
         className={"client-geo-status-choice client-geo-status-choice--"+option.value+
          (status===option.value?" is-selected":"")}>
         <input type="radio" name={"plot-status-"+chosen.plotId} value={option.value}
          checked={status===option.value} disabled={busy||!canPublish}
          onChange={()=>selectStatus(option.value)}/>
         <span className="client-geo-choice-dot" aria-hidden="true"/>
         <span>{option.label}</span>
        </label>)}
       </div>
      </fieldset>
      {status!=="available"?<div className="client-geo-editor-grid">
       <label>Owner / Buyer Name
        <input value={form.ownerName} required maxLength={160}
         disabled={busy||!canPublish} placeholder="Customer name"
         onChange={e=>setDraft("ownerName",e.target.value)}/>
       </label>
       <label>Broker Name <small>(Optional)</small>
        <input value={form.brokerName} maxLength={160}
         disabled={busy||!canPublish} placeholder="Broker name"
         onChange={e=>setDraft("brokerName",e.target.value)}/>
       </label>
       {status==="booked"?<label className="client-geo-wide">Booking Amount (₹)
        <input value={form.bookingAmount} inputMode="decimal" required
         disabled={busy||!canPublish} placeholder="Enter booking amount"
         onChange={e=>setDraft("bookingAmount",e.target.value)}/>
       </label>:<label className="client-geo-wide">Sold Amount (₹)
        <input value={form.soldAmount} inputMode="decimal" required
         disabled={busy||!canPublish} placeholder="Enter sold amount"
         onChange={e=>setDraft("soldAmount",e.target.value)}/>
       </label>}
      </div>:<p className="client-geo-available-note">
       This plot will be shown as Available. Previous private booking and sale
       details stay safely in history.</p>}
      {!canApprove&&<p className="client-geo-info">Your role cannot publish public plot statuses.</p>}
      <div className="client-geo-publish-actions">
       <div className="client-geo-publish-summary">
        <span>Publish Plot {chosen.plotId} as</span>
        <strong className={"client-geo-status "+status}>{displayStatus(status)}</strong>
       </div>
       <button type="button" className="client-geo-publish-button"
        disabled={busy||!canPublish||!isDirty||!validAmount||
         (status!=="available"&&!form.ownerName.trim())}
        onClick={()=>void publish()}>
        {busy?"Publishing…":published?.plotId===chosen.plotId&&published.status===status
         ?"✓ Published: "+status.toUpperCase():"Save & Publish Status"}
       </button>
       {error&&<p className="engine-manage-error client-geo-publish-error" role="alert">{error}</p>}
       {published?.plotId===chosen.plotId&&
        <p className={"engine-manage-ok client-geo-publish-success client-geo-publish-success--"+published.status}
         role="status" aria-live="polite">
         <span aria-hidden="true" className="client-geo-success-check">✓</span>
         <span><b>Plot {published.plotId} Successfully {published.status==="sold"?"Sold":
           published.status==="booked"?"Booked":"Available"}</b>
          <small>Saved and published on the customer Geo site.</small>
         </span>
        </p>}
      </div>
     </section>}
    </div>;
   })}
   {!filtered.length&&<p className="client-geo-empty">No matching plots. Check the active mapping or filter.</p>}
  </div>
  {totalPages>1&&<div className="client-geo-pagination">
   <button type="button" disabled={page===0} onClick={()=>setPage(p=>Math.max(0,p-1))}>Previous</button>
   <span>Page {page+1} / {totalPages} · {filtered.length} results</span>
   <button type="button" disabled={page>=totalPages-1}
    onClick={()=>setPage(p=>Math.min(totalPages-1,p+1))}>Next</button>
  </div>}
  {toast&&<div className={"client-geo-toast client-geo-toast--"+toast.status}
   role="status" aria-live="polite">
   <span className="client-geo-toast-check" aria-hidden="true">✓</span>
   <span><b>Plot {toast.plotId} {displayStatus(toast.status)}</b>
    <small>Successfully saved & published</small>
   </span>
   <button type="button" aria-label="Dismiss notification" onClick={()=>setToast(null)}>×</button>
  </div>}
 </section>;
}
