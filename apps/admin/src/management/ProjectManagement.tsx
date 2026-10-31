import { useCallback, useEffect, useState } from "react";
import "./project-management.css";

type Profile = {
  builderName:string;contactName:string;address:string;phonePrimary:string;phoneSecondary:string;
  whatsapp:string;email:string;websiteUrl:string;mapsUrl:string;brochureUrl:string;
};
type ManagedClient = {id:string;displayName:string;email:string;phone:string;proposedRole:string;
  accessState:"not_provisioned"|"disabled";notes:string;createdAt:string};
type ManagedState = {project:{id:string;name:string;slug:string;projectKind:string;status:string};
  profile:{revision:number;values:Profile};clients:ManagedClient[];clientLoginEnabled:false};
type Tab = "profile"|"clients";
const fields:Array<{key:keyof Profile;name:string;hint?:string}>= [
  {key:"builderName",name:"Developer / Builder name"},
  {key:"contactName",name:"Primary contact person"},
  {key:"address",name:"Project full address"},
  {key:"phonePrimary",name:"Main mobile / phone"},
  {key:"phoneSecondary",name:"Secondary phone"},
  {key:"whatsapp",name:"WhatsApp contact"},
  {key:"email",name:"Contact email"},
  {key:"websiteUrl",name:"Company / project website",hint:"https://"},
  {key:"mapsUrl",name:"Exact Google Maps link",hint:"https://maps.app.goo.gl/..."},
  {key:"brochureUrl",name:"Brochure link",hint:"https://"}
];
async function request<T>(url:string,method="GET",body?:object):Promise<T>{
  const response=await fetch(url,{method,cache:"no-store",headers:{
    "Accept":"application/json",...(body?{"Content-Type":"application/json"}:{})},
    ...(body?{body:JSON.stringify(body)}:{})});
  const value=await response.json() as T&{error?:string};
  if(!response.ok)throw Error(value.error||"Project management request failed.");
  return value;
}
export default function ProjectManagement({section}:{section:Tab}){
  const slug=new URLSearchParams(location.search).get("project")||"";
  const endpoint=`/3Dprojects/api/cloud/projects/${encodeURIComponent(slug)}/manage`;
  const [state,setState]=useState<ManagedState|null>(null);
  const [profile,setProfile]=useState<Profile|null>(null);
  const [name,setName]=useState("");const [email,setEmail]=useState("");
  const [phone,setPhone]=useState("");const [role,setRole]=useState("viewer");
  const [notes,setNotes]=useState("");
  const [error,setError]=useState("");const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  const load=useCallback(async()=>{
    if(!slug){setState(null);setProfile(null);return;}
    const next=await request<ManagedState>(endpoint);
    setState(next);setProfile(next.profile.values);
  },[endpoint,slug]);
  useEffect(()=>{let live=true;void load().catch(e=>{if(live)setError(String(e));});
    return()=>{live=false;};},[load]);
  async function perform(method:string,body:object){
    setBusy(true);setError("");setMessage("");
    try{const next=await request<ManagedState>(endpoint,method,body);
      setState(next);setProfile(next.profile.values);setMessage("Saved and verified from Engine database.");
    }catch(e){setError(e instanceof Error?e.message:"Operation failed.");}
    finally{setBusy(false);}
  }
  if(!slug)return <section className="engine-manage"><h2>Select a project from Overview first</h2></section>;
  return <main className="engine-manage">
    <header><p className="eyebrow">ENGINE · PROJECT ADMINISTRATION</p>
      <h1>{section==="profile"?"Project Profile":"Clients & Roles"}</h1>
      <p>{state?.project.name||slug} · {state?.project.projectKind||"Loading…"}</p></header>
    {error&&<p role="alert" className="engine-manage-error">{error}</p>}
    {message&&<p role="status" className="engine-manage-ok">{message}</p>}
    {section==="profile" ? <>
      <section className="engine-manage-card">
        <h2>Canonical Project Contact Profile</h2>
        <p>Manage source-backed contact information for this Engine project. This workspace does not silently change an immutable customer release.</p>
        {profile?<form onSubmit={e=>{e.preventDefault();void perform("PUT",{
          expectedRevision:state?.profile.revision||0,profile
        });}}>
          <div className="engine-manage-grid">{fields.map(field=><label key={field.key}>{field.name}
            <input disabled={busy||state?.project.status==="archived"} value={profile[field.key]}
              maxLength={field.key==="address"?600:field.key.toLowerCase().includes("url")?1000:field.key==="email"?254:200}
              placeholder={field.hint||""}
              onChange={e=>setProfile(p=>p?{...p,[field.key]:e.target.value}:p)}/></label>)}</div>
          <div className="engine-manage-actions"><span>Revision {state?.profile.revision||0} · Owner controlled</span>
            <button disabled={busy||state?.project.status==="archived"} type="submit">{busy?"Saving…":"Save Project Profile"}</button></div>
        </form>:<p>Loading contact details…</p>}
      </section>
    </>:<>
      <section className="engine-manage-card">
        <h2>Project Client Directory</h2>
        <p>Names, contacts and intended roles are stored per project. <strong>Client logins are not yet provisioned.</strong>
          Creating a record never grants access to customer data or financial records.</p>
        <form onSubmit={e=>{e.preventDefault();void perform("POST",{
          action:"create-client",displayName:name,email,phone,proposedRole:role,notes
        }).then(()=>{setName("");setEmail("");setPhone("");setNotes("");});}}>
          <div className="engine-manage-grid">
            <label>Client / Staff name<input required value={name} maxLength={160} onChange={e=>setName(e.target.value)}/></label>
            <label>Email<input type="email" value={email} maxLength={254} onChange={e=>setEmail(e.target.value)}/></label>
            <label>Phone<input value={phone} maxLength={25} onChange={e=>setPhone(e.target.value)}/></label>
            <label>Proposed role<select value={role} onChange={e=>setRole(e.target.value)}>
              {["viewer","editor","approver","client_admin"].map(v=><option key={v} value={v}>{v}</option>)}
            </select></label>
            <label>Notes<input value={notes} maxLength={500} onChange={e=>setNotes(e.target.value)}/></label>
          </div>
          <div className="engine-manage-actions"><span>No login or password is created</span>
            <button disabled={busy||!name.trim()||(!email&&!phone)||state?.project.status==="archived"}>Add Client Record</button></div>
        </form>
      </section>
      <section className="engine-manage-card"><h2>Clients ({state?.clients.length||0})</h2>
        <div className="engine-manage-client-list">
          {state?.clients.map(client=><div key={client.id}>
            <div><strong>{client.displayName}</strong><small>{client.email||client.phone} · proposed {client.proposedRole}</small>
              <small>{client.accessState==="disabled"?"Disabled":"Not provisioned · No access"}</small></div>
            {client.accessState==="not_provisioned"&&<button disabled={busy} onClick={()=>{
              if(confirm("Disable directory record for "+client.displayName+"?"))
                void perform("PATCH",{action:"disable-client",id:client.id});
            }}>Disable</button>}
          </div>)}
          {!state?.clients.length&&<p>No client records yet.</p>}
        </div>
      </section>
    </>}
  </main>;
}
