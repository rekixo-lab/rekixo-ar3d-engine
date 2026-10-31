import { useEffect, useMemo, useState } from "react";
import { downloadAsset, listAssets, type CloudAssetSummary } from "../studio/cloud";
import "./project-management.css";
function saveBlob(name:string,blob:Blob){
  const uri=URL.createObjectURL(blob);const a=document.createElement("a");
  a.href=uri;a.download=name;a.click();window.setTimeout(()=>URL.revokeObjectURL(uri),2000);
}
export default function ProjectAssets(){
  const slug=new URLSearchParams(location.search).get("project")||"";
  const [assets,setAssets]=useState<CloudAssetSummary[]>([]);
  const [search,setSearch]=useState("");const [busy,setBusy]=useState("");
  const [error,setError]=useState("");
  useEffect(()=>{let live=true;setError("");
    if(!slug){setAssets([]);return;}
    void listAssets(slug).then(r=>{if(live)setAssets(r.assets);}).catch(e=>{if(live)setError(String(e));});
    return()=>{live=false;};},[slug]);
  const visible=useMemo(()=>assets.filter(a=>[a.name,a.kind,a.sha256].some(v=>v.toLowerCase().includes(search.toLowerCase()))),[assets,search]);
  async function getFile(item:CloudAssetSummary){
    setBusy(item.id);setError("");
    try{
      const value=await downloadAsset(item);
      saveBlob(item.name,value.blob);
    }catch(e){setError(e instanceof Error?e.message:"Source download failed.");}
    finally{setBusy("");}
  }
  const exportManifest=()=>{
    const content={format:"engine-project-asset-manifest-v1",projectSlug:slug,exportedAt:new Date().toISOString(),
      note:"Metadata-only manifest. Files are separate and downloaded only after SHA-256 verification.",
      assets:assets.map(({id,kind,name,mimeType,byteSize,sha256,createdAt,refCount})=>
        ({id,kind,name,mimeType,byteSize,sha256,createdAt,refCount}))};
    saveBlob(slug+"-assets-manifest.json",new Blob([JSON.stringify(content,null,2)],{type:"application/json"}));
  };
  return <main className="engine-manage">
    <header><p className="eyebrow">ENGINE · SOURCE INVENTORY</p>
      <h1>Project Assets</h1>
      <p>Project-scoped original and reviewed source files, with SHA-256 verified downloads.</p></header>
    {!slug?<p>Select a project in Overview first.</p>:<>
      {error&&<p className="engine-manage-error" role="alert">{error}</p>}
      <section className="engine-manage-card">
        <div className="engine-manage-actions">
          <div><h2>{assets.length} Project Assets</h2>
            <p>Cloud source inventory is independent from published Building, Geo and Masterplan releases.</p></div>
          <button disabled={!assets.length} onClick={exportManifest}>Export Asset Manifest</button>
        </div>
        <label>Search assets<input value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="Filename, type or checksum"/></label>
        <div className="engine-manage-client-list">
          {visible.map(a=><div key={a.id}><div><strong>{a.name}</strong>
            <small>{a.kind.toUpperCase()} · {(a.byteSize/(1024*1024)).toFixed(2)} MB · {a.mimeType}</small>
            <small>SHA-256: {a.sha256}</small>
            <small>{a.refCount?"Referenced by project draft":"Not currently referenced by project draft"}</small>
          </div><button disabled={busy!==""} onClick={()=>void getFile(a)}>
            {busy===a.id?"Verifying…":"Verify & Download"}</button></div>)}
          {!visible.length&&<p>No matching asset. Use Source Pack for original 3D uploads or Masterplan workspace for images.</p>}
        </div>
      </section>
    </>}
  </main>;
}
