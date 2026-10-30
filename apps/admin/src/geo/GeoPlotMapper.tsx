import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { projects as listProjects, type CloudProjectSummary } from "../studio/cloud";
import "./geo-plot-mapper.css";

type Point = [number, number]; // Immutable Building-local X/Z metres.
type Role = "front" | "back" | "depthA" | "depthB";
type Side = { edges: number[]; length: number; unit: "ft" | "m"; roadFacing: boolean; source: string; verified: boolean };
type Plot = { id: string; corners: Point[]; layout: "three" | "four";
  sides: Partial<Record<Role, Side>>; area: { value: number; unit: "sqft" | "sqm" | "sqyd"; source: string; verified: boolean };
  facing: string; facingSource:string; facingVerified:boolean; road: string; notes: string };
type MappingState = { geoReleaseId: string | null; buildingReleaseId: string | null;
  draft: {revision:number;verifiedRevision:number|null;stale:boolean;plots:Plot[]};
  activeMapping:{id:string;version:number;current:boolean}|null;
  releases:Array<{id:string;version:number;geoReleaseId:string}> };
type GeoPublic = { geoRelease:{id:string}; buildingRelease:{id:string};
  model:{url:string;sha256?:string;byteSize?:number}; canonicalModel?:{url:string;sha256?:string;byteSize?:number}; placement:{headingDeg:number} };
type ToolMode = "pan" | "draw" | "edit";
const ROLES: Role[] = ["front", "back", "depthA", "depthB"];
const directions=["north","north-east","east","south-east","south","south-west","west","north-west"];
const emptySide = (edges:number[]=[]):Side => ({edges,length:0,unit:"ft",roadFacing:false,source:"",verified:false});
const blank = (id:string):Plot => ({id,corners:[],layout:"four",sides:{},
  area:{value:0,unit:"sqft",source:"",verified:false},facing:"north",facingSource:"",facingVerified:false,road:"",notes:""});
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
  const data=await r.json() as T & {error?:string};
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
  const [snap,setSnap]=useState(true);
  const [selectedRole,setSelectedRole]=useState<Role>("front");
  const hostRef=useRef<HTMLDivElement>(null);
  const rendererRef=useRef<THREE.WebGLRenderer|null>(null);
  const cameraRef=useRef<THREE.OrthographicCamera|null>(null);
  const controlsRef=useRef<OrbitControls|null>(null);
  const dragRef=useRef<number|null>(null);
  const workingRef=useRef(working);
  workingRef.current=working;
  const api=slug?`/3Dprojects/api/cloud/projects/${encodeURIComponent(slug)}/geo-plots`:"";
  const refresh=useCallback(async()=>{
    if(!slug){setState(null);setGeo(null);setPlots([]);return;}
    setMessage("");
    const [mapped,experience]=await Promise.all([
      callApi<MappingState>(`/3Dprojects/api/cloud/projects/${encodeURIComponent(slug)}/geo-plots`),
      callApi<GeoPublic>(`/3Dprojects/api/projects/${encodeURIComponent(slug)}/geo-placement`)
    ]);
    if(mapped.geoReleaseId!==experience.geoRelease.id || mapped.buildingReleaseId!==experience.buildingRelease.id)
      throw Error("Geo source mismatch. Reload verified Geo releases.");
    setState(mapped);setGeo(experience);setPlots(mapped.draft.plots);setDirty(false);setWorking(null);
  },[slug]);
  useEffect(()=>{void listProjects().then(r=>setOptions(r.projects)).catch(()=>undefined);},[]);
  useEffect(()=>{let live=true;void refresh().catch(e=>{if(live){setState(null);setGeo(null);setMessage(String(e));}});return()=>{live=false;};},[refresh]);
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
    controls.mouseButtons.LEFT=THREE.MOUSE.PAN;controls.touches.ONE=THREE.TOUCH.PAN;
    controls.touches.TWO=THREE.TOUCH.DOLLY_PAN;controls.screenSpacePanning=true;
    const render=()=>{frame=requestAnimationFrame(render);controls.update();renderer.render(scene,camera);};
    const resize=()=>{const w=host.clientWidth,h=host.clientHeight;if(!w||!h)return;
      renderer.setSize(w,h,false);setViewport({w,h});
      const mid=Math.max(camera.right,-camera.left);
      camera.left=-mid;camera.right=mid;camera.top=mid*h/w;camera.bottom=-mid*h/w;
      camera.updateProjectionMatrix();setViewTick(v=>v+1);};
    const obs=new ResizeObserver(resize);obs.observe(host);
    const changed=()=>setViewTick(v=>v+1);controls.addEventListener("change",changed);
    setModelStatus("Loading checksum-verified 3D master plan…");
    void modelFromVerifiedSource(geo.canonicalModel||geo.model).then(m=>{
      if(!alive){m.traverse(n=>{if(n instanceof THREE.Mesh){n.geometry.dispose();}});return;}
      object=m;scene.add(m);const box=new THREE.Box3().setFromObject(m);
      if(box.isEmpty())throw Error("3D source has no geometry.");
      const center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
      const span=Math.max(size.x,size.z,1)*0.68;
      camera.left=-span;camera.right=span;
      const w=Math.max(host.clientWidth,1),h=Math.max(host.clientHeight,1);
      camera.top=span*h/w;camera.bottom=-span*h/w;
      camera.position.set(center.x,box.max.y+Math.max(size.y,span)*2.5,center.z);
      camera.up.set(0,0,-1);camera.lookAt(center);camera.updateProjectionMatrix();
      controls.target.copy(center);controls.update();setGroundY(box.min.y);setModelStatus("");
      setViewTick(v=>v+1);
    }).catch(e=>{if(alive)setModelStatus(e instanceof Error?e.message:"Model failed to load.");});
    resize();render();
    return()=>{alive=false;cancelAnimationFrame(frame);obs.disconnect();controls.removeEventListener("change",changed);
      controls.dispose();renderer.forceContextLoss();renderer.dispose();renderer.domElement.remove();
      if(object)object.traverse(n=>{if(n instanceof THREE.Mesh){n.geometry.dispose();const mats=Array.isArray(n.material)?n.material:[n.material];mats.forEach(mat=>mat.dispose());}});
      cameraRef.current=null;rendererRef.current=null;controlsRef.current=null;};
  },[geo?.canonicalModel?.url,geo?.canonicalModel?.sha256,geo?.model.url,geo?.model.sha256]);
  const project=(p:Point):Point=>{
    const camera=cameraRef.current;if(!camera)return [0,0];
    const vec=new THREE.Vector3(p[0],groundY+0.02,p[1]).project(camera);
    return [(vec.x+1)*viewport.w/2,(1-vec.y)*viewport.h/2];
  };
  const unproject=(clientX:number,clientY:number):Point|null=>{
    const host=hostRef.current,camera=cameraRef.current;if(!host||!camera)return null;
    const rect=host.getBoundingClientRect();
    const x=(clientX-rect.left)/rect.width*2-1,y=1-(clientY-rect.top)/rect.height*2;
    const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(x,y),camera);
    const hit=ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),-groundY),new THREE.Vector3());
    if(!hit)return null;let point:Point=[Number(hit.x.toFixed(5)),Number(hit.z.toFixed(5))];
    if(snap){const all=plots.flatMap(p=>p.corners).concat(workingRef.current?.corners||[]);
      const near=all.find(p=>{const [a,b]=project(p);return Math.hypot(a-(clientX-rect.left),b-(clientY-rect.top))<9;});
      if(near)point=near;
    }
    return point;
  };
  const choose=(plot:Plot)=>{setWorking(structuredClone(plot));setOriginalId(plot.id);setShape(plot.corners.length===4?"four":"irregular");setMode("edit");};
  const onDraw=(event:React.PointerEvent<SVGSVGElement>)=>{
    if(mode!=="draw"||dragRef.current!==null)return;
    const p=unproject(event.clientX,event.clientY);if(!p)return;
    setWorking(prev=>{
      if(!prev||prev.corners.length>=80||(shape==="four"&&prev.corners.length>=4))return prev;
      const points=[...prev.corners,p];
      return {...prev,corners:points,layout:points.length===3?"three":"four",sides:initialSides(points)};
    });
  };
  const editPoint=(index:number,clientX:number,clientY:number)=>{
    const p=unproject(clientX,clientY);if(!p)return;
    setWorking(prev=>{if(!prev)return prev;const corners=prev.corners.map((q,i)=>i===index?p:q);
      return {...prev,corners,sides:Object.fromEntries(Object.entries(prev.sides).map(([k,v])=>[k,{...v,verified:false}]))};});
  };
  const changeSide=(role:Role,patch:Partial<Side>)=>setWorking(p=>p?{...p,sides:{...p.sides,[role]:{...(p.sides[role]||emptySide()),...patch}}}:p);
  const applyPlot=()=>{
    if(!working)return;const id=working.id.trim();if(!id||working.corners.length<3)throw Error("Plot number and at least 3 mapped corners required.");
    if(plots.some(p=>p.id.toLowerCase()===id.toLowerCase()&&p.id!==originalId))throw Error("Duplicate plot ID.");
    setPlots(prev=>[...prev.filter(p=>p.id!==(originalId||id)),{...working,id}].sort((a,b)=>a.id.localeCompare(b.id,undefined,{numeric:true})));
    setDirty(true);setMessage("Plot staged locally. Save Draft to persist it.");
  };
  const execute=async(action:"save"|"verify"|"publish"|"activate"|"rebind-reset",id?:string)=>{
    if(!state||!geo) return;setBusy(true);setMessage("");
    try{
      const body=action==="save"?{expectedRevision:state.draft.revision,geoReleaseId:state.geoReleaseId,plots}
        :{action,expectedRevision:state.draft.revision,...(id?{releaseId:id}:{}),
          ...(action==="rebind-reset"?{confirmation:"RESET MAPPING "+slug}:{})};
      const result=await callApi<MappingState>(api,{method:action==="save"?"PUT":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      setState(result);setPlots(result.draft.plots);setDirty(false);setWorking(null);
      setMessage(action==="save"?"Mapping draft saved and server read-back confirmed.":action==="verify"?"All plot sources and geometry verified.":action==="publish"?"Immutable plot mapping published for this Geo release.":action==="rebind-reset"?"New empty draft created for active Geo. Historical published mapping releases remain preserved.":"Published mapping version activated.");
    }catch(e){setMessage("ERROR: "+(e instanceof Error?e.message:"Mapping operation failed."));}
    finally{setBusy(false);}
  };
  const importCsv=async(file:File)=>{
    const rows=parseRows(await file.text());if(rows.length<2)throw Error("CSV contains no data.");
    const keys=rows[0].map(s=>s.trim().toLowerCase().replace(/[^a-z0-9]/g,""));
    const required=["id","area","areaunit","front","back","deptha","unit","source"];
    if(required.some(k=>!keys.includes(k)))throw Error("CSV header required: "+required.join(", "));
    const ix=(key:string)=>keys.indexOf(key);
    const updates=new Map<string,Record<string,string>>();
    for(const row of rows.slice(1)){const id=String(row[ix("id")]||"").trim();
      if(!id||updates.has(id))throw Error("Missing or duplicate Plot ID in CSV: "+id);
      updates.set(id,Object.fromEntries(keys.map((k,i)=>[k,row[i]||""])));}
    const unknown=[...updates.keys()].filter(id=>!plots.some(p=>p.id===id));
    if(unknown.length)throw Error("Map polygon corners before importing measurements: "+unknown.slice(0,12).join(", "));
    const proposed=plots.map(p=>{
      const v=updates.get(p.id);if(!v)return p;
      const side={...p.sides};
      for(const role of ROLES){
        const item=side[role];if(!item)continue;
        const n=Number(v[role.toLowerCase()]||"");
        if(!(n>0))throw Error("CSV "+p.id+": "+role+" must be positive.");
        side[role]={...item,length:n,unit:v.unit==="m"?"m":"ft",source:v.source,verified:false};
      }
      return {...p,sides:side,area:{value:Number(v.area),unit:v.areaunit as Plot["area"]["unit"],source:v.source,verified:false},
        facing:v.facing||p.facing,facingVerified:false,road:v.road||p.road};
    });
    setPlots(proposed);setDirty(true);setWorking(null);
    setMessage(updates.size+" plot measurement rows staged for review; verify sources before publish.");
  };
  const exportCsv=()=>{
    const headers=["id","area","areaunit","front","back","deptha","depthb","unit","source","facing","road"];
    const lines=[headers.join(","),...plots.map(p=>[p.id,p.area.value,p.area.unit,
      p.sides.front?.length,p.sides.back?.length,p.sides.depthA?.length,p.sides.depthB?.length,
      p.sides.front?.unit,p.area.source,p.facing,p.road].map(csvCell).join(","))];
    const url=URL.createObjectURL(new Blob([lines.join("\n")],{type:"text/csv;charset=utf-8"}));
    const a=document.createElement("a");a.href=url;a.download=slug+"-geo-plots.csv";a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  const begin=(kind:"four"|"irregular")=>{
    setShape(kind);setMode("draw");setOriginalId(null);
    const ids=new Set(plots.map(p=>p.id));let id=1;while(ids.has(String(id)))id++;
    setWorking(blank(String(id)));setMessage("Tap each plot corner on the top-down verified model.");
  };
  const editable=Boolean(state&&!state.draft.stale&&geo);
  const path=(points:Point[])=>points.map(p=>project(p).join(",")).join(" ");
  return <main className="geo-plot-page">
    <header className="geo-plot-top"><div><p className="eyebrow">REKIXO ENGINE · INDEPENDENT GEO MAPPING</p><h1>3D Geo Plot Mapper</h1>
      <p>Draw plot boundaries on a checksum-verified Building-local master plan. AR3D Platform remains untouched.</p></div>
      <label>Project <select value={slug} onChange={e=>{setSlug(e.target.value);setWorking(null);}}>
        <option value="">Choose project</option>{options.map(o=><option key={o.id} value={o.slug}>{o.name}</option>)}</select></label>
    </header>
    <section className="geo-plot-stats">
      <span>Geo source <b>{state?.geoReleaseId?.slice(0,18)||"Not published"}</b></span>
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
    {message&&<p className={message.startsWith("ERROR")?"geo-plot-warning":"geo-plot-message"} role="status">{message}</p>}
    <section className="geo-plot-tools" aria-label="Plot mapper controls">
      <button disabled={!editable||busy} className={mode==="pan"?"active":""} onClick={()=>setMode("pan")}>Pan / Pinch</button>
      <button disabled={!editable||busy} onClick={()=>begin("four")}>4 Corner</button>
      <button disabled={!editable||busy} onClick={()=>begin("irregular")}>Irregular Polygon</button>
      <button disabled={!editable||busy||!working} onClick={()=>setMode("edit")}>Edit Corners</button>
      <button disabled={!working||!working.corners.length} onClick={()=>{setWorking(p=>p?{...p,corners:p.corners.slice(0,-1),sides:initialSides(p.corners.slice(0,-1))}:p);}}>Undo Corner</button>
      <label><input type="checkbox" checked={snap} onChange={e=>setSnap(e.target.checked)}/> Snap Corners</label>
      <button disabled={!editable||busy||dirty||!state||state.draft.verifiedRevision!==state.draft.revision} onClick={()=>void execute("publish")}>Publish Mapping</button>
    </section>
    <div className="geo-plot-workspace">
      <div className="geo-plot-scene">
        <div className="geo-plot-canvas" ref={hostRef} aria-label="Top-down 3D masterplan plot mapping canvas"/>
        {geo&&<svg className="geo-plot-overlay" viewBox={`0 0 ${viewport.w} ${viewport.h}`}
           style={{pointerEvents:mode==="pan"?"none":"auto"}}
           onPointerDown={onDraw}
           onPointerMove={e=>{if(dragRef.current!==null)editPoint(dragRef.current,e.clientX,e.clientY);}}
           onPointerUp={()=>dragRef.current=null} onPointerCancel={()=>dragRef.current=null}>
          {plots.map(p=><polygon key={p.id} points={path(p.corners)} fill="rgba(16,185,129,.16)"
            stroke={working?.id===p.id?"#f5dd6d":"#3fe3b1"} strokeWidth="2"
            onPointerDown={e=>{if(mode==="draw")return;e.stopPropagation();choose(p);}}/>)}
          {working&&working.corners.length>0&&<>
            <polyline points={path(working.corners)} fill={working.corners.length>=3?"rgba(250,204,21,.22)":"none"}
              stroke="#ffd965" strokeWidth="2.5" strokeDasharray="7 4"/>
            {working.corners.map((point,i)=>{const [x,y]=project(point);
              return <g key={i}><circle cx={x} cy={y} r="9" fill="#ffe49d" stroke="#182a3e" strokeWidth="2"
                onPointerDown={e=>{if(mode!=="edit")return;e.stopPropagation();dragRef.current=i;e.currentTarget.setPointerCapture(e.pointerId);}}
                onPointerUp={e=>{dragRef.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}}/>
                <text x={x+10} y={y-8} fill="#fff" fontSize="13" stroke="#111" paintOrder="stroke">{i+1}</text></g>;
            })}
          </>}
        </svg>}
        <div className="geo-plot-scene-info">{modelStatus||("Top view · Model coordinates in metres · "+(mode==="pan"?"1 finger pan · pinch zoom":mode==="draw"?"Tap corners":"Drag corner handles"))}</div>
      </div>
      <aside className="geo-plot-dock">
        <h3>Plot Inventory</h3>
        <div className="geo-plot-inventory">{plots.map(p=><button type="button" key={p.id} onClick={()=>choose(p)}
          className={working?.id===p.id?"active":""}>{p.id}<small>{p.corners.length} corners</small></button>)}</div>
        {working&&<>
          <h3>{plots.some(p=>p.id===working.id)?"Update":"New"} Plot {working.id}</h3>
          <label>Plot Number<input readOnly={Boolean(originalId)} value={working.id} onChange={e=>setWorking({...working,id:e.target.value})}/></label>
          <p className="geo-plot-hint">Corners: {working.corners.length} · Geometry area (unverified): {areaSqm(working.corners).toFixed(2)} m²</p>
          <label>Approved Area<input inputMode="decimal" type="number" min="0.001" value={working.area.value||""}
            onChange={e=>setWorking({...working,area:{...working.area,value:Number(e.target.value),verified:false}})}/></label>
          <label>Area Unit<select value={working.area.unit} onChange={e=>setWorking({...working,area:{...working.area,unit:e.target.value as Plot["area"]["unit"]}})}>
            <option value="sqft">sqft</option><option value="sqm">sqm</option><option value="sqyd">sqyd</option></select></label>
          <label>Area Source<input value={working.area.source} placeholder="Approved plan / survey reference"
            onChange={e=>setWorking({...working,area:{...working.area,source:e.target.value,verified:false}})}/></label>
          <label className="geo-plot-check"><input type="checkbox" checked={working.area.verified}
            onChange={e=>setWorking({...working,area:{...working.area,verified:e.target.checked}})}/> Area verified against source</label>
          <label>Road / Access<input value={working.road} onChange={e=>setWorking({...working,road:e.target.value})}/></label>
          <label>Facing <select value={working.facing} onChange={e=>setWorking({...working,facing:e.target.value,facingVerified:false})}>
            {directions.map(d=><option key={d} value={d}>{d}</option>)}</select></label>
          <button type="button" disabled={working.corners.length<3} onClick={()=>setWorking(p=>p?{...p,facing:facingFromGeo(p.corners,p.sides.front?.edges||[],geo?.placement.headingDeg||0),facingVerified:false}:p)}>Suggest Facing From Geo North</button>
          <label>Facing Source<input value={working.facingSource} placeholder="Geo north / approved master plan reference"
            onChange={e=>setWorking({...working,facingSource:e.target.value,facingVerified:false})}/></label>
          <label className="geo-plot-check"><input type="checkbox" checked={working.facingVerified}
            onChange={e=>setWorking({...working,facingVerified:e.target.checked})}/> Facing verified against reference</label>
          <p className="geo-plot-hint">Side edge numbers are zero-based; a logical side may contain multiple consecutive edges.</p>
          {ROLES.filter(role=>working.layout==="four"||role!=="depthB").map(role=>{const side=working.sides[role]||emptySide();
            return <fieldset key={role}><legend>{role}</legend>
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
          <label>Notes<textarea rows={2} value={working.notes} onChange={e=>setWorking({...working,notes:e.target.value})}/></label>
          <button disabled={!editable||busy||working.corners.length<3} onClick={()=>{try{applyPlot();}catch(e){setMessage(String(e));}}}>Apply Plot to Draft</button>
        </>}
        <h3>Project Mapping Actions</h3>
        <button disabled={!editable||busy||!dirty} onClick={()=>void execute("save")}>{busy?"Saving…":"Save Mapping Draft"}</button>
        <button disabled={!editable||busy||dirty||!state?.draft.revision} onClick={()=>void execute("verify")}>Verify All Plots</button>
        <label className="geo-plot-import">Import Measurements CSV<input type="file" accept=".csv,text/csv" onChange={e=>{
          const file=e.target.files?.[0];e.target.value="";if(file)void importCsv(file).catch(x=>setMessage("ERROR: "+String(x)));
        }}/></label>
        <button disabled={!plots.length} onClick={exportCsv}>Export Measurement CSV</button>
        {state?.releases.map(r=><button key={r.id} disabled={!editable||busy||r.geoReleaseId!==state.geoReleaseId} onClick={()=>void execute("activate",r.id)}>Activate Mapping v{r.version}</button>)}
      </aside>
    </div>
  </main>;
}
