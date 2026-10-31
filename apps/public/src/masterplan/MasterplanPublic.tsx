import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import "./masterplan-public.css";
import {fitImageFrame,panImageFrame,pinchImageFrame} from "../../../../shared/masterplan-image-gestures.js";
type Point=[number,number];
type Plot={id:string;corners:Point[];facing:string;road:string;notes:string;
  area:{value:number;unit:string};sides:Record<string,{length:number;unit:string;roadFacing:boolean}>};
type GeoPoint={lat:number;lng:number};
type Transform={lat:number[];lng:number[]};
type PublicData={schema:string;project:{name:string;slug:string;location:string};
  release:{id:string;version:number};image:{url:string;width:number;height:number;sha256:string};
  calibration:{transform:Transform;maxResidualM:number;sizeM:{width:number;height:number}};
  plots:Plot[];maps:{apiKey:string|null;mapId:string|null;configured:boolean}};
type GLatLng={};
type GPixel={x:number;y:number};
type GPolygon={setMap:(map:GMap|null)=>void;setVisible:(value:boolean)=>void;addListener:(event:string,cb:()=>void)=>{remove:()=>void}};
type GMap={fitBounds:(bounds:GBounds,padding?:number)=>void};
type GBounds={extend:(point:GeoPoint)=>void};
type GOverlay={setMap:(map:GMap|null)=>void;onAdd:()=>void;onRemove:()=>void;draw:()=>void;
  getPanes:()=>{overlayLayer:HTMLElement}|null;
  getProjection:()=>{fromLatLngToDivPixel:(point:GLatLng)=>GPixel|null}|null};
type GoogleRoot={maps:{Map:new(el:HTMLElement,opts:Record<string,unknown>)=>GMap;
  Polygon:new(opts:Record<string,unknown>)=>GPolygon;
  LatLng:new(lat:number,lng:number)=>GLatLng;
  LatLngBounds:new()=>GBounds;
  OverlayView:new()=>GOverlay}};
const googleWindow=window as unknown as {google?:GoogleRoot};
let googleLoad:Promise<GoogleRoot>|null=null;
function loadMaps(apiKey:string):Promise<GoogleRoot>{
  if(googleWindow.google?.maps?.Map)return Promise.resolve(googleWindow.google);
  if(googleLoad)return googleLoad;
  googleLoad=new Promise<GoogleRoot>((resolve,reject)=>{
    const cb="rekixoMasterplanReady"+Math.random().toString(36).slice(2);
    const host=window as unknown as Record<string,unknown>;
    host[cb]=()=>{delete host[cb];const maps=googleWindow.google;
      if(maps?.maps?.Map)resolve(maps);else {googleLoad=null;reject(Error("Google Maps not initialized."));}};
    const script=document.createElement("script");script.async=true;script.defer=true;
    script.src=`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&loading=async&callback=${cb}`;
    script.onerror=()=>{delete host[cb];googleLoad=null;reject(Error("Google Maps could not load."));};
    document.head.appendChild(script);
  });
  return googleLoad;
}
function locationOf(t:Transform,[u,v]:Point):GeoPoint{
  return {lat:t.lat[0]+t.lat[1]*u+t.lat[2]*v,
    lng:t.lng[0]+t.lng[1]*u+t.lng[2]*v};
}
export default function MasterplanPublic(){
  const match=window.location.pathname.match(/^\/3Dprojects\/([^/]+)\/masterplan\/?$/);
  const slug=match?.[1]||"";
  const [data,setData]=useState<PublicData|null>(null);
  const [error,setError]=useState("");
  const [selected,setSelected]=useState<Plot|null>(null);
  const [showPlots,setShowPlots]=useState(true);
  const [opacity,setOpacity]=useState(.78);
  const [fallback,setFallback]=useState(false);
  const [mapReady,setMapReady]=useState(false);
  const mapHost=useRef<HTMLDivElement>(null);
  const imageRef=useRef<HTMLImageElement|null>(null);
  const polygonsRef=useRef<GPolygon[]>([]);
  const [attempt,setAttempt]=useState(0);
  const [fallbackFrame,setFallbackFrame]=useState({x:0,y:0,w:1,h:1});
  const fallbackPointers=useRef<Map<number,Point>>(new Map());
  const fallbackMoved=useRef(false);
  function fallbackDown(e:ReactPointerEvent<SVGSVGElement>){
    if(!data)return;
    if(!fallbackPointers.current.size)fallbackMoved.current=false;
    fallbackPointers.current.set(e.pointerId,[e.clientX,e.clientY]);
    if(e.target===e.currentTarget)e.currentTarget.setPointerCapture(e.pointerId);
  }
  function fallbackMove(e:ReactPointerEvent<SVGSVGElement>){
    if(!data||!fallbackPointers.current.has(e.pointerId))return;
    const previous=fallbackPointers.current.get(e.pointerId)!;
    const before=[...fallbackPointers.current.values()];
    fallbackPointers.current.set(e.pointerId,[e.clientX,e.clientY]);
    const after=[...fallbackPointers.current.values()];
    const box=e.currentTarget.getBoundingClientRect();
    const image={width:data.image.width,height:data.image.height};
    const viewport={width:box.width,height:box.height};
    if(after.length===2){
      const mid=(p:Point[]):Point=>[(p[0][0]+p[1][0])/2-box.left,
        (p[0][1]+p[1][1])/2-box.top];
      const distance=(p:Point[])=>Math.hypot(p[0][0]-p[1][0],p[0][1]-p[1][1]);
      fallbackMoved.current=true;
      setFallbackFrame(f=>pinchImageFrame(f,image,viewport,mid(before),mid(after),
        distance(before),distance(after)));
    }else if(after.length===1){
      const dx=e.clientX-previous[0],dy=e.clientY-previous[1];
      if(Math.hypot(dx,dy)>0.5)fallbackMoved.current=true;
      setFallbackFrame(f=>panImageFrame(f,image,viewport,[dx,dy]));
    }
  }
  function fallbackUp(e:ReactPointerEvent<SVGSVGElement>){
    fallbackPointers.current.delete(e.pointerId);
    if(e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  }
  useEffect(()=>{
    const controller=new AbortController();
    setError("");setData(null);setSelected(null);setFallback(false);setMapReady(false);
    if(!slug){setError("Invalid masterplan project URL.");return()=>controller.abort();}
    void fetch(`/3Dprojects/api/projects/${encodeURIComponent(slug)}/masterplan`,{
      cache:"no-store",signal:controller.signal}).then(async response=>{
        const v=await response.json() as PublicData&{error?:string};
        if(!response.ok)throw Error(v.error||"Masterplan not published.");
        return v;
      }).then(v=>{if(!controller.signal.aborted){
        setFallbackFrame(fitImageFrame({width:v.image.width,height:v.image.height}));
        fallbackPointers.current.clear();setData(v);
      }}).catch(e=>{if(!controller.signal.aborted)setError(String(e));});
    return()=>controller.abort();
  },[slug,attempt]);
  useEffect(()=>{
    // Do not enter fallback while the released document is still loading.
    // That used to hide the map while Google constructed it at 0×0 pixels.
    if(!data)return;
    if(!data.maps.configured||!data.maps.apiKey||!mapHost.current){setFallback(true);return;}
    setFallback(false);
    let live=true,overlay:GOverlay|null=null;
    const polygons:GPolygon[]=[];polygonsRef.current=polygons;
    void loadMaps(data.maps.apiKey).then(google=>{
      if(!live||!mapHost.current)return;
      const {Map,LatLng,LatLngBounds,OverlayView,Polygon}=google.maps;
      const t=data.calibration.transform;
      const middle=locationOf(t,[.5,.5]);
      const map=new Map(mapHost.current,{center:middle,zoom:18,
        mapId:data.maps.mapId, mapTypeId:"satellite",tilt:0,
        gestureHandling:"cooperative",zoomControl:true,
        mapTypeControl:window.innerWidth>650,fullscreenControl:true,streetViewControl:false});
      const bounds=new LatLngBounds();
      ([ [0,0],[1,0],[1,1],[0,1] ] as Point[]).forEach(p=>bounds.extend(locationOf(t,p)));
      map.fitBounds(bounds,40);
      overlay=new OverlayView();
      const layer=document.createElement("div");layer.className="masterplan-public-overlay";
      layer.style.position="absolute";layer.style.left="0";layer.style.top="0";
      layer.style.transformOrigin="0 0";layer.style.pointerEvents="none";
      const image=document.createElement("img");image.src=data.image.url;
      image.alt="Published geo masterplan";image.width=data.image.width;image.height=data.image.height;
      image.style.cssText=`display:block;width:${data.image.width}px;height:${data.image.height}px;opacity:${opacity}`;
      imageRef.current=image;layer.appendChild(image);
      overlay.onAdd=()=>{overlay?.getPanes()?.overlayLayer.appendChild(layer);};
      overlay.onRemove=()=>{layer.remove();if(imageRef.current===image)imageRef.current=null;};
      overlay.draw=()=>{
        const projection=overlay?.getProjection();if(!projection)return;
        const origin=locationOf(t,[0,0]);
        const a=projection.fromLatLngToDivPixel(new LatLng(origin.lat,origin.lng));
        const bb=locationOf(t,[1,0]),cc=locationOf(t,[0,1]);
        const x=projection.fromLatLngToDivPixel(new LatLng(bb.lat,bb.lng));
        const y=projection.fromLatLngToDivPixel(new LatLng(cc.lat,cc.lng));
        if(!a||!x||!y)return;
        layer.style.transform=`matrix(${(x.x-a.x)/data.image.width},${(x.y-a.y)/data.image.width},
          ${(y.x-a.x)/data.image.height},${(y.y-a.y)/data.image.height},${a.x},${a.y})`;
      };
      overlay.setMap(map);
      for(const plot of data.plots){
        const polygon=new Polygon({map,
          paths:plot.corners.map(p=>locationOf(t,p)),
          strokeColor:"#1ce5af",strokeOpacity:1,strokeWeight:2,
          fillColor:"#22d3a2",fillOpacity:.08,clickable:true,zIndex:80});
        polygon.addListener("click",()=>setSelected(plot));
        polygons.push(polygon);
      }
      setFallback(false);
      setMapReady(true);
    }).catch(e=>{if(live){setError(String(e));setFallback(true);}});
    return()=>{live=false;overlay?.setMap(null);for(const p of polygons)p.setMap(null);
      if(polygonsRef.current===polygons)polygonsRef.current=[];
    };
  },[data?.release.id,data?.maps.apiKey,data?.maps.mapId]);
  useEffect(()=>{if(imageRef.current)imageRef.current.style.opacity=String(opacity);},[opacity,mapReady]);
  useEffect(()=>{for(const p of polygonsRef.current)p.setVisible(showPlots);
    if(!showPlots)setSelected(null);},[showPlots,mapReady]);
  const sizes=useMemo(()=>data?.calibration.sizeM||null,[data]);
  return <main className="masterplan-public">
    <header><div><p>REKIXO · GEO MASTERPLAN</p><h1>{data?.project.name||"Published Geo Masterplan"}</h1>
      {data?.project.location&&<span>{data.project.location}</span>}</div>
      <div className="masterplan-public-header-actions">
        {data&&<a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
          Object.values(locationOf(data.calibration.transform,[.5,.5])).join(","))}`} target="_blank" rel="noreferrer">Open Location</a>}
      </div>
    </header>
    {error&&<div role="alert" className="masterplan-public-error">{error}
      <button onClick={()=>setAttempt(x=>x+1)}>Retry</button></div>}
    <section className="masterplan-public-map">
      <div className="masterplan-public-mapcanvas" ref={mapHost} style={{visibility:fallback?"hidden":"visible"}}/>
      {fallback&&data&&<div className="masterplan-public-fallback">
        <p>Google Map is unavailable. Image-only view—not verified satellite placement. Drag or pinch to inspect.</p>
        <svg viewBox={`${fallbackFrame.x} ${fallbackFrame.y} ${fallbackFrame.w} ${fallbackFrame.h}`}
          preserveAspectRatio="xMidYMid meet" onPointerDown={fallbackDown}
          onPointerMove={fallbackMove} onPointerUp={fallbackUp} onPointerCancel={fallbackUp}>
          <image href={data.image.url} width={data.image.width} height={data.image.height}
            opacity={opacity} />
          {showPlots&&data.plots.map(plot=><polygon key={plot.id}
            points={plot.corners.map(([u,v])=>(u*data.image.width)+","+(v*data.image.height)).join(" ")}
            fill="rgba(9,185,137,.21)" stroke="#1ce5af" strokeWidth={Math.max(2,data.image.width/800)}
            onClick={()=>{if(!fallbackMoved.current)setSelected(plot);}}/>)}
        </svg>
      </div>}
      {!data&&!error&&<div className="masterplan-public-loading">Preparing the published Geo Masterplan…</div>}
      {data&&<div className="masterplan-public-toolbar">
        <button onClick={()=>setShowPlots(x=>!x)} aria-pressed={showPlots}>Plots {showPlots?"ON":"OFF"}</button>
        {fallback&&<button onClick={()=>setFallbackFrame(fitImageFrame(data.image))}>Fit Image</button>}
        <label>Image opacity <input type="range" min=".2" max="1" step=".05" value={opacity}
          onChange={e=>setOpacity(Number(e.target.value))}/></label>
        <span>{data.plots.length} plots · v{data.release.version}</span>
      </div>}
      {selected&&<aside className="masterplan-public-detail">
        <button aria-label="Close plot details" onClick={()=>setSelected(null)}>×</button>
        <small>VERIFIED MASTERPLAN PLOT</small>
        <h2>Plot {selected.id}</h2>
        <strong>{selected.area.value} {selected.area.unit}</strong>
        <p>Facing: {selected.facing}</p>
        {selected.road&&<p>Road: {selected.road}</p>}
        <div>{Object.entries(selected.sides).map(([name,side])=><p key={name}>
          {name}: {side.length} {side.unit}{side.roadFacing?" · Road-facing":""}</p>)}</div>
        {selected.notes&&<p>{selected.notes}</p>}
        <small>Plot status and sales are not inferred from Polygon geometry.</small>
      </aside>}
    </section>
    {data&&<footer>
      Published layout · {sizes?.width.toFixed(1)} × {sizes?.height.toFixed(1)} metres (calibration estimate).
      Survey and original approved documentation are authoritative.
    </footer>}
  </main>;
}
