import {useEffect,useState} from "react";
import GeoBulkPricingPanel,{type GeoPriceQuote} from "../geo/GeoBulkPricingPanel";
import GeoDealRecordsPanel from "../geo/GeoDealRecordsPanel";
import "./project-management.css";
import "./project-client-admin.css";
type Identity={displayName:string;email:string;role:string;projectSlug:string;projectName:string;projectKind?:string;mustChangePassword?:boolean;loginId?:string|null};
type Session={authenticated:boolean;user:Identity|null};
type Commercial={plotId:string;status:"available"|"booked"|"sold";
  pricePaise:number|null;revision:number;publicApproved:boolean;evidenceRef:string};
type CommercialState={mappingReleaseId:string|null;rows:Commercial[];
  plotCount?:number;plotIds?:string[];notice?:string};
type Overview={project:{slug:string;name:string;status:string;kind?:string};role:string;
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
type MasterplanInventory={releaseId:string|null;plotCount:number;
  counts:{available:number;booked:number;confirmed:number};
  plots:{id:string;status:"available"|"booked"|"confirmed"}[];notice?:string};
type ContactFields={
  contactName:string;address:string;phonePrimary:string;phoneSecondary:string;
  whatsapp:string;email:string;websiteUrl:string;mapsUrl:string;brochureUrl:string;
};
type ContactState={revision:number;ownerApprovedPublic:boolean;fields:ContactFields};
const contactLabels:ReadonlyArray<[keyof ContactFields,string]>= [
  ["contactName","Contact person"],["address","Project address"],
  ["phonePrimary","Main phone"],["phoneSecondary","Secondary phone"],
  ["whatsapp","WhatsApp number"],["email","Public contact email"],
  ["websiteUrl","Website URL"],["mapsUrl","Google Maps URL"],
  ["brochureUrl","Brochure URL"]
];
type Panel="overview"|"plots"|"pricing"|"deals"|"contact";
const nameOfRole=(value:string)=>value==="client_admin"?"Client Admin":
  value==="approver"?"Approver":value==="editor"?"Editor":"Viewer";

export default function ProjectClientPortal({projectSlug=""}:{projectSlug?:string}){
  const scopedSlug=projectSlug.trim().toLowerCase();
  const [invite,setInvite]=useState("");
  const [identity,setIdentity]=useState<Identity|null>(null);
  const [email,setEmail]=useState("");
  const [loginId,setLoginId]=useState("");
  const [password,setPassword]=useState("");
  const [oldPassword,setOldPassword]=useState("");
  const [newPassword,setNewPassword]=useState("");
  const [confirmPassword,setConfirmPassword]=useState("");
  const [projectTitle,setProjectTitle]=useState("");
  const [showPassword,setShowPassword]=useState(false);
  const [overview,setOverview]=useState<Overview|null>(null);
  const [commercial,setCommercial]=useState<CommercialState|null>(null);
  const [masterplan,setMasterplan]=useState<MasterplanInventory|null>(null);
  const [contact,setContact]=useState<ContactState|null>(null);
  const [panel,setPanel]=useState<Panel>("overview");
  const [plotSearch,setPlotSearch]=useState("");
  const [plotId,setPlotId]=useState("");
  const [status,setStatus]=useState("");
  const [rupees,setRupees]=useState("");
  const [evidence,setEvidence]=useState("");
  const [publicApproved,setPublicApproved]=useState(false);
  const [priceQuotes,setPriceQuotes]=useState<GeoPriceQuote[]>([]);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const sessionPath="/session"+(scopedSlug?"?project="+encodeURIComponent(scopedSlug):"");

  const load=async()=>{
    const s=await api<Session>(sessionPath);
    // A cookie for another project must not populate a project's private page.
    if(!s.authenticated||!s.user||(scopedSlug&&s.user.projectSlug!==scopedSlug)){
      setIdentity(null);setOverview(null);setCommercial(null);setMasterplan(null);
      setContact(null);
      return;
    }
    if(s.user.mustChangePassword){
      setIdentity(s.user);setOverview(null);setCommercial(null);setMasterplan(null);setContact(null);
      return;
    }
    const path="/projects/"+encodeURIComponent(s.user.projectSlug);
    const o=await api<Overview>(path+"/overview");
    if(o.project.slug!==s.user.projectSlug)throw Error("Project scope verification failed.");
    if(o.project.kind==="masterplan_geo"){
      const inventory=await api<MasterplanInventory>(path+"/masterplan-inventory");
      setMasterplan(inventory);setCommercial(null);
    }else if(o.project.kind==="building" ){
      setMasterplan(null);setCommercial(null);
    }else{
      const rows=await api<CommercialState>(path+"/commercial");
      setMasterplan(null);setCommercial(rows);
    }
    if(s.user.role==="client_admin"){
      setContact(await api<ContactState>(path+"/contact"));
    }else setContact(null);
    setOverview(o);setIdentity(s.user);
  };
  useEffect(()=>{
    const token=window.location.hash.match(/^#invite=([a-f0-9]{64})$/)?.[1]||"";
    if(token){
      setInvite(token);
      history.replaceState(null,"",location.pathname+location.search);
    }
    if(scopedSlug)void api<{projectName:string}>("/projects/"+encodeURIComponent(scopedSlug)+"/login-meta")
      .then(v=>setProjectTitle(v.projectName)).catch(()=>setProjectTitle("Project Client Admin"));
    void load().catch(e=>setError(e instanceof Error?e.message:"Client session unavailable."));
  },[scopedSlug]);
  const selected=commercial?.rows.find(r=>r.plotId.toLowerCase()===plotId.toLowerCase());
  const currentQuote=priceQuotes.find(r=>r.plotId.toLowerCase()===plotId.toLowerCase());
  const choose=(id:string)=>{
    setPlotId(id);
    const row=commercial?.rows.find(r=>r.plotId.toLowerCase()===id.toLowerCase());
    setStatus(row?.status||"");
    setRupees(row?.pricePaise===null||row?.pricePaise===undefined?"":String(row.pricePaise/100));
    setEvidence(row?.evidenceRef||"");setPublicApproved(Boolean(row?.publicApproved));
  };
  const passwordLogin=async()=>{
    if(!scopedSlug||!loginId.trim()||!password)return;
    setBusy(true);setError("");setMessage("");
    try{
      await api("/login","POST",{projectSlug:scopedSlug,loginId:loginId.trim(),password});
      setPassword("");
      await load();
    }catch(e){setError(e instanceof Error?e.message:"Invalid login ID or password.");}
    finally{setBusy(false);}
  };
  const changePassword=async()=>{
    if(!oldPassword||newPassword!==confirmPassword||newPassword.length<8)return;
    setBusy(true);setError("");setMessage("");
    try{
      await api("/change-password","POST",{oldPassword,newPassword});
      setOldPassword("");setNewPassword("");setConfirmPassword("");
      setIdentity(null);setLoginId("");
      setMessage("Password changed successfully. Sign in using your new password.");
    }catch(e){setError(e instanceof Error?e.message:"Password change failed.");}
    finally{setBusy(false);}
  };
  const login=async()=>{
    if(!invite||!email.trim())return;
    setBusy(true);setError("");setMessage("");
    try{
      await api("/enroll","POST",{token:invite,email:email.trim().toLowerCase(),
        ...(scopedSlug?{projectSlug:scopedSlug}:{})});
      setInvite("");setEmail("");setPassword("");
      await load();
      setMessage("Your project admin session is active.");
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  };
  const logout=async()=>{
    setBusy(true);
    try{
      await api("/logout","POST");
      setIdentity(null);setOverview(null);setCommercial(null);setMasterplan(null);
      setMessage("Signed out. Project access revoked on this device.");
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  };
  const save=async()=>{
    if(!identity||!overview?.permissions.commercialPrepare||!plotId||!status)return;
    if(!window.confirm("Save reviewed commercial record for Plot "+plotId+
      "? Public changes require explicit approval and supporting evidence."))return;
    setBusy(true);setError("");setMessage("");
    try{
      const publicFlag=Boolean(overview.permissions.commercialApprove&&publicApproved);
      const payload={plotId,status,pricePaise:moneyToPaise(rupees),currency:"INR",
        evidenceRef:evidence.trim(),publicApproved:publicFlag,
        expectedRevision:selected?.revision||0};
      const next=await api<CommercialState>("/projects/"+
        encodeURIComponent(identity.projectSlug)+"/commercial","PUT",payload);
      setCommercial(next);setMessage("Project commercial record saved and audited.");
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  };

  const saveContact=async()=>{
    if(!identity||identity.role!=="client_admin"||!contact||contact.revision<1)return;
    if(!window.confirm("Save customer-facing contact changes for this project?"))return;
    setBusy(true);setError("");setMessage("");
    try{
      const next=await api<ContactState>("/projects/"+
        encodeURIComponent(identity.projectSlug)+"/contact","PUT",
        {expectedRevision:contact.revision,fields:contact.fields});
      setContact(next);
      setMessage("Client contact details saved. Project owner approval setting was unchanged.");
    }catch(e){setError(e instanceof Error?e.message:"Contact update failed.");}
    finally{setBusy(false);}
  };

  const kind=overview?.project.kind||identity?.projectKind||"legacy";
  const masterplanGeo=kind==="masterplan_geo";
  const availablePanels:Panel[]=kind==="building"?["overview"]:
    masterplanGeo?["overview","plots"]:
    ["overview","plots","pricing",...(overview?.permissions.dealsRead?["deals" as const]:[])];
  if(identity?.role==="client_admin")availablePanels.push("contact");
  const mappingCount=masterplanGeo?masterplan?.plotCount||0:commercial?.plotCount||0;
  const countFor=(kind:"available"|"booked"|"sold")=>
    (commercial?.rows||[]).filter(x=>x.status===kind).length;
  const statusCounts=masterplanGeo?{
    available:masterplan?.counts.available||0,
    booked:masterplan?.counts.booked||0,
    sold:masterplan?.counts.confirmed||0,
    unreviewed:0
  }:{
    available:countFor("available"),booked:countFor("booked"),
    sold:countFor("sold"),
    unreviewed:Math.max(0,mappingCount-(commercial?.rows.length||0))
  };
  const customerSite=identity?"https://ar3dstudio.in/3Dprojects/"+
    encodeURIComponent(identity.projectSlug)+
    (masterplanGeo?"/masterplan":kind==="building"?"":"/geo"):"";
  const filteredMasterplan=(masterplan?.plots||[]).filter(row=>
    row.id.toLowerCase().includes(plotSearch.trim().toLowerCase()));
  const filteredCommercial=(commercial?.rows||[]).filter(row=>
    row.plotId.toLowerCase().includes(plotSearch.trim().toLowerCase()));
  const projectLabel=identity?.projectName||projectTitle||"Project Client Admin";

  return <main className="engine-client-admin">
    <header className="engine-client-admin-head">
      <div className="engine-client-admin-brand">
        <span className="engine-client-admin-mark" aria-hidden="true">
          <i/><i/><i/><i/>
        </span>
        <div>
          <small>AR3D STUDIO · CLIENT ADMIN</small>
          <h1>{projectLabel}</h1>
          <p>{identity?"Private project workspace · "+nameOfRole(identity.role):
            "Project-specific secure sign-in"}</p>
        </div>
      </div>
      {identity&&<div className="engine-client-admin-head-actions">
        <a href={customerSite} target="_blank" rel="noopener noreferrer">View customer site</a>
        <button type="button" disabled={busy} onClick={()=>void logout()}>Sign out</button>
      </div>}
    </header>
    {error&&<p className="engine-manage-error" role="alert">{error}</p>}
    {message&&<p className="engine-manage-ok" role="status">{message}</p>}
    {!identity?<section className="engine-client-admin-signin">
      <h2>Project Client Admin</h2>
      <p>Sign in with the Client ID and temporary password provided by your AR3D
        project administrator. Your account can only access this project.</p>
      {!invite&&!scopedSlug?<p role="status">
        Open your project's AR3D Client Admin link to sign in with ID and Password,
        or use an existing owner-approved invitation.
      </p>:!invite?<form className="engine-client-admin-login-form" onSubmit={e=>{
        e.preventDefault();void passwordLogin();
      }}>
        <label>Mobile Number or Email ID
          <input autoFocus autoComplete="username" value={loginId} maxLength={254} required
            placeholder="Client mobile number or email"
            onChange={e=>setLoginId(e.target.value)}/>
        </label>
        <label>Password
          <span className="engine-client-admin-password-field">
            <input type={showPassword?"text":"password"} autoComplete="current-password"
              value={password} maxLength={128} required placeholder="Enter password"
              onChange={e=>setPassword(e.target.value)}/>
            <button type="button" aria-label={showPassword?"Hide password":"Show password"}
              onClick={()=>setShowPassword(v=>!v)}>{showPassword?"Hide":"Show"}</button>
          </span>
        </label>
        <button type="submit" disabled={busy||!loginId.trim()||!password}>
          {busy?"Signing in…":"Sign In to Client Admin"}</button>
        <p className="engine-client-admin-login-hint">
          Forgot your password? Contact your project Super Admin to reset it.
        </p>
      </form>:
        <form onSubmit={e=>{e.preventDefault();void login();}}>
          <p>Owner-approved one-time invitation · Valid for 24 hours.</p>
          <label>Invited email address
            <input type="email" autoComplete="email" value={email}
              maxLength={254} required onChange={e=>setEmail(e.target.value)}/>
          </label>
          <button type="submit" disabled={busy||!email.trim()}>
            {busy?"Verifying…":"Activate project access"}</button>
          <button type="button" onClick={()=>setInvite("")}>Sign in with ID and Password</button>
        </form>}
    </section>:identity.mustChangePassword?<section className="engine-client-admin-signin">
      <h2>Change Temporary Password</h2>
      <p>For account security, create your own password before opening the dashboard.
        Use at least 8 characters with a letter and a number.</p>
      <form className="engine-client-admin-login-form" onSubmit={e=>{
        e.preventDefault();void changePassword();
      }}>
        <label>Current Temporary Password
          <input type="password" autoComplete="current-password" value={oldPassword}
            required minLength={8} maxLength={128} onChange={e=>setOldPassword(e.target.value)}/>
        </label>
        <label>New Password
          <input type="password" autoComplete="new-password" value={newPassword}
            required minLength={8} maxLength={128} onChange={e=>setNewPassword(e.target.value)}/>
        </label>
        <label>Confirm New Password
          <input type="password" autoComplete="new-password" value={confirmPassword}
            required minLength={8} maxLength={128} onChange={e=>setConfirmPassword(e.target.value)}/>
        </label>
        {confirmPassword&&newPassword!==confirmPassword&&
          <p role="alert">New passwords do not match.</p>}
        <button type="submit" disabled={busy||newPassword.length<8||
          !/[A-Za-z]/.test(newPassword)||!/[0-9]/.test(newPassword)||
          !oldPassword||newPassword!==confirmPassword}>
          {busy?"Updating…":"Change Password"}</button>
      </form>
    </section>:<>
      <nav className="engine-client-admin-tabs" aria-label="Client admin sections">
        {availablePanels.map(item=><button key={item} type="button"
          aria-current={panel===item?"page":undefined} className={panel===item?"is-active":""}
          onClick={()=>setPanel(item)}>{item==="overview"?"Overview":
          item==="plots"?"Plots":item==="pricing"?"Pricing":item==="contact"?"Contact":"Deals"}</button>)}
      </nav>
      <section className="engine-client-admin-meta">
        <span>{identity.displayName} · {identity.email}</span>
        <span>Role: {nameOfRole(identity.role)} · {identity.projectSlug}</span>
      </section>

      {panel==="overview"&&<>
        <section className="engine-client-admin-stats" aria-label="Project plot summary">
          <article><span>Total Plots</span><strong>{mappingCount}</strong></article>
          <article><span>Available</span><strong>{statusCounts.available}</strong></article>
          <article><span>Booked</span><strong>{statusCounts.booked}</strong></article>
          <article><span>{masterplanGeo?"Confirmed":"Sold"}</span><strong>{statusCounts.sold}</strong></article>
          {!masterplanGeo&&<article><span>Not reviewed</span><strong>{statusCounts.unreviewed}</strong></article>}
        </section>
        <div className="engine-client-admin-grid">
          <section className="engine-client-admin-card">
            <h2>Project overview</h2>
            <p>Published project: <strong>{overview?.project.name}</strong></p>
            <p>Status: {overview?.project.status}</p>
            <p>{masterplanGeo?"Masterplan source and private inventory are read-only here.":
              "Commercial facts are separate from immutable 3D geometry and require explicit public approval."}</p>
            <div className="engine-client-admin-actions">
              <button type="button" disabled={busy} onClick={()=>void load()
                .catch(e=>setError(e instanceof Error?e.message:String(e)))}>Refresh</button>
              <button type="button" onClick={()=>setPanel("plots")}>View plots</button>
            </div>
          </section>
          <section className="engine-client-admin-card">
            <h2>Access & responsibilities</h2>
            <p>{overview?.permissions.commercialApprove&&!masterplanGeo?
              "Can approve source-backed listing status and prices for public display.":
              overview?.permissions.commercialPrepare&&!masterplanGeo?
              "Can prepare private commercial facts for review.":
              "Can inspect permitted project facts and inventory."}</p>
            <p>Owner controls 3D mapping, publishing, project access and immutable releases.</p>
            <p>Client sessions are separately authenticated and checked on every request.</p>
          </section>
        </div>
      </>}

      {panel==="plots"&&<section className="engine-client-admin-card">
        <div className="engine-client-admin-card-title">
          <div><h2>{masterplanGeo?"Masterplan inventory":"Geo plot management"}</h2>
            <p>{masterplanGeo?"Read-only, source-backed plot statuses":
              "Reviewed status, listing price and approval records"}</p></div>
          <label className="engine-client-admin-search">Search plot
            <input value={plotSearch} placeholder="Plot number"
              onChange={e=>setPlotSearch(e.target.value)}/></label>
        </div>
        {masterplanGeo?<div className="engine-client-admin-plot-list">
          {filteredMasterplan.map(row=><div className="engine-client-admin-plot-row" key={row.id}>
            <strong>Plot {row.id}</strong>
            <span>{row.status==="confirmed"?"Confirmed":row.status==="booked"?"Booked":"Available"}</span>
          </div>)}
          {!filteredMasterplan.length&&<p>No matching plot records.</p>}
          <p>{masterplan?.notice}</p>
        </div>:<>
          <div className="engine-client-admin-plot-list">
            {filteredCommercial.map(row=><button key={row.plotId} type="button"
              className={"engine-client-admin-plot-row"+(plotId===row.plotId?" is-selected":"")}
              onClick={()=>choose(row.plotId)}>
              <strong>Plot {row.plotId}</strong>
              <span>{row.status} · {row.pricePaise===null?"Price not reviewed":
                "₹"+(row.pricePaise/100).toLocaleString("en-IN")} ·
                {row.publicApproved?" Public approved":" Private review"}</span>
            </button>)}
            {!filteredCommercial.length&&<p>No reviewed listings match the search.</p>}
          </div>
          {overview?.permissions.commercialPrepare&&<>
            <div className="engine-client-admin-editor">
              <h3>Review listing details</h3>
              <label>Canonical mapped Plot ID<input value={plotId} maxLength={48}
                onChange={e=>choose(e.target.value)} placeholder="Exact plot ID"/></label>
              <label>Listing status<select value={status} onChange={e=>setStatus(e.target.value)}>
                <option value="">Choose status</option>
                <option value="available">Available</option>
                <option value="booked">Booked</option>
                <option value="sold">Sold</option>
              </select></label>
              <label>INR listing price<input value={rupees} inputMode="decimal"
                onChange={e=>setRupees(e.target.value)}/></label>
              {currentQuote&&<p>Reviewed CSV quote: ₹{(currentQuote.pricePaise/100).toLocaleString("en-IN")}
                <button type="button" onClick={()=>{
                  if(window.confirm("Use reviewed CSV price? Public approval and status stay unchanged.")){
                    setRupees(String(currentQuote.pricePaise/100));setEvidence(currentQuote.evidenceRef);
                  }
                }}>Use quote</button></p>}
              <label>Evidence / signed agreement reference<input value={evidence}
                maxLength={250} onChange={e=>setEvidence(e.target.value)}/></label>
              {overview.permissions.commercialApprove&&<label className="engine-client-admin-inline-check">
                <input type="checkbox" checked={publicApproved}
                  onChange={e=>setPublicApproved(e.target.checked)}/>
                Approve this listing for public display
              </label>}
              <button type="button" disabled={busy||!plotId||!status||evidence.trim().length<3}
                onClick={()=>void save()}>Save scoped listing</button>
            </div>
          </>}
        </>}
      </section>}

      {panel==="contact"&&identity?.role==="client_admin"&&<section className="engine-client-admin-card">
        <h2>Contact & Location</h2>
        <p>Only customer-facing details can be edited here. Project Owner name,
          developer identity, public visibility consent, mapping and releases are owner-controlled.</p>
        {contact?<form className="engine-client-admin-contact" onSubmit={e=>{
          e.preventDefault();void saveContact();
        }}>
          {contactLabels.map(([key,label])=><label key={key}>{label}
            <input type={key==="email"?"email":key.endsWith("Url")?"url":
              ["phonePrimary","phoneSecondary","whatsapp"].includes(key)?"tel":"text"}
              value={contact.fields[key]} disabled={busy||contact.revision<1}
              maxLength={key==="address"?600:key.endsWith("Url")?1000:
                key==="email"?254:["phonePrimary","phoneSecondary","whatsapp"].includes(key)?25:160}
              onChange={e=>setContact(previous=>previous?
                {...previous,fields:{...previous.fields,[key]:e.target.value}}:null)} />
          </label>)}
          <p className="engine-client-admin-contact-notice">
            Public display consent: <strong>{contact.ownerApprovedPublic?"Enabled by Owner":"Disabled by Owner"}</strong>
            {" · "}Contact revision: {contact.revision}
          </p>
          <button disabled={busy||contact.revision<1} type="submit">Save Contact Details</button>
          {contact.revision===0&&<p>The project owner must configure Project Profile first.</p>}
        </form>:<p>Loading project contact information…</p>}
      </section>}

      {panel==="pricing"&&!masterplanGeo&&identity&&<section className="engine-client-admin-card">
        <h2>Private bulk pricing</h2>
        <GeoBulkPricingPanel
          endpoint={ROOT+"/projects/"+encodeURIComponent(identity.projectSlug)+"/pricing"}
          mappingReleaseId={commercial?.mappingReleaseId||null}
          canEdit={Boolean(overview?.permissions.commercialPrepare)}
          onQuotes={setPriceQuotes}/>
      </section>}

      {panel==="deals"&&overview?.permissions.dealsRead&&!masterplanGeo&&identity&&
        <section className="engine-client-admin-card">
          <h2>Private deal progress</h2>
          <GeoDealRecordsPanel
            endpoint={ROOT+"/projects/"+encodeURIComponent(identity.projectSlug)+"/deals"}
            mappingReleaseId={commercial?.mappingReleaseId||null}
            plotIds={commercial?.plotIds||[]}
            canEdit={Boolean(overview.permissions.dealsWrite)}/>
        </section>}
    </>}
  </main>;
}
