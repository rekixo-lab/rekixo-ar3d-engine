import {useEffect,useMemo,useRef,useState} from "react";
type Status="available"|"booked"|"sold";
type Row={plotId:string;status:Status;draftStatus?:Status|null;revision:number;pricePaise:number|null;
  publicApproved:boolean;evidenceRef:string;hasReview?:boolean;area?:{value:number;unit:string}|null};
export type GeoCommercialState={mappingReleaseId:string|null;plotCount?:number;publicationMode?:string;
  rows:Row[];counts?:{available:number;booked:number;sold:number;unreviewed:number};notice?:string};
type Details={plotId:string;ownerName:string;brokerName:string;bookingAmountPaise:number|null;notes:string;revision:number};
type Draft={ownerName:string;brokerName:string;bookingAmount:string;notes:string};
const ROOT="/3Dprojects/api/client-portal";
async function api<T>(url:string,method="GET",data?:object):Promise<T>{
 const r=await fetch(ROOT+url,{method,credentials:"same-origin",cache:"no-store",
   headers:{"Accept":"application/json",...(data?{"Content-Type":"application/json"}:{})},
   ...(data?{body:JSON.stringify(data)}:{})});
 const j=await r.json() as T&{error?:string};if(!r.ok)throw Error(j.error||"Request failed");return j;
}
const rupees=(paise:number|null)=>paise===null?"—":"₹"+(paise/100).toLocaleString("en-IN",{maximumFractionDigits:2});
function toPaise(value:string){
 if(!value.trim())return null;
 if(!/^\d{1,10}(?:\.\d{1,2})?$/.test(value.trim()))throw Error("Enter amount in rupees, up to two decimal places.");
 const [whole,cents=""]=value.trim().split(".");
 const paise=Number(BigInt(whole)*100n+BigInt(cents.padEnd(2,"0")));
 if(!Number.isSafeInteger(paise)||paise>1e12)throw Error("Booking amount too large.");
 return paise;
}
export default function ClientGeoPlotManagement({slug,commercial,canEdit,canApprove,onCommercialChange}:{
 slug:string;commercial:GeoCommercialState;canEdit:boolean;canApprove:boolean;
 onCommercialChange:(next:GeoCommercialState)=>void}){
 const [details,setDetails]=useState<Details[]>([]);
 const [query,setQuery]=useState("");const [filter,setFilter]=useState<"all"|Status>("all");
 const [page,setPage]=useState(0);
 const [selected,setSelected]=useState("");
 const editorHeadingRef=useRef<HTMLHeadingElement|null>(null);
 const [form,setForm]=useState<Draft>({ownerName:"",brokerName:"",bookingAmount:"",notes:""});
 const [baseline,setBaseline]=useState("");
 const [status,setStatus]=useState<Status>("available");const [evidence,setEvidence]=useState("");
 const [approved,setApproved]=useState(false);
 const [busy,setBusy]=useState(false);const [error,setError]=useState("");const [message,setMessage]=useState("");
 const path="/projects/"+encodeURIComponent(slug);
 const reload=async()=>{
  const v=await api<{mappingReleaseId:string|null;rows:Details[]}>(path+"/plot-details");
  if(v.mappingReleaseId!==commercial.mappingReleaseId)throw Error("Mapping release changed. Reload the page.");
  setDetails(v.rows);
 };
 useEffect(()=>{let live=true;
  void api<{mappingReleaseId:string|null;rows:Details[]}>(path+"/plot-details")
   .then(v=>{if(!live)return;if(v.mappingReleaseId!==commercial.mappingReleaseId){setError("Mapping changed. Reload page.");return;}setDetails(v.rows);setError("");})
   .catch(e=>{if(live)setError(e instanceof Error?e.message:"Plot details unavailable");});
  return()=>{live=false};
 },[slug,commercial.mappingReleaseId]);
 const byId=useMemo(()=>new Map(details.map(d=>[d.plotId.toLowerCase(),d])),[details]);
 const filtered=useMemo(()=>commercial.rows.filter(r=>
   (filter==="all"||r.status===filter)&&r.plotId.toLowerCase().includes(query.trim().toLowerCase())
 ),[commercial.rows,query,filter]);
 const pageSize=100,totalPages=Math.max(1,Math.ceil(filtered.length/pageSize));
 const visibleRows=filtered.slice(page*pageSize,(page+1)*pageSize);
 const editingVisible=visibleRows.some(row=>row.plotId===selected);
 const chosen=commercial.rows.find(r=>r.plotId===selected);
 const detail=chosen?byId.get(chosen.plotId.toLowerCase()):undefined;
 const isDirty=JSON.stringify(form)!==baseline;
 // Show the inline editor as soon as a plot row is selected, without requiring
 // customers to hunt for a form below the complete paginated list.
 useEffect(()=>{
  if(!editingVisible)return;
  const heading=editorHeadingRef.current;
  if(!heading)return;
  const reduced=window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  heading.scrollIntoView({block:"nearest",inline:"nearest",behavior:reduced?"auto":"smooth"});
 },[selected,editingVisible]);
 function choose(row:Row){
  if(isDirty&&selected&&!window.confirm("Unsaved booking details discard?"))return;
  if(row.plotId===selected){
   setSelected("");setMessage("");setError("");
   return;
  }
  setSelected(row.plotId);
  const d=byId.get(row.plotId.toLowerCase());
  const next={ownerName:d?.ownerName||"",brokerName:d?.brokerName||"",
   bookingAmount:d?.bookingAmountPaise==null?"":String(d.bookingAmountPaise/100),notes:d?.notes||""};
  setForm(next);setBaseline(JSON.stringify(next));
  setStatus(row.draftStatus||row.status);
  setEvidence(row.evidenceRef||"");setApproved(row.publicApproved);
  setError("");setMessage("");
 }
 async function saveDetails(){
  if(!chosen||!canEdit)return;
  setBusy(true);setError("");setMessage("");
  try{
   const payload={plotId:chosen.plotId,expectedRevision:detail?.revision||0,
    ownerName:form.ownerName,brokerName:form.brokerName,bookingAmountPaise:toPaise(form.bookingAmount),notes:form.notes};
   await api(path+"/plot-details","PUT",payload);
   await reload();setBaseline(JSON.stringify(form));setMessage("Private booking details saved.");
  }catch(e){setError(e instanceof Error?e.message:"Booking details save failed.");}
  finally{setBusy(false);}
 }
 async function saveStatus(){
  if(!chosen||!canEdit)return;
  if(evidence.trim().length<3){setError("Enter source / booking evidence reference (3+ characters).");return;}
  if(!window.confirm("Update plot "+chosen.plotId+" listing status? The public status needs explicit approval."))return;
  setBusy(true);setError("");setMessage("");
  try{
   const next=await api<GeoCommercialState>(path+"/commercial","PUT",{
    plotId:chosen.plotId,expectedRevision:chosen.revision,status,pricePaise:chosen.pricePaise,
    currency:"INR",evidenceRef:evidence.trim(),publicApproved:canApprove&&approved
   });
   onCommercialChange(next);
   setMessage("Status saved and audited. Public display uses only approved verified releases.");
  }catch(e){setError(e instanceof Error?e.message:"Status update failed.");}
  finally{setBusy(false);}
 }
 return <section className="client-geo-manage">
  <div className="client-geo-toolbar">
   <div><h2>Plot Management</h2><p>{commercial.plotCount||0} mapped plots · Customer-facing status matches verified public release</p></div>
   <input aria-label="Search plot number" placeholder="Search plot number" value={query}
     onChange={e=>{setQuery(e.target.value);setPage(0)}}/>
   <select aria-label="Filter by status" value={filter} onChange={e=>{setFilter(e.target.value as typeof filter);setPage(0)}}>
    <option value="all">All statuses</option><option value="available">Available</option>
    <option value="booked">Booked</option><option value="sold">Sold</option>
   </select>
   <button type="button" onClick={()=>void reload().catch(e=>setError(String(e)))}>Refresh</button>
  </div>
  {commercial.notice&&<p className="client-geo-info">{commercial.notice}</p>}
  {!editingVisible&&error&&<p className="engine-manage-error" role="alert">{error}</p>}
  {!editingVisible&&message&&<p className="engine-manage-ok" role="status">{message}</p>}
  <div className="client-geo-list" aria-label="All published plots">
   <div className="client-geo-table-heading"><span>Plot</span><span>Area</span><span>Owner / Buyer</span>
    <span>Booking amount</span><span>Broker</span><span>Status</span><span/></div>
   {visibleRows.map(row=>{
    const detail=byId.get(row.plotId.toLowerCase());
    const editing=selected===row.plotId;
    return <div key={row.plotId} className={"client-geo-entry"+(editing?" is-editing":"")}>
     <button type="button" className={"client-geo-table-row"+(editing?" is-active":"")}
       aria-expanded={editing} aria-controls={editing?"client-geo-editor-"+row.plotId:undefined}
       onClick={()=>choose(row)}>
      <strong>{row.plotId}</strong>
      <span>{row.area?.value?row.area.value.toLocaleString("en-IN")+" "+row.area.unit:"—"}</span>
      <span>{detail?.ownerName||"—"}</span>
      <span>{rupees(detail?.bookingAmountPaise??null)}</span><span>{detail?.brokerName||"—"}</span>
      <span className={"client-geo-status "+row.status}>{row.status}</span>
      <span className="client-geo-edit-indicator">{editing?"Close editor ↑":"Edit ↓"}</span>
     </button>
     {editing&&chosen&&<section id={"client-geo-editor-"+row.plotId}
       className="client-geo-editor client-geo-editor--inline" aria-label={"Edit plot "+chosen.plotId}>
   <header><h3 ref={editorHeadingRef}>Editing Plot {chosen.plotId}</h3>
    <span>Current public status: <b>{chosen.status}</b></span></header>
   {error&&<p className="engine-manage-error" role="alert">{error}</p>}
   {message&&<p className="engine-manage-ok" role="status">{message}</p>}
   <div className="client-geo-editor-grid">
    <label>Owner / Buyer Name<input value={form.ownerName} maxLength={160} onChange={e=>setForm(v=>({...v,ownerName:e.target.value}))}/></label>
    <label>Broker Name<input value={form.brokerName} maxLength={160} onChange={e=>setForm(v=>({...v,brokerName:e.target.value}))}/></label>
    <label>Booking Amount (₹)<input value={form.bookingAmount} inputMode="decimal" onChange={e=>setForm(v=>({...v,bookingAmount:e.target.value}))}/></label>
    <label>Private Notes<input value={form.notes} maxLength={600} onChange={e=>setForm(v=>({...v,notes:e.target.value}))}/></label>
   </div>
   <p className="client-geo-info">Booking details are private. They do not automatically confirm a legal sale or payment.</p>
   <button type="button" disabled={busy||!canEdit||!isDirty} onClick={()=>void saveDetails()}>
    {busy?"Saving…":"Save booking details"}</button>
   <hr/>
   <div className="client-geo-editor-grid">
    <label>Plot status<select value={status} onChange={e=>setStatus(e.target.value as Status)}>
     <option value="available">Available</option><option value="booked">Booked</option><option value="sold">Sold</option>
    </select></label>
    <label>Source / signed evidence reference<input value={evidence} maxLength={250} placeholder="e.g. Booking slip / file reference"
      onChange={e=>setEvidence(e.target.value)}/></label>
   </div>
   {canApprove&&<label className="client-geo-inline"><input type="checkbox" checked={approved}
     onChange={e=>setApproved(e.target.checked)}/>Approve this listing for public display</label>}
   {commercial.publicationMode==="preliminary"&&<p className="client-geo-info">Preliminary mapping: public status stays Available until verified publication.</p>}
   <button type="button" disabled={busy||!canEdit||evidence.trim().length<3}
     onClick={()=>void saveStatus()}>{busy?"Saving…":"Save plot status"}</button>
  </section>}
    </div>;
   })}
   {!filtered.length&&<p className="client-geo-empty">No matching plots. Check the active published mapping if all plots are missing.</p>}
  </div>
  {totalPages>1&&<div className="client-geo-pagination">
   <button type="button" disabled={page===0} onClick={()=>setPage(p=>Math.max(0,p-1))}>Previous</button>
   <span>Page {page+1} / {totalPages} · {filtered.length} results</span>
   <button type="button" disabled={page>=totalPages-1} onClick={()=>setPage(p=>Math.min(totalPages-1,p+1))}>Next</button>
  </div>}

 </section>;
}
