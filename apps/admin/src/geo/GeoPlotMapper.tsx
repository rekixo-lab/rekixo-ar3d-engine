import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { projects as listProjects, type CloudProjectSummary } from "../studio/cloud";
import {adjacentPlot,boundedZoom,hasPendingPlotEdits,isTextEditingTarget,
  nextFreePlotId,sideLabelAnchor} from "../../../../shared/geo-plot-editor.js";
import GeoPlotInventoryPanel from "./GeoPlotInventoryPanel";
import GeoPlotImageAlignmentPanel from "./GeoPlotImageAlignmentPanel";
import GeoPlotCommercialPanel from "./GeoPlotCommercialPanel";
import {nextUnmappedInventory,parseGeoInventoryCsv,normalizeGeoInventoryRows,
  type GeoInventoryRow} from "../../../../shared/geo-plot-inventory.js";
import {precisionSnap,zoomAnchorDelta,isMappingTap} from "../../../../shared/geo-mapper-pointer.js";
import {inferFrontFirstSideGroups,roadFrontPreview} from "../../../../shared/geo-plot-smart-sides.js";
import {inspectGeoPlotSideCoverage,repairGeoPlotSideCoverage} from "../../../../shared/geo-plot-side-integrity.js";
import {stageGeoManualSideRange,proposeGeoManualSideMapping,applyGeoManualSideProposal,
  geoManualSourceSignature, type GeoManualSideLocks,type GeoManualProposal
} from "../../../../shared/geo-plot-manual-sides.js";
import {geoInventoryReviewIssues} from "../../../../shared/geo-plot-source-review.js";
import {assignFourCornerRoadFront,applyApprovedInventoryRow} from "../../../../shared/geo-plot-source-operations.js";
import {cloneUnverifiedGeoPlot,geoPlotEvidenceManifest,geoPlotQualityReport} from "../../../../shared/geo-plot-stage3-review.js";
import {geoPlotReviewQueue} from "../../../../shared/geo-plot-quality-queue.js";
import {stageVerifiedImageCorner} from "../../../../shared/geo-plot-image-corner.js";
import {geoPlotToolResumeAction,geoPlotPausedDrawingLabel} from "../../../../shared/geo-plot-tool-resume.js";
import {nextCsvPlotForDrawing,assignVisiblePlotEdge,
  draftStorageKey,packLocalPlotDraft,unpackLocalPlotDraft,visibleMappingProgress
} from "../../../../shared/geo-plot-mapper-ux.js";
import type {SimilarityTransform} from "../../../../shared/geo-plot-image-alignment.js";
import {GEO_COMPASS_DIRECTIONS,suggestGeoSideFacing,
  type GeoDirection} from "../../../../shared/geo-plot-facing.js";
import {newPlotEditHistory,replacePlotEditHistory,updatePlotEditHistory,
  closeGroupedPlotEdit,undoPlotEdit,redoPlotEdit,geometryWithRevokedApprovals,nudgePlotCorner
} from "../../../../shared/geo-plot-precision-history.js";
import "./geo-plot-mapper.css";

type Point = [number, number]; // Immutable Building-local X/Z metres.
type Role = "front" | "back" | "depthA" | "depthB";
type Side = { edges: number[]; length: number; unit: "ft" | "m"; roadFacing: boolean; facingDirection?: GeoDirection; source: string; verified: boolean };
type Plot = { id: string; corners: Point[]; layout: "three" | "four";
  sides: Partial<Record<Role, Side>>; area: { value: number; unit: "sqft" | "sqm" | "sqyd"; source: string; verified: boolean };
  facing: string; facingSource:string; facingVerified:boolean; planeY?:number;planeSource?:string;planeVerified?:boolean;road: string; notes: string };
type MappingState = { geoReleaseId: string | null; buildingReleaseId: string | null;
  inventoryRevision:number;alignmentRevision:number;
  draft: {revision:number;verifiedRevision:number|null;verifiedInventoryRevision:number|null;
    verifiedAlignmentRevision:number|null;
    stale:boolean;plots:Plot[]};
  activeMapping:{id:string;version:number;draftRevision?:number;current:boolean;publicationMode:"verified"|"preliminary"}|null;
  releases:Array<{id:string;version:number;geoReleaseId:string;publicationMode:"verified"|"preliminary"}> };
type GeoPublic = { geoRelease:{id:string}; buildingRelease:{id:string};
  model:{url:string;sha256?:string;byteSize?:number}; canonicalModel?:{url:string;sha256?:string;byteSize?:number}; placement:{headingDeg:number;scale:number} };
type ToolMode = "pan" | "draw" | "edit" | "align" | "side";
type PointerPreview = {clientX:number;clientY:number;rawScreen:Point;screen:Point;
  point:Point;kind:"none"|"vertex"|"edge";pointerType:string};
type PointerStart = {id:number;x:number;y:number;cancelled?:boolean};
const ROLES: Role[] = ["front", "back", "depthA", "depthB"];
const directions=GEO_COMPASS_DIRECTIONS.map(item=>item.id);
const emptySide = (edges:number[]=[]):Side => ({edges,length:0,unit:"ft",roadFacing:false,source:"",verified:false});
const blank = (id:string):Plot => ({id,corners:[],layout:"four",sides:{},
  area:{value:0,unit:"sqft",source:"",verified:false},facing:"north",facingSource:"",facingVerified:false,road:"",notes:""});
function fromInventory(row:GeoInventoryRow,planeY:number):Plot {
  return {...blank(row.id),planeY,planeSource:"",planeVerified:false,
    area:{value:row.area,unit:row.areaUnit||"sqft",source:row.areaSource,verified:false},
    facing:row.facing||"north",facingSource:row.facingSource,road:row.road,
    notes:[row.dimensions?"Approved dimensions label: "+row.dimensions:"",row.notes].filter(Boolean).join(" · ")};
}
function sidesWithInventory(corners:Point[],row?:GeoInventoryRow):Plot["sides"] {
  const sides=initialSides(corners);
  if(!row)return sides;
  for(const role of ROLES){
    const side=sides[role];
    if(!side||!(row[role]>0))continue;
    sides[role]={...side,length:row[role],unit:row.lengthUnit||"ft",
      source:row.measurementSource,verified:false};
  }
  return sides;
}
function initialSides(corners:Point[]): Plot["sides"] {
  const suggestion=inferFrontFirstSideGroups(corners);
  if(!suggestion)return {};
  const result:Plot["sides"]={};
  for(const role of ROLES){
    const indices=suggestion.roles[role];
    if(!indices?.length)continue;
    const length=indices.reduce((sum,j)=>sum+Math.hypot(
      corners[j][0]-corners[(j+1)%corners.length][0],
      corners[j][1]-corners[(j+1)%corners.length][1]),0);
    result[role]={...emptySide([...indices]),length:Number((length*3.280839895).toFixed(3))};
  }
  return result;
}
function areaSqm(points:Point[]) {
  return Math.abs(points.reduce((v,p,i)=>v+p[0]*points[(i+1)%points.length][1] -
    p[1]*points[(i+1)%points.length][0],0))/2;
}
function measurementVariance(geometrySqm:number,approvedValue:number,unit:Plot["area"]["unit"],geoScale:number) {
  if(!(geometrySqm>0) || !(approvedValue>0) || !(geoScale>0))return null;
  const sqm=approvedValue*(unit==="sqft"?0.09290304:unit==="sqyd"?0.83612736:1);
  return (geometrySqm*geoScale*geoScale-sqm)/sqm;
}
function geometrySideLengthMetres(points:Point[],edges:number[],geoScale:number) {
  return edges.reduce((length,i)=>{
    if(!Number.isInteger(i)||i<0||i>=points.length)return length;
    const a=points[i],b=points[(i+1)%points.length];
    return length+Math.hypot(a[0]-b[0],a[1]-b[1])*geoScale;
  },0);
}
function facingFromGeo(points:Point[],edges:number[],heading:number) {
  // Never invent North when the selected road edge cannot be resolved.
  return suggestGeoSideFacing(points,edges,heading);
}
async function callApi<T>(url:string,init?:RequestInit):Promise<T> {
  const r=await fetch(url,{cache:"no-store",...init,headers:{"Accept":"application/json",...init?.headers}});
  if(!r.headers.get("content-type")?.toLowerCase().includes("application/json"))
    throw Error("Geo Plot Mapper API returned a web page instead of JSON. Please retry or contact support.");
  let data:T & {error?:string};
  try{data=await r.json() as T & {error?:string};}
  catch{throw Error("Geo Plot Mapper API returned malformed JSON. Please retry or contact support.");}
  if(!r.ok) throw Error(data.error || "Request failed ("+r.status+").");
  return data;
}
async function modelFromVerifiedSource(model:GeoPublic["model"]) {
  const r=await fetch(model.url,{cache:"no-store"});
  if(!r.ok) throw Error("Published 3D model unavailable.");
  const buf=await r.arrayBuffer();
  if(model.byteSize!==undefined && model.byteSize!==buf.byteLength) throw Error("Model byte count mismatch.");
  if(model.sha256){
    const bytes=new Uint8Array(await crypto.subtle.digest("SHA-256",buf));
    const hash=Array.from(bytes).map(x=>x.toString(16).padStart(2,"0")).join("");
    if(hash!==model.sha256.toLowerCase()) throw Error("Immutable 3D model checksum mismatch.");
  }
  const loader=new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf=await new Promise<{scene:THREE.Group}>((resolve,reject)=>loader.parse(buf,"",resolve,reject));
  return gltf.scene;
}
function parseRows(raw:string):string[][] {
  const out:string[][]=[];let row:string[]=[],field="",quoted=false;
  for(let i=0;i<raw.length;i++){
    const ch=raw[i];
    if(ch==='"'){if(quoted&&raw[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}
    else if(ch===","&&!quoted){row.push(field);field="";}
    else if((ch==="\n"||ch==="\r")&&!quoted){if(ch==="\r"&&raw[i+1]==="\n")i++;row.push(field);if(row.some(x=>x.trim()))out.push(row);row=[];field="";}
    else field+=ch;
  }
  if(quoted)throw Error("CSV has an unclosed quoted field.");
  row.push(field);if(row.some(x=>x.trim()))out.push(row);
  return out;
}
function csvCell(value:unknown){return '"'+String(value??"").replace(/"/g,'""').replace(/^[=+@-]/,"'$&")+'"';}
function coverageError(coverage:ReturnType<typeof inspectGeoPlotSideCoverage>){
  const problems:string[]=[];
  if(coverage.missingEdges.length)problems.push("Unassigned edge(s): "+coverage.missingEdges.map(i=>i+1).join(", "));
  if(coverage.duplicateEdges.length)problems.push("Duplicate edge(s): "+coverage.duplicateEdges.map(i=>i+1).join(", "));
  if(coverage.missingRoles.length)problems.push("Missing side: "+coverage.missingRoles.join(", "));
  if(coverage.disconnectedRoles.length)problems.push("Disconnected side: "+coverage.disconnectedRoles.join(", "));
  if(coverage.invalidEdges.length)problems.push("Invalid side edge indices");
  return problems.join(" · ")||"Side assignment requires review.";
}
export default function GeoPlotMapper(){
  const [options,setOptions]=useState<CloudProjectSummary[]>([]);
  const [slug,setSlug]=useState(()=>new URLSearchParams(location.search).get("project")||"");
  const [state,setState]=useState<MappingState|null>(null);
  const [geo,setGeo]=useState<GeoPublic|null>(null);
  const [plots,setPlots]=useState<Plot[]>([]);
  const [inventoryRows,setInventoryRows]=useState<GeoInventoryRow[]>([]);
  const [inventoryImportNonce,setInventoryImportNonce]=useState(0);
  // Each draft plot has its own bounded, reversible local edit history.
  // Switching plots or projects clears that history; no release is modified.
  const dragStartRef=useRef<Plot|null>(null);
  const [workingHistory,setWorkingHistory]=useState(()=>newPlotEditHistory<Plot>());
  const working=workingHistory.present;
  const [selectedCorner,setSelectedCorner]=useState<number|null>(null);
  const [nudgeStep,setNudgeStep]=useState(0.01);
  const [sideEditKind,setSideEditKind]=useState<"auto"|"manual">("manual");
  const [manualSideLocks,setManualSideLocks]=useState<GeoManualSideLocks>({});
  const [manualStartCorner,setManualStartCorner]=useState<number|null>(null);
  const [manualProposal,setManualProposal]=useState<GeoManualProposal<Plot>|null>(null);
  const setWorking=useCallback((update:SetStateAction<Plot|null>)=>{
    // Capture grouping before React batches a pointer release; a closed drag must
    // not accidentally create one undo entry per intermediate frame.
    const grouped=dragStartRef.current!==null;
    setWorkingHistory(history=>{
      const next=typeof update==="function"?update(history.present):update;
      return updatePlotEditHistory(history,next,{grouped});
    });
  },[]);
  const resetWorking=useCallback((plot:Plot|null)=>{
    dragStartRef.current=null;setSelectedCorner(null);
    setManualSideLocks({});setManualStartCorner(null);setManualProposal(null);
    setWorkingHistory(history=>replacePlotEditHistory(history,plot));
  },[]);
  const closeCornerDrag=()=>{
    const started=dragStartRef.current;dragStartRef.current=null;
    if(started)setWorkingHistory(history=>closeGroupedPlotEdit(history,started));
  };
  const undoWorkingEdit=()=>{
    if(dragStartRef.current)return;
    setManualSideLocks({});setManualStartCorner(null);setManualProposal(null);
    setWorkingHistory(undoPlotEdit);
  };
  const redoWorkingEdit=()=>{
    if(dragStartRef.current)return;
    setManualSideLocks({});setManualStartCorner(null);setManualProposal(null);
    setWorkingHistory(redoPlotEdit);
  };
  const [originalId,setOriginalId]=useState<string|null>(null);
  const [dirty,setDirty]=useState(false);
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  const [mode,setMode]=useState<ToolMode>("pan");
  const [shape,setShape]=useState<"four"|"irregular">("four");
  const [viewTick,setViewTick]=useState(0);
  const [viewport,setViewport]=useState({w:800,h:520});
  const [modelStatus,setModelStatus]=useState("Choose a published Geo project.");
  const [groundY,setGroundY]=useState(0);
  // Like the Platform mapper, snapping is opt-in: don't silently move approved corners.
  const [snap,setSnap]=useState(false);
  const [selectedRole,setSelectedRole]=useState<Role>("front");
  const [selectedFacingRole,setSelectedFacingRole]=useState<Role>("front");
  const [extendSide,setExtendSide]=useState(false);
  const [inspectorTab,setInspectorTab]=useState<"sources"|"plot"|"quality"|"publish">("plot");
  const [recoveredLocalDraft,setRecoveredLocalDraft]=useState<{
    plot:Plot;originalId:string|null;shape:"four"|"irregular";checkedAt:number
  }|null>(null);
  const [inventoryQuery,setInventoryQuery]=useState("");
  const [publishedPreview,setPublishedPreview]=useState<{
    draftRevision:number;activeReleaseId:string|null;token:string;
    diff:{liveCount:number;draftCount:number;added:number;removed:number;changed:number;
      changes:Array<{plotId:string;kind:string;fields:string[]}>};
    continuity?:{sourceRows:number;carriedRows:number;reviewRows:number;missingRows:number}
  }|null>(null);
  const [cloneFrom,setCloneFrom]=useState("");
  const [cloneX,setCloneX]=useState("");
  const [cloneZ,setCloneZ]=useState("");
  const [focused,setFocused]=useState(false);
  const [zoomPercent,setZoomPercent]=useState(100);
  const [showGuides,setShowGuides]=useState(true);
  const [pointerPreview,setPointerPreview]=useState<PointerPreview|null>(null);
  const activeProjectRef=useRef(slug);
  activeProjectRef.current=slug;
  const editorRef=useRef<HTMLDivElement>(null);
  const hostRef=useRef<HTMLDivElement>(null);
  const modelBoundsRef=useRef<{center:THREE.Vector3;size:THREE.Vector3;maxY:number}|null>(null);
  const rendererRef=useRef<THREE.WebGLRenderer|null>(null);
  const cameraRef=useRef<THREE.OrthographicCamera|null>(null);
  const controlsRef=useRef<OrbitControls|null>(null);
  const pointerGeometry=useMemo(()=>({
    raycaster:new THREE.Raycaster(),
    plane:new THREE.Plane(new THREE.Vector3(0,1,0),0),
    uv:new THREE.Vector2(),hit:new THREE.Vector3(),projected:new THREE.Vector3()
  }),[]);
  const dragRef=useRef<number|null>(null);
  const alignmentPickRef=useRef<((point:Point)=>void)|null>(null);
  const pointerStartRef=useRef<PointerStart|null>(null);
  const pointerPreviewRef=useRef<PointerPreview|null>(null);
  const pointerRafRef=useRef(0);
  const pointerPendingRef=useRef<{x:number;y:number;kind:string;skip?:number}|null>(null);
  const dragFrameRef=useRef(0);
  const pendingDragRef=useRef<{index:number;x:number;y:number}|null>(null);
  const pointerStatePaintRef=useRef(0);
  const overlayRef=useRef<SVGSVGElement>(null);
  const workingRef=useRef(working);
  workingRef.current=working;
  const advancedDetailsRef=useRef<HTMLDetailsElement|null>(null);
  const displayedPlots=useMemo(()=>plots.filter(p=>p.id.toLowerCase().includes(inventoryQuery.trim().toLowerCase())),
    [plots,inventoryQuery]);
  const inventoryIssues=useMemo(()=>geoInventoryReviewIssues(plots,inventoryRows),
    [plots,inventoryRows]);
  const selectedInventory=useMemo(()=>inventoryRows.find(p=>
    p.id.toLowerCase()===working?.id.toLowerCase()),[inventoryRows,working?.id]);
  const savedSnapRings=useMemo(()=>plots.filter(p=>p.id!==originalId)
    .map(p=>({points:p.corners})),[plots,originalId]);
  const quality=useMemo(()=>geoPlotQualityReport(plots,inventoryRows,{
    geoScale:geo?.placement.scale,
    mappingStale:Boolean(state?.draft.stale),
    alignmentRevision:state?.alignmentRevision||0,
    verifiedAlignmentRevision:state?.draft.verifiedAlignmentRevision,
    inventoryRevision:state?.inventoryRevision,
    verifiedInventoryRevision:state?.draft.verifiedInventoryRevision
  }),[plots,inventoryRows,geo?.placement.scale,state]);
  const actionableQualityIssues=useMemo(()=>quality.issues.filter(issue=>issue.field!=="unmapped"),[quality]);
  // Group 300+ advisory findings into one actionable item per mapped Plot ID.
  // No source approval or public release is changed by this navigation queue.
  const reviewQueue=useMemo(()=>geoPlotReviewQueue(plots,actionableQualityIssues),
    [plots,actionableQualityIssues]);
  const nextTemplateId=useMemo(()=>nextUnmappedInventory(inventoryRows,plots.map(p=>p.id))?.id||
    nextFreePlotId([...plots,...inventoryRows]),[plots,inventoryRows]);
  const onInventoryRowsChange=useCallback((rows:GeoInventoryRow[],revision:number)=>{
    setInventoryRows(rows);setState(prev=>prev?{...prev,inventoryRevision:revision}:prev);
  },[]);
  const onAlignmentRevisionChange=useCallback((revision:number)=>{
    setState(prev=>prev?{...prev,alignmentRevision:revision}:prev);
  },[]);
  const hasUnapplied=hasPendingPlotEdits(working,originalId?plots.find(p=>p.id===originalId):null);
  const sideCoverage=useMemo(()=>working&&working.corners.length>=3?
    inspectGeoPlotSideCoverage(working):null,[working]);
  const previewIsCurrent=Boolean(manualProposal&&working&&
    manualProposal.baseSignature===geoManualSourceSignature(working));
  const progress=useMemo(()=>visibleMappingProgress(inventoryRows,plots),[inventoryRows,plots]);
  useEffect(()=>{
    const key=draftStorageKey(slug);
    if(!key||!state?.geoReleaseId||!state?.buildingReleaseId)return;
    try{
      const raw=window.localStorage.getItem(key);
      const restored=unpackLocalPlotDraft(raw,{
        projectSlug:slug,geoReleaseId:state.geoReleaseId,
        buildingReleaseId:state.buildingReleaseId,mappingRevision:state.draft.revision
      }) as {plot:Plot;originalId:string|null;shape:"four"|"irregular";checkedAt:number}|null;
      setRecoveredLocalDraft(restored);
      if(raw&&!restored)window.localStorage.removeItem(key);
    }catch{setRecoveredLocalDraft(null);}
  },[slug,state?.geoReleaseId,state?.buildingReleaseId,state?.draft.revision]);
  useEffect(()=>{
    const key=draftStorageKey(slug);
    if(!key||!working||!hasUnapplied||!state?.geoReleaseId||!state?.buildingReleaseId)return;
    const timer=window.setTimeout(()=>{
      const raw=packLocalPlotDraft({
        projectSlug:slug,geoReleaseId:state.geoReleaseId!,buildingReleaseId:state.buildingReleaseId!,
        mappingRevision:state.draft.revision,plot:working,originalId,shape
      });
      if(raw)try{window.localStorage.setItem(key,raw);}catch{/* Private browser storage optional. */}
    },350);
    return()=>window.clearTimeout(timer);
  },[slug,working,originalId,shape,hasUnapplied,state?.geoReleaseId,
    state?.buildingReleaseId,state?.draft.revision]);
  const flushLocalDraftRef=useRef<()=>void>(()=>{});
  flushLocalDraftRef.current=()=>{
    const key=draftStorageKey(slug);
    if(!key||!working||!hasUnapplied||!state?.geoReleaseId||!state?.buildingReleaseId)return;
    const raw=packLocalPlotDraft({
      projectSlug:slug,geoReleaseId:state.geoReleaseId,buildingReleaseId:state.buildingReleaseId,
      mappingRevision:state.draft.revision,plot:working,originalId,shape
    });
    if(raw)try{window.localStorage.setItem(key,raw);}catch{/* Storage may be disabled. */}
  };
  useEffect(()=>{
    // Stable browser listeners, latest data via ref. Pointer dragging must not
    // repeatedly detach and reattach listeners on every React render.
    const flush=()=>flushLocalDraftRef.current();
    const onVisibility=()=>{if(document.visibilityState==="hidden")flush();};
    window.addEventListener("pagehide",flush);
    document.addEventListener("visibilitychange",onVisibility);
    return()=>{
      window.removeEventListener("pagehide",flush);
      document.removeEventListener("visibilitychange",onVisibility);
    };
  },[]);
  const clearLocalPlotDraft=()=>{
    const key=draftStorageKey(slug);
    if(key)try{window.localStorage.removeItem(key);}catch{/* Storage may be disabled. */}
    setRecoveredLocalDraft(null);
  };
  const restoreLocalPlotDraft=()=>{
    if(!recoveredLocalDraft||!state||dirty||busy)return;
    const p=recoveredLocalDraft.plot;
    const original=recoveredLocalDraft.originalId;
    const sameSource=(!original||plots.some(x=>x.id===original))&&
      (original||!plots.some(x=>x.id===p.id))&&
      (!inventoryRows.length||inventoryRows.some(x=>x.id===p.id));
    if(!sameSource){clearLocalPlotDraft();setMessage("ERROR: Local draft conflicts with current mapped inventory. Original data preserved.");return;}
    if(!confirmUnapplied()||!window.confirm("Recover only the unfinished private Plot "+p.id+
      " in this browser? The published customer website is unchanged."))return;
    resetWorking(p);setOriginalId(original);setShape(recoveredLocalDraft.shape);
    setMode(p.corners.length>=3?"edit":"draw");setInspectorTab("plot");
    setRecoveredLocalDraft(null);
    setMessage("Recovered unfinished local Plot "+p.id+". Review its corners and source before confirming.");
  };
  const api=slug?`/3Dprojects/api/cloud/projects/${encodeURIComponent(slug)}/geo-plots`:"";
  const refresh=useCallback(async(isCurrent:()=>boolean)=>{
    if(!slug){setState(null);setGeo(null);setPlots([]);return;}
    setMessage("");
    const [mapped,experience]=await Promise.all([
      callApi<MappingState>(`/3Dprojects/api/cloud/projects/${encodeURIComponent(slug)}/geo-plots`),
      callApi<GeoPublic>(`/3Dprojects/api/cloud/projects/${encodeURIComponent(slug)}/geo-plots/source`)
    ]);
    if(!isCurrent())return; // Never load a previous project after rapid project switching.
    if(mapped.geoReleaseId!==experience.geoRelease.id || mapped.buildingReleaseId!==experience.buildingRelease.id)
      throw Error("Geo source mismatch. Reload verified Geo releases.");
    setState(mapped);setGeo(experience);setPlots(mapped.draft.plots);setDirty(false);setWorking(null);
  },[slug]);
  useEffect(()=>{void listProjects().then(r=>setOptions(r.projects)).catch(()=>undefined);},[]);
  useEffect(()=>{
    let live=true;
    setState(null);setGeo(null);setPlots([]);setInventoryRows([]);setWorking(null);setDirty(false);
    pointerPreviewRef.current=null;setPointerPreview(null);alignmentPickRef.current=null;
    void refresh(()=>live).catch(e=>{if(live){setState(null);setGeo(null);
      setMessage("ERROR: "+(e instanceof Error?e.message:"Unable to load published Geo source."));}});
    return()=>{live=false;};
  },[refresh]);
  useEffect(()=>{
    const host=hostRef.current;if(!host||!geo)return;
    let alive=true,frame=0,object:THREE.Object3D|undefined;
    const scene=new THREE.Scene();
    scene.background=new THREE.Color(0x0e1f30);
    scene.add(new THREE.HemisphereLight(0xffffff,0x647084,2.2));
    const light=new THREE.DirectionalLight(0xffffff,2.5);light.position.set(35,100,45);scene.add(light);
    const camera=new THREE.OrthographicCamera(-10,10,10,-10,0.01,100000);
    cameraRef.current=camera;
    let renderer:THREE.WebGLRenderer;
    try{renderer=new THREE.WebGLRenderer({antialias:true});}
    catch{setModelStatus("WebGL is unavailable on this device.");return;}
    rendererRef.current=renderer;renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));
    renderer.outputColorSpace=THREE.SRGBColorSpace;host.appendChild(renderer.domElement);
    const controls=new OrbitControls(camera,renderer.domElement);
    controlsRef.current=controls;controls.enableRotate=false;controls.enableDamping=true;
    controls.minZoom=1;controls.maxZoom=50;controls.zoomToCursor=true;
    controls.mouseButtons.LEFT=THREE.MOUSE.PAN;controls.touches.ONE=THREE.TOUCH.PAN;
    controls.touches.TWO=THREE.TOUCH.DOLLY_PAN;controls.screenSpacePanning=true;
    const render=()=>{
      frame=requestAnimationFrame(render);
      controls.update();renderer.render(scene,camera);

    };
    const resize=()=>{const w=host.clientWidth,h=host.clientHeight;if(!w||!h)return;
      renderer.setSize(w,h,false);setViewport({w,h});
      const mid=Math.max(camera.right,-camera.left);
      camera.left=-mid;camera.right=mid;camera.top=mid*h/w;camera.bottom=-mid*h/w;
      camera.updateProjectionMatrix();setViewTick(v=>v+1);};
    const obs=new ResizeObserver(resize);obs.observe(host);
    const changed=()=>{setViewTick(v=>v+1);setZoomPercent(Math.round(camera.zoom*100));};
    controls.addEventListener("change",changed);
    setModelStatus("Loading checksum-verified 3D master plan…");
    void modelFromVerifiedSource(geo.canonicalModel||geo.model).then(m=>{
      if(!alive){m.traverse(n=>{if(n instanceof THREE.Mesh){n.geometry.dispose();}});return;}
      object=m;scene.add(m);const box=new THREE.Box3().setFromObject(m);
      if(box.isEmpty())throw Error("3D source has no geometry.");
      const center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
      modelBoundsRef.current={center:center.clone(),size:size.clone(),maxY:box.max.y};
      const span=Math.max(size.x,size.z,1)*0.68;
      camera.left=-span;camera.right=span;
      const w=Math.max(host.clientWidth,1),h=Math.max(host.clientHeight,1);
      camera.top=span*h/w;camera.bottom=-span*h/w;
      camera.position.set(center.x,box.max.y+Math.max(size.y,span)*2.5,center.z);
      camera.up.set(0,0,-1);camera.lookAt(center);camera.updateProjectionMatrix();
      camera.zoom=1;controls.target.copy(center);controls.update();
      setZoomPercent(100);setGroundY(box.min.y);setModelStatus("");
      setViewTick(v=>v+1);
    }).catch(e=>{if(alive)setModelStatus(e instanceof Error?e.message:"Model failed to load.");});
    resize();render();
    return()=>{alive=false;cancelAnimationFrame(frame);obs.disconnect();controls.removeEventListener("change",changed);
      controls.dispose();renderer.forceContextLoss();renderer.dispose();renderer.domElement.remove();
      if(object)object.traverse(n=>{if(n instanceof THREE.Mesh){n.geometry.dispose();const mats=Array.isArray(n.material)?n.material:[n.material];mats.forEach(mat=>mat.dispose());}});
      cameraRef.current=null;rendererRef.current=null;controlsRef.current=null;modelBoundsRef.current=null;
      pointerPreviewRef.current=null;};
  },[geo?.canonicalModel?.url,geo?.canonicalModel?.sha256,geo?.model.url,geo?.model.sha256]);
  const project=(p:readonly [number,number]):Point=>{
    const camera=cameraRef.current;if(!camera)return [0,0];
    const vec=pointerGeometry.projected.set(p[0],groundY+0.02,p[1]).project(camera);
    return [(vec.x+1)*viewport.w/2,(1-vec.y)*viewport.h/2];
  };
  const unproject=(clientX:number,clientY:number):Point|null=>{
    const host=hostRef.current,camera=cameraRef.current;if(!host||!camera)return null;
    const rect=host.getBoundingClientRect();if(!rect.width||!rect.height)return null;
    const x=(clientX-rect.left)/rect.width*2-1,y=1-(clientY-rect.top)/rect.height*2;
    const pointer=pointerGeometry;
    pointer.uv.set(x,y);pointer.plane.constant=-groundY;
    pointer.raycaster.setFromCamera(pointer.uv,camera);
    const hit=pointer.raycaster.ray.intersectPlane(pointer.plane,pointer.hit);
    return hit?[Number(hit.x.toFixed(6)),Number(hit.z.toFixed(6))]:null;
  };
  const precisionPointer=(clientX:number,clientY:number,skipIndex=-1)=>{
    const host=hostRef.current,raw=unproject(clientX,clientY);
    if(!host||!raw)return null;
    const rect=host.getBoundingClientRect();
    const screen:Point=[clientX-rect.left,clientY-rect.top];
    if(!snap)return {point:raw,screen,rawScreen:screen,kind:"none" as const};
    const rings:Array<{points:Point[];skipIndex?:number}>=[...savedSnapRings];
    // Snapping never pulls a new polygon onto itself and never locks a dragged
    // handle to its own corner. Cached saved rings avoid all-plot allocation.
    if(mode==="edit"&&workingRef.current?.corners.length)
      rings.push({points:workingRef.current.corners,...(skipIndex>=0?{skipIndex}:{})});
    const target=precisionSnap(raw,screen,rings,project,{enabled:snap,thresholdPx:6});
    return {point:target.point as Point,screen:target.screen as Point,
      rawScreen:screen,kind:target.kind};
  };
  const clearPointer=()=>{
    pointerPendingRef.current=null;pointerPreviewRef.current=null;
    setPointerPreview(null);
  };
  const captureImageAlignmentPoint=(done:(point:Point)=>void)=>{
    if(!geo||!state||state.draft.stale)return;
    alignmentPickRef.current=done;
    setMode("align");
    setMessage("Select the same approved landmark on the 3D canvas. This records a draft control only.");
  };
  const updatePointer=(clientX:number,clientY:number,pointerType:string,skipIndex=-1)=>{
    const host=hostRef.current;if(!host||mode==="pan"||!geo)return;
    const rect=host.getBoundingClientRect();
    if(clientX<rect.left||clientY<rect.top||clientX>rect.right||clientY>rect.bottom){clearPointer();return;}
    const location=precisionPointer(clientX,clientY,skipIndex);
    if(!location)return;
    const next:PointerPreview={clientX,clientY,pointerType,...location};
    pointerPreviewRef.current=next;
    // The browser's native crosshair draws at the real cursor position.
    // State is only for the draft rubberband; precision taps still compute
    // exact model coordinates from each pointer event without throttling.
    const now=performance.now();
    if(now-pointerStatePaintRef.current>=33||!pointerPreview){
      pointerStatePaintRef.current=now;
      setPointerPreview(next);
    }
  };
  const queuePointer=(clientX:number,clientY:number,pointerType:string,skipIndex=-1)=>{
    pointerPendingRef.current={x:clientX,y:clientY,kind:pointerType,skip:skipIndex};
    if(pointerRafRef.current)return;
    pointerRafRef.current=requestAnimationFrame(()=>{
      pointerRafRef.current=0;
      const pending=pointerPendingRef.current;
      if(pending)updatePointer(pending.x,pending.y,pending.kind,pending.skip);
    });
  };
  useEffect(()=>()=>{if(pointerRafRef.current)cancelAnimationFrame(pointerRafRef.current);},[]);
  const confirmUnapplied=()=>!hasUnapplied||window.confirm(
    "This plot has unapplied changes. Leave this plot without applying them?");
  const choose=(plot:Plot)=>{
    if(working?.id===plot.id&&originalId===plot.id)return;
    if(!confirmUnapplied())return;
    clearLocalPlotDraft();resetWorking(structuredClone(plot));
    if(Number.isFinite(plot.planeY))setGroundY(plot.planeY!);
    setOriginalId(plot.id);setShape(plot.corners.length===4?"four":"irregular");
    setMode("edit");setInspectorTab("plot");
  };
  const openPlotQualityReview=(id:string)=>{
    const plot=plots.find(p=>p.id.toLowerCase()===id.toLowerCase());
    if(!plot)return;
    if(working?.id===plot.id&&originalId===plot.id){
      setInspectorTab("plot");return;
    }
    choose(plot);
  };
  const chooseSibling=(direction:1|-1)=>{
    const neighbor=adjacentPlot(plots,working?.id||"",direction);
    if(neighbor)choose(neighbor);
  };
  const rebindWithReviewedSource=async(
    oldAlignment:import("../../../../shared/geo-plot-image-alignment.js").ImageModelAlignmentDraft,
    selectedIds:string[]):Promise<{ok:boolean;reason?:string}>=>{
    if(!state||!geo||!state.draft.stale||busy||dirty||working)
      return {ok:false,reason:"Only a clean, source-stale mapping may be selectively remapped. Save/discard local edits first."};
    if(selectedIds.length<1)return {ok:false,reason:"Select at least one Plot ID for reviewed remapping."};
    setBusy(true);
    try{
      const body={expectedRevision:state.draft.revision,previousAlignment:oldAlignment,selectedIds};
      const reviewed=await callApi<{
        plan:{rows:Array<{plotId:string;selected:boolean;maxModelCoordinateMovementM:number}>;
          unreviewedIds:string[]};
        token:string;expectedRevision:number;verifiedAlignmentRevision:number
      }>(api,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({...body,action:"remap-preflight"})
      });
      if(activeProjectRef.current!==slug)throw Error("Project switched while reviewing source remap.");
      const selected=reviewed.plan.rows.filter(p=>p.selected);
      const maximum=Math.max(...selected.map(p=>p.maxModelCoordinateMovementM));
      const prompt="SELECTIVE SOURCE REMAP\n"+
        selected.length+" selected polygons; "+reviewed.plan.unreviewedIds.length+
        " others keep old coordinates but ALL approvals and model plane approvals reset.\n"+
        "Largest selected model X/Z move: "+maximum.toFixed(3)+" m.\n"+
        "NO published map/sales will change. Continue, then recheck EVERY plot against new signed survey?";
      if(!window.confirm(prompt))
        return {ok:false,reason:"Selective remap cancelled; no source draft was changed."};
      const next=await callApi<MappingState>(api,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({...body,action:"rebind-remap",
          expectedPreflightToken:reviewed.token,confirmation:"REMAP SOURCE "+slug})
      });
      if(activeProjectRef.current!==slug)throw Error("Project changed; reload mapping before editing.");
      setState(next);setPlots(next.draft.plots);setDirty(false);resetWorking(null);
      setOriginalId(null);setMode("pan");setPublishedPreview(null);
      setMessage("Reviewed selective remap saved as UNVERIFIED mapping draft. "+
        reviewed.plan.unreviewedIds.length+" plots still need manual source coordinate review. "+
        "Nothing published. Review every plot and re-verify before Publish.");
      return {ok:true};
    }catch(error){
      const message=error instanceof Error?error.message:String(error);
      setMessage("ERROR: "+message);
      return {ok:false,reason:message};
    }finally{setBusy(false);}
  };
  const preserveSameCoordinateModel=async()=>{
    if(!state||!geo||!state.draft.stale||dirty||working||busy)return;
    setBusy(true);setMessage("");
    try{
      const plan=await callApi<{token:string;plotCount:number;nextCanonicalSha256:string}>(
        api,{method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({action:"preserve-coordinates-preflight",
            expectedRevision:state.draft.revision})});
      if(activeProjectRef.current!==slug)throw Error("Project changed. Restart source review.");
      const exact="PRESERVE 3D COORDINATES "+slug;
      const accepted=window.prompt("KEEP EXISTING 3D PLOT COORDINATES?\\n\\n"+
        plan.plotCount+" polygons will remain in their exact OLD model-local X/Z positions on the NEW 3D model. "+
        "ONLY use this after comparing both models and confirming the same metric scale, origin, orientation and plot layout. "+
        "Different geometry needs verified image-source remapping instead.\\n\\n"+
        "All area, side, facing, road, model-plane and source approvals become UNVERIFIED. "+
        "Historical publications and commercial records remain untouched. Customer site will not change from this draft action.\\n\\n"+
        "Type "+exact+" to create an unverified preserved draft:");
      if(accepted!==exact){setMessage("3D replacement preservation cancelled. Old mapping draft is safe.");return;}
      const next=await callApi<MappingState>(api,{method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({action:"preserve-coordinates",expectedRevision:state.draft.revision,
          expectedPreflightToken:plan.token,confirmation:exact})});
      if(activeProjectRef.current!==slug)throw Error("Project switched after source rebind. Reload.");
      setState(next);setPlots(next.draft.plots);setDirty(false);resetWorking(null);
      setOriginalId(null);setMode("pan");setPublishedPreview(null);
      setMessage("Preserved "+plan.plotCount+" plotted boundaries and IDs in the NEW source as an UNVERIFIED private draft. "+
        "Inspect ALL polygons on the new model, confirm plane height, road, sides and survey values, then Verify and Publish explicitly. "+
        "Prior published mappings and customer statuses have not been overwritten.");
    }catch(error){setMessage("ERROR: "+(error instanceof Error?error.message:String(error)));}
    finally{setBusy(false);}
  };
  const stageCornerFromVerifiedImage=(plotId:string,index:number,uv:Point,
    transform:SimilarityTransform,alignmentRevision:number):{ok:boolean;reason?:string}=>{
    if(!state||!geo||state.draft.stale||busy||state.alignmentRevision!==alignmentRevision)
      return {ok:false,reason:"Mapping or alignment source is stale. Reload before editing image corners."};
    if(!confirmUnapplied())return {ok:false,reason:"Unapplied working-plot edits were preserved; image edit cancelled."};
    try{
      const staged=stageVerifiedImageCorner(plots,plotId,index,uv,transform);
      if(!window.confirm("Stage Plot "+staged.plotId+" corner "+(index+1)+
        " from independently verified original image at model X "+
        staged.modelPoint[0].toFixed(4)+", Z "+staged.modelPoint[1].toFixed(4)+
        "? This changes the LOCAL DRAFT only. All spatial, road, area, facing and plane approvals reset.")){
        return {ok:false,reason:"Image corner correction cancelled. No draft changed."};
      }
      setPlots(staged.plots);setDirty(true);
      resetWorking(null);setOriginalId(null);setMode("pan");
      setMessage("Image-mapped correction staged for Plot "+staged.plotId+
        ". Cross-check new geometry in 3D, Apply/Save/Verify, then explicitly Publish.");
      return {ok:true};
    }catch(error){
      return {ok:false,reason:error instanceof Error?error.message:String(error)};
    }
  };
  const clonePreviousDraft=()=>{
    if(!editable||busy||!cloneFrom)return;
    if(!cloneX.trim()||!cloneZ.trim()){
      setMessage("ERROR: Enter explicit model-local X and Z offset values before cloning.");
      return;
    }
    if(!confirmUnapplied())return;
    const previous=plots.find(p=>p.id===cloneFrom);
    if(!previous){setMessage("ERROR: Select a mapped plot to clone.");return;}
    try{
      const next=cloneUnverifiedGeoPlot(previous,nextTemplateId,Number(cloneX),Number(cloneZ),
        inventoryRows,plots);
      if(!window.confirm("Create an UNVERIFIED draft footprint for Plot "+next.id+
        " using X "+cloneX+" m and Z "+cloneZ+" m translation from Plot "+previous.id+
        "? All measurement, road, facing and plane approvals will be reset. Nothing is published."))return;
      resetWorking(next);setOriginalId(null);
      setShape(next.corners.length===4?"four":"irregular");setMode("edit");setInspectorTab("plot");
      setMessage("Unverified template ready for Plot "+next.id+
        ". Check each corner, approved CSV/source and road; apply only after inspecting the new footprint.");
    }catch(error){
      setMessage("ERROR: "+(error instanceof Error?error.message:String(error)));
    }
  };
  const downloadQualityEvidence=()=>{
    if(!state)return;
    const manifest=geoPlotEvidenceManifest(plots,inventoryRows,geo?.placement.scale||1,{
      inventoryRevision:state.inventoryRevision,mappingRevision:state.draft.revision,
      alignmentRevision:state.alignmentRevision
    });
    const body=JSON.stringify({schema:"geo-plot-operator-review-package-v1",
      projectSlug:slug,createdAt:new Date().toISOString(),quality,
      evidence:manifest,notice:"Owner-private diagnostic only. NOT a backup, certified survey or publish approval."},null,2);
    const href=URL.createObjectURL(new Blob([body],{type:"application/json;charset=utf-8"}));
    const link=document.createElement("a");link.href=href;
    link.download=slug+"-geo-plot-evidence-quality-review.json";link.click();
    window.setTimeout(()=>URL.revokeObjectURL(href),2000);
  };
  const fitView=()=>{
    const camera=cameraRef.current,controls=controlsRef.current,bounds=modelBoundsRef.current;
    if(!camera||!controls||!bounds)return;
    const span=Math.max(bounds.size.x,bounds.size.z,1)*0.68;
    const width=Math.max(hostRef.current?.clientWidth||1,1);
    const height=Math.max(hostRef.current?.clientHeight||1,1);
    camera.left=-span;camera.right=span;camera.top=span*height/width;camera.bottom=-span*height/width;
    camera.zoom=1;
    camera.position.set(bounds.center.x,bounds.maxY+Math.max(bounds.size.y,span)*2.5,bounds.center.z);
    camera.up.set(0,0,-1);camera.lookAt(bounds.center);camera.updateProjectionMatrix();
    controls.target.copy(bounds.center);controls.update();
    setZoomPercent(100);setViewTick(v=>v+1);
  };
  const setZoom=(value:number,clientX?:number,clientY?:number)=>{
    const camera=cameraRef.current,controls=controlsRef.current,host=hostRef.current;
    if(!camera||!controls||!host)return;
    const rect=host.getBoundingClientRect();
    const x=clientX??rect.left+rect.width/2,y=clientY??rect.top+rect.height/2;
    const before=unproject(x,y);
    camera.zoom=boundedZoom(1,value/100);
    camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
    const after=unproject(x,y),delta=zoomAnchorDelta(before,after);
    if(delta){camera.position.x+=delta[0];camera.position.z+=delta[1];
      controls.target.x+=delta[0];controls.target.z+=delta[1];}
    controls.update();camera.updateMatrixWorld(true);
    setZoomPercent(Math.round(camera.zoom*100));setViewTick(v=>v+1);
    if(pointerPreviewRef.current)queuePointer(
      pointerPreviewRef.current.clientX,pointerPreviewRef.current.clientY,
      pointerPreviewRef.current.pointerType,dragRef.current??-1);
  };
  const zoomBy=(factor:number)=>setZoom(boundedZoom((cameraRef.current?.zoom||1),factor)*100);
  const wheelZoomRef=useRef<(value:number,x:number,y:number)=>void>(()=>{});
  wheelZoomRef.current=(value,x,y)=>setZoom(value,x,y);
  useEffect(()=>{
    const overlay=overlayRef.current;
    if(!overlay)return;
    const handleWheel=(event:WheelEvent)=>{
      event.preventDefault();
      const current=cameraRef.current?.zoom||1;
      wheelZoomRef.current(boundedZoom(current,Math.exp(-event.deltaY*0.0016))*100,
        event.clientX,event.clientY);
    };
    // React's wheel listener can be passive. We must prevent scroll on mapping
    // canvas and zoom about the exact cursor, including when SVG masks WebGL.
    overlay.addEventListener("wheel",handleWheel,{passive:false});
    return()=>overlay.removeEventListener("wheel",handleWheel);
  },[geo]);
  useEffect(()=>{if(mode==="pan"){pointerPreviewRef.current=null;setPointerPreview(null);}},[mode]);
  const toggleFullscreen=async()=>{
    try{
      if(document.fullscreenElement===editorRef.current)await document.exitFullscreen();
      else if(!document.fullscreenElement)await editorRef.current?.requestFullscreen();
      else setMessage("ERROR: Exit the other fullscreen view before opening Plot Mapper focus mode.");
    }catch{setMessage("ERROR: Fullscreen was blocked. Use the normal editor view.");}
  };
  useEffect(()=>{
    const changed=()=>setFocused(document.fullscreenElement===editorRef.current);
    document.addEventListener("fullscreenchange",changed);
    return()=>document.removeEventListener("fullscreenchange",changed);
  },[]);
  useEffect(()=>{
    if(!dirty&&!hasUnapplied)return;
    const beforeUnload=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};
    window.addEventListener("beforeunload",beforeUnload);
    return()=>window.removeEventListener("beforeunload",beforeUnload);
  },[dirty,hasUnapplied]);
  const commitCorner=(clientX:number,clientY:number)=>{
    const target=precisionPointer(clientX,clientY);if(!target)return;
    setWorking(prev=>{
      if(!prev||prev.corners.length>=80||(shape==="four"&&prev.corners.length>=4))return prev;
      const corners=[...prev.corners,target.point];
      const sourceRow=inventoryRows.find(row=>row.id.toLowerCase()===prev.id.toLowerCase());
      const sides=sidesWithInventory(corners,sourceRow);
      const suggested=roadFrontPreview({corners,sides},geo?.placement.headingDeg??Number.NaN,suggestGeoSideFacing);
      return {...prev,corners,layout:corners.length===3?"three":"four",sides,
        ...(!prev.facingSource&&suggested?{facing:suggested}:{}),
        area:{...prev.area,verified:false},facingVerified:false};
    });
  };
  const editPoint=(index:number,clientX:number,clientY:number)=>{
    const target=precisionPointer(clientX,clientY,index);if(!target)return;
    setWorking(prev=>{if(!prev)return prev;
      const corners=prev.corners.map((point,i)=>i===index?target.point:point);
      if(corners.every((point,i)=>point[0]===prev.corners[i][0]&&point[1]===prev.corners[i][1]))return prev;
      return geometryWithRevokedApprovals(prev,corners);
    });
  };
  const onOverlayPointerDown=(e:React.PointerEvent<SVGSVGElement>)=>{
    if((mode!=="draw"&&mode!=="align")||dragRef.current!==null||(e.pointerType==="mouse"&&e.button!==0))return;
    pointerStartRef.current={id:e.pointerId,x:e.clientX,y:e.clientY};
    e.currentTarget.setPointerCapture(e.pointerId);
    queuePointer(e.clientX,e.clientY,e.pointerType);
  };
  const queueDrag=(index:number,x:number,y:number)=>{
    pendingDragRef.current={index,x,y};
    if(dragFrameRef.current)return;
    dragFrameRef.current=requestAnimationFrame(()=>{
      dragFrameRef.current=0;
      const latest=pendingDragRef.current;pendingDragRef.current=null;
      if(latest&&dragRef.current===latest.index)
        editPoint(latest.index,latest.x,latest.y);
    });
  };
  const flushDrag=(index:number,x:number,y:number)=>{
    if(dragFrameRef.current){cancelAnimationFrame(dragFrameRef.current);dragFrameRef.current=0;}
    pendingDragRef.current=null;
    if(dragRef.current===index)editPoint(index,x,y);
  };
  useEffect(()=>()=>{if(dragFrameRef.current)cancelAnimationFrame(dragFrameRef.current);},[]);
  const latestPointer=(e:React.PointerEvent<Element>)=>{
    const native=e.nativeEvent;
    try{
      const samples=typeof native.getCoalescedEvents==="function"?native.getCoalescedEvents():[];
      const last=samples.length?samples[samples.length-1]:native;
      return {x:last.clientX,y:last.clientY};
    }catch{return {x:e.clientX,y:e.clientY};}
  };
  const onOverlayPointerMove=(e:React.PointerEvent<SVGSVGElement>)=>{
    const pointer=latestPointer(e);
    const dragging=dragRef.current;
    if(dragging!==null)queueDrag(dragging,pointer.x,pointer.y);
    queuePointer(pointer.x,pointer.y,e.pointerType,dragging??-1);
    const start=pointerStartRef.current;
    if(start&&start.id===e.pointerId&&
      Math.hypot(pointer.x-start.x,pointer.y-start.y)>9)start.cancelled=true;
  };
  const onOverlayPointerUp=(e:React.PointerEvent<SVGSVGElement>)=>{
    const start=pointerStartRef.current;
    if(start&&!start.cancelled&&
      isMappingTap(start,{id:e.pointerId,x:e.clientX,y:e.clientY})){
      if(mode==="draw")commitCorner(e.clientX,e.clientY);
      else if(mode==="align"&&alignmentPickRef.current){
        const point=unproject(e.clientX,e.clientY),done=alignmentPickRef.current;
        if(point){alignmentPickRef.current=null;setMode("pan");done(point);}
      }
    }
    if(start?.id===e.pointerId)pointerStartRef.current=null;
    if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
    if(dragRef.current!==null)flushDrag(dragRef.current,e.clientX,e.clientY);
    dragRef.current=null;closeCornerDrag();
    queuePointer(e.clientX,e.clientY,e.pointerType);
  };
  const onOverlayPointerCancel=(e:React.PointerEvent<SVGSVGElement>)=>{
    if(pointerStartRef.current?.id===e.pointerId)pointerStartRef.current=null;
    if(dragFrameRef.current){cancelAnimationFrame(dragFrameRef.current);dragFrameRef.current=0;}
    pendingDragRef.current=null;
    dragRef.current=null;closeCornerDrag();clearPointer();
  };
  const changeSide=(role:Role,patch:Partial<Side>)=>setWorking(p=>{
    if(!p)return p;
    const changesReference=["edges","length","unit","source","roadFacing","facingDirection"].some(k=>Object.hasOwn(patch,k));
    return {...p,...((Object.hasOwn(patch,"roadFacing")||Object.hasOwn(patch,"facingDirection") ||
       Object.hasOwn(patch,"edges"))?{facingVerified:false}:{}),
      sides:{...p.sides,[role]:{...(p.sides[role]||emptySide()),
        ...(Object.hasOwn(patch,"edges")?{roadFacing:false,facingDirection:undefined}:{}),
        ...(patch.roadFacing===false?{facingDirection:undefined}:{}),...patch,
        ...(changesReference?{verified:false}:{})}}};
  });
  const chooseGeoFacing=(role:Role,direction:GeoDirection|null)=>{
    setWorking(p=>{
      if(!p||p.sides[role]?.roadFacing!==true)return p;
      const current=p.sides[role]!;
      const suggested=suggestGeoSideFacing(p.corners,current.edges,geo?.placement.headingDeg||0);
      const resolved=direction||suggested;
      return {...p,facingVerified:false,
        ...(role==="front"&&resolved?{facing:resolved}:{}),
        sides:{...p.sides,[role]:{...current,facingDirection:direction||undefined}}};
    });
  };
  const selectRoadFront=(edge:number)=>{
    if(!working)return;
    if(!window.confirm("Make polygon edge "+edge+" the road-facing FRONT? All side and facing approvals will reset. No published plot is changed."))return;
    setWorking(p=>{
      if(!p)return p;
      const next=assignFourCornerRoadFront(p,edge);
      const suggested=roadFrontPreview(next,geo?.placement.headingDeg??Number.NaN,suggestGeoSideFacing);
      return {...next,...(!p.facingSource&&suggested?{facing:suggested}:{})};
    });
    setMessage("Road-facing Front changed to edge "+(edge+1)+". Other sides were reassigned automatically. Review CSV measurements, compass and approvals.");
  };
  const applyCurrentSource=()=>{
    if(!working||!selectedInventory)return;
    if(!window.confirm("Replace approved values and sources for Plot "+working.id+
      " with current CSV inventory? Existing polygon corners, site plane and published release remain unchanged. Modified approvals reset."))return;
    setWorking(p=>p?applyApprovedInventoryRow(p,selectedInventory):p);
    setMessage("Plot "+working.id+": approved CSV values staged. Recheck road-facing edge, measurements and sources before applying.");
  };
  const clearManualSidePreview=()=>{
    setManualSideLocks({});setManualStartCorner(null);setManualProposal(null);
  };
  const openManualSideEditor=()=>{
    clearManualSidePreview();setSideEditKind("manual");setSelectedRole("front");
    setExtendSide(false);setMode("side");setInspectorTab("plot");
    setMessage("Manual: choose Front/Back/Depth, tap its START corner and END corner. "+
      "Your other sides will not change until you review and Apply.");
  };
  const openAutoSideEditor=()=>{
    clearManualSidePreview();setSideEditKind("auto");setSelectedRole("front");
    setExtendSide(false);setMode("side");setInspectorTab("plot");
    setMessage("Auto Front: tapping an edge will reassign whole side groups. "+
      "Use Manual to choose each corner range independently.");
  };
  const selectManualCorner=(index:number)=>{
    if(!working||mode!=="side"||sideEditKind!=="manual"||busy||!editable)return;
    if(manualStartCorner===null){
      setManualStartCorner(index);setManualProposal(null);
      setMessage("Start corner "+(index+1)+" selected for "+selectedRole+
        ". Now tap the LAST corner on the same boundary (end exclusive).");
      return;
    }
    try{
      const next=stageGeoManualSideRange(working,manualSideLocks,selectedRole,manualStartCorner,index);
      const range=next[selectedRole]||[];
      setManualSideLocks(next);setManualStartCorner(null);setManualProposal(null);
      setMessage(selectedRole+": corners "+(manualStartCorner+1)+" → "+(index+1)+
        " staged as "+range.length+" connected edge(s). Other roles are UNCHANGED. "+
        "Choose more roles, then Auto Fill Rest to PREVIEW.");
    }catch(error){
      setManualStartCorner(null);
      setMessage("ERROR: "+(error instanceof Error?error.message:String(error)));
    }
  };
  const previewManualSides=()=>{
    if(!working||!editable||busy)return;
    try{
      const proposed=proposeGeoManualSideMapping(working,manualSideLocks);
      setManualProposal(proposed);
      setMessage("Preview only: "+proposed.edgeCount+" edges covered; "+
        proposed.changedRoles.length+" roles would change ("+
        proposed.changedRoles.join(", ")+"). "+
        "Original mapping is unchanged until Apply Preview.");
    }catch(error){
      setManualProposal(null);
      setMessage("ERROR: "+(error instanceof Error?error.message:String(error)));
    }
  };
  const applyManualSides=()=>{
    if(!working||!manualProposal||!previewIsCurrent||!editable||busy)return;
    const changes=manualProposal.changedRoles;
    if(!changes.length){
      clearManualSidePreview();setMode("edit");
      setMessage("No side changes required; original mapping retained.");
      return;
    }
    const unlocked=manualProposal.changedUnpinned;
    const explanation="Apply these DRAFT-only side changes to Plot "+working.id+"?\\n"+
      "Changed: "+changes.join(", ")+"\\n"+
      (unlocked.length?"Auto-filled (not individually selected): "+unlocked.join(", ")+"\\n":"")+
      "Every edge stays assigned exactly once. Survey lengths and polygon corners stay intact. "+
      "Affected road/facing/side verification resets. NOT published.";
    if(!window.confirm(explanation))return;
    try{
      const next=applyGeoManualSideProposal(working,manualProposal);
      setWorking(next);
      clearManualSidePreview();setMode("edit");
      setMessage("✓ Plot "+working.id+": "+changes.join(", ")+
        " applied to local editor. All polygon edges covered. Recheck road, "+
        "CSV measurements and approvals, then Save & Next.");
    }catch(error){setMessage("ERROR: "+(error instanceof Error?error.message:String(error)));}
  };
  const assignSideOnCanvas=(edge:number)=>{
    if(!working||busy||mode!=="side"||sideEditKind!=="auto"||working.corners.length<3)return;
    try{
      const changed=assignVisiblePlotEdge(working,selectedRole,edge,{extend:extendSide});
      const suggested=selectedRole==="front"?
        roadFrontPreview(changed,geo?.placement.headingDeg??Number.NaN,suggestGeoSideFacing):null;
      setWorking({...changed,...(!working.facingSource&&suggested?{facing:suggested}:{})});
      setMessage("Plot "+working.id+": "+selectedRole+" edge "+(edge+1)+
        " staged. Road, source lengths and facing need review before Verify.");
    }catch(error){setMessage("ERROR: "+String(error));}
  };
  const repairWorkingSides=()=>{
    if(!working||!sideCoverage||sideCoverage.ok||busy||!editable)return;
    if(!window.confirm("Repair the unassigned/overlapping side groups in Plot "+working.id+
      "? Polygon corners, approved CSV measurements and the live site will NOT change. "+
      "Side/road/facing approvals will reset for review."))return;
    try{
      const repaired=repairGeoPlotSideCoverage(working);
      setWorking(repaired);setMode("edit");
      setMessage("Plot "+working.id+": all "+repaired.corners.length+
        " edges are now assigned exactly once. Geometry and source lengths retained. "+
        "Review the road-facing Front, dimensions and source approvals before saving.");
    }catch(error){setMessage("ERROR: "+String(error));}
  };
  const applyPlot=(openNext=false)=>{
    if(!working)return;const id=working.id.trim();if(!id||working.corners.length<3)throw Error("Plot number and at least 3 mapped corners required.");
    const coverage=inspectGeoPlotSideCoverage(working);
    if(!coverage.ok)throw Error(coverageError(coverage)+". Use Repair Sides; polygon remains unchanged.");
    if(plots.some(p=>p.id.toLowerCase()===id.toLowerCase()&&p.id!==originalId))throw Error("Duplicate plot ID.");
    const updated=[...plots.filter(p=>p.id!==(originalId||id)),{...working,id}]
      .sort((a,b)=>a.id.localeCompare(b.id,undefined,{numeric:true}));
    setPlots(updated);setDirty(true);setPublishedPreview(null);
    if(openNext){
      const next=nextUnmappedInventory(inventoryRows,updated.map(p=>p.id),id);
      resetWorking(next?fromInventory(next,groundY):
        {...blank(nextFreePlotId([...updated,...inventoryRows])),planeY:groundY,planeSource:"",planeVerified:false});
      setOriginalId(null);setMode("draw");
      setMessage("Plot "+id+" staged. "+(next?"Next unmapped inventory plot "+next.id+" is ready.":"No pending inventory plots.")+" Save Mapping Draft before verification.");
     }else {
      setWorking(null);setOriginalId(null);setMode("pan");
      setMessage("Plot "+id+" staged. Save Mapping Draft before verification.");
    }
  };
  const confirmPlotAndNext=async()=>{
    if(!state||!geo||!working||busy||!editable)return;
    const id=working.id.trim();
    if(!id||working.corners.length<3||
      (shape==="four"&&working.corners.length!==4)){
      setMessage("ERROR: Finish the plot boundary before confirming.");return;
    }
    const coverage=inspectGeoPlotSideCoverage(working);
    if(!coverage.ok){
      setMessage("ERROR: Plot "+id+": "+coverageError(coverage)+
        ". Select Repair Sides. Unsaved polygon corners are kept.");return;
    }
    if(inventoryRows.length&&!inventoryRows.some(row=>row.id.toLowerCase()===id.toLowerCase())){
      setMessage("ERROR: Plot "+id+" is not in the approved CSV. Cancel this unconfirmed Plot 37 and select Plot 1 from Inventory.");return;
    }
    if(plots.some(p=>p.id.toLowerCase()===id.toLowerCase()&&p.id!==originalId)){
      setMessage("ERROR: Duplicate Plot ID "+id+". Open the already mapped plot to edit.");return;
    }
    if(dirty&&!window.confirm("Other staged draft changes will be saved together with Plot "+
      id+". Continue with an UNPUBLISHED draft save?"))return;
    const proposed=[...plots.filter(p=>p.id!==(originalId||id)),{...working,id}]
      .sort((a,b)=>a.id.localeCompare(b.id,undefined,{numeric:true}));
    let writtenRevision:number|null=null;
    setBusy(true);
    try{
      const saved=await callApi<MappingState>(api,{method:"PUT",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({expectedRevision:state.draft.revision,
          geoReleaseId:state.geoReleaseId,plots:proposed})});
      writtenRevision=saved.draft.revision;
      // The public release is NOT changed. Verify a second uncached D1 read
      // before clearing the operator's in-progress corner geometry.
      const readBack=await callApi<MappingState>(api);
      if(activeProjectRef.current!==slug)return;
      const recorded=readBack.draft.plots.find(p=>p.id===id);
      if(!recorded||readBack.draft.revision!==saved.draft.revision||
        JSON.stringify(recorded.corners)!==JSON.stringify(working.corners))
        throw Error("Server read-back did not confirm Plot "+id+". Keep this local draft and reload before editing other plots.");
      setState(readBack);setPlots(readBack.draft.plots);setDirty(false);setPublishedPreview(null);
      clearLocalPlotDraft();
      const next=nextCsvPlotForDrawing(inventoryRows,readBack.draft.plots,id);
      if(next){
        resetWorking(fromInventory(next,groundY));setOriginalId(null);
        setShape("four");setMode("draw");setInspectorTab("plot");
      }else{
        resetWorking(null);setOriginalId(null);setMode("pan");setInspectorTab("quality");
      }
      setMessage("✓ Plot "+id+" SERVER SAVED in private mapping draft r"+
        readBack.draft.revision+". "+(next?"Next CSV Plot "+next.id+" is ready.":
        "All approved CSV IDs mapped. Review original-image alignment, data quality, then Verify and Publish."));
    }catch(error){
      setMessage("ERROR: "+(error instanceof Error?error.message:String(error))+
        (writtenRevision===null
          ?" The unsaved plot is still in this editor; correct the issue before retrying."
          :" Server accepted draft r"+writtenRevision+
            " but read-back is not confirmed. Do NOT press Confirm again; reload and inspect the saved mapping first."));
    }finally{setBusy(false);}
  };
  const downloadGeoRecovery=async()=>{
    if(!state||busy||!slug)return;
    setBusy(true);
    try{
      const document=await callApi<{schema:string;sha256:string;warnings:string[];
        completeness:string;payload:unknown}>(api+"?recovery=1");
      if(activeProjectRef.current!==slug)return;
      if(document.completeness!=="METADATA_AND_R2_REFERENCES_ONLY")
        throw Error("Unexpected recovery export scope.");
      const url=URL.createObjectURL(new Blob([JSON.stringify(document,null,2)],
        {type:"application/json;charset=utf-8"}));
      const a=window.document.createElement("a");a.href=url;
      a.download=slug+"-geo-recovery-manifest.json";a.click();
      setTimeout(()=>URL.revokeObjectURL(url),2000);
      setMessage("Owner-private recovery manifest downloaded. Verify sealed SHAs and independently export R2 object bytes. This is NOT a complete D1/R2 backup.");
    }catch(error){setMessage("ERROR: "+(error instanceof Error?error.message:String(error)));}
    finally{setBusy(false);}
  };
  const inspectPublish=async()=>{
    if(!state||!geo||dirty||working||busy)return;
    setBusy(true);
    try{
      const info=await callApi<NonNullable<typeof publishedPreview>>(api+"?preview=1");
      if(activeProjectRef.current!==slug)return;
      if(info.draftRevision!==state.draft.revision)
        throw Error("Draft revision changed while comparing live publication. Reload.");
      setPublishedPreview(info);
      setMessage("Live/draft preflight ready. "+info.diff.added+" added, "+
        info.diff.changed+" changed, "+info.diff.removed+" removed plots. "+
        (info.continuity ? info.continuity.carriedRows+" status/price records eligible for carry-forward." :
          "Commercial continuity preview unavailable on this API.")+" Review before publish.");
    }catch(error){setMessage("ERROR: "+(error instanceof Error?error.message:String(error)));}
    finally{setBusy(false);}
  };
  const execute=async(action:"save"|"verify"|"publish"|"publish-preliminary"|"activate"|"rebind-reset",id?:string)=>{
    if(!state||!geo)return;
    if((action==="publish"||action==="publish-preliminary")&&state.activeMapping?.current&&
      state.activeMapping.draftRevision===state.draft.revision&&
      state.activeMapping.publicationMode===(action==="publish"?"verified":"preliminary")){
      setMessage("✓ Draft r"+state.draft.revision+" is already LIVE as Mapping v"+
        state.activeMapping.version+". To publish updates, open any Plot, edit it, Confirm/Save "+
        "the new draft revision, then publish the next version.");
      return;
    }
    setBusy(true);setMessage("");
    try{
      let approvedPreflight:NonNullable<typeof publishedPreview>|null=null;
      if(action==="publish"||action==="publish-preliminary"){
        // Fresh server-side sealed release read: a cached diff can never approve
        // a concurrent active-version switch or an updated draft.
        approvedPreflight=await callApi<NonNullable<typeof publishedPreview>>(api+"?preview=1");
        if(approvedPreflight.draftRevision!==state.draft.revision)
          throw Error("Draft changed since the last review. Reload before publish.");
        setPublishedPreview(approvedPreflight);
        const d=approvedPreflight.diff;
        const summary=(action==="publish-preliminary"?
          "PUBLISH PRELIMINARY MAPPING TO LIVE CUSTOMERS?\n"+
          "Plot boundaries and IDs will be live. Any unreviewed Area, Side, Facing or Road facts will be hidden; commercial claims will not be shown.\n"+
          "You can edit and publish another immutable version later.\n\n":
          "PUBLISH VERIFIED MAPPING TO LIVE CUSTOMERS?\n")+
          "Live "+d.liveCount+" → Draft "+d.draftCount+" plots.\n"+
          d.added+" ADDED, "+d.changed+" CHANGED, "+d.removed+" REMOVED.\n"+
          d.changes.slice(0,12).map(p=>p.kind.toUpperCase()+" Plot "+p.plotId+
            " ("+p.fields.join(", ")+")").join("\n")+
          (d.changes.length>12?"\n...plus "+(d.changes.length-12)+" more changes.":"")+
          (approvedPreflight.continuity ?
            "\n\nCOMMERCIAL CONTINUITY: "+approvedPreflight.continuity.carriedRows+
            " status/price records retained; "+approvedPreflight.continuity.reviewRows+
            " require NEW source approval; "+approvedPreflight.continuity.missingRows+
            " unmatched remain in historical releases."+
            "\nDifferent 3D/Geo model source: owner must reapprove statuses before publication." :
            "\n\nCommercial continuity is not reported by this API; independently verify statuses before publication.")+
          "\nEvery release is immutable; edit in the Mapper and publish a new version anytime. Continue?";
        if(!window.confirm(summary))return;
      }
      const body=action==="save"?{expectedRevision:state.draft.revision,geoReleaseId:state.geoReleaseId,plots}
        :{action,expectedRevision:state.draft.revision,...(id?{releaseId:id}:{}),
          ...((action==="publish"||action==="publish-preliminary")?{expectedPreflightToken:approvedPreflight!.token,
            expectedActiveReleaseId:approvedPreflight!.activeReleaseId}:{}),
          ...(action==="rebind-reset"?{confirmation:"RESET MAPPING "+slug}:{})};
      const result=await callApi<MappingState>(api,{method:action==="save"?"PUT":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      if(activeProjectRef.current!==slug)return; // Never display another project’s save response.
      setState(result);setPlots(result.draft.plots);setDirty(false);setWorking(null);setPublishedPreview(null);
      setMessage(action==="save"?"Mapping draft saved and server read-back confirmed.":
        action==="verify"?"All plot sources and geometry verified.":
        action==="publish"?"Verified Geo Plot Mapping published to customer site.":
        action==="publish-preliminary"?"Preliminary Geo Plot Mapping is LIVE. Unreviewed measurements are hidden. You may edit and republish anytime.":
        action==="rebind-reset"?"New empty draft created for active Geo. Historical published mapping releases remain preserved.":
        "Published mapping version activated.");
    }catch(e){setMessage("ERROR: "+(e instanceof Error?e.message:"Mapping operation failed."));}
    finally{setBusy(false);}
  };
  const importSourceInventory=async(raw:string,fileName:string)=>{
    if(!editable||!state||busy||dirty||hasUnapplied)
      throw Error("Save/discard current plot changes before importing a Plot Data CSV.");
    const parsed=normalizeGeoInventoryRows(parseGeoInventoryCsv(raw));
    const inventoryApi=api+"/inventory";
    setBusy(true);
    try{
      const current=await callApi<{revision:number;rows:GeoInventoryRow[]}>(inventoryApi);
      if(activeProjectRef.current!==slug)throw Error("Project changed during source review.");
      const payload={expectedRevision:current.revision,rows:parsed};
      const preview=await callApi<{preview:{
        rowCount:number;added:string[];changed:string[];missing:string[];
        mappedChanged:string[];mappedMissing:string[]
      }}>(inventoryApi,{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({...payload,action:"preflight"})});
      if(preview.preview.missing.length)
        throw Error("CSV omits "+preview.preview.missing.length+
          " existing inventory Plot IDs: "+preview.preview.missing.slice(0,12).join(", ")+
          ". No rows were removed. Reconcile the complete inventory before import.");
      if(activeProjectRef.current!==slug)throw Error("Project switched while reviewing CSV.");
      const info=preview.preview;
      const confirmation="PLATFORM PLOT DATA CSV — "+fileName+"\\n"+
        info.rowCount+" source plots (including irregular/corner plots); "+
        info.added.length+" added, "+info.changed.length+" updated.\\n"+
        info.mappedChanged.length+" existing mapped Plot IDs need subsequent measurement review.\\n"+
        "Feet-inch values will be converted to decimal feet; original source details are preserved.\\n"+
        "This imports source INVENTORY ONLY: it will NOT invent any 3D polygon, verify measurements, "+
        "publish mapping or change a customer release. Continue?";
      if(!window.confirm(confirmation)){
        setMessage("CSV source inventory import cancelled; nothing changed.");
        return;
      }
      const saved=await callApi<{inventory:{revision:number;rows:GeoInventoryRow[]}}>(
        inventoryApi,{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({...payload,action:"import"})});
      if(activeProjectRef.current!==slug)return;
      setInventoryRows(saved.inventory.rows);
      setState(prev=>prev?{...prev,inventoryRevision:saved.inventory.revision}:prev);
      setInventoryImportNonce(v=>v+1);
      setMessage("Imported "+saved.inventory.rows.length+" source Plot IDs into Inventory (revision "+
        saved.inventory.revision+"). Mapped polygons: "+plots.length+
        ". Open 01 · Plot Inventory and use Start Next Unmapped; irregular plots "+
        "require manual boundary/edge review. No live release changed.");
    }finally{setBusy(false);}
  };
  const importCsv=async(file:File)=>{
    if(file.size>2_000_000)throw Error("Measurement CSV exceeds the 2 MB safety limit.");
    const raw=(await file.text()).replace(/^\uFEFF/,"");
    const rows=parseRows(raw);
    if(activeProjectRef.current!==slug)throw Error("Project changed during CSV import; no data staged.");
    if(rows.length<2||rows.length>2501)throw Error("CSV requires 1–2500 measurement rows.");
    const keys=rows[0].map(s=>s.trim().toLowerCase().replace(/[^a-z0-9]/g,""));
    // Platform Plot Data CSV is an inventory, not a geometry-snapshot CSV.
    // Route it to the safe, revisioned inventory preflight even with zero polygons.
    if(keys.includes("plotno")||keys.includes("sqft")||keys.includes("sqm")||
       keys.includes("sqyd")||keys.includes("roadaccess")){
      await importSourceInventory(raw,file.name);
      return;
    }
    if(new Set(keys).size!==keys.length)throw Error("Duplicate CSV column headings.");
    const modern=keys.includes("frontlength");
    const required=modern
      ? ["id","area","areaunit","areasource","facing","facingsource","frontlength","frontunit","frontsource"]
      : ["id","area","areaunit","front","back","deptha","unit","source"];
    if(required.some(k=>!keys.includes(k)))throw Error("CSV header required: "+required.join(", "));
    const updates=new Map<string,Record<string,string>>();
    for(const row of rows.slice(1)){
      if(row.length>keys.length)throw Error("CSV row has more fields than its header.");
      const v=Object.fromEntries(keys.map((k,i)=>[k,(row[i]||"").trim()]));
      const id=v.id;
      if(!id||updates.has(id.toLowerCase()))throw Error("Missing or duplicate Plot ID in CSV: "+id);
      updates.set(id.toLowerCase(),v);
    }
    const unknown=[...updates.keys()].filter(id=>!plots.some(p=>p.id.toLowerCase()===id));
    if(unknown.length)throw Error("Map polygon corners before importing measurements: "+unknown.slice(0,12).join(", "));
    const proposed=plots.map(p=>{
      const v=updates.get(p.id.toLowerCase());if(!v)return p;
      if(modern && v.cornersjson){
        let uploaded:unknown;
        try{uploaded=JSON.parse(v.cornersjson);}catch{throw Error("Invalid corner snapshot for "+p.id);}
        if(JSON.stringify(uploaded)!==JSON.stringify(p.corners))
          throw Error("Plot "+p.id+": geometry changed since CSV export. Export current mapping before importing.");
      }
      const side={...p.sides};
      for(const role of ROLES){
        const item=side[role];if(!item)continue;
        const prefix=role.toLowerCase();
        const length=Number(v[modern?prefix+"length":prefix]);
        const unit=modern?v[prefix+"unit"]:v.unit;
        const source=modern?v[prefix+"source"]:v.source;
        if(!Number.isFinite(length)||length<=0||!["m","ft"].includes(unit)||!source)
          throw Error("Plot "+p.id+": invalid "+role+" measurement/unit/source.");
        const facingDirection=modern?(v[prefix+"facingdirection"]||"").toLowerCase():"";
        if(facingDirection&&!directions.includes(facingDirection as GeoDirection))
          throw Error("Plot "+p.id+": invalid "+role+" Facing Direction.");
        const facingFlag=v[prefix+"roadfacing"];
        if(modern && facingFlag && !["true","false"].includes(facingFlag.toLowerCase()))
          throw Error("Plot "+p.id+": invalid road-facing flag.");
        const roadFacing=modern && facingFlag?facingFlag.toLowerCase()==="true":item.roadFacing;
        const directionColumnPresent=Object.hasOwn(v,prefix+"facingdirection");
        side[role]={...item,length,unit:unit as Side["unit"],source,verified:false,
          roadFacing,facingDirection:modern&&directionColumnPresent?
            (roadFacing&&facingDirection?facingDirection as GeoDirection:undefined):
            (roadFacing?item.facingDirection:undefined)};
      }
      const area=Number(v.area),areaunit=v.areaunit;
      if(!Number.isFinite(area)||area<=0||!["sqft","sqm","sqyd"].includes(areaunit))
        throw Error("Plot "+p.id+": invalid approved area or unit.");
      return {...p,sides:side,
        area:{value:area,unit:areaunit as Plot["area"]["unit"],source:modern?v.areasource:v.source,verified:false},
        facing:v.facing||p.facing,facingSource:modern?v.facingsource:p.facingSource,
        facingVerified:false,road:v.road??p.road,notes:modern?v.notes??p.notes:p.notes,
        planeVerified:false};
    });
    if(activeProjectRef.current!==slug)throw Error("Project switched during CSV validation.");
    setPlots(proposed);setDirty(true);setWorking(null);
    setMessage(updates.size+" plot measurement rows staged (all imported approvals reset). Verify geometry, sources and plane before publish.");
  };
  const exportCsv=()=>{
    const headers=["id","cornersJson","area","areaUnit","areaSource","areaVerified",
      "facing","facingSource","facingVerified","road","notes","planeY","planeSource","planeVerified",
      ...ROLES.flatMap(role=>[role+"Length",role+"Unit",role+"Source",role+"Verified",role+"RoadFacing",role+"FacingDirection"])];
    const lines=[headers.map(csvCell).join(","),...plots.map(p=>[
      p.id,JSON.stringify(p.corners),p.area.value,p.area.unit,p.area.source,p.area.verified,
      p.facing,p.facingSource,p.facingVerified,p.road,p.notes,p.planeY,p.planeSource,p.planeVerified,
      ...ROLES.flatMap(role=>{const side=p.sides[role];
        return [side?.length,side?.unit,side?.source,side?.verified,side?.roadFacing,side?.facingDirection||""];})
    ].map(csvCell).join(","))];
    const url=URL.createObjectURL(new Blob([lines.join("\n")],{type:"text/csv;charset=utf-8"}));
    const a=document.createElement("a");a.href=url;a.download=slug+"-geo-plots.csv";a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  const pauseForPan=()=>{
    const paused=geoPlotPausedDrawingLabel({mode:"pan",plot:working,originalId,shape});
    setMode("pan");
    if(paused)setMessage(paused.text+". View moved without altering plot geometry.");
  };
  const begin=(kind:"four"|"irregular")=>{
    // Same-shape re-selection must resume or edit the SAME working polygon,
    // matching Platform Select. Never wipe existing corners after Pan.
    const action=geoPlotToolResumeAction({plot:working,originalId,shape,requestedShape:kind});
    if(action==="resume"){
      setMode("draw");setInspectorTab("plot");
      setMessage("✓ Resumed Plot "+working!.id+" · "+working!.corners.length+
        (kind==="four"?"/4":"")+" corners kept. Click corner "+(working!.corners.length+1)+".");
      return;
    }
    if(action==="edit"){
      setMode("edit");setInspectorTab("plot");
      setMessage("Plot "+working!.id+" already has all required corners. Use Edit to adjust, or Confirm Plot.");
      return;
    }
    const selected=working&&!originalId&&!working.corners.length&&
      inventoryRows.some(p=>p.id.toLowerCase()===working.id.toLowerCase());
    const pending=nextCsvPlotForDrawing(inventoryRows,plots);
    if(!selected&&!pending){
      setMessage("ERROR: No pending approved CSV Plot ID. Import an inventory revision or edit a mapped plot; Plot 37 will not be invented.");
      setInspectorTab("sources");return;
    }
    if(!selected&&working&&!originalId&&working.corners.length&&shape!==kind){
      if(!window.confirm("Change from "+shape+" to "+kind+"? Plot "+working.id+
        " has "+working.corners.length+" unfinished corners that will be discarded. The private saved mapping is untouched."))return;
    }else if(!selected&&!confirmUnapplied())return;
    if(!selected)clearLocalPlotDraft();
    setShape(kind);setMode("draw");setOriginalId(null);setInspectorTab("plot");
    if(!selected&&pending)resetWorking(fromInventory(pending,groundY));
    setMessage("Plot "+(selected?working!.id:pending?.id)+": start at the road-facing Front edge; tap corners clockwise.");
  };
  const undoCorner=()=>{
    if(!working?.corners.length||busy||originalId)return;
    setWorking(p=>{if(!p)return p;
      const corners=p.corners.slice(0,-1);
      return {...p,corners,sides:initialSides(corners),
        area:{...p.area,verified:false},facingVerified:false};
    });setMode("draw");
  };
  const nudgeSelectedCorner=(dx:number,dz:number)=>{
    if(!working||selectedCorner===null||busy||mode!=="edit"||!editable)return;
    const result=nudgePlotCorner(working,selectedCorner,dx,dz);
    if(result.issue){setMessage("ERROR: "+result.issue);return;}
    if(result.plot!==working){
      setWorking(result.plot);
      setMessage("Moved corner "+(selectedCorner+1)+" in model-local X/Z. Area, side, road, facing and plane approvals reset. Recheck source before Publish.");
    }
  };
  useEffect(()=>{
    if(selectedCorner!==null&&(!working||selectedCorner>=working.corners.length))
      setSelectedCorner(null);
  },[selectedCorner,working?.corners.length]);
  const cancelWorking=()=>{
    if(!confirmUnapplied())return;
    clearLocalPlotDraft();setWorking(null);setOriginalId(null);setMode("pan");setMessage("Unapplied plot selection cleared; saved draft unchanged.");
  };
  const finishBoundary=()=>{
    if(!working||working.corners.length<3){setMessage("ERROR: Mark at least 3 corners before completing the boundary.");return;}
    if(shape==="four"&&working.corners.length!==4){
      setMessage("ERROR: A 4-corner boundary requires exactly 4 points.");return;
    }
    const suggestion=inferFrontFirstSideGroups(working.corners);
    setMode("edit");
    setMessage(suggestion?.reviewRequired
      ?"Boundary ready. Irregular side grouping needs manual review before verification; polygon corners were preserved."
      :"Boundary ready. Front/Depth/Back labels suggested. Check the road edge, then Save & Next.");
  };
  useEffect(()=>{
    const handleKey=(event:KeyboardEvent)=>{
      if(isTextEditingTarget(event.target)||event.altKey||busy)return;
      const k=event.key.toLowerCase();
      if(event.ctrlKey||event.metaKey){
        if(k==="z"||k==="y"){
          const redo=k==="y"||(k==="z"&&event.shiftKey);
          if(working&&!dragStartRef.current&&
             (redo?workingHistory.future.length>0:workingHistory.past.length>0)){
            event.preventDefault();
            if(redo)redoWorkingEdit();else undoWorkingEdit();
          }
          return;
        }
        if(k==="s"){
          event.preventDefault();
          if(working&&hasUnapplied)setMessage("Apply Plot to Draft before saving the mapping.");
          else if(dirty)void execute("save");
        }
        return;
      }
      if(working&&mode==="edit"&&selectedCorner!==null&&editable&&
         editorRef.current?.contains(document.activeElement)&&
         ["arrowup","arrowdown","arrowleft","arrowright"].includes(k)){
        event.preventDefault();
        const step=nudgeStep*(event.shiftKey?10:1);
        nudgeSelectedCorner(k==="arrowleft"?-step:k==="arrowright"?step:0,
          k==="arrowup"?-step:k==="arrowdown"?step:0);
        return;
      }
      if((k==="p"||k==="d"||k==="i"||k==="e"||k==="f")&&!editable)return;
      if(k==="p"){pauseForPan();return;}
      if(k==="d"){begin("four");return;}
      if(k==="i"){begin("irregular");return;}
      if(k==="e"&&working){setMode("edit");return;}
      if(k==="f"){fitView();return;}
      if(k==="backspace"&&working?.corners.length&&!originalId){event.preventDefault();undoCorner();return;}
      if(k==="+"||k==="="){event.preventDefault();zoomBy(1.25);return;}
      if(k==="-"){event.preventDefault();zoomBy(0.8);}
    };
    document.addEventListener("keydown",handleKey);
    return()=>document.removeEventListener("keydown",handleKey);
  });
  const editable=Boolean(state&&!state.draft.stale&&geo);
  const path=(points:Point[])=>points.map(p=>project(p).join(",")).join(" ");
  const pausedDrawing=geoPlotPausedDrawingLabel({mode,plot:working,originalId,shape});
  return <main className="geo-plot-page">
    <header className="geo-plot-top"><div><p className="eyebrow">REKIXO ENGINE · INDEPENDENT GEO MAPPING</p><h1>3D Geo Plot Mapper</h1>
      <p>Draw plot boundaries on a checksum-verified Building-local master plan. AR3D Platform remains untouched.</p></div>
      <label>Project <select value={slug} disabled={busy} onChange={e=>{setSlug(e.target.value);setWorking(null);}}>
        <option value="">Choose project</option>{options.map(o=><option key={o.id} value={o.slug}>{o.name}</option>)}</select></label>
    </header>
    <section className="geo-plot-stats">
      <span>Geo source <b>{state?.geoReleaseId?.slice(0,18)||
          (message.startsWith("ERROR:")?"Load failed":"Checking…")}</b></span>
      <span>Draft <b>r{state?.draft.revision||0}</b></span>
      <span>Mapped <b>{plots.length}</b></span>
      <span>Verified <b>{state?.draft.revision&&state.draft.verifiedRevision===state.draft.revision&&
          state.draft.verifiedInventoryRevision===state.inventoryRevision&&
          (state.alignmentRevision===0||state.draft.verifiedAlignmentRevision===state.alignmentRevision)
            ?"Yes":"Needs review"}</b></span>
      <span>Live mapping <b>{state?.activeMapping?.current?
        "v"+state.activeMapping.version+(state.activeMapping.publicationMode==="preliminary"?" · Preliminary":" · Verified"):
        "None / stale"}</b></span>
    </section>
    {state?.draft.stale&&<div className="geo-plot-warning">
      <p>3D Geo source has changed. Old polygons and commercial history are preserved.
      Use 1 · CSV / Image → Source replacement to verify the old and new model against
      the same original image, then remap only affected Plot IDs. Recheck all plot approvals
      before publishing. Historical releases remain available for recovery.</p>
      <button type="button" disabled={busy||dirty||Boolean(working)}
        onClick={()=>void preserveSameCoordinateModel()}>
        Keep Existing Plot Coordinates · Unverified Draft
      </button>
      <button type="button" disabled={busy} onClick={()=>{
        const exact="RESET MAPPING "+slug;
        if(window.prompt("Create an EMPTY mapping for the new Geo release. Unsaved old draft polygons will be replaced. Type "+exact)===exact)
          void execute("rebind-reset");
      }}>Start new mapping for active Geo</button>
    </div>}
    {message&&<div className={message.startsWith("ERROR")?"geo-plot-warning":"geo-plot-message"}
        role={message.startsWith("ERROR")?"alert":"status"}>{message}
        {message.startsWith("ERROR")&&<button type="button" onClick={()=>window.location.reload()}>
          Retry loading Geo source</button>}</div>}
    <div className="geo-plot-editor-shell" ref={editorRef} data-fullscreen={focused?"true":"false"}>
      <div className="geo-plot-editor-head">
        <div><strong>PRECISION PLOT STUDIO</strong>
          <span>Front-first boundaries · editable corners · source-backed measurements</span></div>
        <div className="geo-plot-editor-head-stats">
          <span><b>{progress.confirmed}</b> / {progress.inventory} confirmed</span>
          <span><b>{progress.pending}</b> pending</span>
          <span><b>{working?.id||"—"}</b> current plot</span>
          {dirty&&<span className="geo-plot-unsaved">Unsaved mapping draft</span>}
        </div>
      </div>
      <section className="geo-plot-tools" aria-label="Plot mapper controls">
        <div className="geo-plot-current-control">
          <label>Current CSV Plot
            <select aria-label="Current approved CSV plot" value={working?.id||""}
              disabled={!editable||busy||dirty}
              onChange={e=>{
                const id=e.target.value;
                if(!id||working?.id===id)return;
                const mapped=plots.find(p=>p.id===id);
                if(mapped){choose(mapped);return;}
                const row=inventoryRows.find(p=>p.id===id);
                if(!row||!confirmUnapplied())return;
                clearLocalPlotDraft();resetWorking(fromInventory(row,groundY));setOriginalId(null);
                setShape("four");setMode("draw");setInspectorTab("plot");
                setMessage("Plot "+id+" selected from approved CSV. Draw the real boundary.");
              }}>
              <option value="">Select CSV Plot…</option>
              {inventoryRows.map(row=><option key={row.id} value={row.id}>{row.id} · {
                plots.some(p=>p.id===row.id)?"confirmed":"pending"}</option>)}
              {working&&!inventoryRows.some(row=>row.id===working.id)&&
                <option value={working.id}>{working.id} · not in CSV</option>}
            </select>
          </label>
        </div>
        <div className="geo-plot-tool-group" aria-label="Boundary drawing tools">
          {mode==="align"&&<button type="button" className="active"
            onClick={()=>{alignmentPickRef.current=null;setMode("pan");}}>Cancel alignment capture</button>}
          <button type="button" disabled={!editable||busy} className={mode==="pan"?"active":""}
            title="Pan and pinch zoom (P) · unfinished corners stay in place"
            aria-pressed={mode==="pan"}
            onClick={pauseForPan}>✋ Pan</button>
          {pausedDrawing&&<button type="button" className="geo-plot-resume-drawing"
            disabled={!editable||busy} aria-label={"Resume Drawing Plot "+pausedDrawing.plotId}
            title={"Continue "+(shape==="four"?"4 corners":"Irregular")+
              " without losing "+working!.corners.length+" existing points (D/I)"}
            onClick={()=>begin(shape)}>
            ▶ Resume Drawing · Corner {pausedDrawing.nextCorner}
          </button>}
          <button type="button" disabled={!editable||busy}
            className={mode==="draw"&&shape==="four"?"active":""}
            title="Draw four-corner boundary, first edge is Front (D)"
            onClick={()=>begin("four")}>▱ 4 corners</button>
          <button type="button" disabled={!editable||busy}
            className={mode==="draw"&&shape==="irregular"?"active":""}
            title="Draw irregular boundary with 3–80 corners (I)"
            onClick={()=>begin("irregular")}>⬡ Irregular</button>
          <button type="button" disabled={!editable||busy||!working}
            className={mode==="edit"?"active":""} title="Drag corners for precision (E)"
            onClick={()=>setMode("edit")}>✎ Edit</button>
          {mode==="draw"&&shape==="irregular"&&working&&working.corners.length>=3&&
            <button type="button" className="geo-plot-tool-complete"
              disabled={!editable||busy} onClick={finishBoundary}>✓ Boundary complete</button>}
        </div>
        <div className="geo-plot-tool-group geo-plot-tool-group--secondary">
          <button type="button" disabled={busy||!workingHistory.past.length}
            aria-label="Undo working plot edit" title="Undo plot edit" onClick={undoWorkingEdit}>↶ Undo</button>
        </div>
        <div className="geo-plot-tool-group geo-plot-zoom-tools" aria-label="Precision viewport zoom">
          <button type="button" disabled={!geo} aria-label="Zoom out" onClick={()=>zoomBy(.8)}>−</button>
          <output>{zoomPercent}%</output>
          <button type="button" disabled={!geo} aria-label="Zoom in" onClick={()=>zoomBy(1.25)}>+</button>
          <button type="button" disabled={!geo} title="Fit all geometry (F)" onClick={fitView}>Fit</button>
          <button type="button" className="geo-plot-fullscreen-toggle"
            title="Show canvas and mapper in full screen" aria-label={focused?"Exit full screen":"Full screen"} aria-pressed={focused}
            onClick={()=>void toggleFullscreen()}>{focused?"⊟ Exit":"⛶ Full screen"}</button>
        </div>
        <details className="geo-plot-toolbar-more">
          <summary>More</summary>
          <div className="geo-plot-toolbar-more-menu">
            <button type="button" disabled={!editable||busy||!working||working.corners.length<3}
              onClick={()=>{setMode("side");setInspectorTab("plot");}}>↔ Assign Sides</button>
            <button type="button" disabled={busy||!workingHistory.future.length}
              aria-label="Redo working plot edit" onClick={redoWorkingEdit}>↷ Redo</button>
            <button type="button" disabled={!working?.corners.length||busy||Boolean(originalId)}
              title="Remove last new-plot corner" onClick={undoCorner}>Remove point</button>
            <button type="button" disabled={!working||busy} onClick={cancelWorking}>Cancel plot</button>
            <label className="geo-plot-toggle"><input type="checkbox" checked={snap}
              onChange={e=>setSnap(e.target.checked)}/> Snap {snap?"ON":"OFF"}</label>
            <label className="geo-plot-toggle"><input type="checkbox" checked={showGuides}
              onChange={e=>setShowGuides(e.target.checked)}/> Labels</label>
            <label className="geo-plot-toolbar-zoom">Zoom
              <input type="range" min="100" max="5000" step="1" value={zoomPercent}
                onChange={e=>setZoom(Number(e.target.value))}
                aria-label="Zoom percent" aria-valuetext={zoomPercent+" percent"}/>
            </label>
          </div>
        </details>
      </section>
      {focused&&message&&<div className={message.startsWith("ERROR")?"geo-plot-warning":"geo-plot-message"} role={message.startsWith("ERROR")?"alert":"status"}>{message}</div>}
      <div className="geo-plot-workspace">
      <div className="geo-plot-scene">
        <div className="geo-plot-canvas" ref={hostRef} aria-label="Top-down 3D masterplan plot mapping canvas"/>
        {geo&&<svg ref={overlayRef} className="geo-plot-overlay" viewBox={`0 0 ${viewport.w} ${viewport.h}`}
           preserveAspectRatio="none"
           data-tool-mode={mode} data-snap={snap?"on":"off"}
           style={{pointerEvents:mode==="pan"?"none":"auto"}}
           onPointerDown={onOverlayPointerDown}
           onPointerMove={onOverlayPointerMove}
           onPointerUp={onOverlayPointerUp}
           onPointerCancel={onOverlayPointerCancel}
           onPointerLeave={()=>{if(dragRef.current===null&&!pointerStartRef.current)clearPointer();}}>
          {plots.map(p=>{
             const x=p.corners.reduce((n,q)=>n+q[0],0)/p.corners.length;
             const y=p.corners.reduce((n,q)=>n+q[1],0)/p.corners.length;
             const [cx,cy]=project([x,y]);
             return <g key={p.id} className="geo-plot-mapped-outline">
               <polygon points={path(p.corners)} fill="rgba(16,185,129,.16)"
                 stroke={working?.id===p.id?"#f5dd6d":"#3fe3b1"} strokeWidth="2"
                 onPointerDown={e=>{if(mode==="draw"||mode==="align")return;e.stopPropagation();choose(p);}}/>
               {showGuides&&<text className="geo-plot-map-number" x={cx} y={cy}
                 textAnchor="middle" dominantBaseline="middle">{p.id}</text>}
             </g>;
           })}
           {working&&mode==="draw"&&working.corners.length>0&&pointerPreview&&
            <line className="geo-plot-precision-rubberband"
              x1={project(working.corners[working.corners.length-1])[0]}
              y1={project(working.corners[working.corners.length-1])[1]}
              x2={pointerPreview.screen[0]} y2={pointerPreview.screen[1]}
              stroke="#ffe78c" strokeWidth="1.5" strokeDasharray="5 4"
              pointerEvents="none"/>}
          {working&&working.corners.length>0&&<>
            <polyline points={path(working.corners)} fill={working.corners.length>=3?"rgba(250,204,21,.22)":"none"}
              stroke="#ffd965" strokeWidth="2.5" strokeDasharray="7 4"/>
            {showGuides&&ROLES.filter(role=>working.layout==="four"||role!=="depthB")
               .map(role=>{
                 const side=working.sides[role],anchor=sideLabelAnchor(working.corners,side?.edges||[]);
                 if(!side||!anchor)return null;
                 const [x,y]=project(anchor);
                 const label=role==="depthA"?"Depth A":role==="depthB"?"Depth B":
                   role==="front"?"Front":"Back";
                 const value=side.verified&&side.length>0
                   ? " · "+side.length.toFixed(2)+" "+side.unit+" ✓" : " · verify";
                 return <text key={role} className="geo-plot-map-side-label"
                   x={x} y={y-14} textAnchor="middle">{label+value}</text>;
               })}
             {(mode==="side"||Boolean(sideCoverage&&!sideCoverage.ok))&&
              working.corners.length>=3&&working.corners.map((point,index)=>{
                const [x1,y1]=project(point),[x2,y2]=project(working.corners[(index+1)%working.corners.length]);
                const role=ROLES.find(item=>working.sides[item]?.edges.includes(index))||"";
                const missing=sideCoverage?.missingEdges.includes(index);
                const duplicated=sideCoverage?.duplicateEdges.includes(index);
                const bad=missing||duplicated;
                return <g key={"side-edge-"+index} className="geo-plot-side-hit">
                  <line x1={x1} y1={y1} x2={x2} y2={y2}
                    stroke={bad?"#ff555e":role===selectedRole?"#40ffb4":"#ffdc86"}
                    strokeWidth={bad?"7":"5"} pointerEvents="none"/>
                  {bad&&<text x={(x1+x2)/2} y={(y1+y2)/2-9} textAnchor="middle"
                    fill="#fff" stroke="#9a192a" paintOrder="stroke" fontSize="12"
                    pointerEvents="none">Edge {index+1} !</text>}
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent"
                    strokeWidth="22" pointerEvents={mode==="side"?"stroke":"none"}
                    onPointerDown={e=>{if(mode!=="side")return;e.preventDefault();e.stopPropagation();assignSideOnCanvas(index);}}
                    onPointerUp={e=>e.stopPropagation()}
                    aria-label={"Assign edge "+(index+1)+" to "+selectedRole}/>
                </g>;
              })}
             {working.corners.map((point,i)=>{const [x,y]=project(point);
              return <g key={i} className="geo-plot-precision-handle">
                <circle className="geo-plot-handle-hit" cx={x} cy={y} r="17" fill="transparent"
                  onPointerDown={e=>{
                    if(mode!=="edit")return;
                    e.stopPropagation();
                    dragRef.current=i;dragStartRef.current=workingRef.current?structuredClone(workingRef.current):null;
                    setSelectedCorner(i);pointerStartRef.current=null;
                    e.currentTarget.setPointerCapture(e.pointerId);
                    updatePointer(e.clientX,e.clientY,e.pointerType,i);
                  }}
                  onPointerUp={e=>{
                    if(dragRef.current!==null)flushDrag(dragRef.current,e.clientX,e.clientY);
                    dragRef.current=null;closeCornerDrag();
                    if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
                    queuePointer(e.clientX,e.clientY,e.pointerType);
                  }}
                  onPointerCancel={()=>{dragRef.current=null;closeCornerDrag();clearPointer();}}/>
                <circle className="geo-plot-handle-visible" cx={x} cy={y}
                  r={Math.max(4.5,10-Math.min((zoomPercent-100)/4900,1)*4)}
                  fill="#ffe49d" stroke="#182a3e" strokeWidth="2.5" pointerEvents="none"/>
                <text x={x+12} y={y-10} fill="#fff" fontSize="13" stroke="#111"
                  paintOrder="stroke" pointerEvents="none">{i+1}</text></g>;
            })}
          </>}
        </svg>}
        {working&&<div className="geo-plot-scene-status" aria-live="polite">
           <b>Plot {working.id}</b>
           <span>{shape==="four"?working.corners.length+"/4":working.corners.length+" (irregular)"} corners</span>
           <span>{mode==="draw"?"Mark Front edge first":mode==="edit"?"Drag numbered corner handles":
             mode==="side"?"Tap highlighted boundary edges to assign "+selectedRole:
             pausedDrawing?"Paused · "+pausedDrawing.nextCorner+" is next · Resume Drawing":"Pan / pinch to inspect"}</span>
         </div>}
         {pausedDrawing&&<div className="geo-plot-paused-banner" role="status">
           {pausedDrawing.text}. Pan freely, then press Resume Drawing or the same 4 corners / Irregular tool.
         </div>}
         <div className="geo-plot-scene-info">{modelStatus||("Top view · model coordinates in metres · "+
           (mode==="pan"?"1 finger pan · pinch zoom":mode==="draw"?"Click corners clockwise · wheel zoom at cursor":"Drag numbered handles · wheel zoom at cursor"))}</div>
      </div>
      <aside className="geo-plot-dock">
        <nav className="geo-plot-dock-tabs geo-plot-primary-tabs" aria-label="Plot Mapper workspaces">
          <button type="button" className={inspectorTab==="plot"?"active":""}
            aria-pressed={inspectorTab==="plot"} disabled={busy||mode==="align"}
            onClick={()=>setInspectorTab("plot")}>Mapping</button>
          <button type="button" className={inspectorTab==="sources"?"active":""}
            aria-pressed={inspectorTab==="sources"} disabled={busy}
            onClick={()=>setInspectorTab("sources")}>CSV / Image</button>
          <button type="button" className={inspectorTab==="quality"||inspectorTab==="publish"?"active":""}
            aria-pressed={inspectorTab==="quality"||inspectorTab==="publish"}
            disabled={busy||mode==="align"}
            onClick={()=>setInspectorTab("quality")}>Review & Publish</button>
        </nav>
        {(inspectorTab==="quality"||inspectorTab==="publish")&&
          <nav className="geo-plot-review-tabs" aria-label="Mapping review or publishing">
            <button type="button" className={inspectorTab==="quality"?"active":""}
              aria-pressed={inspectorTab==="quality"} disabled={busy}
              onClick={()=>setInspectorTab("quality")}>Quality Review</button>
            <button type="button" className={inspectorTab==="publish"?"active":""}
              aria-pressed={inspectorTab==="publish"} disabled={busy}
              onClick={()=>setInspectorTab("publish")}>Publish</button>
          </nav>}
        {recoveredLocalDraft&&<div className="geo-plot-local-recovery" role="status">
          <strong>Unfinished Plot {recoveredLocalDraft.plot.id} available on this browser</strong>
          <span>Matches this project, 3D model and mapping revision. Not published.</span>
          <div><button type="button" disabled={dirty||busy} onClick={restoreLocalPlotDraft}>
            Restore unfinished plot</button>
            <button type="button" onClick={clearLocalPlotDraft}>Discard local copy</button></div>
        </div>}
        <div className="geo-plot-source-workspace" hidden={inspectorTab!=="sources"}>
        <GeoPlotInventoryPanel key={slug+"-inventory-"+inventoryImportNonce}
          slug={slug} mappedIds={plots.map(p=>p.id)}
          workingId={working?.id} blocked={!editable||busy||dirty||hasUnapplied}
          onRowsChange={onInventoryRowsChange}
          onStart={row=>{
            if(!confirmUnapplied())return;
            if(plots.some(p=>p.id.toLowerCase()===row.id.toLowerCase())){
              setMessage("ERROR: This plot is already mapped; use Plot Editor to change it.");
              return;
            }
            clearLocalPlotDraft();resetWorking(fromInventory(row,groundY));
            setOriginalId(null);setShape("four");setMode("draw");setInspectorTab("plot");
            setMessage("Plot "+row.id+" loaded from CSV. Start at the road-facing Front edge, then mark corners.");
          }}/>
        {slug&&geo&&state&&<GeoPlotImageAlignmentPanel key={slug+"-alignment"}
          slug={slug} geoReleaseId={state.geoReleaseId} buildingReleaseId={state.buildingReleaseId}
          plots={plots} onCapture={captureImageAlignmentPoint}
          onRevisionChange={onAlignmentRevisionChange}
          onStageImageCorner={stageCornerFromVerifiedImage} editable={editable&&!busy}
          mappingStale={Boolean(state.draft.stale)}
          onRebindSource={rebindWithReviewedSource}/>}
        </div>
        {inspectorTab==="quality"&&<>
        <details className="geo-plot-review-dashboard" open>
          <summary>03 · Data quality · {progress.pending} pending / {quality.summary.blockers} blockers /
            {actionableQualityIssues.filter(issue=>issue.severity==="review").length} mapped reviews</summary>
          <p className="geo-plot-hint">Private draft diagnostics · {quality.summary.mapped} mapped /
            {quality.summary.inventory} approved inventory IDs. Source evidence and model estimates are separate;
            review findings are not a survey certificate. These Quality issues block Verified status, not a clearly labeled Preliminary Mapping publication.</p>
          <button type="button" disabled={!state} onClick={downloadQualityEvidence}>
            Download Evidence & Quality Review JSON
          </button>
          <div className="geo-plot-review-queue-intro">
            <strong>{reviewQueue.affected} mapped Plot IDs need review
              {reviewQueue.blockedPlots>0?" · "+reviewQueue.blockedPlots+" with blockers":""}</strong>
            <p>{plots.length} mapped polygons do not mean source approvals are complete. Plot boundaries stay
              saved while you review the actual road-facing Front, CSV dimensions,
              model plane and source evidence. No blanket approval is applied.</p>
            {reviewQueue.queue.length>0&&<button type="button"
              disabled={!editable||busy}
              onClick={()=>openPlotQualityReview(reviewQueue.queue[0].id)}>
              Review first pending Plot {reviewQueue.queue[0].id}
            </button>}
          </div>
          <div className="geo-plot-quality-queue" aria-label="Plot quality review queue">
            {reviewQueue.queue.map(item=><article key={item.id} className="geo-plot-quality-item">
              <div className="geo-plot-quality-item-head">
                <strong>Plot {item.id}</strong>
                <span>{item.blockers} blocker{item.blockers===1?"":"s"} ·
                  {" "+item.reviews+" review"+(item.reviews===1?"":"s")}</span>
              </div>
              <p>{item.nextAction}</p>
              <button type="button" disabled={!editable||busy}
                onClick={()=>openPlotQualityReview(item.id)}>
                Review Plot {item.id} in Editor
              </button>
            </article>)}
            {reviewQueue.general.slice(0,12).map((issue,i)=><p key={issue.plotId+issue.field+i}
              className={issue.severity==="blocker"?"geo-plot-warning":"geo-plot-hint"}>
              <strong>{issue.severity==="blocker"?"Project blocker":"Project review"}</strong> ·
              {issue.plotId} · {issue.field}: {issue.reason}
            </p>)}
          </div>
          <details className="geo-plot-quality-raw">
            <summary>Detailed findings · {actionableQualityIssues.length} total
              (full JSON available above)</summary>
          <div className="geo-plot-review-issues" aria-live="polite">
            {actionableQualityIssues.slice(0,24).map((issue,i)=><p key={issue.plotId+issue.field+i}
              className={issue.severity==="blocker"?"geo-plot-warning":"geo-plot-hint"}>
              <strong>{issue.severity==="blocker"?"Blocker":"Review"}</strong> ·
              Plot {issue.plotId} · {issue.field}: {issue.reason}
            </p>)}
            {!actionableQualityIssues.length&&<p className="geo-plot-hint">No blocker/review issues in mapped plots.
              {progress.pending>0?" "+progress.pending+" CSV plots are pending mapping.":""}
              Source and model quality checks do not themselves certify real-world field measurements.</p>}
            {actionableQualityIssues.length>24&&<p className="geo-plot-hint">
              +{actionableQualityIssues.length-24} more. Download the complete evidence report to inspect all plots.</p>}
          </div>
          </details>
        </details>
        <details className="geo-plot-clone-panel">
          <summary>Clone Previous · unverified footprint template</summary>
          <p className="geo-plot-hint">Choose a completed plot and explicit Building-local X/Z translation.
            Duplicate or overlapping footprints are blocked. All approvals reset; no source facts
            from the previous plot authorize the next plot.</p>
          <label>Previous mapped Plot ID<select value={cloneFrom} onChange={e=>setCloneFrom(e.target.value)}
            disabled={!editable||busy}>
            <option value="">Select previous plot</option>
            {plots.map(p=><option key={p.id} value={p.id}>Plot {p.id}</option>)}
          </select></label>
          <strong>New Plot ID · {nextTemplateId} {inventoryRows.some(r=>r.id.toLowerCase()===nextTemplateId.toLowerCase())?"(approved inventory)":"(requires inventory review)"}</strong>
          <div className="geo-plot-clone-offsets">
            <label>X offset (metres)<input type="number" step="any" value={cloneX}
              onChange={e=>setCloneX(e.target.value)} placeholder="Enter surveyed X translation"/></label>
            <label>Z offset (metres)<input type="number" step="any" value={cloneZ}
              onChange={e=>setCloneZ(e.target.value)} placeholder="Enter surveyed Z translation"/></label>
          </div>
          <button type="button" disabled={!editable||busy||!plots.length||!cloneFrom||
            !cloneX.trim()||!cloneZ.trim()} onClick={clonePreviousDraft}>
            Clone to Unverified Draft
          </button>
        </details>
        </>}
        {inspectorTab==="plot"&&<>
        <div className="geo-plot-inspector-head">
           <div><small>PROJECT PLOT INVENTORY</small><h3>Plot Editor</h3></div>
           <span>{displayedPlots.length}/{plots.length}</span>
         </div>
         {working&&!inventoryRows.some(p=>p.id.toLowerCase()===working.id.toLowerCase())&&inventoryRows.length>0&&
          <p className="geo-plot-warning" role="alert">
            Plot {working.id} is NOT in the approved CSV ({progress.inventory} IDs).
            Cancel this unfinished plot and select a CSV Plot ID before Confirm.
          </p>}
         {working&&working.corners.length>=3&&<section className="geo-plot-compact-card" aria-label="Current plot summary">
           <div className="geo-plot-compact-head">
             <strong>Plot {working.id}</strong>
             <div className="geo-plot-compact-navigation">
               <button type="button" disabled={!plots.length||busy} onClick={()=>chooseSibling(-1)}
                 aria-label="Previous mapped plot">‹</button>
               <button type="button" disabled={!plots.length||busy} onClick={()=>chooseSibling(1)}
                 aria-label="Next mapped plot">›</button>
             </div>
             <span>{working.corners.length} corners · {sideCoverage?.ok?
               "✓ "+sideCoverage.edgeCount+" edges assigned":"Side review needed"}</span>
           </div>
           {sideCoverage&&!sideCoverage.ok&&<div className="geo-plot-warning" role="alert">
             <strong>{coverageError(sideCoverage)}</strong>
             <button type="button" disabled={!editable||busy} onClick={repairWorkingSides}>
               Repair Sides · Keep Polygon
             </button>
           </div>}
           <div className="geo-plot-compact-area">
             <span>Area · mapped value</span>
             <strong>{working.area.value>0?working.area.value:selectedInventory?.area||"—"}
               {" "}{working.area.value>0?working.area.unit:selectedInventory?.areaUnit||""}</strong>
           </div>
           <div className="geo-plot-compact-dimensions">
             {ROLES.filter(role=>working.layout==="four"||role!=="depthB").map(role=>{
               const length=working.sides[role]?.length||selectedInventory?.[role]||0;
               const unit=working.sides[role]?.unit||selectedInventory?.lengthUnit||"ft";
               return <div key={role}>
                 <span>{role==="depthA"?"Depth A":role==="depthB"?"Depth B":role==="front"?"Front":"Back"}</span>
                 <strong>{length>0?length.toFixed(2)+" "+unit:"Needs source"}</strong>
               </div>;
             })}
           </div>
           <div className="geo-plot-compact-meta">
             <span>Facing <b>{roadFrontPreview(working,geo?.placement.headingDeg??Number.NaN,suggestGeoSideFacing)||
               (working.facingVerified&&working.facingSource?working.facing:"Check Geo North")}</b>
               <small>Geo suggestion · verify road</small></span>
             <span>Road <b>{working.sides.front?.roadFacing?"Front marked · review source":"Check Front"}</b></span>
           </div>
           {(()=>{const variance=measurementVariance(areaSqm(working.corners),working.area.value,
             working.area.unit,geo?.placement.scale||1);
             return variance!==null&&Math.abs(variance)>0.1?
               <p className="geo-plot-compact-warning" role="status">
                 ⚠ Area mismatch {(Math.abs(variance)*100).toFixed(1)}% · Review Geometry
               </p>:null;
           })()}
           {inferFrontFirstSideGroups(working.corners)?.reviewRequired&&
             <p className="geo-plot-compact-hint">Irregular side groups: confirm the real road and corner segments.</p>}
           {(()=>{const review=reviewQueue.queue.find(item=>item.id.toLowerCase()===working.id.toLowerCase());
             return review?<button type="button" className="geo-plot-compact-review"
               onClick={()=>setInspectorTab("quality")}>
               {review.blockers} blocker(s) · {review.reviews} review(s) · View Quality
             </button>:null;
           })()}
           <div className="geo-plot-compact-actions">
             <button type="button" disabled={!editable||busy||!sideCoverage?.ok}
               aria-label="Change Front by tapping plot edge"
               onClick={()=>{setSelectedRole("front");setMode("side");}}>Change Front</button>
             <button type="button" disabled={!editable||busy||!sideCoverage?.ok}
               onClick={()=>{setSelectedRole("front");setMode("side");}}>Edit Sides</button>
             <button type="button" disabled={!editable||busy}
               onClick={()=>{if(advancedDetailsRef.current)advancedDetailsRef.current.open=true;}}>
               Edit Values
             </button>
           </div>
           <button type="button" className="geo-plot-confirm-primary geo-plot-compact-save"
             disabled={!editable||busy||!state||!sideCoverage?.ok||
               (shape==="four"&&working.corners.length!==4)||
               Boolean(inventoryRows.length&&!inventoryRows.some(row=>row.id.toLowerCase()===working.id.toLowerCase()))}
             aria-label={"Confirm Plot "+working.id+" & Next — Save & Next"}
             onClick={()=>void confirmPlotAndNext()}>✓ {busy?"Saving…":"Save & Next"}</button>
         </section>}
         {working&&mode==="side"&&working.corners.length>=3&&
           <section className="geo-plot-visual-side-panel geo-plot-context-side">
             <div className="geo-plot-context-head">
               <strong>Edit sides on canvas</strong>
               <button type="button" onClick={()=>setMode("edit")}>Done</button>
             </div>
             <div className="geo-plot-side-role-buttons">
               {ROLES.filter(role=>working.layout==="four"||role!=="depthB").map(role=>
                 <button type="button" key={role} aria-pressed={selectedRole===role}
                   className={selectedRole===role?"active":""} disabled={busy||!editable}
                   onClick={()=>setSelectedRole(role)}>
                   {role==="depthA"?"Depth A":role==="depthB"?"Depth B":role==="front"?"Front":"Back"}
                 </button>)}
             </div>
             {working.corners.length>4&&<label className="geo-plot-check">
               <input type="checkbox" checked={extendSide} onChange={e=>setExtendSide(e.target.checked)}/>
               Adjust connected segments
             </label>}
             <small>Tap a boundary edge to assign {selectedRole}. The editor keeps every edge assigned once.</small>
           </section>}
         {state&&state.draft.revision>0&&state.draft.verifiedInventoryRevision!==state.inventoryRevision&&
          state.draft.verifiedRevision===state.draft.revision&&
          <p className="geo-plot-warning" role="status">Source inventory was updated after verification.
            Review current CSV evidence, then Save/Verify before any new Publish.</p>}
        {inventoryIssues.length>0&&<div className="geo-plot-source-review" aria-live="polite">
          <strong>Source Reconciliation · {inventoryIssues.length} issue(s)</strong>
          <small>Inventory revision {state?.inventoryRevision??0} ·
            Verified revision {state?.draft.verifiedInventoryRevision??"not yet"}</small>
          {inventoryIssues.slice(0,7).map((issue,i)=><p key={issue.plotId+issue.field+i}>
            Plot {issue.plotId} · {issue.field}: {issue.reason}</p>)}
          {inventoryIssues.length>7&&<small>+ {inventoryIssues.length-7} more issues. Review each mapped plot.</small>}
          {!inventoryIssues.length&&<small>{progress.confirmed} mapped Plot IDs match current CSV references.
            {progress.pending>0?" "+progress.pending+" approved IDs still need mapping.":""}</small>}
        </div>}
        <details className="geo-plot-inventory-browser">
          <summary>Browse mapped plots · {plots.length}</summary>
        <label className="geo-plot-inventory-search">Find plot
           <input type="search" placeholder="Search plot number" value={inventoryQuery}
             onChange={e=>setInventoryQuery(e.target.value)}/>
         </label>
         <div className="geo-plot-inventory-navigation">
           <button type="button" disabled={!plots.length} onClick={()=>chooseSibling(-1)} aria-label="Previous plot">← Previous</button>
           <button type="button" disabled={!plots.length} onClick={()=>chooseSibling(1)} aria-label="Next plot">Next →</button>
         </div>
         <div className="geo-plot-inventory" aria-label="Mapped plot selection">
           {displayedPlots.map(p=><button type="button" key={p.id} onClick={()=>choose(p)}
             className={working?.id===p.id?"active":""} aria-pressed={working?.id===p.id}>
             Plot {p.id}<small>{p.corners.length} corners</small></button>)}
           {plots.length===0&&<p className="geo-plot-hint">No plot boundaries yet. Select 4 corners or Irregular to draw the first plot.</p>}
           {plots.length>0&&displayedPlots.length===0&&<p className="geo-plot-hint">No plots match this search.</p>}
         </div>
        </details>
         {working&&working.corners.length<3&&<div className="geo-plot-compact-empty">
           <strong>Plot {working.id} · {working.corners.length} corners</strong>
           <p>Draw the first Front edge and continue around the actual boundary. Dimensions are read from the approved CSV.</p>
           <button type="button" disabled={!editable||busy} onClick={()=>begin(shape)}>
             {working.corners.length?"Resume drawing":"Start drawing"}
           </button>
         </div>}
         {working&&<>
          <details ref={advancedDetailsRef} className="geo-plot-advanced-details">
            <summary>Advanced · measurements, evidence & precision</summary>
          <h3>{plots.some(p=>p.id===working.id)?"Update":"New"} Plot {working.id}</h3>
          <div className="geo-plot-inspector-selection">
             <span>{originalId?"Editing mapped plot":"New polygon"}</span>
             <strong>Plot {working.id}</strong>
             <small>{working.corners.length} corners · {hasUnapplied?"Not applied to draft":"Up to date"}</small>
           </div>
          {(()=>{const saved=reviewQueue.queue.find(item=>item.id.toLowerCase()===working.id.toLowerCase());
            return saved?<div className="geo-plot-selected-review-note" role="status">
              <strong>Saved draft: {saved.blockers} blocker(s) · {saved.reviews} review(s)</strong>
              <span>{saved.nextAction}</span>
              <small>After making source-backed changes, Confirm Plot to save privately and recalculate this report.
                A correct CSV match does not automatically approve measurements.</small>
            </div>:null;
          })()}
          {mode==="edit"&&working.corners.length>=3&&<div className="geo-plot-corner-nudge"
            aria-label="Precision model-local corner movement">
            <strong>Precision corner movement (metres, model X/Z)</strong>
            <div className="geo-plot-nudge-settings">
              <label>Corner
                <select aria-label="Selected corner" value={selectedCorner??""}
                  onChange={e=>setSelectedCorner(e.target.value===""?null:Number(e.target.value))}>
                  <option value="">Choose corner</option>
                  {working.corners.map((_,i)=><option key={i} value={i}>
                    Corner {i+1} · X {working.corners[i][0].toFixed(3)}, Z {working.corners[i][1].toFixed(3)}</option>)}
                </select>
              </label>
              <label>Step (metres)
                <select aria-label="Corner movement step" value={nudgeStep}
                  onChange={e=>setNudgeStep(Number(e.target.value))}>
                  <option value={0.01}>0.01 m</option><option value={0.1}>0.1 m</option>
                  <option value={0.5}>0.5 m</option>
                </select>
              </label>
            </div>
            <div className="geo-plot-nudge-buttons">
              <button type="button" aria-label="Nudge corner model negative X"
                disabled={!editable||busy||selectedCorner===null}
                onClick={()=>nudgeSelectedCorner(-nudgeStep,0)}>−X</button>
              <button type="button" aria-label="Nudge corner model negative Z"
                disabled={!editable||busy||selectedCorner===null}
                onClick={()=>nudgeSelectedCorner(0,-nudgeStep)}>−Z</button>
              <button type="button" aria-label="Nudge corner model positive Z"
                disabled={!editable||busy||selectedCorner===null}
                onClick={()=>nudgeSelectedCorner(0,nudgeStep)}>+Z</button>
              <button type="button" aria-label="Nudge corner model positive X"
                disabled={!editable||busy||selectedCorner===null}
                onClick={()=>nudgeSelectedCorner(nudgeStep,0)}>+X</button>
            </div>
            <small>Choose a corner above or click its handle. Arrow keys move the selected corner when editor controls are focused; Shift = 10×. Moving geometry revokes source and road-side approvals.</small>
          </div>}
          <label>Plot Number<input readOnly={Boolean(originalId)} value={working.id} onChange={e=>setWorking({...working,id:e.target.value})}/></label>
          {selectedInventory&&<div className="geo-plot-source-review">
            <strong>Approved CSV · Plot {selectedInventory.id}</strong>
            <p>Area {selectedInventory.area||"not supplied"} {selectedInventory.areaUnit} ·
              Front {selectedInventory.front||"—"} · Back {selectedInventory.back||"—"} ·
              Depth A {selectedInventory.depthA||"—"} · Depth B {selectedInventory.depthB||"—"} {selectedInventory.lengthUnit}</p>
            {selectedInventory.sideDimensions&&<p className="geo-plot-hint">
              Original CAD side detail: {selectedInventory.sideDimensions}</p>}
            {selectedInventory.notes&&<p className="geo-plot-hint">
              Source notes: {selectedInventory.notes}</p>}
            {!selectedInventory.depthA&&<p className="geo-plot-warning">
              Source Depth A missing. Use irregular polygon mode and review individual source edges;
              do not invent a missing segment length.</p>}
            <button type="button" disabled={!editable||busy} onClick={applyCurrentSource}>
              Apply Latest Approved CSV to Selected Plot (unverified)</button>
          </div>}
          <details open className="geo-plot-inspector-section">
            <summary>01 · Geometry & site plane</summary>
          <p className="geo-plot-hint">Corners: {working.corners.length} · Model area (unverified): {areaSqm(working.corners).toFixed(2)} m²
          · Geo-scale area estimate: {(areaSqm(working.corners)*(geo?.placement.scale||1)**2).toFixed(2)} m²</p>
          <label>Mapping plane height (model-local Y, metres)<input type="number" step="any"
            value={working.planeY??""} onChange={e=>{const y=Number(e.target.value);if(Number.isFinite(y)){setGroundY(y);setWorking({...working,planeY:y,planeVerified:false});}}}/></label>
          <label>Site plane source<input value={working.planeSource||""} placeholder="Verified GLB floor/approved survey elevation"
            onChange={e=>setWorking({...working,planeSource:e.target.value,planeVerified:false})}/></label>
          <label className="geo-plot-check"><input type="checkbox" checked={working.planeVerified===true}
            onChange={e=>setWorking({...working,planeVerified:e.target.checked})}/> Verified model-local plot mapping plane</label>
          <p className="geo-plot-hint">Changing this plane affects the projected public map footprint. A model bounding-box minimum is a starting suggestion, not a surveyed measurement.</p>
          {(()=>{
            const variance=measurementVariance(areaSqm(working.corners),working.area.value,
              working.area.unit,geo?.placement.scale||1);
            return variance!==null && Math.abs(variance)>0.1
              ? <p className="geo-plot-warning">Area / model geometry mismatch: {(Math.abs(variance)*100).toFixed(1)}%.
                Recheck approved plan dimensions, GLB metric scale and Geo alignment before verifying.</p>
              : null;
          })()}
          </details>
          <details open className="geo-plot-inspector-section">
            <summary>02 · Approved area & source</summary>
          <label>Approved Area<input inputMode="decimal" type="number" min="0.001" value={working.area.value||""}
            onChange={e=>setWorking({...working,area:{...working.area,value:Number(e.target.value),verified:false}})}/></label>
          <label>Area Unit<select value={working.area.unit} onChange={e=>setWorking({...working,area:{...working.area,unit:e.target.value as Plot["area"]["unit"],verified:false}})}>
            <option value="sqft">sqft</option><option value="sqm">sqm</option><option value="sqyd">sqyd</option></select></label>
          <label>Area Source<input value={working.area.source} placeholder="Approved plan / survey reference"
            onChange={e=>setWorking({...working,area:{...working.area,source:e.target.value,verified:false}})}/></label>
          <label className="geo-plot-check"><input type="checkbox" checked={working.area.verified}
            onChange={e=>setWorking({...working,area:{...working.area,verified:e.target.checked}})}/> Area verified against source</label>
          </details>
          <details open className="geo-plot-inspector-section">
            <summary>03 · Road, facing & north</summary>
          <label>Road / Access<input value={working.road} onChange={e=>setWorking({...working,road:e.target.value,facingVerified:false})}/></label>
          <label>Primary Front Facing <select value={working.facing}
            onChange={e=>setWorking(p=>p?{...p,facing:e.target.value,facingVerified:false,
              sides:{...p.sides,...(p.sides.front?.roadFacing?{
                front:{...p.sides.front,facingDirection:e.target.value as GeoDirection}
              }:{})}}:p)}>
            {directions.map(d=><option key={d} value={d}>{d}</option>)}</select></label>
          <button type="button" disabled={working.corners.length<3}
            onClick={()=>setWorking(p=>{
              if(!p)return p;
              const facing=facingFromGeo(p.corners,p.sides.front?.edges||[],geo?.placement.headingDeg||0);
              if(!facing)return p;
              return {...p,facing,facingVerified:false,
                sides:{...p.sides,...(p.sides.front?{
                  front:{...p.sides.front,facingDirection:undefined}
                }:{})}};
            })}>Suggest Primary Front From Geo North</button>
          <label>Facing Source<input value={working.facingSource} placeholder="Geo north / approved master plan reference"
            onChange={e=>setWorking({...working,facingSource:e.target.value,facingVerified:false})}/></label>
          <label className="geo-plot-check"><input type="checkbox" checked={working.facingVerified}
            onChange={e=>setWorking({...working,facingVerified:e.target.checked})}/> Facing verified against reference</label>
          {working.corners.length>=3&&(()=>{
            const roadSides=ROLES.filter(role=>working.sides[role]?.roadFacing===true&&
              (working.layout==="four"||role!=="depthB"));
            if(!roadSides.length)return <p className="geo-plot-hint">Select Road side on Front / Back / Depth below to enable the per-side compass. Unselected sides are not advertised as facing.</p>;
            const role=roadSides.includes(selectedFacingRole)?selectedFacingRole:roadSides[0];
            const side=working.sides[role]!;
            const suggested=suggestGeoSideFacing(working.corners,side.edges,geo?.placement.headingDeg||0);
            const selected=side.facingDirection||suggested;
            return <div className="geo-plot-facing-compass" aria-label="Geo road-side facing compass">
              <strong>Geo Facing Compass · Road-Facing Sides</strong>
              <div className="geo-plot-facing-roles" role="group" aria-label="Choose road-facing side">
                {roadSides.map(key=><button type="button" key={key}
                  aria-pressed={role===key} className={role===key?"active":""}
                  onClick={()=>setSelectedFacingRole(key)}>
                  {key==="front"?"Front":key==="back"?"Back":key==="depthA"?"Depth A":"Depth B"}
                </button>)}
              </div>
              <small>Geo north suggestion: {suggested?
                GEO_COMPASS_DIRECTIONS.find(v=>v.id===suggested)?.arrow+" "+
                GEO_COMPASS_DIRECTIONS.find(v=>v.id===suggested)?.label:
                "Unavailable — check polygon & Geo heading"}</small>
              <div className="geo-plot-facing-directions" role="group" aria-label={"Compass direction for "+role}>
                <button type="button" className={!side.facingDirection?"active":""}
                  aria-pressed={!side.facingDirection} onClick={()=>chooseGeoFacing(role,null)}>
                  Auto · Geo
                </button>
                {GEO_COMPASS_DIRECTIONS.map(item=><button type="button" key={item.id}
                  className={side.facingDirection===item.id?"active":""}
                  aria-pressed={side.facingDirection===item.id}
                  onClick={()=>chooseGeoFacing(role,item.id)}>
                  <b>{item.arrow}</b> {item.label}
                </button>)}
              </div>
              <small>Customer-facing preview: {selected?
                GEO_COMPASS_DIRECTIONS.find(v=>v.id===selected)?.arrow+" "+
                GEO_COMPASS_DIRECTIONS.find(v=>v.id===selected)?.label:
                "No direction"}. Only mapped road sides appear. Manual overrides affect this side only; Save Mapping Draft and publish to update customers.</small>
            </div>;
          })()}

          </details>
          <details open className="geo-plot-inspector-section">
            <summary>04 · Front, Back & Depth sizes</summary>
          <p className="geo-plot-hint">Front must face the actual road, not the top of the screen. For four-corner plots select the road-touching edge. Corner plots may have multiple road-facing sides.</p>
          {working.corners.length===4&&working.layout==="four"&&<label>Road-facing FRONT boundary
            <select value={working.sides.front?.edges[0]??0}
              onChange={e=>selectRoadFront(Number(e.target.value))}>
              {working.corners.map((_,i)=><option key={i} value={i}>Edge {i} · Corner {i+1} → {i===3?1:i+2}</option>)}
            </select>
          </label>}
          {working.road&&working.sides.front?.roadFacing!==true&&
            <p className="geo-plot-warning">Road/access is entered but Front is not confirmed as the road side. Verified Publish requires source review; Preliminary Publish remains available and will hide unapproved Road details.</p>}
          {ROLES.filter(role=>working.layout==="four"||role!=="depthB").map(role=>{const side=working.sides[role]||emptySide();
            const localM=geometrySideLengthMetres(working.corners,side.edges,1);
            const scaledM=geometrySideLengthMetres(working.corners,side.edges,geo?.placement.scale||1);
            const reference=side.unit==="ft"?scaledM*3.280839895:scaledM;
            const csvLength=selectedInventory?.[role]||0;
            const mismatch=side.length>0 && reference>0 && Math.abs(reference-side.length)/side.length>0.1;
            return <fieldset key={role}><legend>{role}</legend>
              <p className={mismatch?"geo-plot-warning":"geo-plot-hint"}>
                Approved CSV: {csvLength>0?csvLength+" "+selectedInventory?.lengthUnit:"not supplied"}
                {" · "}Mapped source: {side.length||"not supplied"} {side.unit}
                {" · "}Model-local estimate: {localM.toFixed(2)} m
                {" · "}Geo-scaled estimate: {scaledM.toFixed(2)} m
                {mismatch?" — geo-scaled estimate differs more than 10% from the mapped side length; recheck source and scale.":" (estimates are not authoritative)"}
              </p>
              <label>Edges (0…{Math.max(working.corners.length-1,0)})<input value={side.edges.join(",")} placeholder="0,1"
                onChange={e=>changeSide(role,{edges:e.target.value.split(",").map(x=>Number(x.trim())).filter(Number.isInteger),verified:false})}/></label>
              <label>Length<input type="number" min="0.001" step="any" value={side.length||""}
                onChange={e=>changeSide(role,{length:Number(e.target.value),verified:false})}/></label>
              <label>Unit<select value={side.unit} onChange={e=>changeSide(role,{unit:e.target.value as Side["unit"],verified:false})}>
                <option value="ft">ft</option><option value="m">m</option></select></label>
              <label>Source<input value={side.source} placeholder="Survey sheet / drawing" onChange={e=>changeSide(role,{source:e.target.value,verified:false})}/></label>
              <label className="geo-plot-check"><input type="checkbox" checked={side.roadFacing} onChange={e=>changeSide(role,{roadFacing:e.target.checked})}/> Road side</label>
              <label className="geo-plot-check"><input type="checkbox" checked={side.verified} onChange={e=>changeSide(role,{verified:e.target.checked})}/> Source verified</label>
            </fieldset>;
          })}
          </details>
          <details open className="geo-plot-inspector-section">
            <summary>05 · Notes & confirm</summary>
          <label>Notes<textarea rows={2} value={working.notes} onChange={e=>setWorking({...working,notes:e.target.value})}/></label>
          <div className="geo-plot-inspector-actions">
            <button type="button" className="geo-plot-action-primary"
              disabled={!editable||busy||working.corners.length<3||
                (shape==="four"&&working.corners.length!==4)}
              onClick={()=>{try{applyPlot();}catch(e){setMessage("ERROR: "+String(e));}}}>✓ Apply Plot to Draft</button>
            <button type="button" disabled={!editable||busy||working.corners.length<3||
                (shape==="four"&&working.corners.length!==4)}
              onClick={()=>{try{applyPlot(true);}catch(e){setMessage("ERROR: "+String(e));}}}>
              Apply & Draw Next →</button>
          </div>
          </details>
          </details>
        </>}
        </>}
        {inspectorTab==="publish"&&<>
        <section className="geo-plot-publish-actions" aria-label="Publish mapping">
          <button type="button" className="geo-plot-preliminary-button"
            disabled={!editable||busy||dirty||Boolean(working)||!state||plots.length===0}
            title="Publish saved plot boundaries; authoritative source approval can follow"
            onClick={()=>void execute("publish-preliminary")}>Publish Live · Preliminary</button>
          <button type="button" className="geo-plot-publish-button"
            disabled={!editable||busy||dirty||Boolean(working)||!state||
              state.draft.verifiedRevision!==state.draft.revision||
              state.draft.verifiedInventoryRevision!==state.inventoryRevision||
              (state.alignmentRevision>0&&state.draft.verifiedAlignmentRevision!==state.alignmentRevision)||
              inventoryIssues.length>0}
            onClick={()=>void execute("publish")}>Publish Mapping</button>
        </section>
        {state?.activeMapping?.current&&slug&&<GeoPlotCommercialPanel
          key={slug+"-commercial-"+state.activeMapping.id}
          slug={slug} mappingReleaseId={state.activeMapping.id}
          plotIds={plots.map(p=>p.id)}/>}
        <div className="geo-plot-draft-actions">
          <h3>Save, review & publish</h3>
          <button type="button" disabled={!state||busy||!slug} onClick={()=>void downloadGeoRecovery()}>
            Download Geo Recovery Manifest (private)
          </button>
          <p className="geo-plot-hint">Sealed D1 mapping history + SHA-pinned R2 references.
            Rehearse restore offline; independently export R2 bytes and payment-ledger backup
            before calling any project fully recoverable.</p>
          <button type="button" disabled={!editable||busy||dirty||Boolean(working)||!state?.draft.revision}
            onClick={()=>void inspectPublish()}>Preview Live vs Draft Plot Changes</button>
          {publishedPreview&&<div className="geo-plot-review-dashboard" role="status">
            <strong>Live {publishedPreview.diff.liveCount} → Draft {publishedPreview.diff.draftCount}</strong>
            <p>{publishedPreview.diff.added} added · {publishedPreview.diff.changed} changed ·
              {publishedPreview.diff.removed} removed. A fresh preflight and confirmation is required to publish.</p>
            {publishedPreview.continuity&&<p>
              Retain {publishedPreview.continuity.carriedRows} private status/price records ·
              {publishedPreview.continuity.reviewRows} need new source approval ·
              {publishedPreview.continuity.missingRows} unmatched remain in historical releases.
              Customer records will not silently inherit approvals after a 3D model change.
            </p>}
            {publishedPreview.diff.changes.slice(0,12).map((x,i)=><p key={i}>
              {x.kind}: Plot {x.plotId} ({x.fields.join(", ")})</p>)}
            {publishedPreview.diff.changes.length>12&&<p>
              +{publishedPreview.diff.changes.length-12} additional differences.
              Download private evidence/quality review before publishing.</p>}
          </div>}
          {state?.activeMapping?.current&&
            state.activeMapping.draftRevision===state.draft.revision&&
            <p className="geo-plot-message" role="status">
              ✓ Current Draft r{state.draft.revision} is already LIVE as Mapping v{state.activeMapping.version}
              {" · "}{state.activeMapping.publicationMode}.
              To update the customer site, edit any Plot, Confirm Plot to save a new revision,
              then Publish that revision. Re-publishing unchanged data will not create a duplicate release.
            </p>}
          <p className="geo-plot-hint">Once the mapped boundaries are server-saved, Publish Preliminary can go live without waiting for Road, Area, Facing, Side or alignment reviews. Unapproved facts remain hidden on the customer site. Edit any Plot, save, and republish a new version whenever needed. Verified Publish still requires full source review.</p>
        <button disabled={!editable||busy||!dirty} onClick={()=>void execute("save")}>{busy?"Saving…":"Save Mapping Draft"}</button>
        <button type="button" className="geo-plot-preliminary-button"
          disabled={!editable||busy||dirty||Boolean(working)||!state||plots.length===0}
          onClick={()=>void execute("publish-preliminary")}>
          Publish Preliminary Mapping · Editable Later
        </button>
        <small className="geo-plot-hint">Publishes saved Plot IDs and polygon boundaries immediately with an explicit preliminary label. Unverified measurements, directions, road facts and commercial information are not claimed publicly. Corrections can be edited and republished as a new version.</small>
        <button disabled={!editable||busy||dirty||Boolean(working)||!state?.draft.revision||inventoryIssues.length>0} onClick={()=>void execute("verify")}>Verify All Plots</button>
        <button type="button" className="geo-plot-publish-button"
          disabled={!editable||busy||dirty||Boolean(working)||!state||
            state.draft.verifiedRevision!==state.draft.revision||
            state.draft.verifiedInventoryRevision!==state.inventoryRevision||
            (state.alignmentRevision>0&&state.draft.verifiedAlignmentRevision!==state.alignmentRevision)||
            inventoryIssues.length>0}
          onClick={()=>void execute("publish")}>Publish Verified Mapping to Customer Site</button>
        <small className="geo-plot-hint">Confirm Plot saves a PRIVATE draft only.
          The public Geo site changes after separate Verify and explicit Publish.</small>
        <label className="geo-plot-import">Import Measurements CSV / Platform Plot Data CSV
          <small>Platform Plot Data is safely routed to Inventory first, even with zero mapped plots.</small>
          <input type="file" accept=".csv,text/csv" disabled={!editable||busy||dirty||hasUnapplied}
          onChange={e=>{
          const file=e.target.files?.[0];e.target.value="";if(file)void importCsv(file).catch(x=>setMessage("ERROR: "+String(x)));
        }}/></label>
        <button disabled={!plots.length} onClick={exportCsv}>Export Measurement CSV</button>
        {state?.releases.map(r=><button key={r.id} disabled={!editable||busy||r.geoReleaseId!==state.geoReleaseId}
          onClick={()=>{
            if(window.confirm("Activate historic Mapping v"+r.version+"? This restores its sealed plot data, which may predate the current approved CSV inventory. Current draft and immutable history remain intact."))
              void execute("activate",r.id);
          }}>Activate Mapping v{r.version}{r.publicationMode==="preliminary"?" · Preliminary":" · Verified"}</button>)}
        </div>
        </>}
        <details className="geo-plot-shortcuts geo-plot-help">
          <summary>Keyboard shortcuts · Help</summary>
          <span>P Pan · D Resume 4 corners · I Resume Irregular · E Edit · F Fit</span>
          <span>After Pan, use Resume Drawing (or the SAME shape button) to keep existing corners.</span>
          <span>Ctrl/⌘+Z Undo · Ctrl/⌘+Shift+Z Redo · Corner + arrow keys (Shift = 10×)</span>
          <span>+ / − Zoom · Backspace Remove last new corner · Ctrl/⌘+S Save draft</span>
        </details>
      </aside>
      </div>
    </div>
  </main>;
}
