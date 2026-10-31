import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { projects as listProjects, type CloudProjectSummary } from "../studio/cloud";
import {adjacentPlot,boundedZoom,hasPendingPlotEdits,isTextEditingTarget,
  nextFreePlotId,sideLabelAnchor} from "../../../../shared/geo-plot-editor.js";
import GeoPlotInventoryPanel from "./GeoPlotInventoryPanel";
import {nextUnmappedInventory,type GeoInventoryRow} from "../../../../shared/geo-plot-inventory.js";
import {precisionSnap,zoomAnchorDelta,isMappingTap} from "../../../../shared/geo-mapper-pointer.js";
import {geoInventoryReviewIssues} from "../../../../shared/geo-plot-source-review.js";
import {assignFourCornerRoadFront,applyApprovedInventoryRow} from "../../../../shared/geo-plot-source-operations.js";
import "./geo-plot-mapper.css";

type Point = [number, number]; // Immutable Building-local X/Z metres.
type Role = "front" | "back" | "depthA" | "depthB";
type Side = { edges: number[]; length: number; unit: "ft" | "m"; roadFacing: boolean; source: string; verified: boolean };
type Plot = { id: string; corners: Point[]; layout: "three" | "four";
  sides: Partial<Record<Role, Side>>; area: { value: number; unit: "sqft" | "sqm" | "sqyd"; source: string; verified: boolean };
  facing: string; facingSource:string; facingVerified:boolean; planeY?:number;planeSource?:string;planeVerified?:boolean;road: string; notes: string };
type MappingState = { geoReleaseId: string | null; buildingReleaseId: string | null;
  inventoryRevision:number;
  draft: {revision:number;verifiedRevision:number|null;verifiedInventoryRevision:number|null;
    stale:boolean;plots:Plot[]};
  activeMapping:{id:string;version:number;current:boolean}|null;
  releases:Array<{id:string;version:number;geoReleaseId:string}> };
type GeoPublic = { geoRelease:{id:string}; buildingRelease:{id:string};
  model:{url:string;sha256?:string;byteSize?:number}; canonicalModel?:{url:string;sha256?:string;byteSize?:number}; placement:{headingDeg:number;scale:number} };
type ToolMode = "pan" | "draw" | "edit";
type PointerPreview = {clientX:number;clientY:number;rawScreen:Point;screen:Point;
  point:Point;kind:"none"|"vertex"|"edge";pointerType:string};
type PointerStart = {id:number;x:number;y:number;cancelled?:boolean};
const ROLES: Role[] = ["front", "back", "depthA", "depthB"];
const directions=["north","north-east","east","south-east","south","south-west","west","north-west"];
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
  if(corners.length<3)return {};
  const result:Plot["sides"]={};
  const layout=corners.length===3?"three":"four";
  // Geometric ring order: Front → right depth → Back → left depth.
  const edges:Role[]=layout==="three" ? ["front","depthA","back"] : ["front","depthA","back","depthB"];
  edges.forEach((role,i)=>{
    const indices=i===edges.length-1
      ? Array.from({length:corners.length-i},(_,k)=>i+k) : [i];
    const length=indices.reduce((sum,j)=>sum+Math.hypot(
      corners[j][0]-corners[(j+1)%corners.length][0],
      corners[j][1]-corners[(j+1)%corners.length][1]),0);
    result[role]={...emptySide(indices),length:Number((length*3.280839895).toFixed(3))};
  });
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
  if (points.length<3 || !edges.length) return "north";
  const cx=points.reduce((v,p)=>v+p[0],0)/points.length;
  const cz=points.reduce((v,p)=>v+p[1],0)/points.length;
  let east=0,north=0;
  for(const i of edges){
    const a=points[i],b=points[(i+1)%points.length],mx=(a[0]+b[0])/2,mz=(a[1]+b[1])/2;
    let ex=b[1]-a[1],nz=b[0]-a[0];
    if((mx-cx)*ex+(mz-cz)*(-nz)<0){ex=-ex;nz=-nz;}
    east+=ex;north+=nz;
  }
  const h=heading*Math.PI/180;
  const worldE=east*Math.cos(h)+north*Math.sin(h),worldN=-east*Math.sin(h)+north*Math.cos(h);
  return directions[Math.round(((Math.atan2(worldE,worldN)*180/Math.PI)+360)%360/45)%8];
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
export default function GeoPlotMapper(){
  const [options,setOptions]=useState<CloudProjectSummary[]>([]);
  const [slug,setSlug]=useState(()=>new URLSearchParams(location.search).get("project")||"");
  const [state,setState]=useState<MappingState|null>(null);
  const [geo,setGeo]=useState<GeoPublic|null>(null);
  const [plots,setPlots]=useState<Plot[]>([]);
  const [inventoryRows,setInventoryRows]=useState<GeoInventoryRow[]>([]);
  const [working,setWorking]=useState<Plot|null>(null);
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
  const [inventoryQuery,setInventoryQuery]=useState("");
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
  const dragRef=useRef<number|null>(null);
  const pointerStartRef=useRef<PointerStart|null>(null);
  const pointerPreviewRef=useRef<PointerPreview|null>(null);
  const pointerRafRef=useRef(0);
  const pointerPendingRef=useRef<{x:number;y:number;kind:string;skip?:number}|null>(null);
  const overlayRef=useRef<SVGSVGElement>(null);
  const loupeCanvasRef=useRef<HTMLCanvasElement>(null);
  const renderFramesRef=useRef(0);
  const workingRef=useRef(working);
  workingRef.current=working;
  const displayedPlots=useMemo(()=>plots.filter(p=>p.id.toLowerCase().includes(inventoryQuery.trim().toLowerCase())),
    [plots,inventoryQuery]);
  const inventoryIssues=useMemo(()=>geoInventoryReviewIssues(plots,inventoryRows),
    [plots,inventoryRows]);
  const selectedInventory=useMemo(()=>inventoryRows.find(p=>
    p.id.toLowerCase()===working?.id.toLowerCase()),[inventoryRows,working?.id]);
  const onInventoryRowsChange=useCallback((rows:GeoInventoryRow[],revision:number)=>{
    setInventoryRows(rows);setState(prev=>prev?{...prev,inventoryRevision:revision}:prev);
  },[]);
  const hasUnapplied=hasPendingPlotEdits(working,originalId?plots.find(p=>p.id===originalId):null);
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
    pointerPreviewRef.current=null;setPointerPreview(null);
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
      // The loupe samples this exact frame of the canonical model, not a guessed image.
      // WebGL capture must happen immediately after render (drawing buffer may be transient).
      const pointer=pointerPreviewRef.current,loupe=loupeCanvasRef.current;
      if(pointer&&loupe&&++renderFramesRef.current%3===0){
        const source=renderer.domElement,ctx=loupe.getContext("2d");
        if(ctx&&host.clientWidth&&host.clientHeight){
          const scaleX=source.width/host.clientWidth,scaleY=source.height/host.clientHeight;
          const sourceW=Math.min(42*scaleX,source.width),sourceH=Math.min(42*scaleY,source.height);
          const targetX=pointer.screen[0]*scaleX,targetY=pointer.screen[1]*scaleY;
          const sx=Math.max(0,targetX-sourceW/2),sy=Math.max(0,targetY-sourceH/2);
          const ex=Math.min(source.width,targetX+sourceW/2),ey=Math.min(source.height,targetY+sourceH/2);
          const dstX=(sx-targetX+sourceW/2)/sourceW*loupe.width;
          const dstY=(sy-targetY+sourceH/2)/sourceH*loupe.height;
          const dstW=(ex-sx)/sourceW*loupe.width,dstH=(ey-sy)/sourceH*loupe.height;
          ctx.clearRect(0,0,loupe.width,loupe.height);
          if(ex>sx&&ey>sy){
            try{ctx.imageSmoothingEnabled=false;
              ctx.drawImage(source,sx,sy,ex-sx,ey-sy,dstX,dstY,dstW,dstH);}
            catch{/* A temporarily unavailable WebGL capture never changes mapping coordinates. */}
          }
        }
      }
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
    const vec=new THREE.Vector3(p[0],groundY+0.02,p[1]).project(camera);
    return [(vec.x+1)*viewport.w/2,(1-vec.y)*viewport.h/2];
  };
  const unproject=(clientX:number,clientY:number):Point|null=>{
    const host=hostRef.current,camera=cameraRef.current;if(!host||!camera)return null;
    const rect=host.getBoundingClientRect();if(!rect.width||!rect.height)return null;
    const x=(clientX-rect.left)/rect.width*2-1,y=1-(clientY-rect.top)/rect.height*2;
    const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(x,y),camera);
    const hit=ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),-groundY),new THREE.Vector3());
    return hit?[Number(hit.x.toFixed(6)),Number(hit.z.toFixed(6))]:null;
  };
  const precisionPointer=(clientX:number,clientY:number,skipIndex=-1)=>{
    const host=hostRef.current,raw=unproject(clientX,clientY);
    if(!host||!raw)return null;
    const rect=host.getBoundingClientRect();
    const screen:Point=[clientX-rect.left,clientY-rect.top];
    const rings:Array<{points:Point[];skipIndex?:number}>=
      plots.filter(p=>p.id!==originalId).map(p=>({points:p.corners}));
    // Platform parity: new drawing snaps to SAVED boundaries, never back onto
    // its own incomplete polygon (which could silently create zero-length edges).
    if(mode==="edit"&&workingRef.current?.corners.length)
      rings.push({points:workingRef.current.corners,...(skipIndex>=0?{skipIndex}:{})});
    const target=precisionSnap(raw,screen,rings,project,{enabled:snap,thresholdPx:6});
    return {point:target.point as Point,screen:target.screen as Point,
      rawScreen:screen,kind:target.kind};
  };
  const clearPointer=()=>{pointerPendingRef.current=null;pointerPreviewRef.current=null;setPointerPreview(null);};
  const updatePointer=(clientX:number,clientY:number,pointerType:string,skipIndex=-1)=>{
    const host=hostRef.current;if(!host||mode==="pan"||!geo)return;
    const rect=host.getBoundingClientRect();
    if(clientX<rect.left||clientY<rect.top||clientX>rect.right||clientY>rect.bottom){clearPointer();return;}
    const location=precisionPointer(clientX,clientY,skipIndex);
    if(!location)return;
    const next:PointerPreview={clientX,clientY,pointerType,...location};
    pointerPreviewRef.current=next;setPointerPreview(next);
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
    setWorking(structuredClone(plot));
    if(Number.isFinite(plot.planeY))setGroundY(plot.planeY!);
    setOriginalId(plot.id);setShape(plot.corners.length===4?"four":"irregular");setMode("edit");
  };
  const chooseSibling=(direction:1|-1)=>{
    const neighbor=adjacentPlot(plots,working?.id||"",direction);
    if(neighbor)choose(neighbor);
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
      return {...prev,corners,layout:corners.length===3?"three":"four",
        sides:sidesWithInventory(corners,sourceRow),
        area:{...prev.area,verified:false},facingVerified:false};
    });
  };
  const editPoint=(index:number,clientX:number,clientY:number)=>{
    const target=precisionPointer(clientX,clientY,index);if(!target)return;
    setWorking(prev=>{if(!prev)return prev;
      const corners=prev.corners.map((point,i)=>i===index?target.point:point);
      return {...prev,corners,area:{...prev.area,verified:false},facingVerified:false,
        sides:Object.fromEntries(Object.entries(prev.sides).map(([k,v])=>[k,{...v,verified:false}]))};
    });
  };
  const onOverlayPointerDown=(e:React.PointerEvent<SVGSVGElement>)=>{
    if(mode!=="draw"||dragRef.current!==null||(e.pointerType==="mouse"&&e.button!==0))return;
    pointerStartRef.current={id:e.pointerId,x:e.clientX,y:e.clientY};
    e.currentTarget.setPointerCapture(e.pointerId);
    queuePointer(e.clientX,e.clientY,e.pointerType);
  };
  const onOverlayPointerMove=(e:React.PointerEvent<SVGSVGElement>)=>{
    const dragging=dragRef.current;
    if(dragging!==null)editPoint(dragging,e.clientX,e.clientY);
    queuePointer(e.clientX,e.clientY,e.pointerType,dragging??-1);
    const start=pointerStartRef.current;
    if(start&&start.id===e.pointerId&&
      Math.hypot(e.clientX-start.x,e.clientY-start.y)>9)start.cancelled=true;
  };
  const onOverlayPointerUp=(e:React.PointerEvent<SVGSVGElement>)=>{
    const start=pointerStartRef.current;
    if(mode==="draw"&&start&&!start.cancelled&&
      isMappingTap(start,{id:e.pointerId,x:e.clientX,y:e.clientY}))
      commitCorner(e.clientX,e.clientY);
    if(start?.id===e.pointerId)pointerStartRef.current=null;
    if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
    dragRef.current=null;
    queuePointer(e.clientX,e.clientY,e.pointerType);
  };
  const onOverlayPointerCancel=(e:React.PointerEvent<SVGSVGElement>)=>{
    if(pointerStartRef.current?.id===e.pointerId)pointerStartRef.current=null;
    dragRef.current=null;clearPointer();
  };
  const changeSide=(role:Role,patch:Partial<Side>)=>setWorking(p=>{
    if(!p)return p;
    const changesReference=["edges","length","unit","source","roadFacing"].some(k=>Object.hasOwn(patch,k));
    return {...p,...(Object.hasOwn(patch,"roadFacing")?{facingVerified:false}:{}),
      sides:{...p.sides,[role]:{...(p.sides[role]||emptySide()),...patch,
        ...(changesReference?{verified:false}:{})}}};
  });
  const selectRoadFront=(edge:number)=>{
    if(!working)return;
    if(!window.confirm("Make polygon edge "+edge+" the road-facing FRONT? All side and facing approvals will reset. No published plot is changed."))return;
    setWorking(p=>p?assignFourCornerRoadFront(p,edge):p);
    setMessage("Road-facing Front changed to edge "+edge+". Review Front/Back/Depth lengths and sources, then reverify.");
  };
  const applyCurrentSource=()=>{
    if(!working||!selectedInventory)return;
    if(!window.confirm("Replace approved values and sources for Plot "+working.id+
      " with current CSV inventory? Existing polygon corners, site plane and published release remain unchanged. Modified approvals reset."))return;
    setWorking(p=>p?applyApprovedInventoryRow(p,selectedInventory):p);
    setMessage("Plot "+working.id+": approved CSV values staged. Recheck road-facing edge, measurements and sources before applying.");
  };
  const applyPlot=(openNext=false)=>{
    if(!working)return;const id=working.id.trim();if(!id||working.corners.length<3)throw Error("Plot number and at least 3 mapped corners required.");
    if(plots.some(p=>p.id.toLowerCase()===id.toLowerCase()&&p.id!==originalId))throw Error("Duplicate plot ID.");
    const updated=[...plots.filter(p=>p.id!==(originalId||id)),{...working,id}]
      .sort((a,b)=>a.id.localeCompare(b.id,undefined,{numeric:true}));
    setPlots(updated);setDirty(true);
    if(openNext){
      const next=nextUnmappedInventory(inventoryRows,updated.map(p=>p.id),id);
      setWorking(next?fromInventory(next,groundY):
        {...blank(nextFreePlotId([...updated,...inventoryRows])),planeY:groundY,planeSource:"",planeVerified:false});
      setOriginalId(null);setMode("draw");
      setMessage("Plot "+id+" staged. "+(next?"Next unmapped inventory plot "+next.id+" is ready.":"No pending inventory plots.")+" Save Mapping Draft before verification.");
     }else {
      setWorking(null);setOriginalId(null);setMode("pan");
      setMessage("Plot "+id+" staged. Save Mapping Draft before verification.");
    }
  };
  const execute=async(action:"save"|"verify"|"publish"|"activate"|"rebind-reset",id?:string)=>{
    if(!state||!geo) return;setBusy(true);setMessage("");
    try{
      const body=action==="save"?{expectedRevision:state.draft.revision,geoReleaseId:state.geoReleaseId,plots}
        :{action,expectedRevision:state.draft.revision,...(id?{releaseId:id}:{}),
          ...(action==="rebind-reset"?{confirmation:"RESET MAPPING "+slug}:{})};
      const result=await callApi<MappingState>(api,{method:action==="save"?"PUT":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      if(activeProjectRef.current!==slug)return; // Never display another project’s save response.
      setState(result);setPlots(result.draft.plots);setDirty(false);setWorking(null);
      setMessage(action==="save"?"Mapping draft saved and server read-back confirmed.":action==="verify"?"All plot sources and geometry verified.":action==="publish"?"Immutable plot mapping published for this Geo release.":action==="rebind-reset"?"New empty draft created for active Geo. Historical published mapping releases remain preserved.":"Published mapping version activated.");
    }catch(e){setMessage("ERROR: "+(e instanceof Error?e.message:"Mapping operation failed."));}
    finally{setBusy(false);}
  };
  const importCsv=async(file:File)=>{
    if(file.size>2_000_000)throw Error("Measurement CSV exceeds the 2 MB safety limit.");
    const rows=parseRows(await file.text());
    if(activeProjectRef.current!==slug)throw Error("Project changed during CSV import; no data staged.");
    if(rows.length<2||rows.length>2501)throw Error("CSV requires 1–2500 measurement rows.");
    const keys=rows[0].map(s=>s.trim().toLowerCase().replace(/[^a-z0-9]/g,""));
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
        const facingFlag=v[prefix+"roadfacing"];
        if(modern && facingFlag && !["true","false"].includes(facingFlag.toLowerCase()))
          throw Error("Plot "+p.id+": invalid road-facing flag.");
        side[role]={...item,length,unit:unit as Side["unit"],source,verified:false,
          roadFacing:modern && facingFlag ? facingFlag.toLowerCase()==="true":item.roadFacing};
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
      ...ROLES.flatMap(role=>[role+"Length",role+"Unit",role+"Source",role+"Verified",role+"RoadFacing"])];
    const lines=[headers.map(csvCell).join(","),...plots.map(p=>[
      p.id,JSON.stringify(p.corners),p.area.value,p.area.unit,p.area.source,p.area.verified,
      p.facing,p.facingSource,p.facingVerified,p.road,p.notes,p.planeY,p.planeSource,p.planeVerified,
      ...ROLES.flatMap(role=>{const side=p.sides[role];
        return [side?.length,side?.unit,side?.source,side?.verified,side?.roadFacing];})
    ].map(csvCell).join(","))];
    const url=URL.createObjectURL(new Blob([lines.join("\n")],{type:"text/csv;charset=utf-8"}));
    const a=document.createElement("a");a.href=url;a.download=slug+"-geo-plots.csv";a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  const begin=(kind:"four"|"irregular")=>{
    const selected=working&&!originalId&&!working.corners.length&&
      inventoryRows.some(p=>p.id.toLowerCase()===working.id.toLowerCase());
    if(!selected&&!confirmUnapplied())return;
    setShape(kind);setMode("draw");setOriginalId(null);
    if(!selected)setWorking({...blank(nextFreePlotId([...plots,...inventoryRows])),planeY:groundY,planeSource:"",planeVerified:false});
    setMessage("Start at the road-facing Front edge, then tap corners clockwise. Complete the boundary before entering surveyed sizes.");
  };
  const undoCorner=()=>{
    if(!working?.corners.length||busy||originalId)return;
    setWorking(p=>{if(!p)return p;
      const corners=p.corners.slice(0,-1);
      return {...p,corners,sides:initialSides(corners),
        area:{...p.area,verified:false},facingVerified:false};
    });setMode("draw");
  };
  const cancelWorking=()=>{
    if(!confirmUnapplied())return;
    setWorking(null);setOriginalId(null);setMode("pan");setMessage("Unapplied plot selection cleared; saved draft unchanged.");
  };
  const finishBoundary=()=>{
    if(!working||working.corners.length<3){setMessage("ERROR: Mark at least 3 corners before completing the boundary.");return;}
    if(shape==="four"&&working.corners.length!==4){
      setMessage("ERROR: A 4-corner boundary requires exactly 4 points.");return;
    }
    setMode("edit");setMessage("Boundary ready. Adjust corner handles and enter approved measurements in the inspector.");
  };
  useEffect(()=>{
    const handleKey=(event:KeyboardEvent)=>{
      if(isTextEditingTarget(event.target)||event.altKey||event.metaKey||busy)return;
      if(event.ctrlKey&&event.key.toLowerCase()==="s"){
        event.preventDefault();
        if(working&&hasUnapplied)setMessage("Apply Plot to Draft before saving the mapping.");
        else if(dirty)void execute("save");
        return;
      }
      if(event.ctrlKey)return;
      const k=event.key.toLowerCase();
      if((k==="p"||k==="d"||k==="i"||k==="e"||k==="f")&&!editable)return;
      if(k==="p"){setMode("pan");return;}
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
      <span>Verified <b>{state?.draft.verifiedRevision===state?.draft.revision&&state?.draft.revision?"Yes":"No"}</b></span>
      <span>Live mapping <b>{state?.activeMapping?.current?"v"+state.activeMapping.version:"None / stale"}</b></span>
    </section>
    {state?.draft.stale&&<div className="geo-plot-warning">
      <p>Geo source has changed. Old polygon coordinates are locked to avoid wrong placement.
      Historical published releases remain available when the matching Geo release is restored.</p>
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
          <span><b>{plots.length}</b> mapped</span>
          <span><b>{working?.id||"—"}</b> current plot</span>
          {dirty&&<span className="geo-plot-unsaved">Unsaved mapping draft</span>}
        </div>
      </div>
      <section className="geo-plot-tools" aria-label="Plot mapper controls">
        <div className="geo-plot-tool-group" aria-label="Boundary drawing tools">
          <button type="button" disabled={!editable||busy} className={mode==="pan"?"active":""}
            title="Pan and pinch zoom (P)" aria-pressed={mode==="pan"}
            onClick={()=>setMode("pan")}>✋ Pan</button>
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
          <button type="button" className="geo-plot-tool-complete"
            disabled={!editable||busy||!working||working.corners.length<3||
              (shape==="four"&&working.corners.length!==4)}
            onClick={finishBoundary}>✓ Boundary complete</button>
        </div>
        <div className="geo-plot-tool-group geo-plot-tool-group--secondary">
          <button type="button" disabled={!working?.corners.length||busy||Boolean(originalId)}
            title="Undo last plotted corner (Backspace)" onClick={undoCorner}>↶ Undo</button>
          <button type="button" disabled={!working||busy} onClick={cancelWorking}>Cancel</button>
          <label className="geo-plot-toggle"><input type="checkbox" checked={snap}
            onChange={e=>setSnap(e.target.checked)}/> Snap {snap?"ON":"OFF"}</label>
          <label className="geo-plot-toggle"><input type="checkbox" checked={showGuides}
            onChange={e=>setShowGuides(e.target.checked)}/> Labels</label>
        </div>
        <div className="geo-plot-tool-group geo-plot-zoom-tools" aria-label="Precision viewport zoom">
          <button type="button" disabled={!geo} aria-label="Zoom out" onClick={()=>zoomBy(.8)}>−</button>
          <input type="range" min="100" max="5000" step="1"
            value={zoomPercent} onChange={e=>setZoom(Number(e.target.value))}
            aria-label="Zoom percent" aria-valuetext={zoomPercent+" percent"}/>
          <output>{zoomPercent}%</output>
          <button type="button" disabled={!geo} aria-label="Zoom in" onClick={()=>zoomBy(1.25)}>+</button>
          <button type="button" disabled={!geo} title="Fit all geometry (F)" onClick={fitView}>Fit</button>
          <button type="button" className="geo-plot-fullscreen-toggle" title="Show toolbar, canvas and inspector in full screen"
            aria-pressed={focused} onClick={()=>void toggleFullscreen()}>
            {focused?"⊟ Exit full screen":"⛶ Full screen"}</button>
        </div>
        <div className="geo-plot-tool-group geo-plot-tool-group--publish">
          <button type="button" className="geo-plot-publish-button"
            disabled={!editable||busy||dirty||Boolean(working)||!state||
              state.draft.verifiedRevision!==state.draft.revision||
              state.draft.verifiedInventoryRevision!==state.inventoryRevision||
              inventoryIssues.length>0}
            onClick={()=>void execute("publish")}>Publish Mapping</button>
        </div>
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
                 onPointerDown={e=>{if(mode==="draw")return;e.stopPropagation();choose(p);}}/>
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
             {working.corners.map((point,i)=>{const [x,y]=project(point);
              return <g key={i} className="geo-plot-precision-handle">
                <circle className="geo-plot-handle-hit" cx={x} cy={y} r="17" fill="transparent"
                  onPointerDown={e=>{
                    e.stopPropagation();
                    if(mode!=="edit")return;
                    dragRef.current=i;pointerStartRef.current=null;
                    e.currentTarget.setPointerCapture(e.pointerId);
                    updatePointer(e.clientX,e.clientY,e.pointerType,i);
                  }}
                  onPointerUp={e=>{
                    dragRef.current=null;
                    if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
                    queuePointer(e.clientX,e.clientY,e.pointerType);
                  }}
                  onPointerCancel={()=>{dragRef.current=null;clearPointer();}}/>
                <circle className="geo-plot-handle-visible" cx={x} cy={y}
                  r={Math.max(4.5,10-Math.min((zoomPercent-100)/4900,1)*4)}
                  fill="#ffe49d" stroke="#182a3e" strokeWidth="2.5" pointerEvents="none"/>
                <text x={x+12} y={y-10} fill="#fff" fontSize="13" stroke="#111"
                  paintOrder="stroke" pointerEvents="none">{i+1}</text></g>;
            })}
          </>}
        </svg>}
        {pointerPreview&&mode!=="pan"&&geo&&<>
          <div className="geo-plot-precision-crosshair" data-snap-kind={pointerPreview.kind}
            style={{left:pointerPreview.screen[0],top:pointerPreview.screen[1]}}
            aria-hidden="true"><i/><b/></div>
          {pointerPreview.kind!=="none"&&
            <div className="geo-plot-precision-pointer-origin" aria-hidden="true"
              style={{left:pointerPreview.rawScreen[0],top:pointerPreview.rawScreen[1]}}/>}
          <div className="geo-plot-precision-loupe" role="img"
            aria-label="Magnified view centered on the exact mapping target">
            <canvas ref={loupeCanvasRef} width={144} height={144} aria-hidden="true"/>
            <div className="geo-plot-loupe-reticle" aria-hidden="true"/>
            <strong>{pointerPreview.kind==="vertex"?"● Vertex snap":
              pointerPreview.kind==="edge"?"━ Edge snap":"✚ Exact point"}</strong>
            <span>Model X {pointerPreview.point[0].toFixed(4)} · Z {pointerPreview.point[1].toFixed(4)} m</span>
          </div>
        </>}
        {working&&<div className="geo-plot-scene-status" aria-live="polite">
           <b>Plot {working.id}</b>
           <span>{shape==="four"?working.corners.length+"/4":working.corners.length+" (irregular)"} corners</span>
           <span>{mode==="draw"?"Mark Front edge first":mode==="edit"?"Drag numbered corner handles":"Pan / pinch to inspect"}</span>
         </div>}
         <div className="geo-plot-scene-info">{modelStatus||("Top view · model coordinates in metres · "+
           (mode==="pan"?"1 finger pan · pinch zoom":mode==="draw"?"Click corners clockwise · wheel zoom at cursor":"Drag numbered handles · wheel zoom at cursor"))}</div>
      </div>
      <aside className="geo-plot-dock">
        <GeoPlotInventoryPanel key={slug} slug={slug} mappedIds={plots.map(p=>p.id)}
          workingId={working?.id} blocked={!editable||busy||dirty||hasUnapplied}
          onRowsChange={onInventoryRowsChange}
          onStart={row=>{
            if(!confirmUnapplied())return;
            if(plots.some(p=>p.id.toLowerCase()===row.id.toLowerCase())){
              setMessage("ERROR: This plot is already mapped; use Plot Editor to change it.");
              return;
            }
            setWorking(fromInventory(row,groundY));setOriginalId(null);setShape("four");setMode("draw");
            setMessage("Plot "+row.id+" loaded from CSV. Start at the road-facing Front edge, then mark corners.");
          }}/>
        <div className="geo-plot-inspector-head">
           <div><small>PROJECT PLOT INVENTORY</small><h3>Plot Editor</h3></div>
           <span>{displayedPlots.length}/{plots.length}</span>
         </div>
         {state&&state.draft.revision>0&&state.draft.verifiedInventoryRevision!==state.inventoryRevision&&
          state.draft.verifiedRevision===state.draft.revision&&
          <p className="geo-plot-warning" role="status">Source inventory was updated after verification.
            Review current CSV evidence, then Save/Verify before any new Publish.</p>}
        {inventoryRows.length>0&&<div className="geo-plot-source-review" aria-live="polite">
          <strong>Source Reconciliation · {inventoryIssues.length} issue(s)</strong>
          <small>Inventory revision {state?.inventoryRevision??0} ·
            Verified revision {state?.draft.verifiedInventoryRevision??"not yet"}</small>
          {inventoryIssues.slice(0,7).map((issue,i)=><p key={issue.plotId+issue.field+i}>
            Plot {issue.plotId} · {issue.field}: {issue.reason}</p>)}
          {inventoryIssues.length>7&&<small>+ {inventoryIssues.length-7} more issues. Review each mapped plot.</small>}
          {!inventoryIssues.length&&<small>All mapped plots match the approved CSV values and source references.</small>}
        </div>}
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
         {working&&<>
          <h3>{plots.some(p=>p.id===working.id)?"Update":"New"} Plot {working.id}</h3>
          <div className="geo-plot-inspector-selection">
             <span>{originalId?"Editing mapped plot":"New polygon"}</span>
             <strong>Plot {working.id}</strong>
             <small>{working.corners.length} corners · {hasUnapplied?"Not applied to draft":"Up to date"}</small>
           </div>
          <label>Plot Number<input readOnly={Boolean(originalId)} value={working.id} onChange={e=>setWorking({...working,id:e.target.value})}/></label>
          {selectedInventory&&<div className="geo-plot-source-review">
            <strong>Approved CSV · Plot {selectedInventory.id}</strong>
            <p>Area {selectedInventory.area||"not supplied"} {selectedInventory.areaUnit} ·
              Front {selectedInventory.front||"—"} · Back {selectedInventory.back||"—"} ·
              Depth A {selectedInventory.depthA||"—"} · Depth B {selectedInventory.depthB||"—"} {selectedInventory.lengthUnit}</p>
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
          <label>Facing <select value={working.facing} onChange={e=>setWorking({...working,facing:e.target.value,facingVerified:false})}>
            {directions.map(d=><option key={d} value={d}>{d}</option>)}</select></label>
          <button type="button" disabled={working.corners.length<3} onClick={()=>setWorking(p=>p?{...p,facing:facingFromGeo(p.corners,p.sides.front?.edges||[],geo?.placement.headingDeg||0),facingVerified:false}:p)}>Suggest Facing From Geo North</button>
          <label>Facing Source<input value={working.facingSource} placeholder="Geo north / approved master plan reference"
            onChange={e=>setWorking({...working,facingSource:e.target.value,facingVerified:false})}/></label>
          <label className="geo-plot-check"><input type="checkbox" checked={working.facingVerified}
            onChange={e=>setWorking({...working,facingVerified:e.target.checked})}/> Facing verified against reference</label>
          </details>
          <details open className="geo-plot-inspector-section">
            <summary>04 · Front, Back & Depth sizes</summary>
          <p className="geo-plot-hint">Front must face the actual road, not the top of the screen. For four-corner plots select the road-touching edge. Corner plots may have multiple road-facing sides.</p>
          {working.corners.length===4&&<label>Road-facing FRONT boundary
            <select value={working.sides.front?.edges[0]??0}
              onChange={e=>selectRoadFront(Number(e.target.value))}>
              {working.corners.map((_,i)=><option key={i} value={i}>Edge {i} · Corner {i+1} → {i===3?1:i+2}</option>)}
            </select>
          </label>}
          {working.road&&working.sides.front?.roadFacing!==true&&
            <p className="geo-plot-warning">Road/access is entered but Front has not been marked Road side. Publishing requires explicit road-front confirmation.</p>
          {ROLES.filter(role=>working.layout==="four"||role!=="depthB").map(role=>{const side=working.sides[role]||emptySide();
            const referenceM=geometrySideLengthMetres(working.corners,side.edges,geo?.placement.scale||1);
            const reference=side.unit==="ft"?referenceM*3.280839895:referenceM;
            const mismatch=side.length>0 && reference>0 && Math.abs(reference-side.length)/side.length>0.1;
            return <fieldset key={role}><legend>{role}</legend>
              <p className={mismatch?"geo-plot-warning":"geo-plot-hint"}>
                Model geometry estimate: {reference.toFixed(2)} {side.unit}
                {mismatch?" — differs by more than 10% from the approved side length; verify scale and source.":" (not authoritative)"}
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
        </>}
        <div className="geo-plot-draft-actions">
          <h3>Save, review & publish</h3>
          <p className="geo-plot-hint">Apply each plot, save the draft, reconcile the approved CSV, then verify. A new inventory revision blocks Publish until re-reviewed.</p>
        <button disabled={!editable||busy||!dirty} onClick={()=>void execute("save")}>{busy?"Saving…":"Save Mapping Draft"}</button>
        <button disabled={!editable||busy||dirty||Boolean(working)||!state?.draft.revision||inventoryIssues.length>0} onClick={()=>void execute("verify")}>Verify All Plots</button>
        <label className="geo-plot-import">Import Measurements CSV<input type="file" accept=".csv,text/csv" onChange={e=>{
          const file=e.target.files?.[0];e.target.value="";if(file)void importCsv(file).catch(x=>setMessage("ERROR: "+String(x)));
        }}/></label>
        <button disabled={!plots.length} onClick={exportCsv}>Export Measurement CSV</button>
        {state?.releases.map(r=><button key={r.id} disabled={!editable||busy||r.geoReleaseId!==state.geoReleaseId} onClick={()=>void execute("activate",r.id)}>Activate Mapping v{r.version}</button>)}
        </div>
        <div className="geo-plot-shortcuts">
          <strong>Keyboard shortcuts</strong>
          <span>P Pan · D 4 corners · I Irregular · E Edit · F Fit</span>
          <span>+ / − Zoom · Backspace Undo (new plot) · Ctrl+S Save draft</span>
        </div>
      </aside>
      </div>
    </div>
  </main>;
}
