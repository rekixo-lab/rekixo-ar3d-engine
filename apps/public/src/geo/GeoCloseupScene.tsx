import {useEffect,useRef,useState,type MutableRefObject} from "react";
import * as THREE from "three";
import {OrbitControls} from "three/examples/jsm/controls/OrbitControls.js";
import {GLTFLoader} from "three/examples/jsm/loaders/GLTFLoader.js";
import {MeshoptDecoder} from "three/examples/jsm/libs/meshopt_decoder.module.js";
import {buildModelGeoPlotLayer,type ModelPlotLayer} from "./geoPlotModelOverlay";
import type {GeoPlotDrawerPlot} from "./GeoPlotDetailsDrawer";
import type {GeoPlotStatus} from "../../../../shared/geo-plot-status.js";
import {geoCloseupCameraOffset,geoCloseupFrontDirection,geoCloseupMinDistance,
  geoCloseupPlotFocus,type GeoCloseupView} from "../../../../shared/geo-closeup-camera.js";

type ModelSource={url:string;name:string;byteSize?:number;sha256?:string};
export type GeoCloseupHandle={
  zoom:(step:number)=>void;
  preset:(view:GeoCloseupView)=>void;
  focus:(plot:GeoPlotDrawerPlot)=>void;
};
type Props={
  model:ModelSource;
  plots:GeoPlotDrawerPlot[];
  statusEnabled:boolean;
  statusFilter:GeoPlotStatus|null;
  statuses:Readonly<Record<string,GeoPlotStatus>>;
  onPlotSelect:(plot:GeoPlotDrawerPlot)=>void;
  controllerRef:MutableRefObject<GeoCloseupHandle|null>;
  initialView:GeoCloseupView;
};

async function loadImmutableCloseupModel(model:ModelSource){
  // Never load an unverified alternative GLB or skip the Geo release hash.
  const response=await fetch(model.url,{
    headers:{Accept:"model/gltf-binary,application/octet-stream"},cache:"force-cache",
  });
  if(!response.ok)throw Error("Verified 3D source unavailable ("+response.status+").");
  const bytes=await response.arrayBuffer();
  if(model.byteSize!==undefined&&bytes.byteLength!==model.byteSize)
    throw Error("Geo model byte-size verification failed.");
  if(model.sha256){
    const hash=await crypto.subtle.digest("SHA-256",bytes);
    const actual=Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,"0")).join("");
    if(actual!==model.sha256.toLowerCase())throw Error("Geo model checksum mismatch.");
  }
  const loader=new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  return await new Promise<THREE.Object3D>((resolve,reject)=>{
    loader.parse(bytes,"",gltf=>resolve(gltf.scene),reject);
  });
}
function disposeVerifiedModel(model:THREE.Object3D){
  model.traverse(node=>{
    if(!(node instanceof THREE.Mesh))return;
    node.geometry.dispose();
    const materials=Array.isArray(node.material)?node.material:[node.material];
    for(const material of materials){
      for(const value of Object.values(material))
        if(value instanceof THREE.Texture)value.dispose();
      material.dispose();
    }
  });
}

/**
 * Independent GLB-local viewer. Google Maps and its native zoom ceiling are
 * deliberately NOT involved, and public plot meshes share the exact original
 * canonical local coordinates of the verified Geo GLB.
 */
export function GeoCloseupScene({
  model,plots,statusEnabled,statusFilter,statuses,onPlotSelect,controllerRef,initialView,
}:Props){
  const hostRef=useRef<HTMLDivElement|null>(null);
  const plotLayerRef=useRef<ModelPlotLayer|null>(null);
  const invalidateRef=useRef<(()=>void)|null>(null);
  const initialViewRef=useRef(initialView);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  useEffect(()=>{
    plotLayerRef.current?.setStatusPresentation(statusEnabled,statusFilter,statuses);
    invalidateRef.current?.();
  },[statusEnabled,statusFilter,statuses]);
  useEffect(()=>{
    const host=hostRef.current;
    if(!host)return;
    let cancelled=false;
    let animation=0;
    let loadedModel:THREE.Object3D|null=null;
    let plotLayer:ModelPlotLayer|null=null;
    let resizeObserver:ResizeObserver|null=null;
    let pointer:{id:number;x:number;y:number;t:number}|null=null;
    let bounds:THREE.Box3|null=null;
    let siteRadius=10;
    let groundY=0;
    const plotsById=new Map(plots.map(p=>[p.id,p]));
    const scene=new THREE.Scene();
    scene.background=new THREE.Color("#0b2632");
    scene.add(new THREE.HemisphereLight(0xecfbff,0x52636e,2));
    const sunlight=new THREE.DirectionalLight(0xffffff,2.1);
    sunlight.position.set(60,120,90);
    scene.add(sunlight);
    const camera=new THREE.PerspectiveCamera(50,1,.01,5000);
    const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:"high-performance"});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.75));
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.toneMapping=THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure=1.05;
    const canvas=renderer.domElement;
    canvas.className="geo-closeup-canvas";
    canvas.setAttribute("aria-label","Independent rotatable 3D masterplan: drag to rotate, pinch to zoom, tap a plot");
    host.appendChild(canvas);
    const controls=new OrbitControls(camera,canvas);
    controls.enableDamping=true;
    controls.dampingFactor=.075;
    controls.enablePan=true;
    controls.screenSpacePanning=true;
    controls.minPolarAngle=.04;
    controls.maxPolarAngle=Math.PI*.495;
    controls.touches.ONE=THREE.TOUCH.ROTATE;
    controls.touches.TWO=THREE.TOUCH.DOLLY_PAN;
    const render=()=>{
      animation=0;
      if(cancelled)return;
      // damping update returns true while a camera is still moving
      const moving=controls.update();
      renderer.render(scene,camera);
      if(moving)invalidate();
    };
    const invalidate=()=>{
      if(!animation&&!cancelled)animation=window.requestAnimationFrame(render);
    };
    invalidateRef.current=invalidate;
    const resize=()=>{
      if(cancelled)return;
      const width=Math.max(1,host.clientWidth),height=Math.max(1,host.clientHeight);
      renderer.setSize(width,height,false);
      camera.aspect=width/height;
      camera.updateProjectionMatrix();
      invalidate();
    };
    const applyPreset=(view:GeoCloseupView)=>{
      if(!bounds||bounds.isEmpty())return;
      const target=bounds.getCenter(new THREE.Vector3());
      const forward=geoCloseupFrontDirection(plots);
      const offset=geoCloseupCameraOffset(siteRadius,view,forward);
      camera.position.set(target.x+offset[0],target.y+offset[1],target.z+offset[2]);
      controls.target.copy(target);
      controls.update();
      invalidate();
    };
    const zoom=(step:number)=>{
      if(!bounds||!Number.isFinite(step)||step===0)return;
      const direction=camera.position.clone().sub(controls.target);
      if(direction.length()<1e-8)return;
      const distance=THREE.MathUtils.clamp(
        direction.length()*(step>0?.5:2),controls.minDistance,controls.maxDistance);
      camera.position.copy(controls.target).add(direction.setLength(distance));
      controls.update();
      invalidate();
    };
    const focus=(plot:GeoPlotDrawerPlot)=>{
      if(!bounds)return;
      const targetInfo=geoCloseupPlotFocus(plot,groundY);
      if(!targetInfo)return;
      const direction=camera.position.clone().sub(controls.target).normalize();
      if(!direction.toArray().every(Number.isFinite))direction.set(1,.8,1).normalize();
      const target=new THREE.Vector3(...targetInfo.target);
      controls.target.copy(target);
      camera.position.copy(target).addScaledVector(direction,
        THREE.MathUtils.clamp(targetInfo.distance,controls.minDistance*1.5,controls.maxDistance));
      controls.update();
      invalidate();
    };
    controllerRef.current={zoom,preset:applyPreset,focus};
    const down=(event:PointerEvent)=>{
      pointer=null;
      if(event.isPrimary&&event.button===0)
        pointer={id:event.pointerId,x:event.clientX,y:event.clientY,t:performance.now()};
    };
    const up=(event:PointerEvent)=>{
      const start=pointer;
      pointer=null;
      if(!start||start.id!==event.pointerId||!event.isPrimary||
         Math.hypot(start.x-event.clientX,start.y-event.clientY)>7||
         performance.now()-start.t>850||!plotLayer)return;
      const rect=canvas.getBoundingClientRect();
      if(!(rect.width>0&&rect.height>0))return;
      const x=(event.clientX-rect.left)/rect.width*2-1;
      const y=1-(event.clientY-rect.top)/rect.height*2;
      if(Math.abs(x)>1||Math.abs(y)>1)return;
      const ray=new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(x,y),camera);
      const hits=ray.intersectObjects(plotLayer.hitMeshes.filter(mesh=>
        mesh.visible&&mesh.parent?.visible&&mesh.parent.parent?.visible),false);
      const id=hits[0]?.object.userData.plotId;
      if(typeof id==="string"){
        const selected=plotsById.get(id);
        if(selected)onPlotSelect(selected);
      }
    };
    const cancelPointer=()=>{pointer=null;};
    canvas.addEventListener("pointerdown",down,true);
    canvas.addEventListener("pointerup",up,true);
    canvas.addEventListener("pointercancel",cancelPointer,true);
    controls.addEventListener("change",invalidate);
    resizeObserver=new ResizeObserver(resize);
    resizeObserver.observe(host);
    resize();
    void loadImmutableCloseupModel(model).then(verified=>{
      if(cancelled){disposeVerifiedModel(verified);return;}
      loadedModel=verified;
      bounds=new THREE.Box3().setFromObject(verified);
      if(bounds.isEmpty())throw Error("Verified 3D masterplan has empty geometry.");
      scene.add(verified);
      groundY=bounds.min.y;
      siteRadius=Math.max(bounds.getBoundingSphere(new THREE.Sphere()).radius,.5);
      controls.minDistance=geoCloseupMinDistance(siteRadius);
      controls.maxDistance=Math.max(25,siteRadius*10);
      camera.near=Math.max(.002,controls.minDistance*.01);
      camera.far=Math.max(300,siteRadius*45);
      camera.updateProjectionMatrix();
      plotLayer=buildModelGeoPlotLayer(verified,plots);
      plotLayerRef.current=plotLayer;
      scene.add(plotLayer.group);
      plotLayer.setStatusPresentation(statusEnabled,statusFilter,statuses);
      applyPreset(initialViewRef.current);
      setLoading(false);
      setError("");
    }).catch(reason=>{
      if(!cancelled){
        setLoading(false);
        setError(reason instanceof Error?reason.message:"Verified close-up model unavailable.");
      }
    });
    return ()=>{
      cancelled=true;
      controllerRef.current=null;
      plotLayerRef.current=null;
      invalidateRef.current=null;
      if(animation)window.cancelAnimationFrame(animation);
      resizeObserver?.disconnect();
      canvas.removeEventListener("pointerdown",down,true);
      canvas.removeEventListener("pointerup",up,true);
      canvas.removeEventListener("pointercancel",cancelPointer,true);
      controls.removeEventListener("change",invalidate);
      controls.dispose();
      plotLayer?.dispose();
      if(loadedModel)disposeVerifiedModel(loadedModel);
      renderer.dispose();
      renderer.forceContextLoss();
      if(canvas.parentElement===host)host.removeChild(canvas);
    };
    // Keep the WebGL asset mounted across status/selection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[model.url,model.sha256,model.byteSize,plots,controllerRef,onPlotSelect]);
  return <div ref={hostRef} className="geo-model-inspector" aria-label="Independent 3D close-up mode">
    {(loading||error)&&<div className="geo-inspector-status" role="status">
      {error?<span>{error}</span>:<span>Opening verified 3D masterplan…</span>}
    </div>}
    <div className="geo-closeup-guide" aria-hidden="true">1 finger: rotate · 2 fingers: move / zoom</div>
  </div>;
}
