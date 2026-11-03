import {useEffect,useState} from "react";
const API="/3Dprojects/api/client-portal/projects/";
const endpoint=(slug:string,section:string)=>API+encodeURIComponent(slug)+"/"+section;
async function request<T>(url:string,method="GET",body?:object):Promise<T>{
 const res=await fetch(url,{method,credentials:"same-origin",cache:"no-store",
  headers:{"Accept":"application/json",...(body?{"Content-Type":"application/json"}:{})},
  ...(body?{body:JSON.stringify(body)}:{})});
 const data=await res.json() as T&{error?:string};
 if(!res.ok)throw Error(data.error||"Request failed");return data;
}
type GalleryImage={id:string;caption:string;mime:string;sizeBytes:number;createdAt:string};
export function ClientGeoGallery({slug}:{slug:string}){
 const [items,setItems]=useState<GalleryImage[]>([]),[file,setFile]=useState<File|null>(null);
 const [caption,setCaption]=useState(""),[busy,setBusy]=useState(false);
 const [error,setError]=useState(""),[message,setMessage]=useState("");
 const url=endpoint(slug,"gallery");
 const reload=async()=>setItems((await request<{images:GalleryImage[]}>(url)).images);
 useEffect(()=>{let live=true;void request<{images:GalleryImage[]}>(url)
   .then(r=>{if(live)setItems(r.images)}).catch(e=>{if(live)setError(String(e))});
   return()=>{live=false};},[url]);
 async function upload(){
  if(!file||file.size>8388608)return;
  setBusy(true);setError("");setMessage("");
  try{
   const data=new FormData();data.append("file",file);data.append("caption",caption);
   const response=await fetch(url,{method:"POST",credentials:"same-origin",body:data});
   const body=await response.json() as {error?:string};
   if(!response.ok)throw Error(body.error||"Upload failed");
   setFile(null);setCaption("");await reload();setMessage("Image uploaded privately.");
  }catch(e){setError(e instanceof Error?e.message:"Upload failed.");}
  finally{setBusy(false);}
 }
 async function remove(id:string){
  if(!window.confirm("Delete this project image?"))return;
  setBusy(true);setError("");
  try{await request(url,"DELETE",{id});await reload();setMessage("Image deleted.");}
  catch(e){setError(e instanceof Error?e.message:"Delete failed.");}finally{setBusy(false);}
 }
 return <section className="engine-client-admin-card client-geo-gallery">
  <header><h2>Gallery Manager</h2><p>{items.length}/10 images · JPG, PNG, WebP · up to 8 MB each</p></header>
  {error&&<p role="alert" className="engine-manage-error">{error}</p>}
  {message&&<p role="status" className="engine-manage-ok">{message}</p>}
  <div className="client-geo-upload">
   <label>Choose image<input aria-label="Upload gallery image" type="file" accept="image/jpeg,image/png,image/webp"
    onChange={e=>setFile(e.target.files?.[0]||null)}/></label>
   <label>Caption<input value={caption} maxLength={160} onChange={e=>setCaption(e.target.value)}/></label>
   <button type="button" disabled={busy||!file||file.size>8388608||items.length>=10} onClick={()=>void upload()}>
    {busy?"Uploading…":"Upload image"}</button>
  </div>
  <div className="client-geo-gallery-grid">
   {items.map(item=><article key={item.id}>
    <img src={endpoint(slug,"gallery-image")+"?id="+encodeURIComponent(item.id)} alt={item.caption||"Project gallery image"} loading="lazy"/>
    <div><strong>{item.caption||"Project image"}</strong>
     <small>{(item.sizeBytes/1048576).toFixed(2)} MB</small></div>
    <button type="button" disabled={busy} onClick={()=>void remove(item.id)}>Delete</button>
   </article>)}
   {!items.length&&<p>No images uploaded yet.</p>}
  </div>
  <p className="client-geo-info">Images remain private to this Client Admin until a separate public-gallery approval is implemented.</p>
 </section>;
}
type Notice={id:string;plotId:string;title:string;body:string;state:"draft"|"published";revision:number;updatedAt:string};
export function ClientGeoNotices({slug,plotIds}:{slug:string;plotIds:string[]}){
 const [items,setItems]=useState<Notice[]>([]),[busy,setBusy]=useState(false);
 const [error,setError]=useState(""),[message,setMessage]=useState("");
 const [editing,setEditing]=useState<Notice|null>(null);
 const [plotId,setPlotId]=useState(""),[title,setTitle]=useState(""),[body,setBody]=useState("");
 const url=endpoint(slug,"notices");
 const reload=async()=>setItems((await request<{notices:Notice[]}>(url)).notices);
 useEffect(()=>{let live=true;void request<{notices:Notice[]}>(url)
   .then(r=>{if(live)setItems(r.notices)}).catch(e=>{if(live)setError(String(e))});
   return()=>{live=false};},[url]);
 function reset(){setEditing(null);setPlotId("");setTitle("");setBody("");}
 function pick(n:Notice){setEditing(n);setPlotId(n.plotId);setTitle(n.title);setBody(n.body);}
 async function save(state:"draft"|"published"){
  if(!plotId||!title.trim()||!body.trim())return;
  if(state==="published"&&!window.confirm("Publish this notice for public visitors?"))return;
  setBusy(true);setError("");setMessage("");
  try{
   await request(url,editing?"PUT":"POST",{id:editing?.id,plotId,title,body,
     state,expectedRevision:editing?.revision||0});
   await reload();reset();setMessage(state==="published"?"Plot notice published.":"Plot notice saved as draft.");
  }catch(e){setError(e instanceof Error?e.message:"Notice save failed.");}
  finally{setBusy(false);}
 }
 async function remove(n:Notice){
  if(n.state!=="draft"||!window.confirm("Delete this draft?"))return;
  setBusy(true);setError("");try{await request(url,"DELETE",{id:n.id,expectedRevision:n.revision});
   await reload();reset();}catch(e){setError(String(e))}finally{setBusy(false);}
 }
 return <section className="engine-client-admin-card client-geo-notices">
  <h2>Plot Updates</h2><p>Draft, review and publish an update for a mapped plot.</p>
  {error&&<p className="engine-manage-error" role="alert">{error}</p>}
  {message&&<p className="engine-manage-ok" role="status">{message}</p>}
  <div className="client-geo-editor-grid">
   <label>Plot ID<select value={plotId} onChange={e=>setPlotId(e.target.value)}>
    <option value="">Select plot</option>{plotIds.map(id=><option key={id} value={id}>{id}</option>)}
   </select></label>
   <label>Update title<input value={title} maxLength={120} onChange={e=>setTitle(e.target.value)}/></label>
   <label className="client-geo-wide">Update details<textarea rows={3} maxLength={1200} value={body}
    onChange={e=>setBody(e.target.value)}/></label>
  </div>
  <div className="engine-client-admin-actions">
   <button type="button" disabled={busy||!plotId||!title.trim()||!body.trim()} onClick={()=>void save("draft")}>Save draft</button>
   <button type="button" disabled={busy||!plotId||!title.trim()||!body.trim()} onClick={()=>void save("published")}>Publish update</button>
   <button type="button" onClick={reset}>Clear</button>
  </div>
  <div className="client-geo-notice-list">
   {items.map(n=><article key={n.id}>
    <div><b>Plot {n.plotId} · {n.title}</b><span>{n.state.toUpperCase()}</span><p>{n.body}</p></div>
    <button type="button" disabled={busy} onClick={()=>pick(n)}>Edit</button>
    {n.state==="draft"&&<button type="button" disabled={busy} onClick={()=>void remove(n)}>Delete</button>}
   </article>)}
   {!items.length&&<p>No plot updates yet.</p>}
  </div>
 </section>;
}
