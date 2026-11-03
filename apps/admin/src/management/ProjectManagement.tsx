import { useCallback, useEffect, useState } from "react";
import {projectClientAdminUrl} from "../../../../shared/project-client-admin-url.js";
import "./project-management.css";

type Profile = {
  projectNumber:string;ownerName:string;publicContactsEnabled:boolean;
  builderName:string;contactName:string;address:string;phonePrimary:string;phoneSecondary:string;
  whatsapp:string;email:string;websiteUrl:string;mapsUrl:string;brochureUrl:string;
};
type ManagedClient = {id:string;displayName:string;email:string;phone:string;proposedRole:string;
  accessState:"not_provisioned"|"disabled";notes:string;createdAt:string;updatedAt:string;
  grantActive?:boolean;grantedRole?:string;grantEpoch?:number;
  credentialLoginId?:string|null;credentialLoginType?:string|null;passwordActive?:number;mustChangePassword?:number};
type ManagedState = {project:{id:string;name:string;slug:string;projectKind:string;status:string;location:string};
  profile:{revision:number;values:Profile};clients:ManagedClient[];clientLoginEnabled:boolean;
  invitation?:{clientId:string;role:string;expiresAt:number;inviteUrl:string};
  credential?:{clientId:string;loginId:string;loginType:string;password:string;mustChangePassword:boolean}};
type Tab = "profile"|"clients";
const fields:Array<{key:Exclude<keyof Profile,"publicContactsEnabled">;name:string;hint?:string}>= [
  {key:"projectNumber",name:"Project reference / registration number"},
  {key:"ownerName",name:"Project Owner name"},
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
  const [projectName,setProjectName]=useState("");const [projectLocation,setProjectLocation]=useState("");
  const [editingClient,setEditingClient]=useState<ManagedClient|null>(null);
  const [profile,setProfile]=useState<Profile|null>(null);
  const [name,setName]=useState("");const [email,setEmail]=useState("");
  const [phone,setPhone]=useState("");const [role,setRole]=useState("client_admin");
  const [loginType,setLoginType]=useState<"mobile"|"email">("mobile");
  const [notes,setNotes]=useState("");
  const [error,setError]=useState("");const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  const [invitation,setInvitation]=useState<ManagedState["invitation"]|null>(null);
  const [credential,setCredential]=useState<ManagedState["credential"]|null>(null);
  useEffect(()=>{
    if(!credential)return;
    const timer=setTimeout(()=>setCredential(null),5*60*1000);
    return()=>clearTimeout(timer);
  },[credential]);
  const load=useCallback(async()=>{
    if(!slug){setState(null);setProfile(null);return;}
    const next=await request<ManagedState>(endpoint);
    setState(next);setProfile(next.profile.values);
    setProjectName(next.project.name);setProjectLocation(next.project.location||"");
  },[endpoint,slug]);
  useEffect(()=>{let live=true;void load().catch(e=>{if(live)setError(String(e));});
    return()=>{live=false;};},[load]);
  async function perform(method:string,body:object){
    setBusy(true);setError("");setMessage("");
    try{const next=await request<ManagedState>(endpoint,method,body);
      setState(next);setProfile(next.profile.values);
      if(next.invitation)setInvitation(next.invitation);
      if(next.credential)setCredential(next.credential);
      setMessage(next.credential?"Client Admin ID and temporary password created. Copy them securely; the password is shown only once.":
        next.invitation?"Client invitation created. Share the secret privately; it is shown only once.":"Saved and verified from Engine database.");
      return true;
    }catch(e){setError(e instanceof Error?e.message:"Operation failed.");return false;}
    finally{setBusy(false);}
  }
  async function saveProjectMetadata(){
    if(!state||!projectName.trim()||busy)return;
    setBusy(true);setError("");setMessage("");
    try{
      const next=await request<{name:string;location?:string}>(
        `/3Dprojects/api/cloud/projects/${encodeURIComponent(slug)}`,"PATCH",
        {action:"metadata",name:projectName.trim(),location:projectLocation.trim()});
      setState(current=>current?{...current,project:{...current.project,name:next.name,location:next.location||""}}:current);
      setProjectName(next.name);setProjectLocation(next.location||"");
      setMessage("Project name and location updated. Its stable link and published releases were kept.");
    }catch(e){setError(e instanceof Error?e.message:"Project update failed.");}
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
        <h2>Project Identity</h2>
        <p>Edit the existing project without changing its permanent ID, slug, mapped polygons or published versions.</p>
        <form onSubmit={e=>{e.preventDefault();void saveProjectMetadata();}}>
          <div className="engine-manage-grid">
            <label>Project Name<input required maxLength={200} value={projectName}
              disabled={busy||state?.project.status==="archived"}
              onChange={e=>setProjectName(e.target.value)}/></label>
            <label>Project Location<input maxLength={180} value={projectLocation}
              disabled={busy||state?.project.status==="archived"}
              onChange={e=>setProjectLocation(e.target.value)}/></label>
          </div>
          <div className="engine-manage-actions">
            <span>Permanent URL slug: {state?.project.slug||slug}</span>
            <button type="submit" disabled={busy||!projectName.trim()||state?.project.status==="archived"}>Update Project Name</button>
          </div>
        </form>
      </section>
      <section className="engine-manage-card">
        <h2>Canonical Project Contact Profile</h2>
        <p>Manage source-backed contact information for this Engine project. This workspace does not silently change an immutable customer release.</p>
        {profile?<form onSubmit={e=>{e.preventDefault();void perform("PUT",{
          expectedRevision:state?.profile.revision||0,profile
        });}}>
          <div className="engine-manage-grid">{fields.map(field=><label key={field.key}>{field.name}
            <input disabled={busy||state?.project.status==="archived"} value={profile[field.key]}
              maxLength={field.key==="address"?600:field.key.endsWith("Url")?1000:
                field.key==="projectNumber"?80:field.key==="ownerName"?160:
                field.key==="email"?254:field.key==="contactName"?160:
                ["phonePrimary","phoneSecondary","whatsapp"].includes(field.key)?25:200}
              type={field.key==="email"?"email":field.key.endsWith("Url")?"url":
                ["phonePrimary","phoneSecondary","whatsapp"].includes(field.key)?"tel":"text"}
              placeholder={field.hint||""}
              onChange={e=>setProfile(p=>p?{...p,[field.key]:e.target.value}:p)}/></label>)}</div>
          <label className="engine-manage-public-contact-optin">
            <input type="checkbox" checked={profile.publicContactsEnabled}
              disabled={busy||state?.project.status==="archived"}
              onChange={e=>setProfile(p=>p?{...p,publicContactsEnabled:e.target.checked}:p)}/>
            Show approved Project Owner, Builder, address, Call, WhatsApp and Maps on the public Geo customer site
          </label>
          <p>OFF by default for privacy. Only the owner can enable it; private client directory,
            commercial evidence and buyer/payment data are never made public.</p>
          <div className="engine-manage-actions"><span>Revision {state?.profile.revision||0} · Owner controlled</span>
            <button disabled={busy||state?.project.status==="archived"} type="submit">{busy?"Saving…":"Save / Update Profile"}</button></div>
        </form>:<p>Loading contact details…</p>}
      </section>
    </>:<>
      <section className="engine-manage-card">
        <h2>Project Client Directory</h2>
        <div className="engine-manage-client-admin-link">
          <span>Private Client Admin for this project</span>
          <a href={projectClientAdminUrl(slug)} target="_blank" rel="noopener noreferrer">Open Client Admin</a>
          <button type="button" onClick={()=>void navigator.clipboard.writeText(projectClientAdminUrl(slug))}>
            Copy Client Admin URL
          </button>
        </div>
        <p><strong>AR3D Platform-style Client Admin:</strong> enter the client's name, mobile
          number and email. Creating a Client Admin automatically generates a personal login ID
          and temporary password for this project. First sign-in requires a password change.</p>
        <p>Other Viewer/Editor/Approver roles can continue using scoped invitations.
          Client Admin access can be reset or revoked here. Mapping, Geo releases and
          owner-only financial controls stay restricted.</p>
        {credential&&<section className="engine-manage-card engine-manage-credential" role="status">
          <h3>Client Admin credentials — copy now</h3>
          <p>Project: <strong>{state?.project.name}</strong> · Password changes on first login.
            The temporary password cannot be recovered after closing this card.</p>
          <label>Client Login ID<input readOnly aria-label="New Client Admin Login ID"
            value={credential.loginId} onFocus={e=>e.currentTarget.select()}/></label>
          <label>Temporary Password<input readOnly aria-label="Temporary Client Admin Password"
            value={credential.password} onFocus={e=>e.currentTarget.select()}/></label>
          <label>Personal Client Admin URL<input readOnly value={projectClientAdminUrl(slug)}
            aria-label="Personal AR3D Client Admin URL" onFocus={e=>e.currentTarget.select()}/></label>
          <div className="engine-manage-actions">
            <button type="button" onClick={()=>void navigator.clipboard.writeText(
              "AR3D Client Admin\n"+projectClientAdminUrl(slug)+"\nLogin ID: "+credential.loginId+
              "\nTemporary Password: "+credential.password)}>
              Copy Login Details</button>
            <button type="button" onClick={()=>setCredential(null)}>Hide Credentials</button>
          </div>
        </section>}
        {invitation&&<div className="engine-manage-card" role="status">
          <strong>One-time private invitation — copy now</strong>
          <p>Expires {new Date(invitation.expiresAt).toLocaleString()} · {invitation.role}.
            This bearer link is delivered out of band after identity verification by the owner.
            It is NOT sent by email automatically.</p>
          <input readOnly value={invitation.inviteUrl} aria-label="One-time project client invitation link"
            onFocus={e=>e.currentTarget.select()}/>
          <div className="engine-manage-actions">
            <button type="button" onClick={()=>void navigator.clipboard.writeText(invitation.inviteUrl)}>
              Copy one-time invitation</button>
            <button type="button" onClick={()=>setInvitation(null)}>Hide this secret</button>
          </div>
        </div>}
        <form onSubmit={e=>{e.preventDefault();void perform("POST",{
          action:"create-client",displayName:name,email,phone,proposedRole:role,loginType,notes
        }).then(saved=>{if(saved){setName("");setEmail("");setPhone("");setNotes("");}});}}>
          <div className="engine-manage-grid">
            <label>Client / Staff name<input required value={name} maxLength={160} onChange={e=>setName(e.target.value)}/></label>
            <label>Email<input type="email" value={email} maxLength={254} onChange={e=>setEmail(e.target.value)}/></label>
            <label>Mobile Number<input type="tel" value={phone} maxLength={25} onChange={e=>setPhone(e.target.value)}/></label>
            <label>Proposed role<select value={role} onChange={e=>setRole(e.target.value)}>
              {["viewer","editor","approver","client_admin"].map(v=><option key={v} value={v}>{v}</option>)}
            </select></label>
            {role==="client_admin"&&<label>Login ID Type
              <select value={loginType} onChange={e=>setLoginType(e.target.value as "mobile"|"email")}>
                <option value="mobile">Mobile number</option>
                <option value="email">Email</option>
              </select></label>}
            <label>Notes<input value={notes} maxLength={500} onChange={e=>setNotes(e.target.value)}/></label>
          </div>
          <div className="engine-manage-actions">
            <span>{role==="client_admin"?"Secure ID and password generated automatically":"Invitation required for non-admin roles"}</span>
            <button disabled={busy||!name.trim()||
              !(role==="client_admin"?(loginType==="mobile"?phone:email):(email||phone))||
              state?.project.status==="archived"}>
              {role==="client_admin"?"Create Client Admin & Login":"Add Client Record"}
            </button>
          </div>
        </form>
      </section>
      {editingClient&&<section className="engine-manage-card">
        <h2>Edit Client — {editingClient.displayName}</h2>
        <p>Changing a login mobile/email signs out old sessions. Changing the role revokes existing access until a new invitation or password is issued.</p>
        <form onSubmit={e=>{e.preventDefault();
          if(editingClient.proposedRole!==state?.clients.find(c=>c.id===editingClient.id)?.proposedRole&&
            !confirm("Changing role will revoke existing login and invitations. Continue?"))return;
          void perform("PATCH",{action:"update-client",id:editingClient.id,
            expectedUpdatedAt:editingClient.updatedAt,displayName:editingClient.displayName,
            email:editingClient.email,phone:editingClient.phone,
            proposedRole:editingClient.proposedRole,notes:editingClient.notes
          }).then(ok=>{if(ok)setEditingClient(null);});
        }}>
          <div className="engine-manage-grid">
            <label>Client Name<input required maxLength={160} value={editingClient.displayName}
              onChange={e=>setEditingClient(v=>v?{...v,displayName:e.target.value}:v)}/></label>
            <label>Email<input type="email" maxLength={254} value={editingClient.email}
              onChange={e=>setEditingClient(v=>v?{...v,email:e.target.value}:v)}/></label>
            <label>Mobile<input type="tel" maxLength={25} value={editingClient.phone}
              onChange={e=>setEditingClient(v=>v?{...v,phone:e.target.value}:v)}/></label>
            <label>Role<select value={editingClient.proposedRole}
              onChange={e=>setEditingClient(v=>v?{...v,proposedRole:e.target.value}:v)}>
              {["viewer","editor","approver","client_admin"].map(v=><option key={v} value={v}>{v}</option>)}
            </select></label>
            <label>Notes<input maxLength={500} value={editingClient.notes}
              onChange={e=>setEditingClient(v=>v?{...v,notes:e.target.value}:v)}/></label>
          </div>
          <div className="engine-manage-actions">
            <button type="button" onClick={()=>setEditingClient(null)}>Cancel</button>
            <button type="submit" disabled={busy||!editingClient.displayName.trim()||
              !(editingClient.email||editingClient.phone)}>Save Client Changes</button>
          </div>
        </form>
      </section>}
      <section className="engine-manage-card"><h2>Clients ({state?.clients.length||0})</h2>
        <div className="engine-manage-client-list">
          {state?.clients.map(client=><div key={client.id}>
            <div><strong>{client.displayName}</strong><small>{client.email||client.phone} · proposed {client.proposedRole}</small>
              <small>{client.accessState==="disabled"?"Revoked / disabled":
                client.grantActive?"Active grant · "+client.grantedRole+" · epoch "+client.grantEpoch:
                "Not invited · no access"}</small>
              {client.credentialLoginId&&<small>Login ID: {client.credentialLoginId} ·
                {client.mustChangePassword?" Temporary password pending change":" Password active"}</small>}
            </div>
            <div className="engine-manage-actions">
              <button type="button" disabled={busy||state?.project.status==="archived"}
                onClick={()=>setEditingClient({...client})}>Edit Client</button>
              {client.accessState==="disabled"&&<button type="button" disabled={busy}
                onClick={()=>{if(confirm("Re-enable this client record? Old credentials stay inactive until you issue new access."))
                  void perform("PATCH",{action:"enable-client",id:client.id});}}>Enable Record</button>}
            </div>
            {client.accessState==="not_provisioned"&&<div className="engine-manage-actions">
              {client.proposedRole==="client_admin"&&<button type="button"
                disabled={busy||(!client.email&&!client.phone)}
                onClick={()=>{
                  if(confirm("Generate "+(client.credentialLoginId?"a NEW":"a")+" temporary Client Admin password for "+
                    client.displayName+"? Previous sessions and passwords will be revoked."))
                    void perform("POST",{action:client.credentialLoginId?
                      "reset-client-password":"provision-client-password",id:client.id,
                      loginType:client.credentialLoginType||(client.phone?"mobile":"email")});
                }}>{client.credentialLoginId?"Reset Client Password":"Create Client Login"}</button>}
              {client.proposedRole!=="client_admin"&&<button disabled={busy||!client.email} onClick={()=>{
                if(confirm("Grant "+client.proposedRole+" access ONLY to this project for "+client.displayName+
                  "? A 24h one-time invite will be generated. Confirm identity before sharing."))
                  void perform("POST",{action:"grant-client-access",id:client.id,role:client.proposedRole});
              }}>{client.grantActive?"Rotate invite / revoke previous sessions":"Issue scoped invitation"}</button>}
              <button disabled={busy} onClick={()=>{
                if(confirm("Permanently revoke ALL sessions and invitations for "+client.displayName+
                   " in this project?"))
                  void perform("PATCH",{action:"revoke-client-access",id:client.id});
              }}>Revoke access</button>
            </div>}
          </div>)}
          {!state?.clients.length&&<p>No client records yet.</p>}
        </div>
      </section>
    </>}
  </main>;
}
