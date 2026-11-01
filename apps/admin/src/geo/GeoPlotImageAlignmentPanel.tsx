import {useCallback,useEffect,useMemo,useState,type PointerEvent} from "react";
import {downloadAsset,listAssets,type CloudAssetSummary} from "../studio/cloud";
import {evaluateImageModelAlignment,modelPointToImage,imagePointToModel,
  type ImageModelAlignmentDraft,type AlignmentPoint,type SimilarityTransform} from "../../../../shared/geo-plot-image-alignment.js";
import "./geo-plot-image-alignment.css";

type Point=[number,number];
type Snapshot={revision:number;verifiedRevision:number|null;stale:boolean;
  modelSha256:string;draft:ImageModelAlignmentDraft|null};
type Props={slug:string;geoReleaseId:string|null;buildingReleaseId:string|null;
  plots:Array<{id:string;corners:Point[]}>;onCapture:(done:(point:Point)=>void)=>void;
  onRevisionChange:(revision:number)=>void;editable:boolean;
  onStageImageCorner:(id:string,index:number,uv:Point,transform:SimilarityTransform,
    alignmentRevision:number)=>{ok:boolean;reason?:string}};
const url=(slug:string)=>"/3Dprojects/api/cloud/projects/"+encodeURIComponent(slug)+"/geo-plots/alignment";
async function api<T>(path:string,init?:RequestInit):Promise<T>{
  const r=await fetch(path,{cache:"no-store",...init,headers:{
    Accept:"application/json",...init?.headers
  }});
  if(!(r.headers.get("content-type")||"").includes("application/json"))
    throw Error("Image alignment API returned a web page instead of JSON.");
  const data=await r.json() as T&{error?:string};
  if(!r.ok)throw Error(data.error||"Alignment request failed ("+r.status+").");
  return data;
}
function exportReview(slug:string,snapshot:Snapshot,draft:ImageModelAlignmentDraft){
  const content=JSON.stringify({format:"geo-image-alignment-review-v1",slug,
    createdAt:new Date().toISOString(),savedRevision:snapshot.revision,
    savedVerifiedRevision:snapshot.verifiedRevision,draft},null,2);
  const address=URL.createObjectURL(new Blob([content],{type:"application/json;charset=utf-8"}));
  const link=document.createElement("a");link.href=address;
  link.download=slug+"-image-alignment-review.json";link.click();
  window.setTimeout(()=>URL.revokeObjectURL(address),2000);
}
export default function GeoPlotImageAlignmentPanel({
  slug,geoReleaseId,buildingReleaseId,plots,onCapture,onRevisionChange,
  onStageImageCorner,editable
}:Props){
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
  const [draft,setDraft]=useState<ImageModelAlignmentDraft|null>(null);
  const [assets,setAssets]=useState<CloudAssetSummary[]>([]);
  const [imageUrl,setImageUrl]=useState("");
  const [actualImage,setActualImage]=useState<{width:number;height:number}|null>(null);
  const [pending,setPending]=useState<Point|null>(null);
  const [evidence,setEvidence]=useState("");
  const [dirty,setDirty]=useState(false);
  const [busy,setBusy]=useState("");
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const [showOverlay,setShowOverlay]=useState(true);
  const [open,setOpen]=useState(false);
  const [imageEditMode,setImageEditMode]=useState(false);
  const [expanded,setExpanded]=useState(false);
  const [imagePlotId,setImagePlotId]=useState("");
  const [imageCornerIndex,setImageCornerIndex]=useState(0);
  const [pendingEdit,setPendingEdit]=useState<Point|null>(null);
  const sources=useMemo(()=>assets.filter(a=>a.kind==="reference"&&
    ["image/jpeg","image/png","image/webp"].includes(a.mimeType)),[assets]);
  const selected=useMemo(()=>sources.find(a=>a.id===draft?.imageAssetId),[sources,draft?.imageAssetId]);
  const load=useCallback(async()=>{
    const [state,assetList]=await Promise.all([
      api<Snapshot>(url(slug)),listAssets(slug)
    ]);
    setSnapshot(state);setDraft(state.draft);setAssets(assetList.assets);
    setDirty(false);setPending(null);setPendingEdit(null);setImageEditMode(false);
    setExpanded(false);setMessage("");setError("");
  },[slug]);
  useEffect(()=>{
    let valid=true;
    void load().catch(err=>{if(valid)setError(String(err));});
    return()=>{valid=false;};
  },[load]);
  useEffect(()=>{
    let valid=true;let currentUrl="";
    setImageUrl("");setActualImage(null);
    if(!selected)return;
    void downloadAsset(selected).then(asset=>{
      if(!valid)return;
      currentUrl=URL.createObjectURL(asset.blob);
      setImageUrl(currentUrl);
    }).catch(err=>{if(valid)setError("Original image checksum verification failed: "+String(err));});
    return()=>{valid=false;if(currentUrl)URL.revokeObjectURL(currentUrl);};
  },[selected?.id,selected?.sha256]);
  const dimensionalDraft=useMemo(()=>draft&&actualImage?
    {...draft,imageWidth:actualImage.width,imageHeight:actualImage.height}:draft,
    [draft,actualImage]);
  const dimensionMismatch=Boolean(draft&&actualImage&&
    (draft.imageWidth!==actualImage.width||draft.imageHeight!==actualImage.height));
  const assessed=useMemo(()=>{
    if(!dimensionalDraft||dimensionalDraft.anchors.length<3)
      return {result:null,error:"Add three non-collinear fit anchors."};
    try{return {result:evaluateImageModelAlignment(dimensionalDraft),error:""};}
    catch(err){return {result:null,error:err instanceof Error?err.message:String(err)};}
  },[dimensionalDraft]);
  const isVerified=Boolean(snapshot&&snapshot.revision>0&&
    snapshot.verifiedRevision===snapshot.revision&&!snapshot.stale&&!dirty&&!dimensionMismatch&&
    assessed.result?.verifiedReady);
  const stale=Boolean(snapshot?.stale||draft&&(
    draft.geoReleaseId!==geoReleaseId||draft.buildingReleaseId!==buildingReleaseId||
    draft.modelSha256!==snapshot?.modelSha256));
  const canStageImage=Boolean(isVerified&&!stale&&editable&&actualImage&&imageUrl&&
    assessed.result?.verifiedReady&&plots.length);
  const imagePlot=plots.find(p=>p.id===imagePlotId)||null;
  const newModelCorner=useMemo(()=>pendingEdit&&assessed.result?
    imagePointToModel(assessed.result.transform,pendingEdit):null,
    [pendingEdit,assessed.result]);
  const reload=async()=>{
    if(dirty&&!window.confirm("Discard unapplied image alignment point edits and reload saved revision?"))return;
    setBusy("reload");try{await load();}catch(err){setError(String(err));}
    finally{setBusy("");}
  };
  const selectSource=(id:string)=>{
    if(!snapshot||!geoReleaseId||!buildingReleaseId)return;
    const asset=sources.find(a=>a.id===id);
    if(!asset)return;
    const old=draft;
    const switched=Boolean(old&&(old.imageAssetId!==asset.id||
      old.imageSha256!==asset.sha256.toLowerCase()||old.geoReleaseId!==geoReleaseId||
      old.buildingReleaseId!==buildingReleaseId||old.modelSha256!==snapshot.modelSha256));
    if(switched&&old){
      if(!window.confirm("Switch original image? The image alignment draft points will be cleared. "+
        "The CURRENT review JSON will be downloaded first. Published plot data will remain unchanged."))return;
      exportReview(slug,snapshot,old);
    }
    if(!old||switched){
      // Keep already checksum-verified dimensions when rebinding the SAME image.
      // Clearing them here would deadlock Save without a new image load event.
      if(!old||old.imageAssetId!==asset.id||old.imageSha256!==asset.sha256.toLowerCase())
        setActualImage(null);
      setDraft({imageAssetId:asset.id,imageSha256:asset.sha256.toLowerCase(),
        imageWidth:0,imageHeight:0,
        geoReleaseId,buildingReleaseId,modelSha256:snapshot.modelSha256,
        anchors:[],checkpoints:[]});
      setDirty(true);setPending(null);setMessage("New original image selected. Pair fresh points and Save before Verify.");
    }
  };
  const markImage=(ev:PointerEvent<SVGSVGElement>)=>{
    if(!draft||!imageUrl||busy)return;
    const rect=ev.currentTarget.getBoundingClientRect();
    if(!rect.width||!rect.height)return;
    const u=(ev.clientX-rect.left)/rect.width,v=(ev.clientY-rect.top)/rect.height;
    if(u<0||u>1||v<0||v>1)return;
    const pixel:Point=[Number(u.toFixed(7)),Number(v.toFixed(7))];
    if(imageEditMode){if(canStageImage)setPendingEdit(pixel);}
    else setPending(pixel);
  };
  const stageImageCorner=()=>{
    if(!canStageImage||!imagePlot||!pendingEdit||!snapshot||!assessed.result||
       imageCornerIndex<0||imageCornerIndex>=imagePlot.corners.length)return;
    const result=onStageImageCorner(imagePlot.id,imageCornerIndex,pendingEdit,
      assessed.result.transform,snapshot.revision);
    if(!result.ok){setError(result.reason||"Image corner edit was not staged.");return;}
    setPendingEdit(null);setError("");
    setMessage("Unverified image corner correction staged in the SAME canonical 3D draft. Recheck in 3D, Save, Verify and explicitly Publish.");
  };
  const capture=(kind:"anchors"|"checkpoints")=>{
    if(!draft||!pending||!evidence.trim())return;
    const point=pending,evidenceText=evidence.trim(),type=kind;
    onCapture(model=>{
      setDraft(previous=>{
        if(!previous)return previous;
        const all=[...previous.anchors,...previous.checkpoints];
        let count=1;while(all.some(p=>p.id===((type==="anchors"?"F":"C")+count)))count++;
        const record:AlignmentPoint={id:(type==="anchors"?"F":"C")+count,
          u:point[0],v:point[1],x:model[0],z:model[1],evidence:evidenceText};
        return {...previous,[type]:[...previous[type],record]};
      });
      setPending(null);setDirty(true);
      setMessage("3D model X/Z captured. Save and use independent withheld checkpoints before verification.");
    });
    setMessage("Click the corresponding site location on the 3D masterplan canvas to pair this image point.");
  };
  const drop=(kind:"anchors"|"checkpoints",id:string)=>{
    setDraft(old=>old?{...old,[kind]:old[kind].filter(p=>p.id!==id)}:old);setDirty(true);
  };
  const save=async()=>{
    if(!snapshot||!dimensionalDraft||!selected||!actualImage||busy)return;
    setBusy("save");setError("");
    try{
      const switched=Boolean(snapshot.draft&&(
        snapshot.draft.imageAssetId!==dimensionalDraft.imageAssetId||
        snapshot.draft.imageSha256!==dimensionalDraft.imageSha256||
        snapshot.draft.geoReleaseId!==dimensionalDraft.geoReleaseId||
        snapshot.draft.buildingReleaseId!==dimensionalDraft.buildingReleaseId||
        snapshot.draft.modelSha256!==dimensionalDraft.modelSha256));
      const next=await api<Snapshot>(url(slug),{
        method:"PUT",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({expectedRevision:snapshot.revision,draft:dimensionalDraft,confirmSourceChange:switched})
      });
      setSnapshot(next);setDraft(next.draft);setDirty(false);
      onRevisionChange(next.revision);
      setMessage("Private image/model alignment draft saved. No published plot geometry changed.");
    }catch(err){setError(err instanceof Error?err.message:String(err));}
    finally{setBusy("");}
  };
  const verify=async()=>{
    if(!snapshot||dirty||dimensionMismatch||!draft||!assessed.result?.verifiedReady||stale||busy)return;
    setBusy("verify");setError("");
    try{
      const next=await api<Snapshot>(url(slug),{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({action:"verify",expectedRevision:snapshot.revision})
      });
      setSnapshot(next);setDraft(next.draft);
      setMessage("Independent image↔model checkpoints verified server-side. Existing published mapping remains unchanged.");
    }catch(err){setError(err instanceof Error?err.message:String(err));}
    finally{setBusy("");}
  };
  const projected=useMemo(()=>{
    if(!assessed.result||!showOverlay||!isVerified)return [];
    return plots.map(plot=>({id:plot.id,uv:plot.corners.map(point=>
      modelPointToImage(assessed.result!.transform,point))}));
  },[plots,assessed.result,showOverlay,isVerified]);
  const canEdit=Boolean(geoReleaseId&&buildingReleaseId&&snapshot);
  return <details className={"geo-align-panel"+(expanded?" geo-align-panel--expanded":"")}
    open={open} onToggle={event=>{
      const next=event.currentTarget.open;setOpen(next);
      if(!next){setExpanded(false);setImageEditMode(false);setPendingEdit(null);}
    }}>
    <summary>02 · Original image ↔ verified 3D alignment
      <small> · {isVerified?"independent QA passed":snapshot?.draft?"needs review":"not set"}</small>
    </summary>
    <div className="geo-align-body">
      <p className="geo-plot-hint">Private, project-scoped calibration. Image U/V is 0–1;
        3D points remain immutable Building-local X/Z metres. No model, plot, sale or live release is changed.</p>
      {error&&<p className="geo-plot-warning" role="alert">{error}</p>}
      {message&&<p className="geo-plot-message" role="status">{message}</p>}
      {stale&&<p className="geo-plot-warning">A source or Geo/Building release changed.
        Select the same approved image again to rebind safely, or select a new image.
        A review JSON is downloaded before old fit points are cleared. Save an empty
        source-pinned revision before pairing new points.</p>}
      <div className="geo-align-actions">
        <button type="button" disabled={!!busy} onClick={()=>void reload()}>Reload Sources / Draft</button>
        {snapshot?.stale&&draft&&selected&&<button type="button" disabled={!!busy}
          onClick={()=>selectSource(draft.imageAssetId)}>Rebind same approved image to current 3D release</button>}
        {snapshot&&draft&&<button type="button" onClick={()=>exportReview(slug,snapshot,draft)}>
          Download Private Review JSON</button>}
      </div>
      <label>Approved original reference image
        <select value={draft?.imageAssetId||""} disabled={!canEdit||!!busy}
          onChange={e=>selectSource(e.target.value)}>
          <option value="">Choose uploaded original image</option>
          {sources.map(a=><option key={a.id} value={a.id}>{a.name} · {a.sha256.slice(0,10)}</option>)}
        </select>
      </label>
      {!sources.length&&<p className="geo-plot-hint">First archive the original masterplan PNG/JPG/WebP in the Plot Inventory section, then Reload Sources.</p>}
      {selected&&<p className="geo-align-checksum">Image SHA-256: {selected.sha256.slice(0,20)}…
        Model SHA-256: {snapshot?.modelSha256.slice(0,20)}…</p>}
      {draft&&<div className="geo-align-edit-controls">
        <strong>Image / 3D Unified Plot Corner Editor</strong>
        <p className="geo-plot-hint">Only independently verified original image alignment may reposition a mapped Plot ID.
          Canonical coordinates always remain Building-local X/Z. Each edited corner will revoke area,
          side, road/front, north and plane approvals, and nothing publishes automatically.</p>
        <div className="geo-align-actions">
          <button type="button" disabled={!imageEditMode&&!canStageImage}
            onClick={()=>{
              if(imageEditMode){setImageEditMode(false);setExpanded(false);setPendingEdit(null);return;}
              if(!window.confirm("Open original-image mapping mode? Only independently verified image sources are allowed. Edited geometry will remain unpublished and unverified."))return;
              setImageEditMode(true);setShowOverlay(true);setExpanded(true);setPendingEdit(null);
              setImagePlotId(plots[0]?.id||"");setImageCornerIndex(0);setPending(null);
            }}>{imageEditMode?"Exit Image Plot Editor":"Edit Existing Plot Corners on Verified Image"}</button>
          {imageEditMode&&<button type="button" onClick={()=>setExpanded(s=>!s)}>
            {expanded?"Compact Image Workspace":"Expand Image Workspace"}</button>}
        </div>
        {imageEditMode&&<>
          <div className="geo-align-edit-selectors">
            <label>Canonical mapped Plot ID
              <select value={imagePlotId} disabled={!canStageImage}
                onChange={e=>{setImagePlotId(e.target.value);setImageCornerIndex(0);setPendingEdit(null);}}>
                {plots.map(p=><option key={p.id} value={p.id}>Plot {p.id}</option>)}
              </select>
            </label>
            <label>Corner to reposition on original image
              <select value={imageCornerIndex} disabled={!canStageImage||!imagePlot}
                onChange={e=>{setImageCornerIndex(Number(e.target.value));setPendingEdit(null);}}>
                {imagePlot?.corners.map((_,i)=><option key={i} value={i}>Corner {i+1}</option>)}
              </select>
            </label>
          </div>
          <p className="geo-plot-hint">Click the new source-image position for the chosen corner.
            Gold ring = selected original corner; red ring = proposed location. You must confirm staging.</p>
          {pendingEdit&&newModelCorner&&<p>Proposed U {pendingEdit[0].toFixed(6)},
            V {pendingEdit[1].toFixed(6)} → model X {newModelCorner[0].toFixed(4)} m,
            Z {newModelCorner[1].toFixed(4)} m</p>}
          <button type="button" disabled={!canStageImage||!imagePlot||!pendingEdit||!!busy}
            onClick={stageImageCorner}>Stage Image Corner to Unverified 3D Draft</button>
        </>}
      </div>}
      {draft&&<div className="geo-align-image">
        {imageUrl?<div className="geo-align-image-stage">
          <img src={imageUrl} alt="Checksum-verified original masterplan source used for image to model alignment"
            onLoad={event=>{
              const width=event.currentTarget.naturalWidth,height=event.currentTarget.naturalHeight;
              if(width<1||height<1||width*height>80_000_000){
                setActualImage(null);setError("Original image dimensions exceed the 80-megapixel alignment safety limit.");
              }else setActualImage({width,height});
            }}/>
          <svg viewBox="0 0 1 1" preserveAspectRatio="none"
            aria-label={imageEditMode?"Select new plot corner on approved masterplan image":"Select a checkpoint on the original masterplan image"}
            onPointerDown={markImage}>
            {projected.map(p=><polygon key={p.id}
              points={p.uv.map(q=>q.join(",")).join(" ")}
              stroke="#31e0ad" fill="rgba(49,224,173,.15)" strokeWidth=".002"
              pointerEvents="none"/>)}
            {imageEditMode&&projected.filter(p=>p.id===imagePlotId)
              .flatMap(p=>p.uv.map((uv,index)=>({uv,index})))
              .map(({uv,index})=><circle key={"image-corner-"+index} cx={uv[0]} cy={uv[1]}
                r={index===imageCornerIndex?".011":".006"}
                stroke={index===imageCornerIndex?"#ffda67":"#eeffff"}
                strokeWidth=".003" fill="none" pointerEvents="none"/>)}
            {pendingEdit&&imageEditMode&&<circle cx={pendingEdit[0]} cy={pendingEdit[1]}
              r=".012" fill="none" stroke="#ff5973" strokeWidth=".004"
              pointerEvents="none"/>}
            {draft.anchors.map(p=><circle key={p.id} cx={p.u} cy={p.v} r=".008"
              fill="#ffce6d" stroke="#172638" strokeWidth=".002" pointerEvents="none"/>)}
            {draft.checkpoints.map(p=><circle key={p.id} cx={p.u} cy={p.v} r=".008"
              fill="#7ebcff" stroke="#172638" strokeWidth=".002" pointerEvents="none"/>)}
            {assessed.result&&draft.checkpoints.map(p=>{
              const predicted=modelPointToImage(assessed.result!.transform,[p.x,p.z]);
              return <g key={p.id+"-residual"} pointerEvents="none">
                <line x1={p.u} y1={p.v} x2={predicted[0]} y2={predicted[1]}
                  stroke="#ff5674" strokeWidth=".004"/>
                <circle cx={predicted[0]} cy={predicted[1]} r=".006"
                  fill="none" stroke="#ff5674" strokeWidth=".002"/>
              </g>;
            })}
            {pending&&<circle cx={pending[0]} cy={pending[1]} r=".012"
              stroke="#ffffff" strokeWidth=".003" fill="none" pointerEvents="none"/>}
          </svg>
        </div>:<p className="geo-plot-hint">Loading and verifying original image bytes…</p>}
        {!imageEditMode&&<p className="geo-plot-hint">Click a precise landmark on the image. Then capture its matching location on the 3D canvas.
          Use at least 3 distributed fit anchors and 2 different withheld survey checkpoints.</p>}
        {actualImage&&<small>Original resolution {actualImage.width} × {actualImage.height} pixels · aspect-correct 3D fit</small>}
        {dimensionMismatch&&<p className="geo-plot-warning">Original image dimensions differ from the saved draft. Save and reverify this corrected image aspect before any overlay.</p>}
        {!imageEditMode&&pending&&<strong>Image point U {pending[0].toFixed(5)} · V {pending[1].toFixed(5)}</strong>}
        {!imageEditMode&&<label>Signed drawing / survey evidence for new pair
          <input value={evidence} maxLength={160} placeholder="Approved plan, page and surveyed landmark"
            onChange={e=>setEvidence(e.target.value)}/></label>}
        {!imageEditMode&&<div className="geo-align-actions">
          <button type="button" disabled={!canEdit||stale||!!busy||!pending||!evidence.trim()||draft.anchors.length>=48}
            onClick={()=>capture("anchors")}>Pair Fit Point on 3D Canvas</button>
          <button type="button" disabled={!canEdit||stale||!!busy||!pending||!evidence.trim()||draft.checkpoints.length>=48}
            onClick={()=>capture("checkpoints")}>Pair Independent Checkpoint</button>
        </div>}
      </div>}
      {draft&&<div className="geo-align-points">
        {(["anchors","checkpoints"] as const).map(kind=><div key={kind}>
          <strong>{kind==="anchors"?"Fit anchors":"Withheld checkpoints"} · {draft[kind].length}</strong>
          {draft[kind].map(p=><div className="geo-align-point" key={p.id}>
            <span>{p.id}: ({p.u.toFixed(4)}, {p.v.toFixed(4)}) → X {p.x.toFixed(3)}, Z {p.z.toFixed(3)}
              <small>{p.evidence}</small></span>
            <button type="button" disabled={!canEdit||!!busy}
              onClick={()=>drop(kind,p.id)} aria-label={"Remove "+p.id}>Remove</button>
          </div>)}
        </div>)}
      </div>}
      {draft&&<div className="geo-align-qa">
        <strong>Independent QA · {assessed.result?.verifiedReady?"eligible":"review required"}</strong>
        {assessed.result?<p>Fit max {assessed.result.maxFitMetres?.toFixed(3)} m ·
          withheld max {assessed.result.maxCheckpointMetres?.toFixed(3)??"—"} m ·
          review limit {assessed.result.limitMetres.toFixed(3)} m</p>:
          <p>{assessed.error}</p>}
        {assessed.result?.issues.map((issue,i)=><p key={i} className="geo-plot-warning">{issue}</p>)}
        <p className="geo-plot-hint">Blue dots are withheld survey checkpoints; red lines connect each to the model-predicted image location.
          Long lines require source review before verification.</p>
        <p className="geo-plot-hint">Alignment is a read-only overlay preview after independent verification.
          A passing check does not certify survey accuracy or automatically republish polygons.</p>
        <label><input type="checkbox" checked={showOverlay}
          onChange={e=>setShowOverlay(e.target.checked)}/> Show verified plot outline overlay</label>
        <div className="geo-align-actions">
          <button type="button" disabled={!canEdit||(!dirty&&!dimensionMismatch)||!!busy||!selected||!actualImage}
            onClick={()=>void save()}>{busy==="save"?"Saving…":"Save Alignment Draft"}</button>
          <button type="button" disabled={!canEdit||dirty||dimensionMismatch||!!busy||!assessed.result?.verifiedReady}
            onClick={()=>void verify()}>{busy==="verify"?"Verifying…":"Verify Independent Checkpoints"}</button>
        </div>
      </div>}
    </div>
  </details>;
}
