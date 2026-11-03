import {useEffect,useState} from "react";
import GeoBulkPricingPanel from "../geo/GeoBulkPricingPanel";
import GeoDealRecordsPanel from "../geo/GeoDealRecordsPanel";
import ClientGeoPlotManagement from "./ClientGeoPlotManagement";
import {ClientGeoGallery,ClientGeoNotices} from "./ClientGeoGalleryNotices";
import ClientGeoSales from "./ClientGeoSales";
import "./project-management.css";
import "./project-client-admin.css";
type Identity={displayName:string;email:string;role:string;projectSlug:string;projectName:string;projectKind?:string;mustChangePassword?:boolean;loginId?:string|null};
type Session={authenticated:boolean;user:Identity|null};
type Commercial={plotId:string;status:"available"|"booked"|"sold";
  pricePaise:number|null;revision:number;publicApproved:boolean;evidenceRef:string};
type CommercialState={mappingReleaseId:string|null;rows:Commercial[];
  plotCount?:number;plotIds?:string[];notice?:string;publicationMode?:string;
  counts?:{available:number;booked:number;sold:number;unreviewed:number}};
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
type Panel="overview"|"plots"|"pricing"|"deals"|"contact"|"gallery"|"sales"|"notices";
const nameOfRole=(value:string)=>value==="client_admin"?"Client Admin":
  value==="approver"?"Approver":value==="editor"?"Editor":"Viewer";

function PasswordRevealField({name,value,update,completion}:{name:string;value:string;update:(text:string)=>void;completion:string}){
  const [visible,setVisible]=useState(false);
  return <span className="engine-client-admin-field engine-client-admin-password-field">
    <input aria-label={name} type={visible?"text":"password"} autoComplete={completion}
      value={value} required minLength={8} maxLength={128} onChange={e=>update(e.target.value)}/>
    <button type="button" className="engine-client-admin-reveal"
      aria-label={(visible?"Hide ":"Show ")+name} title={(visible?"Hide ":"Show ")+name}
      aria-pressed={visible} onClick={()=>setVisible(v=>!v)}>
      {visible?<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8"/>
        <path d="M9.9 5.3A10.7 10.7 0 0 1 12 5c5.1 0 8.8 4.5 10 7-0.4 0.8-1.3 2.1-2.7 3.3M6.5 6.5C4.3 7.9 2.8 10.2 2 12c1.3 2.5 5 7 10 7 1.2 0 2.3-0.2 3.4-0.6"/>
      </svg>:<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>
      </svg>}
    </button>
  </span>;
}

function BuilderAdminBrand({projectName}:{projectName:string}){
  return <div className="engine-client-builder-brand">
    <span className="engine-client-builder-symbol" role="img" aria-label="Construction crane">🏗️</span>
    <h1>Builder Admin</h1>
    <p>Project: <strong>{projectName}</strong></p>
  </div>;
}

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
  const [projectKind,setProjectKind]=useState("");
  const [showPassword,setShowPassword]=useState(false);
  const [overview,setOverview]=useState<Overview|null>(null);
  const [commercial,setCommercial]=useState<CommercialState|null>(null);
  const [masterplan,setMasterplan]=useState<MasterplanInventory|null>(null);
  const [contact,setContact]=useState<ContactState|null>(null);
  const [panel,setPanel]=useState<Panel>("overview");
  const [showLivePreview,setShowLivePreview]=useState(false);
  const [plotSearch,setPlotSearch]=useState("");
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
    if(scopedSlug)void api<{projectName:string;projectKind?:string}>(
      "/projects/"+encodeURIComponent(scopedSlug)+"/login-meta")
      .then(v=>{
        setProjectTitle(v.projectName);
        setProjectKind(v.projectKind||"");
      })
      .catch(()=>setProjectTitle("Project"));

    void load().catch(e=>setError(e instanceof Error?e.message:"Client session unavailable."));
  },[scopedSlug]);
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
  if(identity?.role==="client_admin"){if(!masterplanGeo&&kind!=="building")availablePanels.push("gallery","sales","notices");availablePanels.push("contact");}
  const mappingCount=masterplanGeo?masterplan?.plotCount||0:commercial?.plotCount||0;
  const countFor=(kind:"available"|"booked"|"sold")=>
    (commercial?.rows||[]).filter(x=>x.status===kind).length;
  const statusCounts=masterplanGeo?{
    available:masterplan?.counts.available||0,
    booked:masterplan?.counts.booked||0,
    sold:masterplan?.counts.confirmed||0,
    unreviewed:0
  }:{
    available:commercial?.counts?.available??countFor("available"),
    booked:commercial?.counts?.booked??countFor("booked"),
    sold:commercial?.counts?.sold??countFor("sold"),
    unreviewed:commercial?.counts?.unreviewed??Math.max(0,mappingCount-(commercial?.rows.filter(x=>x.revision>0).length||0))
  };
  const customerSite=identity?"https://ar3dstudio.in/3Dprojects/"+
    encodeURIComponent(identity.projectSlug)+
    (masterplanGeo?"/masterplan":kind==="building"?"":"/geo"):"";
  const filteredMasterplan=(masterplan?.plots||[]).filter(row=>
    row.id.toLowerCase().includes(plotSearch.trim().toLowerCase()));
  const projectLabel=identity?.projectName||projectTitle||"Project";
  const authGate=!identity||Boolean(identity.mustChangePassword);
  const backProjectHref=scopedSlug?"/3Dprojects/"+encodeURIComponent(scopedSlug)+
    (projectKind==="masterplan_geo"?"/masterplan":projectKind==="building"?"":"/geo"):
    "/3Dprojects";

  return <main className={"engine-client-admin"+(authGate?" engine-client-admin-auth":"")}>
    {!authGate&&<header className="engine-client-admin-head">
      <div className="engine-client-admin-brand">
        <span className="engine-client-admin-mark" aria-hidden="true">
          <i/><i/><i/><i/>
        </span>
        <div>
          <small>AR3D STUDIO · CLIENT ADMIN</small>
          <h1>{projectLabel}</h1>
          {!authGate&&<p>Private workspace · {nameOfRole(identity!.role)}</p>}
        </div>
      </div>
      {identity&&<div className="engine-client-admin-head-actions">
        <a href={customerSite} target="_blank" rel="noopener noreferrer">View customer site</a>
        <button type="button" disabled={busy} onClick={()=>void logout()}>Sign out</button>
      </div>}
    </header>}
    {error&&<p className="engine-manage-error" role="alert">{error}</p>}
    {message&&<p className="engine-manage-ok" role="status">{message}</p>}
    {!identity?<section className="engine-client-admin-signin" aria-label="Builder Admin sign in">
      <BuilderAdminBrand projectName={projectLabel}/>
      {!invite&&!scopedSlug?<p role="status" className="engine-client-admin-auth-help">
        Open your project's Client Admin link, or use an invitation.
      </p>:!invite?<form className="engine-client-admin-login-form" onSubmit={e=>{
        e.preventDefault();void passwordLogin();
      }}>
        <label>Mobile / Email
          <span className="engine-client-admin-field">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <rect x="5" y="2.7" width="14" height="18.6" rx="3"/>
              <path d="M10 17.5h4"/>
            </svg>
            <input aria-label="Mobile Number or Email ID" autoFocus autoComplete="username"
              value={loginId} maxLength={254} required placeholder="Mobile number or email"
              onChange={e=>setLoginId(e.target.value)}/>
          </span>
        </label>
        <label>Password
          <span className="engine-client-admin-field engine-client-admin-password-field">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4.5" y="10.5" width="15" height="10.5" rx="2.6"/>
              <path d="M8.2 10.5V7a3.8 3.8 0 0 1 7.6 0v3.5"/>
            </svg>
            <input aria-label="Password" type={showPassword?"text":"password"}
              autoComplete="current-password" value={password} maxLength={128} required
              placeholder="Enter password" onChange={e=>setPassword(e.target.value)}/>
            <button type="button" className="engine-client-admin-reveal"
              aria-label={showPassword?"Hide password":"Show password"}
              aria-pressed={showPassword} title={showPassword?"Hide password":"Show password"}
              onClick={()=>setShowPassword(v=>!v)}>
              {showPassword?
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8"/>
                  <path d="M9.9 5.3A10.7 10.7 0 0 1 12 5c5.1 0 8.8 4.5 10 7-0.4 0.8-1.3 2.1-2.7 3.3M6.5 6.5C4.3 7.9 2.8 10.2 2 12c1.3 2.5 5 7 10 7 1.2 0 2.3-0.2 3.4-0.6"/>
                </svg>:
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>}
            </button>
          </span>
        </label>
        <button className="engine-client-admin-submit" type="submit"
          disabled={busy||!loginId.trim()||!password}>
          <span>{busy?"Signing in…":"Sign in"}</span>
          {!busy&&<svg aria-hidden="true" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14m-6-6 6 6-6 6"/>
          </svg>}
        </button>
        {scopedSlug&&<a className="engine-client-admin-back-project"
          href={backProjectHref}>← Back to Project</a>}
      </form>:
        <form className="engine-client-admin-login-form" onSubmit={e=>{
          e.preventDefault();void login();
        }}>
          <label>Invited email
            <span className="engine-client-admin-field">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="5" width="18" height="14" rx="2.5"/>
                <path d="m4.2 7 7.8 5.6L19.8 7"/>
              </svg>
              <input type="email" autoComplete="email" value={email}
                aria-label="Invited email address" maxLength={254} required
                placeholder="Email address" onChange={e=>setEmail(e.target.value)}/>
            </span>
          </label>
          <button className="engine-client-admin-submit" type="submit"
            disabled={busy||!email.trim()}>
            {busy?"Verifying…":"Activate project access"}
          </button>
          <button className="engine-client-admin-text-action" type="button"
            onClick={()=>setInvite("")}>Use ID and password instead</button>
          {scopedSlug&&<a className="engine-client-admin-back-project"
            href={backProjectHref}>← Back to Project</a>}
        </form>}
    </section>:identity.mustChangePassword?<section className="engine-client-admin-signin"
      aria-labelledby="client-change-heading">
      <BuilderAdminBrand projectName={projectLabel}/>
      <h2 id="client-change-heading" className="engine-client-admin-change-title">Change Temporary Password</h2>
      <p className="engine-client-admin-auth-help">8+ characters · letters and numbers</p>
      <form className="engine-client-admin-login-form" onSubmit={e=>{
        e.preventDefault();void changePassword();
      }}>
        <label>Current password
          <PasswordRevealField name="Current password" value={oldPassword} update={setOldPassword} completion="current-password"/>
        </label>
        <label>New password
          <PasswordRevealField name="New password" value={newPassword} update={setNewPassword} completion="new-password"/>
        </label>
        <label>Confirm password
          <PasswordRevealField name="Confirm password" value={confirmPassword} update={setConfirmPassword} completion="new-password"/>
        </label>
        {confirmPassword&&newPassword!==confirmPassword&&
          <p role="alert">Passwords don't match.</p>}
        <button className="engine-client-admin-submit" type="submit"
          disabled={busy||newPassword.length<8||
            !/[A-Za-z]/.test(newPassword)||!/[0-9]/.test(newPassword)||
            !oldPassword||newPassword!==confirmPassword}>
          {busy?"Updating…":"Change password"}
        </button>
      </form>
      {scopedSlug&&<a className="engine-client-admin-back-project"
        href={backProjectHref}>← Back to Project</a>}
    </section>:<>
      <div className="engine-client-admin-workspace">
      <aside className="engine-client-admin-sidebar">
        <div className="engine-client-admin-sidebar-brand"><strong>Builder Admin</strong><small>{projectLabel}</small></div>
      <nav className="engine-client-admin-tabs" aria-label="Client admin sections">
        {availablePanels.map(item=><button key={item} type="button"
          aria-current={panel===item?"page":undefined} className={panel===item?"is-active":""}
          onClick={()=>setPanel(item)}>{item==="overview"?"Overview":
          item==="plots"?"Plot Management":item==="pricing"?"Pricing":item==="contact"?"Contact":
          item==="gallery"?"Gallery":item==="sales"?"Sales & Accounts":item==="notices"?"Plot Updates":"Deal Progress"}</button>)}
      </nav>
      <p className="engine-client-admin-sidebar-hint">Project-scoped management · Your maps and releases are protected</p>
      </aside><div className="engine-client-admin-main">
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
        </section>
        <div className="engine-client-admin-grid">
          <section className="engine-client-admin-card">
            <h2>Project masterplan / Geo preview</h2>
            <p>View the actual published customer site, without changing mapping.</p>
            <div className="engine-client-admin-actions">
              <button type="button" onClick={()=>setShowLivePreview(v=>!v)}>
                {showLivePreview?"Hide live preview":"Show live preview"}</button>
              <a href={customerSite} target="_blank" rel="noopener noreferrer">Open customer site</a>
            </div>
            {showLivePreview&&<iframe className="engine-client-admin-live-preview"
              title={projectLabel+" live project preview"} src={customerSite} loading="lazy"/>}
          </section>
          <section className="engine-client-admin-card">
            <h2>Quick actions</h2>
            <div className="engine-client-admin-quick">
              <button type="button" onClick={()=>setPanel("plots")}>Manage plot status & booking</button>
              {availablePanels.includes("sales")&&<button type="button" onClick={()=>setPanel("sales")}>Sales & Accounts</button>}
              {availablePanels.includes("gallery")&&<button type="button" onClick={()=>setPanel("gallery")}>Gallery images</button>}
              <button type="button" onClick={()=>setPanel("contact")}>Contact details</button>
              <button type="button" disabled={busy} onClick={()=>void load().catch(e=>setError(String(e)))}>Refresh counts</button>
            </div>
          </section>
        </div>
      </>}

      {panel==="plots"&&(masterplanGeo?
        <section className="engine-client-admin-card">
          <div className="engine-client-admin-card-title">
            <h2>Masterplan Inventory</h2>
            <label className="engine-client-admin-search">Search plot
              <input value={plotSearch} placeholder="Plot number" onChange={e=>setPlotSearch(e.target.value)}/></label>
          </div>
          <div className="engine-client-admin-plot-list">
            {filteredMasterplan.map(row=><div className="engine-client-admin-plot-row" key={row.id}>
              <strong>Plot {row.id}</strong>
              <span>{row.status==="confirmed"?"Confirmed":row.status==="booked"?"Booked":"Available"}</span>
            </div>)}
            {!filteredMasterplan.length&&<p>No matching plot records.</p>}
          </div><p>{masterplan?.notice}</p>
        </section>:
        commercial?<ClientGeoPlotManagement slug={identity.projectSlug} commercial={commercial}
          canEdit={Boolean(overview?.permissions.commercialPrepare)}
          canApprove={Boolean(overview?.permissions.commercialApprove)}
          onCommercialChange={setCommercial}/>:
        <section className="engine-client-admin-card"><p>Loading published Geo plot mapping…</p></section>)}

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
          />
      </section>}

      {panel==="gallery"&&identity&&!masterplanGeo&&<ClientGeoGallery slug={identity.projectSlug}/>}
      {panel==="notices"&&identity&&!masterplanGeo&&<ClientGeoNotices slug={identity.projectSlug}
        plotIds={commercial?.plotIds||[]}/>}
      {panel==="sales"&&identity&&!masterplanGeo&&<ClientGeoSales slug={identity.projectSlug}
        plotIds={commercial?.plotIds||[]}/>}

      {panel==="deals"&&overview?.permissions.dealsRead&&!masterplanGeo&&identity&&
        <section className="engine-client-admin-card">
          <h2>Private deal progress</h2>
          <GeoDealRecordsPanel
            endpoint={ROOT+"/projects/"+encodeURIComponent(identity.projectSlug)+"/deals"}
            mappingReleaseId={commercial?.mappingReleaseId||null}
            plotIds={commercial?.plotIds||[]}
            canEdit={Boolean(overview.permissions.dealsWrite)}/>
        </section>}
      </div></div>
    </>}
  </main>;
}
