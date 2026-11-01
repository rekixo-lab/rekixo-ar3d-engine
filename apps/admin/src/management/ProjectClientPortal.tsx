import {useEffect,useState} from "react";
import GeoBulkPricingPanel,{type GeoPriceQuote} from "../geo/GeoBulkPricingPanel";
import GeoDealRecordsPanel from "../geo/GeoDealRecordsPanel";
import "./project-management.css";
type Identity={displayName:string;email:string;role:string;projectSlug:string;projectName:string};
type Session={authenticated:boolean;user:Identity|null};
type Commercial={plotId:string;status:"available"|"booked"|"sold";
  pricePaise:number|null;revision:number;publicApproved:boolean;evidenceRef:string};
type CommercialState={mappingReleaseId:string|null;rows:Commercial[];
  plotCount?:number;plotIds?:string[];notice?:string};
type Overview={project:{slug:string;name:string;status:string};role:string;
  permissions:{commercialRead:boolean;commercialPrepare:boolean;commercialApprove:boolean;
    dealsRead?:boolean;dealsWrite?:boolean}};
const ROOT="/3Dprojects/api/client-portal";
async function api<T>(path:string,method="GET",data?:unknown):Promise<T>{
  const response=await fetch(ROOT+path,{method,credentials:"same-origin",cache:"no-store",
    headers:{"Accept":"application/json",...(data?{"Content-Type":"application/json"}:{})},
    ...(data?{body:JSON.stringify(data)}:{})});
  const raw=await response.text();
  let parsed:T&{error?:string};
  try{parsed=JSON.parse(raw) as T&{error?:string};}
  catch{throw Error("Project client session service returned invalid JSON.");}
  if(!response.ok)throw Error(parsed.error||"Project client request failed.");
  return parsed;
}
function moneyToPaise(value:string){
  const clean=value.trim();
  if(!clean)return null;
  if(!/^\d{1,10}(?:\.\d{1,2})?$/.test(clean))
    throw Error("Enter INR rupees with at most 2 decimal places.");
  const [a,b=""]=clean.split(".");
  const n=BigInt(a)*100n+BigInt(b.padEnd(2,"0"));
  if(n>1000000000000n)throw Error("INR amount exceeds listing safety limit.");
  return Number(n);
}
export default function ProjectClientPortal(){
  const [invite,setInvite]=useState("");
  const [identity,setIdentity]=useState<Identity|null>(null);
  const [email,setEmail]=useState("");
  const [overview,setOverview]=useState<Overview|null>(null);
  const [commercial,setCommercial]=useState<CommercialState|null>(null);
  const [plotId,setPlotId]=useState("");
  const [status,setStatus]=useState("");
  const [rupees,setRupees]=useState("");
  const [evidence,setEvidence]=useState("");
  const [publicApproved,setPublicApproved]=useState(false);
  const [priceQuotes,setPriceQuotes]=useState<GeoPriceQuote[]>([]);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const load=async()=>{
    const s=await api<Session>("/session");
    setIdentity(s.authenticated?s.user:null);
    if(!s.user){setOverview(null);setCommercial(null);return;}
    const path="/projects/"+encodeURIComponent(s.user.projectSlug);
    const [o,rows]=await Promise.all([
      api<Overview>(path+"/overview"),
      api<CommercialState>(path+"/commercial")
    ]);
    setOverview(o);setCommercial(rows);
  };
  useEffect(()=>{
    const token=window.location.hash.match(/^#invite=([a-f0-9]{64})$/)?.[1]||"";
    if(token){setInvite(token);history.replaceState(null,"",location.pathname+location.search);}
    let live=true;
    void api<Session>("/session").then(async s=>{
      if(!live)return;
      if(!s.user)return;
      setIdentity(s.user);
      const path="/projects/"+encodeURIComponent(s.user.projectSlug);
      const [o,rows]=await Promise.all([
        api<Overview>(path+"/overview"),api<CommercialState>(path+"/commercial")
      ]);
      if(live){setOverview(o);setCommercial(rows);}
    }).catch(err=>{if(live)setError(String(err));});
    return()=>{live=false;};
  },[]);
  const selected=commercial?.rows.find(r=>r.plotId.toLowerCase()===plotId.toLowerCase());
  const currentQuote=priceQuotes.find(r=>r.plotId.toLowerCase()===plotId.toLowerCase());
  const choose=(id:string)=>{
    setPlotId(id);
    const row=commercial?.rows.find(r=>r.plotId.toLowerCase()===id.toLowerCase());
    setStatus(row?.status||"");
    setRupees(row?.pricePaise===null||row?.pricePaise===undefined?"":String(row.pricePaise/100));
    setEvidence(row?.evidenceRef||"");setPublicApproved(Boolean(row?.publicApproved));
  };
  const login=async()=>{
    if(!invite||!email.trim())return;
    setBusy(true);setError("");setMessage("");
    try{
      await api("/enroll","POST",{token:invite,email:email.trim().toLowerCase()});
      setInvite("");setEmail("");
      await load();
      setMessage("Project-scoped sign-in established. Owner credentials are not shared.");
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  };
  const logout=async()=>{
    setBusy(true);try{await api("/logout","POST");setIdentity(null);setOverview(null);
      setCommercial(null);setMessage("Client session revoked on this device.");}
    catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  };
  const save=async()=>{
    if(!identity||!overview?.permissions.commercialPrepare||!plotId||!status)return;
    setBusy(true);setError("");setMessage("");
    try{
      const publicFlag=overview.permissions.commercialApprove&&publicApproved;
      if(!window.confirm("Submit a project-scoped commercial record for Plot "+plotId+
        "?\n"+(publicFlag?"This will publish the approved listing status/price.":
          "This remains PRIVATE until approved by an authorized approver.")+
        "\nNo buyer or receipt information is included."))return;
      const payload={plotId,status,pricePaise:moneyToPaise(rupees),currency:"INR",
        evidenceRef:evidence.trim(),publicApproved:publicFlag,
        expectedRevision:selected?.revision||0};
      const path="/projects/"+encodeURIComponent(identity.projectSlug)+"/commercial";
      const next=await api<CommercialState>(path,"PUT",payload);
      setCommercial(next);setMessage("Commercial record saved with project scope and audit history.");
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  };
  return <main className="engine-manage" style={{maxWidth:920,margin:"0 auto"}}>
    <header><p className="eyebrow">AR3D ENGINE · PROJECT CLIENT PORTAL</p>
      <h1>Scoped Project Access</h1>
      <p>Independent of Engine Owner sign-in · private project data only</p></header>
    {error&&<p className="engine-manage-error" role="alert">{error}</p>}
    {message&&<p className="engine-manage-ok" role="status">{message}</p>}
    {!identity?<section className="engine-manage-card">
      <h2>Accept an owner-issued invitation</h2>
      <p>The owner must confirm your identity and share a one-time link privately.
        A directory contact alone does not create a login. Links expire after 24 hours.</p>
      {!invite&&<p>Open the private invitation link issued for your project to continue.</p>}
      {invite&&<form onSubmit={e=>{e.preventDefault();void login();}}>
        <label>Invited email address<input type="email" autoComplete="email" required
          value={email} maxLength={254} onChange={e=>setEmail(e.target.value)}/></label>
        <div className="engine-manage-actions"><button disabled={busy||!email.trim()}>
          {busy?"Verifying invitation…":"Accept one-time invitation"}</button></div>
      </form>}
    </section>:<>
      <section className="engine-manage-card">
        <h2>{identity.projectName}</h2>
        <p>{identity.displayName} · {identity.email} · Role: <strong>{identity.role}</strong></p>
        <p>Every request rechecks the project grant, role, active release and session revocation.
          This session cannot open Engine Owner APIs or another project's ledger.</p>
        <div className="engine-manage-actions">
          <button type="button" onClick={()=>void load()} disabled={busy}>Refresh project</button>
          <button type="button" onClick={()=>void logout()} disabled={busy}>Sign out</button>
        </div>
      </section>
      <section className="engine-manage-card">
        <h2>Approved Geo Plot Listing Records</h2>
        <p>{overview?.permissions.commercialApprove?"You may approve source-backed public listings.":
          overview?.permissions.commercialPrepare?"You may prepare private listing facts for an approver.":
            "You have read-only access to this project's listing records."}</p>
        <p>Active mapping release: {commercial?.mappingReleaseId?.slice(0,20)||"not published"}</p>
        {commercial?.rows.map(row=><p key={row.plotId}>
          <button type="button" onClick={()=>choose(row.plotId)}>Plot {row.plotId}</button>
          {" · "}{row.status}{" · "}
          {row.pricePaise===null?"Price unverified":"₹"+(row.pricePaise/100).toLocaleString("en-IN")}
          {" · "}{row.publicApproved?"Public approved":"Private review"}</p>)}
        {!commercial?.rows.length&&<p>No source-backed commercial records for the active mapping release.</p>}
        {overview?.permissions.commercialPrepare&&<>
          <label>Existing canonical Plot ID<input value={plotId} maxLength={48}
            onChange={e=>choose(e.target.value)} placeholder="Exact mapped ID"/></label>
          <label>Listing status<select value={status} onChange={e=>setStatus(e.target.value)}>
            <option value="">Select reviewed status</option>
            <option value="available">Available</option><option value="booked">Booked</option>
            <option value="sold">Sold</option></select></label>
          <label>INR listing price (optional)<input value={rupees}
            inputMode="decimal" onChange={e=>setRupees(e.target.value)}/></label>
          {currentQuote&&<p>Private CSV price suggestion:
            {" "}₹{(currentQuote.pricePaise/100).toLocaleString("en-IN")}
            <button type="button" onClick={()=>{
              if(!window.confirm("Use reviewed CSV quote? It does not change status or public approval."))return;
              setRupees(String(currentQuote.pricePaise/100));setEvidence(currentQuote.evidenceRef);
            }}>Use reviewed CSV price</button>
          </p>}
          <label>Source / signed agreement reference<input value={evidence}
            maxLength={250} onChange={e=>setEvidence(e.target.value)}/></label>
          {overview.permissions.commercialApprove&&<label>
            <input type="checkbox" checked={publicApproved}
              onChange={e=>setPublicApproved(e.target.checked)}/>
            Explicitly approve for public display</label>}
          <div className="engine-manage-actions">
            <button type="button" disabled={busy||!plotId||!status||evidence.trim().length<3}
              onClick={()=>void save()}>Save scoped commercial record</button></div>
        </>}
        {identity&&<GeoBulkPricingPanel
          endpoint={ROOT+"/projects/"+encodeURIComponent(identity.projectSlug)+"/pricing"}
          mappingReleaseId={commercial?.mappingReleaseId||null}
          canEdit={Boolean(overview?.permissions.commercialPrepare)}
          onQuotes={setPriceQuotes}/>}
        {overview?.permissions.dealsRead&&identity&&<GeoDealRecordsPanel
          endpoint={ROOT+"/projects/"+encodeURIComponent(identity.projectSlug)+"/deals"}
          mappingReleaseId={commercial?.mappingReleaseId||null}
          plotIds={commercial?.plotIds||[]}
          canEdit={Boolean(overview.permissions.dealsWrite)}/>}
      </section>
    </>}
  </main>;
}
