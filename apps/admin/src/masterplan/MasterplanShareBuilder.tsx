import {useEffect,useState} from "react";
import {uploadAsset,listAssets,type CloudAssetSummary} from "../studio/cloud";
import type {Asset} from "../studio/domain";
import "../management/project-management.css";
type Version={id:string;version:number};
type ShareState={draft:{revision:number;title:string;description:string;cardAssetId:string|null};
  active:{id:string;version:number;revision:number;title:string;description:string;cardAssetId:string}|null;
  history:Version[];shareUrl:string};
async function call<T>(url:string,method="GET",body?:object):Promise<T>{
  const r=await fetch(url,{cache:"no-store",method,headers:{"Accept":"application/json",...(body?{"Content-Type":"application/json"}:{})},
    ...(body?{body:JSON.stringify(body)}:{})});
  const result=await r.json() as T&{error?:string};
  if(!r.ok)throw Error(result.error||"Share Builder request failed.");
  return result;
}
async function optimizePoster(file:File){
  if(!["image/jpeg","image/png","image/webp"].includes(file.type)||file.size>8*1024*1024)
    throw Error("Choose PNG/JPEG/WebP image under 8 MB.");
  const bitmap=await createImageBitmap(file);
  try{
    const ratio=Math.min(1,1200/Math.max(bitmap.width,bitmap.height));
    const canvas=document.createElement("canvas");
    canvas.width=Math.max(1,Math.round(bitmap.width*ratio));
    canvas.height=Math.max(1,Math.round(bitmap.height*ratio));
    const ctx=canvas.getContext("2d");if(!ctx)throw Error("Image processing unavailable.");
    ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
    for(const quality of [.84,.76,.68,.58,.48]){
      const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,"image/jpeg",quality));
      if(blob&&blob.size<=550*1024){
        const preview=new File([blob],"geo-masterplan-share.jpg",{type:"image/jpeg"});
        const bytes=new Uint8Array(await crypto.subtle.digest("SHA-256",await preview.arrayBuffer()));
        return {file:preview,sha:Array.from(bytes,n=>n.toString(16).padStart(2,"0")).join("")};
      }
    }
    throw Error("This image cannot be optimized below 550 KB. Choose a simpler image.");
  }finally{bitmap.close();}
}
export default function MasterplanShareBuilder(){
  const slug=new URLSearchParams(window.location.search).get("project")||"";
  const endpoint=`/3Dprojects/api/cloud/projects/${encodeURIComponent(slug)}/masterplan-share`;
  const [state,setState]=useState<ShareState|null>(null);
  const [assets,setAssets]=useState<CloudAssetSummary[]>([]);
  const [title,setTitle]=useState("");const [description,setDescription]=useState("");
  const [cardId,setCardId]=useState("");
  const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");const [error,setError]=useState("");
  async function reload(){
    if(!slug)return;
    const [s,a]=await Promise.all([call<ShareState>(endpoint),listAssets(slug)]);
    setState(s);setAssets(a.assets);
    setTitle(s.draft.title);setDescription(s.draft.description);
    setCardId(s.draft.cardAssetId||"");
  }
  useEffect(()=>{let valid=true;void (async()=>{
    try{if(slug)await reload();}catch(e){if(valid)setError(String(e));}
  })();return()=>{valid=false;};},[slug]);
  async function exec(method:string,body:object){
    setBusy(true);setError("");setMessage("");
    try{
      const next=await call<ShareState>(endpoint,method,body);
      setState(next);setTitle(next.draft.title);setDescription(next.draft.description);
      setCardId(next.draft.cardAssetId||"");setMessage("Share Builder saved and checked against Engine database.");
      return true;
    }catch(e){setError(e instanceof Error?e.message:"Share operation failed.");return false;}
    finally{setBusy(false);}
  }
  async function upload(file:File){
    setBusy(true);setError("");setMessage("");
    try{
      const optimized=await optimizePoster(file);
      const asset:Asset={id:crypto.randomUUID(),projectId:slug,name:optimized.file.name,
        size:optimized.file.size,type:optimized.file.type,hash:optimized.sha,blob:optimized.file};
      const next=await uploadAsset(slug,asset,"reference");
      setCardId(next.asset.id);setAssets(a=>[...a,next.asset]);
      setMessage("Poster optimized and uploaded. Save Draft then Publish Share.");
    }catch(e){setError(e instanceof Error?e.message:"Poster upload failed.");}
    finally{setBusy(false);}
  }
  const source=assets.find(a=>a.id===cardId);
  const live=assets.find(a=>a.id===state?.active?.cardAssetId);
  return <main className="engine-manage">
    <header><p className="eyebrow">MASTERPLAN GEO · SHARE BUILDER</p>
      <h1>WhatsApp & Social Preview</h1>
      <p>One independent share image and metadata version for a published image masterplan; Building and 3D Geo posters are unchanged.</p></header>
    {error&&<p role="alert" className="engine-manage-error">{error}</p>}
    {message&&<p role="status" className="engine-manage-ok">{message}</p>}
    {!slug?<p>Select a project first.</p>:<section className="engine-manage-card">
      <h2>Draft Share Preview</h2>
      <div className="engine-manage-grid">
        <label>Share Title<input value={title} maxLength={120} onChange={e=>setTitle(e.target.value)}/></label>
        <label>Share Description<input value={description} maxLength={280} onChange={e=>setDescription(e.target.value)}/></label>
        <label>Share Poster (PNG/JPEG/WebP)
          <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy}
            onChange={e=>{const file=e.target.files?.[0];e.target.value="";if(file)void upload(file);}}/></label>
      </div>
      {source&&<div style={{maxWidth:490,marginTop:14}}>
        <img src={source.contentUrl+"?preview=1"} alt="Draft share preview" style={{maxWidth:"100%",borderRadius:10}}/></div>}
      <div className="engine-manage-actions"><span>Draft revision {state?.draft.revision||0} · 550 KB share image limit</span>
        <button disabled={busy||!cardId||title.trim().length<3||description.trim().length<10}
          onClick={()=>void exec("PUT",{expectedRevision:state?.draft.revision||0,title,description,cardAssetId:cardId})}>
          Save Share Draft</button>
        <button disabled={busy||!state?.draft.cardAssetId||state?.active?.revision===state?.draft.revision||state?.draft.title!==title||state?.draft.description!==description||
            state?.draft.cardAssetId!==cardId}
          onClick={()=>void exec("POST",{action:"publish",expectedRevision:state?.draft.revision||0})}>
          {state?.active?.revision===state?.draft.revision?"Published · Current Draft":"Publish WhatsApp Preview"}</button>
      </div>
      <h2>Published Preview</h2>
      {state?.active?<><p>Live Share v{state.active.version}</p>
        {live&&<img src={live.contentUrl+"?preview=1"} alt="Published share poster" style={{maxWidth:"min(100%,490px)"}}/>}
        <button onClick={()=>{void navigator.clipboard.writeText(state.shareUrl).then(()=>setMessage("Link copied."));}}>
          Copy Published Link</button></>:<p>No published share preview yet. Published Geo Masterplan is required first.</p>}
      <h2>Share Release History</h2>
      {state?.history.map(v=><button key={v.id} disabled={busy||state.active?.id===v.id}
        onClick={()=>void exec("POST",{action:"activate",releaseId:v.id})}>Activate Share v{v.version}</button>)}
    </section>}
  </main>;
}
