import {useEffect,useState} from "react";
import "./project-management.css";
type Domain={hostname:string;status:"pending"|"active"|"disabled";verifiedAt:string|null;website:string;admin:string};
type Data={fallbackWebsite:string;fallbackAdmin:string;domains:Domain[];notice?:string};
export default function ProjectDomains(){
 const slug=new URLSearchParams(window.location.search).get("project")||"";
 const endpoint="/3Dprojects/api/cloud/projects/"+encodeURIComponent(slug)+"/domains";
 const [data,setData]=useState<Data|null>(null);
 const [hostname,setHostname]=useState("");
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
 useEffect(()=>{let live=true;if(!slug)return;
  void fetch(endpoint,{cache:"no-store"}).then(async r=>{
    const d=await r.json() as Data&{error?:string};
    if(!r.ok)throw Error(d.error||"Domain settings unavailable.");
    if(live)setData(d);
  }).catch(e=>{if(live)setError(String(e));});
  return()=>{live=false;};
 },[endpoint,slug]);
 async function apply(method:"POST"|"DELETE",host:string,action?:string){
  setBusy(true);setError("");setMessage("");
  try{
   const r=await fetch(endpoint,{method,headers:{"Content-Type":"application/json"},
     body:JSON.stringify({action,hostname:host})});
   const d=await r.json() as Data&{error?:string};
   if(!r.ok)throw Error(d.error||"Domain operation failed.");
   setData(d);setHostname("");setMessage(d.notice||"Domain settings saved.");
  }catch(e){setError(e instanceof Error?e.message:"Domain operation failed.");}
  finally{setBusy(false);}
 }
 return <main className="engine-manage">
  <header><p className="eyebrow">OPTIONAL · CUSTOMER SETUP</p><h1>Customer Domains</h1>
   <p>Most projects need no custom domain. Default AR3D links always remain available.</p></header>
  {error&&<p role="alert" className="engine-manage-error">{error}</p>}
  {message&&<p role="status" className="engine-manage-ok">{message}</p>}
  {!slug?<p>Choose a project first.</p>:<>
   <section className="engine-manage-card">
    <h2>Standard AR3D Links</h2>
    <p>Website: <a href={data?.fallbackWebsite} target="_blank" rel="noreferrer">{data?.fallbackWebsite||"Loading…"}</a></p>
    <p>Client Admin: <a href={data?.fallbackAdmin} target="_blank" rel="noreferrer">{data?.fallbackAdmin||"Loading…"}</a></p>
   </section>
   <section className="engine-manage-card">
    <h2>Add Custom Domain Only When Needed</h2>
    <p>Register the client's hostname. It remains Pending until Cloudflare routes it to <strong>rekixo-3d-public</strong>, DNS and SSL are ready, and Verify succeeds.</p>
    <form onSubmit={e=>{e.preventDefault();void apply("POST",hostname.trim().toLowerCase(),"add");}}>
     <div className="engine-manage-grid"><label>Customer hostname
      <input maxLength={253} required disabled={busy} placeholder="example.com (without https://)" value={hostname}
       onChange={e=>setHostname(e.target.value)}/></label></div>
     <div className="engine-manage-actions">
      <span>Website: / · Client Admin: /admin</span>
      <button type="submit" disabled={!data||busy||!hostname.trim()}>Register Domain</button>
     </div>
    </form>
   </section>
   <section className="engine-manage-card">
    <h2>Registered Domains</h2>
    {data?.domains.map(d=><div className="engine-manage-card" key={d.hostname}>
     <div className="engine-manage-actions"><strong>{d.hostname}</strong><span>{d.status.toUpperCase()}</span></div>
     <p>{d.website} · {d.admin}</p>
     {d.status==="pending"&&<p>Finish Cloudflare Custom Domain attachment, DNS and SSL before verification.</p>}
     <div className="engine-manage-actions">
      {d.status==="pending"&&<button disabled={busy} onClick={()=>void apply("POST",d.hostname,"verify")}>Verify & Activate</button>}
      {d.status==="active"&&<a href={d.website} target="_blank" rel="noreferrer">Open Website</a>}
      {d.status!=="disabled"&&<button disabled={busy} onClick={()=>{
       if(confirm("Disable this domain? Standard links remain available. Remove its Cloudflare attachment separately."))
        void apply("DELETE",d.hostname);
      }}>Disable</button>}
     </div>
    </div>)}
    {data&&!data.domains.length&&<p>No custom domains. Standard AR3D links are ready.</p>}
   </section>
  </>}
 </main>;
}
