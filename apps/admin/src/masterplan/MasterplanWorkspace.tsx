import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { listAssets, uploadAsset, type CloudAssetSummary } from "../studio/cloud";
import type { Asset } from "../studio/domain";
import "./masterplan-workspace.css";

type Point=[number,number];type Role="front"|"back"|"depthA"|"depthB";
type Side={edges:number[];length:number;unit:"ft"|"m";roadFacing:boolean;source:string;verified:boolean};
type Plot={id:string;corners:Point[];layout:"three"|"four";sides:Partial<Record<Role,Side>>;
  area:{value:number;unit:"sqft"|"sqm"|"sqyd";source:string;verified:boolean};
  facing:string;facingSource:string;facingVerified:boolean;road:string;notes:string};
type Control={u:number;v:number;lat:number;lng:number;source:string;verified:boolean};
type MasterplanDraft={revision:number;verifiedRevision:number|null;imageAssetId:string|null;
  width:number;height:number;controlPoints:Control[];plots:Plot[]};
type MasterplanState={project:{slug:string;name:string;status:string};draft:MasterplanDraft;
  activeRelease:{id:string;version:number}|null;history:Array<{id:string;version:number}>};
type Mode="source"|"plots"|"controls";
type Tool="pan"|"draw"|"edit"|"point";
const roles:Role[]=["front","depthA","back","depthB"];
const directions=["north","north-east","east","south-east","south","south-west","west","north-west"];
const blankSide=():Side=>({edges:[],length:0,unit:"ft",roadFacing:false,source:"",verified:false});
function newPlot(id:string):Plot{return {id,corners:[],layout:"four",sides:{},
  area:{value:0,unit:"sqft",source:"",verified:false},facing:"north",
  facingSource:"",facingVerified:false,road:"",notes:""};}
function assignSides(points:Point[]):Plot["sides"]{
  const sides:Plot["sides"]={};if(points.length<3)return sides;
  const names=points.length===3?roles.slice(0,3):roles;
  names.forEach((role,i)=>{
    const edges=i===names.length-1
      ? Array.from({length:points.length-i},(_,j)=>i+j):[i];
    sides[role]={...blankSide(),edges};
  });
  return sides;
}
function normalizedSvgPoint(e:ReactPointerEvent<SVGSVGElement>,svg:SVGSVGElement,width:number,height:number):Point|null{
  const pt=svg.createSVGPoint();pt.x=e.clientX;pt.y=e.clientY;
  const matrix=svg.getScreenCTM();if(!matrix||!width||!height)return null;
  const local=pt.matrixTransform(matrix.inverse());
  if(local.x<0||local.y<0||local.x>width||local.y>height)return null;
  return [Number((local.x/width).toFixed(7)),Number((local.y/height).toFixed(7))];
}
function parseResponse<T>(r:Response):Promise<T>{return r.json().then(x=>{
  if(!r.ok)throw Error(x.error||"Masterplan API request failed.");return x as T;});}
const cell=(v:unknown)=>'"'+String(v??"").replace(/"/g,'""').replace(/^[=+@-]/,"'$&")+'"';
function csv(plots:Plot[]):string{
  const headers=["plotId","cornersJSON","area","areaUnit","areaSource","facing","facingSource","road","notes",
    ...roles.flatMap(role=>[role+"Edges",role+"Length",role+"Unit",role+"Source",role+"RoadFacing"])];
  return [headers.map(cell).join(","),...plots.map(plot=>[
    plot.id,JSON.stringify(plot.corners),plot.area.value,plot.area.unit,plot.area.source,
    plot.facing,plot.facingSource,plot.road,plot.notes,
    ...roles.flatMap(role=>[plot.sides[role]?.edges.join("|"),plot.sides[role]?.length,
      plot.sides[role]?.unit,plot.sides[role]?.source,plot.sides[role]?.roadFacing])
  ].map(cell).join(","))].join("\n");
}
export default function MasterplanWorkspace({mode}:{mode:Mode}){
  const slug=new URLSearchParams(location.search).get("project")||"";
  const endpoint=`/3Dprojects/api/cloud/projects/${encodeURIComponent(slug)}/masterplan-geo`;
  const [state,setState]=useState<MasterplanState|null>(null);
  const [draft,setDraft]=useState<MasterplanDraft|null>(null);
  const [assets,setAssets]=useState<CloudAssetSummary[]>([]);
  const [tool,setTool]=useState<Tool>("pan");
  const [working,setWorking]=useState<Plot|null>(null);
  const [originalId,setOriginalId]=useState<string|null>(null);
  const [controlIndex,setControlIndex]=useState<number|null>(null);
  const [dirty,setDirty]=useState(false);const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");const [status,setStatus]=useState("");
  const [imageUrl,setImageUrl]=useState("");
  const [frame,setFrame]=useState({x:0,y:0,w:1,h:1});
  const svgRef=useRef<SVGSVGElement>(null);
  const activeProject=useRef(slug);activeProject.current=slug;
  const pointerRef=useRef<Map<number,Point>>(new Map());
  const panRef=useRef<Point|null>(null);
  const dragRef=useRef<number|null>(null);
  const workingRef=useRef(working);workingRef.current=working;
  const load=useCallback(async()=>{
    if(!slug){setState(null);setDraft(null);return;}
    const id=slug;
    const [r,a]=await Promise.all([fetch(endpoint,{cache:"no-store"}),listAssets(slug)]);
    const next=await parseResponse<MasterplanState>(r);
    if(activeProject.current!==id)return;
    setState(next);setDraft(next.draft);setAssets(a.assets);setWorking(null);setDirty(false);
    setFrame({x:0,y:0,w:next.draft.width||1,h:next.draft.height||1});
    setError("");setStatus("");
  },[slug,endpoint]);
  useEffect(()=>{let on=true;void load().catch(e=>{if(on)setError(String(e));});
    return()=>{on=false;};},[load]);
  useEffect(()=>{
    const source=assets.find(a=>a.id===draft?.imageAssetId);
    setImageUrl(source?.contentUrl ? source.contentUrl+"?preview=1" : "");
  },[draft?.imageAssetId,assets]);
  function changeDraft(patch:Partial<MasterplanDraft>){
    setDraft(d=>d?{...d,...patch}:d);setDirty(true);
  }
  async function upload(file:File){
    if(!["image/png","image/jpeg","image/webp"].includes(file.type))
      throw Error("Use original PNG, JPG or WebP masterplan.");
    if(file.size>16*1024*1024)throw Error("Choose an optimized masterplan image under 16 MB.");
    const image=await createImageBitmap(file);
    const width=image.width,height=image.height;image.close();
    if(width>50000||height>50000)throw Error("Masterplan image pixel size is too large.");
    const checksum=new Uint8Array(await crypto.subtle.digest("SHA-256",await file.arrayBuffer()));
    const hash=Array.from(checksum,x=>x.toString(16).padStart(2,"0")).join("");
    const data:Asset={id:crypto.randomUUID(),projectId:slug,name:file.name,
      type:file.type,size:file.size,hash,blob:file};
    const result=await uploadAsset(slug,data,"source");
    if(activeProject.current!==slug)return;
    setAssets(a=>[...a.filter(v=>v.id!==result.asset.id),result.asset]);
    changeDraft({imageAssetId:result.asset.id,width,height,controlPoints:[],plots:[],
      verifiedRevision:null});
    setFrame({x:0,y:0,w:width,h:height});setWorking(null);
    setStatus("Original image archived; all previous calibration and polygons cleared. Save the new draft.");
  }
  async function operation(action:"save"|"verify"|"publish"|"activate",releaseId?:string){
    if(!draft||!state)return;
    setBusy(true);setError("");setStatus("");
    try{
      if((action==="verify"||action==="publish")&&(dirty||working))
        throw Error("Apply any open Plot and Save Draft before verification/publishing.");
      const body=action==="save"?{expectedRevision:state.draft.revision,
        draft:{imageAssetId:draft.imageAssetId,width:draft.width,height:draft.height,
          controlPoints:draft.controlPoints,plots:draft.plots}}
        :{action,expectedRevision:state.draft.revision,...(releaseId?{releaseId}:{})};
      const reply=await fetch(endpoint,{method:action==="save"?"PUT":"POST",
        headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      const next=await parseResponse<MasterplanState>(reply);
      if(activeProject.current!==slug)return;
      setState(next);setDraft(next.draft);setDirty(false);setWorking(null);
      setStatus(action==="save"?"Masterplan draft saved and server read-back confirmed.":
        action==="verify"?"Source, GPS controls, source-backed plot measurements verified.":
        action==="publish"?"Immutable Geo Masterplan published to customer site.":"Previous immutable release activated.");
    }catch(e){setError(e instanceof Error?e.message:"Operation failed.");}
    finally{setBusy(false);}
  }
  function newBoundary(){
    if(!draft)return;
    const ids=new Set(draft.plots.map(x=>x.id));let n=1;while(ids.has(String(n)))n++;
    setOriginalId(null);setWorking(newPlot(String(n)));setTool("draw");
  }
  function choose(p:Plot){setOriginalId(p.id);setWorking(structuredClone(p));setTool("edit");}
  function updatePlot<K extends keyof Plot>(key:K,value:Plot[K]){
    setWorking(p=>p?{...p,[key]:value}:p);
  }
  function apply(){
    if(!working||!draft) return;
    const id=working.id.trim();
    if(!id||working.corners.length<3){setError("Plot number and at least three polygon corners required.");return;}
    if(draft.plots.some(p=>p.id.toLowerCase()===id.toLowerCase()&&p.id!==originalId)){
      setError("Duplicate plot number.");return;
    }
    const plots=[...draft.plots.filter(p=>p.id!==(originalId||id)),{...working,id}]
      .sort((a,b)=>a.id.localeCompare(b.id,undefined,{numeric:true}));
    changeDraft({plots});setWorking(null);setOriginalId(null);setTool("pan");
    setStatus("Polygon and dimensions staged. Save Draft to persist.");
  }
  function zoom(factor:number,uv?:Point){
    const center=uv||[frame.x+frame.w/2,frame.y+frame.h/2];
    const w=Math.max(1,Math.min(draft?.width||1,frame.w*factor));
    const h=Math.max(1,Math.min(draft?.height||1,frame.h*factor));
    setFrame({x:center[0]-(center[0]-frame.x)*w/frame.w,
      y:center[1]-(center[1]-frame.y)*h/frame.h,w,h});
  }
  const setSide=(role:Role,patch:Partial<Side>)=>setWorking(p=>p?
    {...p,sides:{...p.sides,[role]:{...(p.sides[role]||blankSide()),...patch}}}:p);
  function down(e:ReactPointerEvent<SVGSVGElement>){
    const svg=svgRef.current;if(!svg||!draft)return;
    const p=normalizedSvgPoint(e,svg,draft.width,draft.height);
    pointerRef.current.set(e.pointerId,[e.clientX,e.clientY]);
    if(tool==="pan"){panRef.current=[e.clientX,e.clientY];e.currentTarget.setPointerCapture(e.pointerId);return;}
    if(!p)return;
    if(tool==="point" && controlIndex!==null){
      const arr=draft.controlPoints.map((cp,i)=>i===controlIndex?{...cp,u:p[0],v:p[1],verified:false}:cp);
      changeDraft({controlPoints:arr});setControlIndex(null);setTool("pan");return;
    }
    if(tool==="draw"&&working){
      if(working.corners.length>=80)return;
      const near=draft.plots.flatMap(plot=>plot.corners).find(q=>
        Math.hypot((q[0]-p[0])*draft.width,(q[1]-p[1])*draft.height)<8*frame.w/(svg.clientWidth||1));
      const corners=[...working.corners,near||p];
      setWorking({...working,corners,layout:corners.length===3?"three":"four",sides:assignSides(corners)});
      return;
    }
    if(tool==="edit"&&working){
      const hit=working.corners.findIndex(q=>
        Math.hypot((q[0]-p[0])*draft.width,(q[1]-p[1])*draft.height)<12*frame.w/(svg.clientWidth||1));
      if(hit>=0){dragRef.current=hit;e.currentTarget.setPointerCapture(e.pointerId);}
    }
  }
  function move(e:ReactPointerEvent<SVGSVGElement>){
    const svg=svgRef.current;if(!svg||!draft||!pointerRef.current.has(e.pointerId))return;
    const previous=pointerRef.current.get(e.pointerId)!;
    pointerRef.current.set(e.pointerId,[e.clientX,e.clientY]);
    if(tool==="pan"&&panRef.current){
      const dx=(e.clientX-previous[0])*frame.w/(svg.clientWidth||1);
      const dy=(e.clientY-previous[1])*frame.h/(svg.clientHeight||1);
      setFrame(v=>({...v,x:v.x-dx,y:v.y-dy}));return;
    }
    if(tool==="edit"&&dragRef.current!==null&&workingRef.current){
      const point=normalizedSvgPoint(e,svg,draft.width,draft.height);if(!point)return;
      setWorking(prev=>prev?{...prev,corners:prev.corners.map((v,i)=>i===dragRef.current?point:v),
        sides:Object.fromEntries(Object.entries(prev.sides).map(([k,v])=>[k,{...v,verified:false}]))}:prev);
    }
  }
  function up(e:ReactPointerEvent<SVGSVGElement>){
    pointerRef.current.delete(e.pointerId);dragRef.current=null;panRef.current=null;
    if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
  }
  const approved=state?.draft.verifiedRevision===state?.draft.revision&&Boolean(state?.draft.revision);
  const publishedUrl=slug?`/3Dprojects/${encodeURIComponent(slug)}/masterplan`:"";
  const source=assets.find(a=>a.id===draft?.imageAssetId);
  return <main className="masterplan-workspace">
    <header><p className="eyebrow">REKIXO ENGINE · INDEPENDENT IMAGE GEO PROJECT</p>
      <h1>{mode==="source"?"Geo Masterplan Source":mode==="plots"?"Masterplan Plot Mapper":"Mapping Controls"}</h1>
      <p>Project: <strong>{state?.project.name||slug}</strong> · Building model/release not required. Approved image and GPS controls remain separate from 3D Buildings.</p></header>
    {error&&<p role="alert" className="masterplan-error">{error}</p>}
    {status&&<p role="status" className="masterplan-ok">{status}</p>}
    {state&&<div className="masterplan-stats">
      <span>Draft <b>r{draft?.revision||0}</b></span><span>Plots <b>{draft?.plots.length||0}</b></span>
      <span>GPS Points <b>{draft?.controlPoints.length||0}</b></span>
      <span>Verified <b>{approved?"Yes":"No"}</b></span>
      <span>Live <b>{state.activeRelease?"v"+state.activeRelease.version:"Not published"}</b></span></div>}
    <div className="masterplan-tools">
      <button onClick={()=>setTool("pan")} className={tool==="pan"?"active":""}>Pan</button>
      <button onClick={()=>zoom(.8)}>Zoom +</button>
      <button onClick={()=>zoom(1.25)}>Zoom −</button>
      <button onClick={()=>draft&&setFrame({x:0,y:0,w:draft.width,h:draft.height})}>Fit</button>
      {mode!=="source"&&<button onClick={newBoundary} disabled={!imageUrl}>+ New Polygon</button>}
      <button disabled={!dirty||busy||!draft?.imageAssetId} onClick={()=>void operation("save")}>Save Draft</button>
      <button disabled={dirty||busy||!state?.draft.revision||Boolean(working)} onClick={()=>void operation("verify")}>Verify</button>
      <button disabled={dirty||busy||!approved||Boolean(working)} onClick={()=>void operation("publish")}>Publish Masterplan</button>
      {state?.activeRelease&&<a href={publishedUrl} target="_blank" rel="noreferrer">Open Live Geo Map</a>}
    </div>
    <div className="masterplan-grid">
      <section className="masterplan-stage">
        {imageUrl&&draft?.width&&draft?.height?<svg ref={svgRef} viewBox={`${frame.x} ${frame.y} ${frame.w} ${frame.h}`}
          preserveAspectRatio="xMidYMid meet" onPointerDown={down} onPointerMove={move}
          onPointerUp={up} onPointerCancel={up}
          onWheel={e=>{if(e.ctrlKey||e.deltaY){zoom(e.deltaY>0?1.12:.88);}}}>
          <image href={imageUrl} x="0" y="0" width={draft.width} height={draft.height} />
          {draft.plots.map(plot=><g key={plot.id} onClick={()=>tool!=="draw"&&choose(plot)}>
            <polygon points={plot.corners.map(p=>p[0]*draft.width+","+p[1]*draft.height).join(" ")}
              fill="rgba(20,211,161,.17)" stroke="#2be3ad" strokeWidth={Math.max(1,frame.w/600)}/>
            <text x={plot.corners[0][0]*draft.width+4} y={plot.corners[0][1]*draft.height+14}
              fill="white" stroke="#0d2333" paintOrder="stroke" fontSize={Math.max(11,frame.w/50)}>{plot.id}</text>
          </g>)}
          {draft.controlPoints.map((p,i)=><g key={i}>
            <circle cx={p.u*draft.width} cy={p.v*draft.height} r={Math.max(4,frame.w/150)}
              fill="#f6cd6c" stroke="#282027" strokeWidth={2}/>
            <text x={p.u*draft.width+8} y={p.v*draft.height-8}
              fill="white" stroke="#222" paintOrder="stroke" fontSize={Math.max(12,frame.w/65)}>GPS {i+1}</text>
          </g>)}
          {working&&<g>
            <polyline points={working.corners.map(p=>p[0]*draft.width+","+p[1]*draft.height).join(" ")}
              fill="rgba(245,201,54,.22)" stroke="#ffe084" strokeWidth={Math.max(2,frame.w/440)}/>
            {working.corners.map((p,i)=><circle key={i} cx={p[0]*draft.width} cy={p[1]*draft.height}
              r={Math.max(5,frame.w/140)} fill="#ffe7a1" stroke="#112734" strokeWidth={1.5}/>)}
          </g>}
        </svg>:<div className="masterplan-placeholder">
          <strong>No approved masterplan source selected</strong>
          <p>Upload an image in the Source workspace. No Building GLB is needed.</p>
        </div>}
        <p className="masterplan-stage-hint">{tool==="pan"?"Drag to pan; use Zoom/Fit controls.":
          tool==="draw"?"Tap each plot corner; then enter approved details and apply.":
          tool==="edit"?"Drag an individual polygon corner; side approvals reset.":
          "Tap a location on the image for selected GPS control point."}</p>
      </section>
      <aside className="masterplan-dock">
        {mode==="source"?<>
          <h2>Original Masterplan</h2>
          <label>Upload image (PNG, JPG, WebP · max 16 MB)
            <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy}
              onChange={e=>{const file=e.target.files?.[0];e.target.value="";
                if(file){setBusy(true);void upload(file).catch(x=>setError(String(x))).finally(()=>setBusy(false));}}}/></label>
          <p>{source?.name||"No image"} · {draft?.width||0}×{draft?.height||0} px</p>
          <h2>Geo Control Points</h2>
          <p>Use 3–24 surveyed control points. Select Position and tap matching location on the image; then enter exact Latitude/Longitude and source.</p>
          {draft?.controlPoints.map((cp,i)=><fieldset key={i}><legend>Control Point {i+1}</legend>
            <button onClick={()=>{setTool("point");setControlIndex(i);}}>Set Image Position</button>
            <small>U {cp.u.toFixed(6)}, V {cp.v.toFixed(6)}</small>
            <label>Latitude <input type="number" step="any" value={cp.lat}
              onChange={e=>changeDraft({controlPoints:draft.controlPoints.map((v,j)=>
                j===i?{...v,lat:Number(e.target.value),verified:false}:v)})}/></label>
            <label>Longitude <input type="number" step="any" value={cp.lng}
              onChange={e=>changeDraft({controlPoints:draft.controlPoints.map((v,j)=>
                j===i?{...v,lng:Number(e.target.value),verified:false}:v)})}/></label>
            <label>Survey Source <input value={cp.source} onChange={e=>changeDraft({controlPoints:
              draft.controlPoints.map((v,j)=>j===i?{...v,source:e.target.value,verified:false}:v)})}/></label>
            <label className="masterplan-check"><input type="checkbox" checked={cp.verified} onChange={e=>changeDraft({
              controlPoints:draft.controlPoints.map((v,j)=>j===i?{...v,verified:e.target.checked}:v)})}/> Source verified</label>
            <button onClick={()=>changeDraft({controlPoints:draft.controlPoints.filter((_,j)=>j!==i)})}>Remove Point</button>
          </fieldset>)}
          <button disabled={!draft||draft.controlPoints.length>=24} onClick={()=>draft&&changeDraft({
            controlPoints:[...draft.controlPoints,{u:.5,v:.5,lat:0,lng:0,source:"",verified:false}]})}>+ Add GPS Point</button>
        </>:<>
          <h2>Plot Inventory</h2>
          <div className="masterplan-inventory">{draft?.plots.map(p=><button key={p.id} type="button"
            className={working?.id===p.id?"active":""} onClick={()=>choose(p)}>{p.id}</button>)}</div>
          {working?<fieldset><legend>Plot {working.id}</legend>
            <label>Plot Number <input value={working.id} readOnly={originalId!==null}
              onChange={e=>updatePlot("id",e.target.value)}/></label>
            <small>{working.corners.length} polygon corners</small>
            <button disabled={!working.corners.length} onClick={()=>setWorking(p=>p?{...p,
              corners:p.corners.slice(0,-1),sides:assignSides(p.corners.slice(0,-1))}:p)}>Undo Corner</button>
            <button disabled={working.corners.length<3} onClick={()=>setTool("edit")}>Drag Corners</button>
            <label>Approved Area<input type="number" step="any" min="0" value={working.area.value||""}
              onChange={e=>updatePlot("area",{...working.area,value:Number(e.target.value),verified:false})}/></label>
            <label>Area Unit<select value={working.area.unit} onChange={e=>updatePlot("area",
              {...working.area,unit:e.target.value as Plot["area"]["unit"],verified:false})}>
                <option value="sqft">sqft</option><option value="sqm">sqm</option><option value="sqyd">sqyd</option>
              </select></label>
            <label>Approved Area Source<input value={working.area.source} onChange={e=>
              updatePlot("area",{...working.area,source:e.target.value,verified:false})}/></label>
            <label className="masterplan-check"><input type="checkbox" checked={working.area.verified}
              onChange={e=>updatePlot("area",{...working.area,verified:e.target.checked})}/> Area verified</label>
            <label>Facing<select value={working.facing} onChange={e=>setWorking({
              ...working,facing:e.target.value,facingVerified:false})}>
              {directions.map(d=><option key={d} value={d}>{d}</option>)}</select></label>
            <label>Facing Source<input value={working.facingSource} onChange={e=>
              setWorking({...working,facingSource:e.target.value,facingVerified:false})}/></label>
            <label className="masterplan-check"><input type="checkbox" checked={working.facingVerified}
              onChange={e=>updatePlot("facingVerified",e.target.checked)}/> Facing reviewed</label>
            <label>Road<input value={working.road} onChange={e=>updatePlot("road",e.target.value)}/></label>
            {roles.filter(role=>working.layout!=="three"||role!=="depthB").map(role=>{
              const side=working.sides[role]||blankSide();return <fieldset key={role}><legend>{role}</legend>
                <label>Edge indices (0 to {Math.max(0,working.corners.length-1)})
                  <input value={side.edges.join(",")} onChange={e=>setSide(role,{edges:e.target.value.split(",")
                    .map(x=>Number(x.trim())).filter(Number.isInteger),verified:false})}/></label>
                <label>Length<input type="number" step="any" min="0" value={side.length||""}
                  onChange={e=>setSide(role,{length:Number(e.target.value),verified:false})}/></label>
                <label>Unit<select value={side.unit} onChange={e=>setSide(role,{unit:e.target.value as Side["unit"],verified:false})}>
                  <option value="ft">ft</option><option value="m">m</option></select></label>
                <label>Survey Source<input value={side.source} onChange={e=>
                  setSide(role,{source:e.target.value,verified:false})}/></label>
                <label className="masterplan-check"><input type="checkbox" checked={side.roadFacing}
                  onChange={e=>setSide(role,{roadFacing:e.target.checked})}/> Road-facing</label>
                <label className="masterplan-check"><input type="checkbox" checked={side.verified}
                  onChange={e=>setSide(role,{verified:e.target.checked})}/> Measurement verified</label>
              </fieldset>;
            })}
            <label>Notes<textarea rows={2} value={working.notes} onChange={e=>updatePlot("notes",e.target.value)}/></label>
            <button disabled={working.corners.length<3} onClick={apply}>Apply Plot to Draft</button>
          </fieldset>:<p>Select a plot, or create a new polygon.</p>}
          <button disabled={!draft?.plots.length} onClick={()=>{
            if(!draft)return;
            const file=new Blob([csv(draft.plots)],{type:"text/csv;charset=utf-8"});
            const url=URL.createObjectURL(file),a=document.createElement("a");
            a.href=url;a.download=slug+"-masterplan-plots.csv";a.click();
            setTimeout(()=>URL.revokeObjectURL(url),1000);
          }}>Export Plot Mapping CSV</button>
        </>}
        <h2>Mapping Release History</h2>
        {state?.history.map(r=><button key={r.id} disabled={busy||state.activeRelease?.id===r.id}
          onClick={()=>void operation("activate",r.id)}>Activate v{r.version}</button>)}
        <p className="masterplan-guidance">Only current Verified and Published mapping reaches the customer Geo map.
          The source image is not a legal land survey. Real-world control points must be checked against approved survey data.</p>
      </aside>
    </div>
  </main>;
}
