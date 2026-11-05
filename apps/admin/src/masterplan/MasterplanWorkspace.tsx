import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { listAssets, uploadAsset, type CloudAssetSummary } from "../studio/cloud";
import type { Asset } from "../studio/domain";
import {fitImageFrame,imageWorldAt,panImageFrame,pinchImageFrame,zoomImageFrame} from "../../../../shared/masterplan-image-gestures.js";
import {assignFourCornerRoadFront} from "../../../../shared/geo-plot-source-operations.js";
import {inferFrontFirstSideGroups,nearestPlotBoundaryEdge} from "../../../../shared/geo-plot-smart-sides.js";
import {inspectGeoPlotSideCoverage,repairGeoPlotSideCoverage} from "../../../../shared/geo-plot-side-integrity.js";
import {packMasterplanRecovery,unpackMasterplanRecovery,reviewMasterplanCsv,invalidateMasterplanSourceProof,
  type MasterplanCsvReview} from "../../../../shared/masterplan-workflow.js";
import "./masterplan-workspace.css";

type Point=[number,number];type Role="front"|"back"|"depthA"|"depthB";
type Side={edges:number[];length:number;unit:"ft"|"m";roadFacing:boolean;source:string;verified:boolean};
type Plot={id:string;corners:Point[];layout:"three"|"four";sides:Partial<Record<Role,Side>>;
  area:{value:number;unit:"sqft"|"sqm"|"sqyd";source:string;verified:boolean};
  facing:string;facingSource:string;facingVerified:boolean;road:string;notes:string};
type Control={u:number;v:number;lat:number;lng:number;source:string;verified:boolean};
type MasterplanDraft={revision:number;verifiedRevision:number|null;imageAssetId:string|null;
  width:number;height:number;controlPoints:Control[];plots:Plot[]};
type LocalSnapshot={draft:MasterplanDraft;working:Plot|null;originalId:string|null;dirty:boolean;savedAt?:string};
type ImageComparison={file:File;width:number;height:number;previewUrl:string};
type MasterplanState={project:{slug:string;name:string;status:string};draft:MasterplanDraft;
  activeRelease:{id:string;version:number;draftRevision:number}|null;history:Array<{id:string;version:number}>};
type Mode="source"|"plots"|"controls";
type Tool="pan"|"draw"|"edit"|"point"|"front";
const roles:Role[]=["front","depthA","back","depthB"];
const directions=["north","north-east","east","south-east","south","south-west","west","north-west"];
const blankSide=():Side=>({edges:[],length:0,unit:"ft",roadFacing:false,source:"",verified:false});
function newPlot(id:string):Plot{return {id,corners:[],layout:"four",sides:{},
  area:{value:0,unit:"sqft",source:"",verified:false},facing:"north",
  facingSource:"",facingVerified:false,road:"",notes:""};}
function assignSides(points:Point[]):Plot["sides"]{
  const inferred=inferFrontFirstSideGroups(points);
  const sides:Plot["sides"]={};
  if(!inferred)return sides;
  for(const role of roles){
    const edges=inferred.roles[role];
    if(edges?.length)sides[role]={...blankSide(),edges:[...edges]};
  }
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
function exportMasterplanDraftReview(slug:string,draft:MasterplanDraft){
  // Owner-private local review snapshot, NOT a complete D1+R2 recovery package.
  const body=JSON.stringify({schema:"rekixo-masterplan-source-review-v1",projectSlug:slug,
    createdAt:new Date().toISOString(),draft},null,2);
  const url=URL.createObjectURL(new Blob([body],{type:"application/json;charset=utf-8"}));
  const a=document.createElement("a");a.href=url;a.download=slug+"-source-change-review.json";a.click();
  window.setTimeout(()=>URL.revokeObjectURL(url),3000);
}
export default function MasterplanWorkspace({mode}:{mode:Mode}){
  const slug=new URLSearchParams(location.search).get("project")||"";
  const endpoint=`/3Dprojects/api/cloud/projects/${encodeURIComponent(slug)}/masterplan-geo`;
  const [state,setState]=useState<MasterplanState|null>(null);
  const [draft,setDraft]=useState<MasterplanDraft|null>(null);
  const [assets,setAssets]=useState<CloudAssetSummary[]>([]);
  const [tool,setTool]=useState<Tool>("pan");
  const [panel,setPanel]=useState<"source"|"plots">(() => new URLSearchParams(location.search).get("tab")==="source" || mode==="source" ? "source" : "plots");
  const [working,setWorking]=useState<Plot|null>(null);
  const [plotHistory,setPlotHistory]=useState<{past:Plot[];future:Plot[]}>({past:[],future:[]});
  const [draftHistory,setDraftHistory]=useState<{past:MasterplanDraft[];future:MasterplanDraft[]}>({past:[],future:[]});
  const [originalId,setOriginalId]=useState<string|null>(null);
  const [controlIndex,setControlIndex]=useState<number|null>(null);
  const [dirty,setDirty]=useState(false);const [busy,setBusy]=useState(false);
  const [advanced,setAdvanced]=useState(false);
  const [csvPreview,setCsvPreview]=useState<MasterplanCsvReview<Plot>|null>(null);
  const [csvName,setCsvName]=useState("");
  const [imageComparison,setImageComparison]=useState<ImageComparison|null>(null);
  const [imageCompared,setImageCompared]=useState(false);
  const [recovery,setRecovery]=useState<LocalSnapshot|null>(null);
  const [recoveryConflict,setRecoveryConflict]=useState(false);
  const recoveryKey=slug?"rekixo-masterplan-working-v1:"+slug:"";
  const [error,setError]=useState("");const [status,setStatus]=useState("");
  const [imageUrl,setImageUrl]=useState("");
  const [frame,setFrame]=useState({x:0,y:0,w:1,h:1});
  const svgRef=useRef<SVGSVGElement>(null);
  const activeProject=useRef(slug);activeProject.current=slug;
  const pointerRef=useRef<Map<number,Point>>(new Map());
  const dragRef=useRef<number|null>(null);
  const workingRef=useRef(working);workingRef.current=working;
  const sideCoverage=useMemo(()=>working&&working.corners.length>=3?
    inspectGeoPlotSideCoverage(working):null,[working]);
  const load=useCallback(async()=>{
    if(!slug){setState(null);setDraft(null);return;}
    const id=slug;
    const [r,a]=await Promise.all([fetch(endpoint,{cache:"no-store"}),listAssets(slug)]);
    const next=await parseResponse<MasterplanState>(r);
    if(activeProject.current!==id)return;
    setState(next);setDraft(next.draft);setAssets(a.assets);setWorking(null);setDirty(false);
    try{
      const saved=window.localStorage.getItem(recoveryKey);
      const matched=unpackMasterplanRecovery<LocalSnapshot>(saved,{
        projectSlug:slug,revision:next.draft.revision,imageAssetId:next.draft.imageAssetId});
      setRecovery(matched);setRecoveryConflict(Boolean(saved&&!matched));
    }catch{setRecovery(null);setRecoveryConflict(false);}
    setPlotHistory({past:[],future:[]});setDraftHistory({past:[],future:[]});setCsvPreview(null);
    setFrame(fitImageFrame({width:next.draft.width||1,height:next.draft.height||1}));
    setError("");setStatus("");
  },[slug,endpoint,recoveryKey]);
  useEffect(()=>{let on=true;void load().catch(e=>{if(on)setError(String(e));});
    return()=>{on=false;};},[load]);
  useEffect(()=>()=>{if(imageComparison?.previewUrl)URL.revokeObjectURL(imageComparison.previewUrl);},[imageComparison?.previewUrl]);
  useEffect(()=>{
    const source=assets.find(a=>a.id===draft?.imageAssetId);
    setImageUrl(source?.contentUrl ? source.contentUrl+"?preview=1" : "");
  },[draft?.imageAssetId,assets]);
  const flushRecoveryRef=useRef<()=>void>(()=>{});
  flushRecoveryRef.current=()=>{
    if(!state||!draft||!recoveryKey||(!dirty&&!hasPendingPlot()))return;
    const body=packMasterplanRecovery({projectSlug:slug,revision:state.draft.revision,
      imageAssetId:state.draft.imageAssetId,draft,working,originalId,dirty});
    try{window.localStorage.setItem(recoveryKey,body);}catch{/* Storage may be unavailable. */}
  };
  useEffect(()=>{
    if(!state||!draft)return;
    const timeout=window.setTimeout(()=>flushRecoveryRef.current(),350);
    const flush=()=>flushRecoveryRef.current();
    const hidden=()=>{if(document.visibilityState==="hidden")flush();};
    window.addEventListener("pagehide",flush);
    document.addEventListener("visibilitychange",hidden);
    return ()=>{window.clearTimeout(timeout);
      window.removeEventListener("pagehide",flush);
      document.removeEventListener("visibilitychange",hidden);};
  },[state?.draft.revision,draft,working,originalId,dirty,recoveryKey]);
  useEffect(()=>{
    const onUnload=(event:BeforeUnloadEvent)=>{
      if(!dirty&&!hasPendingPlot())return;
      flushRecoveryRef.current();
      event.preventDefault();event.returnValue="";
    };
    window.addEventListener("beforeunload",onUnload);
    return ()=>window.removeEventListener("beforeunload",onUnload);
  },[dirty,working,originalId,draft]);
  function recoverLocal(){
    if(!recovery||!state||dirty||hasPendingPlot())return;
    if(!window.confirm("Restore local unapplied edits for this exact server revision? Nothing will publish automatically."))return;
    setDraft(recovery.draft);setWorking(recovery.working);
    setOriginalId(recovery.originalId);setDirty(recovery.dirty);
    setPlotHistory({past:[],future:[]});setDraftHistory({past:[],future:[]});
    setRecovery(null);setRecoveryConflict(false);
    setStatus("Local draft restored. Review, Apply Plot and Save Draft before verification.");
  }
  function discardRecovery(){
    if(!window.confirm("Discard the browser-only recovery snapshot for this project?"))return;
    try{window.localStorage.removeItem(recoveryKey);}catch{}
    setRecovery(null);setRecoveryConflict(false);
  }
  function downloadRecovery(){
    try{
      const raw=window.localStorage.getItem(recoveryKey);if(!raw)return;
      const uri=URL.createObjectURL(new Blob([raw],{type:"application/json"}));
      const link=document.createElement("a");link.href=uri;
      link.download=slug+"-manual-recovery.json";link.click();
      window.setTimeout(()=>URL.revokeObjectURL(uri),2000);
    }catch{setError("Browser recovery export unavailable.");}
  }
  async function previewCsv(file:File){
    if(!draft||dirty||hasPendingPlot())throw Error("Apply and Save current mapping before importing a CSV.");
    if(file.size>2000000)throw Error("CSV exceeds 2 MB.");
    const review=reviewMasterplanCsv<Plot>(await file.text(),draft.plots);
    setCsvPreview(review);setCsvName(file.name);
    setStatus("CSV analysed; existing polygons and published releases have not changed.");
  }
  function applyCsvPreview(){
    if(!csvPreview||dirty||hasPendingPlot()||(!csvPreview.changed.length&&!csvPreview.added.length))return;
    if(!window.confirm("Apply CSV values to the LOCAL DRAFT only? Existing polygon positions are protected. Changed source approvals remain unverified until independently rechecked."))return;
    changeDraft({plots:csvPreview.plots});
    setCsvPreview(null);setStatus("CSV values staged in draft only. Review missing-data warnings, then Save Draft and Verify.");
  }
  function missingData(){
    if(!draft)return [];
    const issues:string[]=[];
    if(draft.controlPoints.length<3)issues.push("At least 3 GPS control points required");
    draft.controlPoints.forEach((p,i)=>{
      if(!p.verified||!p.source)issues.push("GPS "+(i+1)+": unverified source");
    });
    for(const plot of draft.plots){
      if(!plot.area.value||!plot.area.source||!plot.area.verified)issues.push("Plot "+plot.id+": area needs verification");
      if(!plot.facingSource||!plot.facingVerified)issues.push("Plot "+plot.id+": facing needs verification");
      for(const role of roles){
        if(role==="depthB"&&plot.layout==="three")continue;
        const side=plot.sides[role];
        if(!side?.length||!side.verified||!side.source)
          issues.push("Plot "+plot.id+": "+role+" source / length / approval missing");
      }
      if(plot.road&&!plot.sides.front?.roadFacing)issues.push("Plot "+plot.id+": road-facing front needs review");
    }
    return issues;
  }
  function changeDraft(patch:Partial<MasterplanDraft>){
    if(!draft)return;
    setDraftHistory(h=>({past:[...h.past.slice(-7),structuredClone(draft)],future:[]}));
    setCsvPreview(null);setDraft({...draft,...patch});setDirty(true);
  }
  function hasPendingPlot(){
    if(!working)return false;
    if(!originalId)return true;
    const original=draft?.plots.find(p=>p.id===originalId);
    return !original||JSON.stringify(original)!==JSON.stringify(working);
  }
  function confirmClosePlot(){
    if(!hasPendingPlot())return true;
    if(!window.confirm("This plot has unapplied changes. Discard these local plot edits?"))return false;
    if(!dirty)try{window.localStorage.removeItem(recoveryKey);}catch{}
    return true;
  }
  function checkpointPlot(){
    if(working)setPlotHistory(h=>({past:[...h.past.slice(-39),structuredClone(working)],future:[]}));
  }
  function editWorking(update:(plot:Plot)=>Plot){
    if(!working)return;
    const next=update(working);
    if(JSON.stringify(next)===JSON.stringify(working))return;
    checkpointPlot();setWorking(next);
  }
  function undo(){
    if(working&&plotHistory.past.length){
      const previous=plotHistory.past.at(-1)!;
      setPlotHistory(h=>({past:h.past.slice(0,-1),future:[...h.future,structuredClone(working)]}));
      setWorking(previous);return;
    }
    if(!working&&draft&&draftHistory.past.length){
      const previous=draftHistory.past.at(-1)!;
      setDraftHistory(h=>({past:h.past.slice(0,-1),future:[...h.future,structuredClone(draft)]}));
      setDraft(previous);setDirty(true);
    }
  }
  function redo(){
    if(working&&plotHistory.future.length){
      const next=plotHistory.future.at(-1)!;
      setPlotHistory(h=>({past:[...h.past,structuredClone(working)],future:h.future.slice(0,-1)}));
      setWorking(next);return;
    }
    if(!working&&draft&&draftHistory.future.length){
      const next=draftHistory.future.at(-1)!;
      setDraftHistory(h=>({past:[...h.past,structuredClone(draft)],future:h.future.slice(0,-1)}));
      setDraft(next);setDirty(true);
    }
  }
  async function prepareSource(file:File){
    if(dirty||hasPendingPlot())throw Error("Apply and Save current work before replacing its source.");
    if(!["image/png","image/jpeg","image/webp"].includes(file.type))
      throw Error("Use original PNG, JPG or WebP masterplan.");
    if(file.size>16*1024*1024)throw Error("Choose an image under 16 MB.");
    const image=await createImageBitmap(file),width=image.width,height=image.height;
    image.close();
    if(width>50000||height>50000)throw Error("Masterplan pixel dimensions exceed allowed bounds.");
    if(draft?.imageAssetId&&(draft.plots.length>0||draft.controlPoints.length>0)){
      setImageComparison({file,width,height,previewUrl:URL.createObjectURL(file)});
      setImageCompared(false);return;
    }
    await upload(file,false);
  }
  async function upload(file:File,preserve=false):Promise<boolean>{
    if(dirty||hasPendingPlot())throw Error("Apply any open plot and Save the current mapping draft before replacing its source image.");
    if(!["image/png","image/jpeg","image/webp"].includes(file.type))
      throw Error("Use original PNG, JPG or WebP masterplan.");
    if(file.size>16*1024*1024)throw Error("Choose an optimized masterplan image under 16 MB.");
    const image=await createImageBitmap(file);
    const width=image.width,height=image.height;image.close();
    if(width>50000||height>50000)throw Error("Masterplan image pixel size is too large.");
    if(preserve&&(!draft||draft.width!==width||draft.height!==height||!imageCompared))
      throw Error("To keep geometry, first compare both same-size images and check the alignment confirmation.");
    if(draft?.imageAssetId&&(draft.plots.length>0||draft.controlPoints.length>0)){
      const message=preserve
        ?"Preserve polygon positions and GPS coordinates for the NEW same-size image as an UNVERIFIED draft? All survey, facing and measurement approvals will be revoked. You must visually recheck every plot and GPS point."
        :"Replace image and CLEAR the CURRENT DRAFT's "+draft.plots.length+" polygons and "+draft.controlPoints.length+
          " GPS points? Published releases remain immutable. Review backup JSON downloads first.";
      if(!window.confirm(message))return false;
      exportMasterplanDraftReview(slug,draft);
    }
    const checksum=new Uint8Array(await crypto.subtle.digest("SHA-256",await file.arrayBuffer()));
    const hash=Array.from(checksum,x=>x.toString(16).padStart(2,"0")).join("");
    const data:Asset={id:crypto.randomUUID(),projectId:slug,name:file.name,
      type:file.type,size:file.size,hash,blob:file};
    const result=await uploadAsset(slug,data,"source");
    if(activeProject.current!==slug)return false;
    setAssets(a=>[...a.filter(v=>v.id!==result.asset.id),result.asset]);
    const kept=preserve&&draft?invalidateMasterplanSourceProof(draft):null;
    changeDraft({imageAssetId:result.asset.id,width,height,
      controlPoints:kept?.controlPoints||[],plots:kept?.plots||[],
      verifiedRevision:null});
    setCsvPreview(null);setFrame(fitImageFrame({width,height}));
    setWorking(null);setPlotHistory({past:[],future:[]});
    setStatus(preserve
      ?"New source staged with old plot geometry UNVERIFIED. Check every polygon and GPS point; Save, Verify and Publish remain separate."
      :"Original image uploaded; existing draft calibration and polygons cleared. Save the new draft.");
    return true;
  }
  async function acceptComparedSource(preserve:boolean){
    if(!imageComparison)return;
    setBusy(true);setError("");
    try{
      const applied=await upload(imageComparison.file,preserve);
      if(applied){setImageComparison(null);setImageCompared(false);}
    }catch(error){setError(error instanceof Error?error.message:String(error));}
    finally{setBusy(false);}
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
      setPlotHistory({past:[],future:[]});setDraftHistory({past:[],future:[]});
      try{window.localStorage.removeItem(recoveryKey);}catch{}
      setRecovery(null);setRecoveryConflict(false);
      setStatus(action==="save"?"Masterplan draft saved and server read-back confirmed.":
        action==="verify"?"Source, GPS controls, source-backed plot measurements verified.":
        action==="publish"?"Immutable Geo Masterplan published to customer site.":"Previous immutable release activated.");
    }catch(e){setError(e instanceof Error?e.message:"Operation failed.");}
    finally{setBusy(false);}
  }
  function selectPanel(next:"source"|"plots") {
    if(panel===next||!confirmClosePlot())return;
    setWorking(null);setOriginalId(null);setPlotHistory({past:[],future:[]});
    const url=new URL(window.location.href);
    url.searchParams.set("tab",next);
    window.history.replaceState({},"",url.pathname+url.search);
    setPanel(next);setTool("pan");
  }
  function newBoundary(){
    if(!draft||!confirmClosePlot())return;
    setPlotHistory({past:[],future:[]});
    const ids=new Set(draft.plots.map(x=>x.id));let n=1;while(ids.has(String(n)))n++;
    setOriginalId(null);setWorking(newPlot(String(n)));setTool("draw");
  }
  function choose(p:Plot){
    if(working?.id===p.id&&originalId===p.id)return;
    if(!confirmClosePlot())return;
    setPlotHistory({past:[],future:[]});setOriginalId(p.id);setWorking(structuredClone(p));setTool("edit");
  }
  function updatePlot<K extends keyof Plot>(key:K,value:Plot[K]){
    editWorking(p=>({...p,[key]:value}));
  }
  function apply(){
    if(!working||!draft) return;
    const audit=inspectGeoPlotSideCoverage(working);
    if(!audit.ok){
      setError("Plot "+working.id+": incomplete sides. Unassigned edges "+
        audit.missingEdges.map(x=>x+1).join(", ")+
        ". Check duplicates/continuity and use Repair Sides.");
      return;
    }
    const id=working.id.trim();
    if(!id||working.corners.length<3){setError("Plot number and at least three polygon corners required.");return;}
    if(draft.plots.some(p=>p.id.toLowerCase()===id.toLowerCase()&&p.id!==originalId)){
      setError("Duplicate plot number.");return;
    }
    const plots=[...draft.plots.filter(p=>p.id!==(originalId||id)),{...working,id}]
      .sort((a,b)=>a.id.localeCompare(b.id,undefined,{numeric:true}));
    changeDraft({plots});setWorking(null);setOriginalId(null);setTool("pan");
    setPlotHistory({past:[],future:[]});
    setStatus("Polygon and dimensions staged. Save Draft to persist.");
  }
  function zoom(factor:number,uv?:Point){
    if(!draft)return;
    setFrame(previous=>zoomImageFrame(previous,{width:draft.width,height:draft.height},factor,uv));
  }
  const setSide=(role:Role,patch:Partial<Side>)=>editWorking(p=>{
    const changed=["edges","length","unit","source","roadFacing"].some(k=>Object.hasOwn(patch,k));
    return {...p,...((Object.hasOwn(patch,"roadFacing") || (role==="front"&&Object.hasOwn(patch,"edges")))?{facingVerified:false}:{}),
      sides:{...p.sides,[role]:{...(p.sides[role]||blankSide()),...(Object.hasOwn(patch,"edges")?{roadFacing:false}:{}),...patch,
        ...(changed?{verified:false}:{})}}};
  });
  const setRoadFront=(edge:number)=>{
    if(!working)return;
    if(!window.confirm("Make edge "+(edge+1)+" the road-facing Front? Side/facing approvals will reset. Existing polygons and published releases remain unchanged."))return;
    editWorking(p=>assignFourCornerRoadFront(p,edge));
  };
  function down(e:ReactPointerEvent<SVGSVGElement>){
    const svg=svgRef.current;if(!svg||!draft)return;
    const p=normalizedSvgPoint(e,svg,draft.width,draft.height);
    pointerRef.current.set(e.pointerId,[e.clientX,e.clientY]);
    if(tool==="pan"){e.currentTarget.setPointerCapture(e.pointerId);return;}
    if(pointerRef.current.size>1||!p)return;
    if(tool==="front"&&working){
      const picked=nearestPlotBoundaryEdge(working.corners,p,draft.width,draft.height);
      const threshold=12*frame.w/Math.max(svg.clientWidth,1);
      if(picked&&picked.distance<=threshold&&working.corners.length===4&&working.layout==="four"){
        setRoadFront(picked.edge);setTool("edit");
      }else setStatus("Tap closer to a plotted boundary edge. For complex irregular sides, use Advanced edge groups.");
      return;
    }
    if(tool==="point" && controlIndex!==null){
      const arr=draft.controlPoints.map((cp,i)=>i===controlIndex?{...cp,u:p[0],v:p[1],verified:false}:cp);
      changeDraft({controlPoints:arr});setControlIndex(null);setTool("pan");return;
    }
    if(tool==="draw"&&working){
      if(working.corners.length>=80)return;
      const near=draft.plots.flatMap(plot=>plot.corners).find(q=>
        Math.hypot((q[0]-p[0])*draft.width,(q[1]-p[1])*draft.height)<8*frame.w/(svg.clientWidth||1));
      const corners=[...working.corners,near||p];
      editWorking(p=>({...p,corners,layout:corners.length===3?"three":"four",sides:assignSides(corners)}));
      return;
    }
    if(tool==="edit"&&working){
      const hit=working.corners.findIndex(q=>
        Math.hypot((q[0]-p[0])*draft.width,(q[1]-p[1])*draft.height)<12*frame.w/(svg.clientWidth||1));
      if(hit>=0){checkpointPlot();dragRef.current=hit;e.currentTarget.setPointerCapture(e.pointerId);}
    }
  }
  function move(e:ReactPointerEvent<SVGSVGElement>){
    const svg=svgRef.current;if(!svg||!draft||!pointerRef.current.has(e.pointerId))return;
    const previous=pointerRef.current.get(e.pointerId)!;
    const before=[...pointerRef.current.values()];
    pointerRef.current.set(e.pointerId,[e.clientX,e.clientY]);
    if(tool==="pan"){
      const box=svg.getBoundingClientRect(),extent={width:draft.width,height:draft.height};
      const viewport={width:box.width,height:box.height};
      const after=[...pointerRef.current.values()];
      if(after.length===2){
        const midpoint=(points:Point[]):Point=>[(points[0][0]+points[1][0])/2-box.left,
          (points[0][1]+points[1][1])/2-box.top];
        const distance=(points:Point[])=>Math.hypot(points[0][0]-points[1][0],
          points[0][1]-points[1][1]);
        setFrame(v=>pinchImageFrame(v,extent,viewport,midpoint(before),
          midpoint(after),distance(before),distance(after)));
      }else if(after.length===1){
        setFrame(v=>panImageFrame(v,extent,viewport,
          [e.clientX-previous[0],e.clientY-previous[1]]));
      }
      return;
    }
    if(tool==="edit"&&dragRef.current!==null&&workingRef.current){
      const point=normalizedSvgPoint(e,svg,draft.width,draft.height);if(!point)return;
      setWorking(prev=>prev?{...prev,corners:prev.corners.map((v,i)=>i===dragRef.current?point:v),
        area:{...prev.area,verified:false},facingVerified:false,
        sides:Object.fromEntries(Object.entries(prev.sides).map(([k,v])=>[k,{...v,verified:false}]))}:prev);
    }
  }
  function up(e:ReactPointerEvent<SVGSVGElement>){
    pointerRef.current.delete(e.pointerId);dragRef.current=null;
    if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
  }
  const missingIssues=useMemo(()=>missingData(),[draft]);
  const approved=state?.draft.verifiedRevision===state?.draft.revision&&Boolean(state?.draft.revision);
  const alreadyLive=Boolean(approved&&state?.activeRelease?.draftRevision===state?.draft.revision);
  const publishedUrl=slug?`/3Dprojects/${encodeURIComponent(slug)}/masterplan`:"";
  const source=assets.find(a=>a.id===draft?.imageAssetId);
  return <main className="masterplan-workspace">
    <header><p className="eyebrow">REKIXO ENGINE · INDEPENDENT IMAGE GEO PROJECT</p>
      <h1>Masterplan Plot Mapper</h1>
      <p>Project: <strong>{state?.project.name||slug}</strong> · Building model/release not required. Approved image and GPS controls remain separate from 3D Buildings.</p></header>
    {error&&<p role="alert" className="masterplan-error">{error}</p>}
    {status&&<p role="status" className="masterplan-ok">{status}</p>}
    {(recovery||recoveryConflict)&&<section className="masterplan-recovery" role="status">
      <strong>{recovery?"Recover unsaved Masterplan work":"Recovery from a different draft revision blocked"}</strong>
      <p>{recovery?"Unapplied edits were found in this browser for the exact saved source and revision.":
        "The browser has an older local snapshot. It was not applied. Export it for manual review or discard it."}</p>
      {recovery&&<button type="button" disabled={dirty||hasPendingPlot()} onClick={recoverLocal}>Restore Local Draft</button>}
      <button type="button" onClick={downloadRecovery}>Download Recovery JSON</button>
      <button type="button" onClick={discardRecovery}>Discard Recovery</button>
    </section>}
    {state&&<div className="masterplan-stats">
      <span>Draft <b>r{draft?.revision||0}</b></span><span>Plots <b>{draft?.plots.length||0}</b></span>
      <span>GPS Points <b>{draft?.controlPoints.length||0}</b></span>
      <span>Verified <b>{approved?"Yes":"No"}</b></span>
      <span>Live <b>{state.activeRelease?"v"+state.activeRelease.version:"Not published"}</b></span></div>}
    <nav className="masterplan-editor-tabs" aria-label="Masterplan editor tools">
      <button type="button" aria-pressed={panel==="source"} className={panel==="source"?"active":""}
        onClick={()=>selectPanel("source")}>01 · Source & GPS</button>
      <button type="button" aria-pressed={panel==="plots"} className={panel==="plots"?"active":""}
        onClick={()=>selectPanel("plots")}>02 · Plot Mapper & Measurements</button>
    </nav>
    <div className="masterplan-tools">
      <button onClick={()=>setTool("pan")} className={tool==="pan"?"active":""}>Pan</button>
      <button onClick={()=>zoom(.8)}>Zoom +</button>
      <button onClick={()=>zoom(1.25)}>Zoom −</button>
      <button onClick={()=>draft&&setFrame(fitImageFrame({width:draft.width,height:draft.height}))}>Fit</button>
      <button disabled={busy||!(working?plotHistory.past.length:draftHistory.past.length)} onClick={undo}>Undo</button>
      <button disabled={busy||!(working?plotHistory.future.length:draftHistory.future.length)} onClick={redo}>Redo</button>
      <button type="button" aria-pressed={advanced} className={advanced?"active":""}
        onClick={()=>setAdvanced(value=>!value)}>{advanced?"Advanced ✓":"Advanced"}</button>
      {panel==="plots"&&<button onClick={newBoundary} disabled={!imageUrl}>+ New Polygon</button>}
      <button disabled={!dirty||busy||!draft?.imageAssetId} onClick={()=>void operation("save")}>Save Draft</button>
      <button disabled={dirty||busy||!state?.draft.revision||Boolean(working)} onClick={()=>void operation("verify")}>Verify</button>
      <button disabled={dirty||busy||!approved||alreadyLive||Boolean(working)}
        onClick={()=>void operation("publish")}>{alreadyLive?"Published · Current Draft":state?.activeRelease?"Publish Update":"Publish Masterplan"}</button>
      {state?.activeRelease&&<a href={publishedUrl} target="_blank" rel="noreferrer">Open Live Geo Map</a>}
    </div>
    <div className="masterplan-grid">
      <section className="masterplan-stage">
        {imageUrl&&draft?.width&&draft?.height?<svg ref={svgRef} viewBox={`${frame.x} ${frame.y} ${frame.w} ${frame.h}`}
          preserveAspectRatio="xMidYMid meet" onPointerDown={down} onPointerMove={move}
          onPointerUp={up} onPointerCancel={up}
          onWheel={e=>{if(!draft)return;e.preventDefault();
            const box=e.currentTarget.getBoundingClientRect();
            const focus=imageWorldAt(frame,{width:box.width,height:box.height},
              [e.clientX-box.left,e.clientY-box.top]);
            zoom(e.deltaY>0?1.12:.88,focus);}}>
          <image href={imageUrl} x="0" y="0" width={draft.width} height={draft.height} />
          {draft.plots.map(plot=><g key={plot.id} onClick={()=>tool!=="draw"&&tool!=="front"&&choose(plot)}>
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
            {sideCoverage&&!sideCoverage.ok&&[...new Set([...sideCoverage.missingEdges,...sideCoverage.duplicateEdges])].map(i=>{
              const a=working.corners[i],b=working.corners[(i+1)%working.corners.length];
              return <line key={"missing-"+i} x1={a[0]*draft.width} y1={a[1]*draft.height}
                x2={b[0]*draft.width} y2={b[1]*draft.height}
                stroke="#ff5964" strokeWidth={Math.max(3,frame.w/300)}
                strokeLinecap="round" pointerEvents="none"/>;
            })}
            {working.corners.map((p,i)=><circle key={i} cx={p[0]*draft.width} cy={p[1]*draft.height}
              r={Math.max(5,frame.w/140)} fill="#ffe7a1" stroke="#112734" strokeWidth={1.5}/>)}
          </g>}
        </svg>:<div className="masterplan-placeholder">
          <strong>No approved masterplan source selected</strong>
          <p>Upload an image in the Source workspace. No Building GLB is needed.</p>
        </div>}
        <p className="masterplan-stage-hint">{tool==="pan"?"Drag to pan; use two fingers to pinch-zoom on touch screens, or Zoom/Fit.":
          tool==="draw"?"Tap each plot corner; then enter approved details and apply.":
          tool==="edit"?"Drag an individual polygon corner; side approvals reset.":
          tool==="front"?"Tap the real road-facing edge to set Front. Other sides update automatically.":
          "Tap a location on the image for selected GPS control point."}</p>
      </section>
      <aside className="masterplan-dock">
        {panel==="source"?<>
          <h2>Original Masterplan</h2>
          {advanced&&draft?.imageAssetId&&<button type="button" disabled={!draft}
            onClick={()=>draft&&exportMasterplanDraftReview(slug,draft)}>
            Download source-change review snapshot (JSON · not a full backup)
          </button>}
          <label>Upload image (PNG, JPG, WebP · max 16 MB)
            <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy}
              onChange={e=>{const file=e.target.files?.[0];e.target.value="";
                if(file){setBusy(true);void prepareSource(file).catch(x=>setError(String(x))).finally(()=>setBusy(false));}}}/></label>
          <p>{source?.name||"No image"} · {draft?.width||0}×{draft?.height||0} px</p>
          {imageComparison&&<section className="masterplan-image-comparison">
            <strong>Safe Image Replace · Compare Before Applying</strong>
            <div className="masterplan-image-comparison__grid">
              <figure><img src={imageUrl} alt="Current source map"/><figcaption>Current original</figcaption></figure>
              <figure><img src={imageComparison.previewUrl} alt="Replacement map candidate"/><figcaption>New candidate</figcaption></figure>
            </div>
            <p>{imageComparison.width} × {imageComparison.height} px. Keep geometry only if corresponding plot corners and GPS anchors line up exactly. No published map will change yet.</p>
            <label className="masterplan-check"><input type="checkbox" checked={imageCompared}
              onChange={e=>setImageCompared(e.target.checked)}/> I compared image alignment and source evidence</label>
            <button type="button" disabled={busy||!imageCompared||imageComparison.width!==draft?.width||imageComparison.height!==draft?.height}
              onClick={()=>void acceptComparedSource(true)}>Keep Geometry as Unverified Draft</button>
            <button type="button" disabled={busy} onClick={()=>void acceptComparedSource(false)}>Replace and Reset Mapping Draft</button>
            <button type="button" disabled={busy} onClick={()=>{setImageComparison(null);setImageCompared(false);}}>Cancel</button>
          </section>}
          <h2>Geo Control Points</h2>
          <p>Use 3–24 surveyed control points. Select Position and tap matching location on the image; then enter exact Latitude/Longitude and source.</p>
          {draft?.controlPoints.map((cp,i)=><fieldset key={i}><legend>Control Point {i+1}</legend>
            <button onClick={()=>{setTool("point");setControlIndex(i);}}>Set Image Position</button>
            {advanced&&<small>U {cp.u.toFixed(6)}, V {cp.v.toFixed(6)}</small>}
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
            {advanced&&<button onClick={()=>changeDraft({controlPoints:draft.controlPoints.filter((_,j)=>j!==i)})}>Remove Point</button>}
          </fieldset>)}
          <button disabled={!draft||draft.controlPoints.length>=24} onClick={()=>draft&&changeDraft({
            controlPoints:[...draft.controlPoints,{u:.5,v:.5,lat:0,lng:0,source:"",verified:false}]})}>+ Add GPS Point</button>
        </>:<>
          <h2>Plot Inventory</h2>
          <label>Import Plot Data CSV (preview first · draft only)
            <input type="file" accept=".csv,text/csv" disabled={busy||dirty||Boolean(working)||!draft}
              onChange={e=>{const file=e.target.files?.[0];e.target.value="";
                if(file)void previewCsv(file).catch(error=>setError(error instanceof Error?error.message:String(error)));}}/>
          </label>
          {csvPreview&&<section className="masterplan-csv-preview" role="status">
            <strong>CSV Review · {csvName}</strong>
            <p>{csvPreview.rowCount} source IDs · {csvPreview.added.length} new polygons · {csvPreview.changed.length} metadata updates</p>
            <p>{csvPreview.unmapped.length} plots need drawing · {csvPreview.missing.length} mapped IDs absent from CSV · {csvPreview.issues.length} measurement/review issues</p>
            {csvPreview.unmapped.length>0&&<small>Unmapped: {csvPreview.unmapped.slice(0,12).join(", ")}</small>}
            {csvPreview.missing.length>0&&<small>Existing plots not in CSV (preserved): {csvPreview.missing.slice(0,12).join(", ")}</small>}
            {csvPreview.issues.slice(0,8).map((issue,i)=><small key={i}>{issue}</small>)}
            <button type="button" disabled={dirty||Boolean(working)||(!csvPreview.changed.length&&!csvPreview.added.length)}
              onClick={applyCsvPreview}>Apply CSV to Draft Only</button>
            <button type="button" onClick={()=>setCsvPreview(null)}>Cancel Import</button>
          </section>}
          <details className="masterplan-missing-data">
            <summary>Missing Data Checker · {missingIssues.length} issues</summary>
            {missingIssues.length===0?<p>All mapped plot fields are source-reviewed.</p>:
              <ul>{missingIssues.slice(0,35).map((issue,i)=><li key={i}>{issue}</li>)}</ul>}
            {missingIssues.length>35&&<small>Showing first 35; download mapping CSV for a full source review.</small>}
          </details>
          <div className="masterplan-inventory">{draft?.plots.map(p=><button key={p.id} type="button"
            className={working?.id===p.id?"active":""} onClick={()=>choose(p)}>{p.id}</button>)}</div>
          {working?<fieldset><legend>Plot {working.id}</legend>
            <label>Plot Number <input value={working.id} readOnly={originalId!==null}
              onChange={e=>updatePlot("id",e.target.value)}/></label>
            {advanced&&<small>{working.corners.length} polygon corners</small>}
            <button disabled={!working.corners.length} onClick={()=>editWorking(p=>({...p,
              corners:p.corners.slice(0,-1),sides:assignSides(p.corners.slice(0,-1)),
               area:{...p.area,verified:false},facingVerified:false}))}>Undo Corner</button>
            <button disabled={working.corners.length<3} onClick={()=>setTool("edit")}>Drag Corners</button>
            {sideCoverage&&!sideCoverage.ok&&<div className="masterplan-guidance" role="alert">
              <strong>Side edges need repair</strong>
              <p>Unassigned: {sideCoverage.missingEdges.map(i=>i+1).join(", ")||"none"} ·
                Duplicated: {sideCoverage.duplicateEdges.map(i=>i+1).join(", ")||"none"} ·
                Missing roles: {sideCoverage.missingRoles.join(", ")||"none"}</p>
              <button type="button" disabled={busy} onClick={()=>{
                if(!window.confirm("Repair only logical side assignments for Plot "+working.id+
                  "? The original polygon, CSV measurements and published map remain unchanged. Reverify side assignments."))return;
                try{
                  editWorking(p=>repairGeoPlotSideCoverage(p));
                  setStatus("Side coverage repaired. Review Front/Depth and approved dimensions.");
                }catch(e){setError(String(e));}
              }}>Repair Sides · Keep Polygon</button>
            </div>}
            {sideCoverage?.ok&&<small>✓ {sideCoverage.edgeCount} edges assigned exactly once</small>}
            {working.corners.length>=3&&<div className="masterplan-guidance">
              Initial Front = first tapped edge. After mapping, choose any road-facing edge to change Front; other sides update automatically.
              {inferFrontFirstSideGroups(working.corners)?.reviewRequired&&
                <p>Irregular side groups need manual review; no surveyed length is guessed.</p>}
            </div>}
            {working.corners.length===4&&working.layout==="four"&&
              <button type="button" className={tool==="front"?"active":""}
                onClick={()=>setTool("front")}>↔ Choose Front on Map</button>}
            <label>Approved Area<input type="number" step="any" min="0" value={working.area.value||""}
              onChange={e=>updatePlot("area",{...working.area,value:Number(e.target.value),verified:false})}/></label>
            <label>Area Unit<select value={working.area.unit} onChange={e=>updatePlot("area",
              {...working.area,unit:e.target.value as Plot["area"]["unit"],verified:false})}>
                <option value="sqft">sqft</option><option value="sqm">sqm</option><option value="sqyd">sqyd</option>
              </select></label>
            {advanced&&<label>Approved Area Source<input value={working.area.source} onChange={e=>
              updatePlot("area",{...working.area,source:e.target.value,verified:false})}/></label>}
            {advanced&&<label className="masterplan-check"><input type="checkbox" checked={working.area.verified}
              onChange={e=>updatePlot("area",{...working.area,verified:e.target.checked})}/> Area verified</label>}
            <label>Facing<select value={working.facing} onChange={e=>editWorking(p=>({...p,
              facing:e.target.value,facingVerified:false}))}>
              {directions.map(d=><option key={d} value={d}>{d}</option>)}</select></label>
            {advanced&&<label>Facing Source<input value={working.facingSource} onChange={e=>
              editWorking(p=>({...p,facingSource:e.target.value,facingVerified:false}))}/></label>}
            {advanced&&<label className="masterplan-check"><input type="checkbox" checked={working.facingVerified}
              onChange={e=>updatePlot("facingVerified",e.target.checked)}/> Facing reviewed</label>}
            <label>Road<input value={working.road} onChange={e=>editWorking(p=>({...p,road:e.target.value,facingVerified:false}))}/></label>
            {working.corners.length===4&&working.layout==="four"&&<label>Road-facing FRONT edge
              <select value={working.sides.front?.edges[0]??0} onChange={e=>setRoadFront(Number(e.target.value))}>
                {working.corners.map((_,i)=><option key={i} value={i}>Edge {i} · Corner {i+1} → {i===3?1:i+2}</option>)}
              </select></label>}
            {working.road&&working.sides.front?.roadFacing!==true&&
              <p className="masterplan-guidance">Review the Front boundary against the road on the approved image. Mark its Road-facing checkbox.</p>}
            {roles.filter(role=>working.layout!=="three"||role!=="depthB").map(role=>{
              const side=working.sides[role]||blankSide();return <fieldset key={role}><legend>{role}</legend>
                {advanced&&<label>Edge indices (0 to {Math.max(0,working.corners.length-1)})
                  <input value={side.edges.join(",")} onChange={e=>setSide(role,{edges:e.target.value.split(",")
                    .map(x=>Number(x.trim())).filter(Number.isInteger),verified:false})}/></label>}
                <label>Length<input type="number" step="any" min="0" value={side.length||""}
                  onChange={e=>setSide(role,{length:Number(e.target.value),verified:false})}/></label>
                <label>Unit<select value={side.unit} onChange={e=>setSide(role,{unit:e.target.value as Side["unit"],verified:false})}>
                  <option value="ft">ft</option><option value="m">m</option></select></label>
                {advanced&&<label>Survey Source<input value={side.source} onChange={e=>
                  setSide(role,{source:e.target.value,verified:false})}/></label>}
                <label className="masterplan-check"><input type="checkbox" checked={side.roadFacing}
                  onChange={e=>setSide(role,{roadFacing:e.target.checked})}/> Road-facing</label>
                {advanced&&<label className="masterplan-check"><input type="checkbox" checked={side.verified}
                  onChange={e=>setSide(role,{verified:e.target.checked})}/> Measurement verified</label>}
              </fieldset>;
            })}
            {advanced&&<label>Notes<textarea rows={2} value={working.notes} onChange={e=>updatePlot("notes",e.target.value)}/></label>}
            {!advanced&&<small>Source verification and edge details are in Advanced.</small>}
            <button disabled={working.corners.length<3} onClick={()=>apply()}>Apply Plot to Draft</button>
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
