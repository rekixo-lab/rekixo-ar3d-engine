import {useEffect,useState} from "react";
import {listAssets,uploadAsset,type CloudAssetSummary} from "../studio/cloud";
import {GEO_INVENTORY_HEADERS,parseGeoInventoryCsv,normalizeGeoInventoryRows,
  nextUnmappedInventory,type GeoInventoryRow,type GeoInventoryDiff} from "../../../../shared/geo-plot-inventory.js";

type Snapshot={revision:number;rows:GeoInventoryRow[];updatedBy?:string|null;updatedAt?:string|null};
type Preview=GeoInventoryDiff&{rowCount:number;expectedRevision:number;
  geometryChanged:boolean;publishedDataChanged:boolean;approvalsReset:boolean};
type Props={slug:string;mappedIds:string[];workingId?:string;blocked:boolean;
  onRowsChange:(rows:GeoInventoryRow[])=>void;onStart:(row:GeoInventoryRow)=>void};
const url=(slug:string)=>`/3Dprojects/api/cloud/projects/${encodeURIComponent(slug)}/geo-plots/inventory`;
async function request<T>(path:string,init?:RequestInit):Promise<T>{
  const r=await fetch(path,{cache:"no-store",...init,headers:{"Accept":"application/json",...init?.headers}});
  const content=r.headers.get("content-type")||"";
  if(!content.includes("application/json"))throw Error("Inventory API returned a web page, not JSON.");
  const data=await r.json() as T&{error?:string};
  if(!r.ok)throw Error(data.error||"Inventory request failed ("+r.status+").");
  return data;
}
function downloadTemplate(){
  const csv=GEO_INVENTORY_HEADERS.join(",")+"\n";
  const uri=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
  const link=document.createElement("a");link.href=uri;link.download="geo-plot-inventory-template.csv";link.click();
  window.setTimeout(()=>URL.revokeObjectURL(uri),1000);
}
export default function GeoPlotInventoryPanel({slug,mappedIds,workingId,blocked,onRowsChange,onStart}:Props){
  const [inventory,setInventory]=useState<Snapshot|null>(null);
  const [preview,setPreview]=useState<{rows:GeoInventoryRow[];summary:Preview;name:string}|null>(null);
  const [busy,setBusy]=useState("");
  const [error,setError]=useState("");
  const [success,setSuccess]=useState("");
  const [referenceAssets,setReferenceAssets]=useState<CloudAssetSummary[]>([]);
  const [query,setQuery]=useState("");
  useEffect(()=>{
    let mounted=true;setInventory(null);setPreview(null);setError("");setSuccess("");
    void Promise.all([request<Snapshot>(url(slug)),
      listAssets(slug).catch(()=>({assets:[] as CloudAssetSummary[]}))]).then(([result,assetList])=>{
      if(!mounted)return;
      setInventory(result);onRowsChange(result.rows);
      setReferenceAssets(assetList.assets.filter(a=>a.kind==="reference"&&a.mimeType.startsWith("image/")));
    }).catch(e=>{if(mounted)setError(e instanceof Error?e.message:"Inventory unavailable.");});
    return()=>{mounted=false;};
  },[slug,onRowsChange]);
  const send=(action:"preflight"|"import",rows:GeoInventoryRow[],revision:number)=>
    request<{preview:Preview;inventory?:Snapshot}>(url(slug),{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({action,expectedRevision:revision,rows})
    });
  const chooseFile=async(file:File)=>{
    if(!inventory)throw Error("Inventory must load before importing.");
    if(file.size>2_000_000)throw Error("Inventory CSV must be under 2 MB.");
    setBusy("preview");setError("");setPreview(null);
    try{
      const parsed=normalizeGeoInventoryRows(parseGeoInventoryCsv(await file.text()));
      const result=await send("preflight",parsed,inventory.revision);
      setPreview({rows:parsed,summary:result.preview,name:file.name});
      setSuccess("Preflight completed; nothing has been written or published.");
    }catch(e){setError(e instanceof Error?e.message:"CSV preflight failed.");}
    finally{setBusy("");}
  };
  const importRows=async()=>{
    if(!preview||!inventory||blocked||preview.summary.missing.length)return;
    if(!window.confirm("Import "+preview.rows.length+
      " project-scoped inventory records? Existing published polygons, model and customer data remain unchanged."))return;
    setBusy("import");setError("");
    try{
      const result=await send("import",preview.rows,inventory.revision);
      if(!result.inventory)throw Error("Inventory read-back missing.");
      setInventory(result.inventory);onRowsChange(result.inventory.rows);setPreview(null);
      setSuccess("Plot inventory saved and read back. Mapping and published website unchanged.");
    }catch(e){setError(e instanceof Error?e.message:"Inventory import failed.");}
    finally{setBusy("");}
  };
  const archiveReference=async(file:File)=>{
    if(!["image/jpeg","image/png","image/webp"].includes(file.type)||file.size<100||file.size>16*1024*1024)
      throw Error("Choose an original JPEG, PNG or WebP image between 100 bytes and 16 MB.");
    setBusy("image");setError("");
    try{
      const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",await file.arrayBuffer()));
      const hash=Array.from(digest,n=>n.toString(16).padStart(2,"0")).join("");
      await uploadAsset(slug,{id:crypto.randomUUID(),projectId:slug,name:file.name,
        type:file.type,size:file.size,hash,blob:file},"reference");
      const assets=await listAssets(slug);
      setReferenceAssets(assets.assets.filter(a=>a.kind==="reference"&&a.mimeType.startsWith("image/")));
      setSuccess("Original image archived as a private reference only. It has NOT replaced, aligned or published the live 3D model.");
    }catch(e){setError(e instanceof Error?e.message:"Original reference upload failed.");}
    finally{setBusy("");}
  };
  const rows=inventory?.rows||[];
  const taken=new Set(mappedIds.map(x=>x.toLowerCase()));
  const pending=nextUnmappedInventory(rows,mappedIds,workingId);
  const filtered=rows.filter(p=>p.id.toLowerCase().includes(query.toLowerCase()));
  return <details className="geo-plot-inventory-first">
    <summary>01 · Plot Inventory & original sources
      <small> · {rows.length} IDs / {rows.filter(p=>!taken.has(p.id.toLowerCase())).length} pending</small>
    </summary>
    <div className="geo-plot-inventory-first-body">
      <p className="geo-plot-hint">Upload approved Plot Data <strong>before</strong> mapping. Imported data remains unverified draft metadata. No published polygon, sale or Building/Geo release is changed.</p>
      {error&&<p className="geo-plot-inventory-error" role="alert">{error}</p>}
      {success&&<p className="geo-plot-inventory-success" role="status">{success}</p>}
      <div className="geo-plot-inventory-summary">
        <span><b>{rows.length}</b> inventory</span>
        <span><b>{rows.filter(p=>taken.has(p.id.toLowerCase())).length}</b> mapped</span>
        <span><b>{rows.filter(p=>!taken.has(p.id.toLowerCase())).length}</b> pending</span>
      </div>
      <button type="button" onClick={downloadTemplate}>Download Plot CSV Template</button>
      <label className="geo-plot-import">Import Plot Inventory CSV
        <input type="file" accept=".csv,text/csv" disabled={!inventory||!!busy}
          onChange={e=>{const file=e.target.files?.[0];e.target.value="";
            if(file)void chooseFile(file);}}/>
      </label>
      {preview&&<div className="geo-plot-inventory-preview">
        <strong>Review: {preview.name}</strong>
        <p>{preview.summary.rowCount} records · {preview.summary.added.length} added ·
          {" "+preview.summary.changed.length} updated · {preview.summary.mappedChanged.length} already-mapped metadata rows for review</p>
        {preview.summary.missing.length>0&&<p className="geo-plot-inventory-error">Existing IDs absent from CSV: {preview.summary.missing.slice(0,12).join(", ")}. Re-import with every existing ID.</p>}
        <button type="button" className="geo-plot-action-primary"
          disabled={!!busy||blocked||preview.summary.missing.length>0}
          onClick={()=>void importRows()}>Confirm Inventory Import (draft only)</button>
      </div>}
      {pending&&<button type="button" className="geo-plot-action-primary"
        disabled={blocked||!!busy} onClick={()=>onStart(pending)}>Start Next Unmapped: {pending.id}</button>}
      {rows.length>0&&<>
        <label>Find inventory plot<input type="search" value={query}
          onChange={e=>setQuery(e.target.value)} placeholder="Plot number"/></label>
        <div className="geo-plot-inventory-list" aria-label="CSV-first plot inventory">
          {filtered.slice(0,120).map(p=>{
            const mapped=taken.has(p.id.toLowerCase());
            return <button type="button" key={p.id} disabled={mapped||blocked||!!busy}
              onClick={()=>onStart(p)} title={mapped?"Already mapped. Use the mapped plot editor to modify it.":"Start precise 4-corner mapping"}>
              <strong>{p.id}</strong><small>{mapped?"Mapped":"Needs polygon"}</small>
            </button>;
          })}
        </div>
        {filtered.length>120&&<p className="geo-plot-hint">Showing the first 120 matches; narrow the search for a specific plot.</p>}
      </>}
      <div className="geo-plot-reference-source">
        <strong>Original masterplan reference (private archive)</strong>
        <p className="geo-plot-hint">Upload the approved JPG/PNG/WebP for this existing Geo project. Upload is archival only—not an aligned mapping surface. 3D coordinates stay on the existing verified Building model.</p>
        <label className="geo-plot-import">Archive original reference image
          <input type="file" accept="image/jpeg,image/png,image/webp" disabled={!!busy}
            onChange={e=>{const file=e.target.files?.[0];e.target.value="";
              if(file)void archiveReference(file);}}/>
        </label>
        <small>{referenceAssets.length} private reference image(s) archived · see Project Assets for verified downloads</small>
      </div>
    </div>
  </details>;
}
