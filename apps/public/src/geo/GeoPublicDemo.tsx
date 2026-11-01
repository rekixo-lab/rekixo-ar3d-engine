import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { Viewer3D } from "../viewer/Viewer3D";
import { applyRigidBuildingPlacement } from "./geoRigidTransform";
import { buildModelGeoPlotLayer,pickModelGeoPlot,type ModelPlotLayer } from "./geoPlotModelOverlay";
import { loadPublicBranding, type PublicProjectBranding } from "../branding";
import {geoPathBounds,visibleGeoPlotPaths,type GeoBounds} from "../../../../shared/geo-plot-viewport.js";
import "./geo-public-demo.css";

type GeoCoordinate = {
  longitude: number;
  latitude: number;
  altitudeM?: number;
};

type GeoPublicContacts={
  projectNumber:string;ownerName:string;builderName:string;contactName:string;
  address:string;phone:string;phoneSecondary:string;whatsapp:string;email:string;
  websiteUrl:string;mapsUrl:string;
};
const safeContactDigits=(value:string)=>value.replace(/[^0-9]/g,"");
const geoPublicMapHref=(contacts:GeoPublicContacts)=>{
  if(contacts.mapsUrl)return contacts.mapsUrl;
  return contacts.address?"https://www.google.com/maps/search/?api=1&query="+
    encodeURIComponent(contacts.address):"";
};
const geoWhatsAppHref=(value:string)=>{
  const digits=safeContactDigits(value);
  // India local 10-digit numbers are accepted only when supplied as 10-digit mobile.
  const number=digits.length===10&&/^[6-9]/.test(digits)?"91"+digits:digits;
  return number.length>=11&&number.length<=15?"https://wa.me/"+number:"";
};
type GeoPayload = {
  project: { id: string; slug: string; name: string; location?: string };
  publicContacts?:GeoPublicContacts;
  buildingRelease: {
    id: string;
    version: number;
    manifestSha256: string;
  };
  geoRelease: {
    id: string;
    version: number;
    manifestSha256: string;
    manifestFormat?: string;
    sourceDraftRevision: number;
    createdAt?: string;
  };
  placement: {
    coordinateReferenceSystem: "WGS84";
    localFrame: "ENU";
    units: "m";
    anchor: GeoCoordinate;
    heightMode: "ground-clamped" | "ground-relative" | "absolute";
    eastOffsetM: number;
    northOffsetM: number;
    verticalOffsetM: number;
    headingDeg: number;
    pitchDeg: number;
    rollDeg: number;
    scale: number;
  };
  modelAnchor: {
    id: string;
    name: string;
    kind: string;
    localPositionM: { x: number; y: number; z: number };
  };
  runtime?: {
    integratedScene?: boolean;
    qualityTiers?: string[];
    buildingTransform?: string;
  };
  maps: {
    apiKey: string | null;
    mapId: string | null;
    apiKeyConfigured?: boolean;
    mapIdConfigured?: boolean;
    configured: boolean;
  };
  model: {
    id: string;
    name: string;
    mimeType: string;
    byteSize?: number;
    url: string;
    variant?: string;
    sha256?: string;
    sourceSha256?: string;
  };
  plotMapping?: {version:number;geoReleaseId:string;publicationMode?:"verified"|"preliminary";plots:GeoMappedPlot[];
    commercial?:Record<string,{status:"available"|"booked"|"sold";pricePaise:number|null;currency:"INR"}>};
  error?: string;
};

type GeoMappedPlot = { id:string; corners:Array<[number,number]>; planeY?:number; facing:string|null; road:string|null; notes:string;
  area:{value:number;unit:string}|null; sides:Record<string,{length:number;unit:string;roadFacing:boolean}> };

type GeoCameraView = "overview" | "front" | "corner" | "entry" | "aerial";
type MapsListener = { remove(): void };
type MapCapabilities = { isWebGLOverlayViewAvailable?: boolean };
type GoogleMap = {
  addListener(name: string, listener: (event?: {domEvent?:Event}) => void): MapsListener;
  setCenter(position: { lat: number; lng: number }): void;
  setZoom(zoom: number): void;
  moveCamera?(options: Record<string, unknown>): void;
  getRenderingType?(): string;
  getMapCapabilities?(): MapCapabilities;
  getMapTypeId?(): string;
  getZoom?(): number | undefined;
  getBounds?(): {getNorthEast():{lat():number;lng():number};
    getSouthWest():{lat():number;lng():number}}|undefined;
};

type MaxZoomResult = { zoom?: number };
type GoogleMaxZoomService = {
  getMaxZoomAtLatLng(position: { lat: number; lng: number }): Promise<MaxZoomResult>;
};

type WebGLTransformer = {
  fromLatLngAltitude(input: {
    lat: number;
    lng: number;
    altitude: number;
  }): number[];
};

type WebGLDrawOptions = {
  gl: WebGLRenderingContext;
  transformer: WebGLTransformer;
};

type WebGLContextOptions = { gl: WebGLRenderingContext };

type GoogleWebGLOverlay = {
  onAdd?: () => void;
  onContextRestored?: (options: WebGLContextOptions) => void;
  onDraw?: (options: WebGLDrawOptions) => void;
  onContextLost?: () => void;
  onRemove?: () => void;
  setMap(map: GoogleMap | null): void;
  requestRedraw(): void;
};

type GoogleRoot = {
  maps: {
    Map: new (node: HTMLElement, options: Record<string, unknown>) => GoogleMap;
    MaxZoomService?: new () => GoogleMaxZoomService;
    WebGLOverlayView?: new () => GoogleWebGLOverlay;
    RenderingType?: { VECTOR?: string; RASTER?: string; UNINITIALIZED?: string };
  };
};

type GeoWindow = Window &
  typeof globalThis & {
    google?: GoogleRoot;
    __rekixoPublicGeoMapsReady?: () => void;
  };

const WEBGL_CONTEXT_TIMEOUT_MS = 12_000;
const GEO_CAMERA_VIEWS: Array<{ id: GeoCameraView; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "front", label: "Front" },
  { id: "corner", label: "Corner" },
  { id: "entry", label: "Entry view" },
  { id: "aerial", label: "Aerial" },
];
let mapsPromise: Promise<GoogleRoot> | null = null;
let mapsKeyLoaded = "";

function loadGoogleMaps(apiKey: string) {
  const geoWindow = window as GeoWindow;
  if (geoWindow.google?.maps?.Map && mapsKeyLoaded === apiKey)
    return Promise.resolve(geoWindow.google);
  if (mapsPromise && mapsKeyLoaded === apiKey) return mapsPromise;

  mapsKeyLoaded = apiKey;
  mapsPromise = new Promise<GoogleRoot>((resolve, reject) => {
    const callback = "__rekixoPublicGeoMapsReady";
    geoWindow[callback] = () => {
      if (geoWindow.google?.maps?.Map) resolve(geoWindow.google);
      else reject(new Error("Google Maps initialize nahi hui."));
    };
    const existing = document.getElementById("rekixo-public-geo-maps-js");
    if (existing) existing.remove();
    const script = document.createElement("script");
    script.id = "rekixo-public-geo-maps-js";
    script.async = true;
    script.defer = true;
    script.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&loading=async&callback=${callback}`;
    script.onerror = () => {
      mapsPromise = null;
      reject(new Error("Google Maps load nahi hui."));
    };
    document.head.appendChild(script);
  });
  return mapsPromise;
}

function browserSupportsWebGL() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

function renderingTypeLabel(map: GoogleMap) {
  return String(map.getRenderingType?.() || "UNKNOWN").toUpperCase();
}

function webglTimeoutMessage(map: GoogleMap) {
  const capabilities = map.getMapCapabilities?.();
  if (capabilities?.isWebGLOverlayViewAvailable === false)
    return "Configured Google Maps Map ID WebGLOverlayView support expose nahi kar raha. JavaScript Vector Map ID, billing aur browser hardware acceleration verify karein.";
  const renderingType = renderingTypeLabel(map);
  if (renderingType.includes("RASTER"))
    return "Google Maps raster mode mila after vector startup window. API key aur production JavaScript Vector Map ID same Cloud project me verify karein.";
  if (!browserSupportsWebGL())
    return "Browser WebGL unavailable hai. Hardware acceleration/WebGL enable karke reload karein.";
  return `Integrated vector WebGL context ${WEBGL_CONTEXT_TIMEOUT_MS / 1000}s me ready nahi hua (${renderingType}).`;
}

function sha256Hex(bytes: ArrayBuffer) {
  return crypto.subtle.digest("SHA-256", bytes).then((digest) =>
    Array.from(new Uint8Array(digest), (value) =>
      value.toString(16).padStart(2, "0"),
    ).join(""),
  );
}

async function loadVerifiedModel(model: GeoPayload["model"]) {
  const response = await fetch(model.url, {
    headers: { Accept: "model/gltf-binary,application/octet-stream" },
    cache: "force-cache",
  });
  if (!response.ok)
    throw new Error(`Immutable Geo model load failed (${response.status}).`);
  const bytes = await response.arrayBuffer();
  if (model.byteSize !== undefined && bytes.byteLength !== model.byteSize)
    throw new Error("Immutable Geo model byte-size verification failed.");
  if (model.sha256 && (await sha256Hex(bytes)) !== model.sha256.toLowerCase())
    throw new Error("Immutable Geo model checksum verification failed.");
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  return new Promise<THREE.Object3D>((resolve, reject) => {
    loader.parse(
      bytes,
      "",
      (gltf) => resolve(gltf.scene),
      (reason) =>
        reject(
          reason instanceof Error
            ? reason
            : new Error("Immutable Geo GLB parse failed."),
        ),
    );
  });
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    node.geometry?.dispose();
    for (const material of Array.isArray(node.material)
      ? node.material
      : [node.material]) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      material.dispose();
    }
  });
}

function mapAltitude(data: GeoPayload) {
  return data.placement.heightMode === "absolute"
    ? Number(data.placement.anchor.altitudeM || 0)
    : 0;
}

function normalizeHeading(value: number) {
  return ((value % 360) + 360) % 360;
}

function isSatelliteMapType(mapTypeId?: string) {
  const value = String(mapTypeId || "").toLowerCase();
  return value.includes("satellite") || value.includes("hybrid");
}

function cameraPreset(view: GeoCameraView, buildingHeading: number) {
  const heading = normalizeHeading(buildingHeading);
  switch (view) {
    case "front":
      return { zoom: 20.1, tilt: 67.5, heading };
    case "corner":
      return { zoom: 19.85, tilt: 67.5, heading: normalizeHeading(heading + 35) };
    case "entry":
      return { zoom: 21.25, tilt: 67.5, heading };
    case "aerial":
      return { zoom: 18.65, tilt: 20, heading };
    default:
      return { zoom: 19, tilt: 67.5, heading };
  }
}


// Inspect the immutable site model independently of the satellite imagery ceiling.
// Only mounted on demand; the Google Map stays mounted so the Geo camera is preserved.
function GeoModelInspector({ model }: { model: GeoPayload["model"] }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [message, setMessage] = useState("Preparing verified 3D detail…");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let frame = 0;
    let loadedModel: THREE.Object3D | undefined;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x081421);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x708294, 2.1));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.6);
    keyLight.position.set(40, 90, 65);
    scene.add(keyLight);
    const camera = new THREE.PerspectiveCamera(48, 1, 0.001, 10000);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      setMessage("This device cannot start the 3D detail renderer.");
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    host.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.enablePan = true;
    controls.rotateSpeed = 0.7;
    controls.zoomSpeed = 0.85;
    controls.touches.ONE = THREE.TOUCH.ROTATE;
    controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;

    const resize = () => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const render = () => {
      frame = window.requestAnimationFrame(render);
      controls.update();
      renderer.render(scene, camera);
    };
    render();

    void loadVerifiedModel(model).then((object) => {
      if (disposed) {
        disposeObject(object);
        return;
      }
      loadedModel = object;
      const bounds = new THREE.Box3().setFromObject(object);
      if (bounds.isEmpty()) {
        setMessage("The verified model contains no visible geometry.");
        return;
      }
      const sphere = bounds.getBoundingSphere(new THREE.Sphere());
      const radius = Math.max(sphere.radius, 0.1);
      camera.near = Math.max(radius / 100000, 0.0001);
      camera.far = Math.max(radius * 100, 1000);
      camera.position.copy(sphere.center).add(new THREE.Vector3(radius * 1.6, radius * 1.0, radius * 1.6));
      camera.updateProjectionMatrix();
      controls.target.copy(sphere.center);
      controls.minDistance = Math.max(radius * 0.01, 0.001);
      controls.maxDistance = Math.max(radius * 50, 10);
      controls.update();
      scene.add(object);
      setMessage("");
    }).catch((reason: unknown) => {
      if (!disposed) setMessage(reason instanceof Error ? reason.message : "3D detail could not load.");
    });

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      renderer.forceContextLoss();
      renderer.dispose();
      renderer.domElement.remove();
      if (loadedModel) disposeObject(loadedModel);
    };
  }, [model.url, model.sha256, model.byteSize]);

  return (
    <div ref={hostRef} className="geo-model-inspector" aria-label="Verified site model 3D detail viewer">
      {message ? <div className="geo-inspector-status" role="status">{message}</div> : null}
    </div>
  );
}

function geoPlotWorldPath(plot:GeoMappedPlot,data:GeoPayload,groundY:number) {
  const wrapper=new THREE.Group();
  const model=new THREE.Group();
  applyRigidBuildingPlacement(wrapper,model,data.modelAnchor.localPositionM,{
    eastOffsetM:data.placement.eastOffsetM,northOffsetM:data.placement.northOffsetM,
    verticalOffsetM:data.placement.verticalOffsetM,headingDeg:data.placement.headingDeg,
    pitchDeg:data.placement.pitchDeg,rollDeg:data.placement.rollDeg,scale:data.placement.scale,
  });
  wrapper.updateMatrixWorld(true);
  const latitude=data.placement.anchor.latitude*Math.PI/180;
  const latMeters=111132.92-559.82*Math.cos(2*latitude)+1.175*Math.cos(4*latitude);
  const lngMeters=111412.84*Math.cos(latitude)-93.5*Math.cos(3*latitude)+.118*Math.cos(5*latitude);
  return plot.corners.map(([x,z])=>{
    const local=model.localToWorld(new THREE.Vector3(x,groundY,z));
    return {lat:data.placement.anchor.latitude+local.y/latMeters,
      lng:data.placement.anchor.longitude+local.x/lngMeters};
  });
}

function IntegratedGeoScene({ data, toolbarContainer }: { data: GeoPayload; toolbarContainer?: HTMLElement | null }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const cameraActionRef = useRef<((view: GeoCameraView) => void) | null>(null);
  const zoomActionRef = useRef<((step: number) => void) | null>(null);
  const [inspectMode, setInspectMode] = useState(false);
  const [selectedPlot, setSelectedPlot] = useState<GeoMappedPlot|null>(null);
  const [showPlotBoundaries, setShowPlotBoundaries] = useState(true);
  const showPlotsRef=useRef(showPlotBoundaries);
  showPlotsRef.current=showPlotBoundaries;
  const plotRefreshRef=useRef<((visible:boolean)=>void)|null>(null);
  useEffect(() => {
    plotRefreshRef.current?.(showPlotBoundaries);
    if(!showPlotBoundaries)setSelectedPlot(null);
  },[showPlotBoundaries]);
  const [cameraView, setCameraView] = useState<GeoCameraView>("overview");
  const [satelliteMaxZoom, setSatelliteMaxZoom] = useState<number | null>(null);
  const [zoomNotice, setZoomNotice] = useState("");
  const [failure, setFailure] = useState("");

  useEffect(() => {
    if (!hostRef.current || !data.maps.apiKey || !data.maps.mapId) return;
    let cancelled = false;
    let overlay: GoogleWebGLOverlay | undefined;
    let mapIdle: MapsListener | undefined;
    let mapTypeChanged: MapsListener | undefined;
    let mapZoomChanged: MapsListener | undefined;
    let mapClick: MapsListener | undefined;
    let pointerHost:HTMLDivElement|null=null;
    let onNativePointerDown:((event:PointerEvent)=>void)|null=null;
    let onNativePointerUp:((event:PointerEvent)=>void)|null=null;
    let plotLayer:ModelPlotLayer|null=null;
    let latestProjection:THREE.Matrix4|null=null;
    const plotIds=new Map((data.plotMapping?.plots||[]).map(plot=>[plot.id,plot]));
    let preparedPaths:Array<{plot:GeoMappedPlot;path:Array<{lat:number;lng:number}>;bounds:GeoBounds}>=[];
    let refreshPlotPolygons:((visible:boolean)=>void)|null=null;
    let renderer: THREE.WebGLRenderer | undefined;
    let loadedModel: THREE.Object3D | undefined;
    let root: THREE.Group | undefined;
    let contextTimer: number | undefined;
    let contextRestored = false;
    let zoomCheckTimer: number | undefined;
    let activeCameraView: GeoCameraView = "overview";

    const clearContextTimer = () => {
      if (contextTimer !== undefined) window.clearTimeout(contextTimer);
      contextTimer = undefined;
    };

    const modelResultPromise = loadVerifiedModel(data.model)
      .then((model) => ({ model, error: undefined as unknown }))
      .catch((error: unknown) => ({ model: undefined, error }));
    void loadGoogleMaps(data.maps.apiKey)
      .then((google) => {
        if (cancelled || !hostRef.current) {
          void modelResultPromise.then(({ model }) => {
            if (model && model !== loadedModel) disposeObject(model);
          });
          return;
        }
        if (!browserSupportsWebGL())
          throw new Error("Browser WebGL unavailable hai. Hardware acceleration/WebGL enable karke reload karein.");
        const WebGLOverlayView = google.maps.WebGLOverlayView;
        if (!WebGLOverlayView)
          throw new Error("This browser/map runtime does not expose WebGLOverlayView.");

        const center = {
          lat: data.placement.anchor.latitude,
          lng: data.placement.anchor.longitude,
        };
        const initialCamera = cameraPreset("overview", data.placement.headingDeg);
        const map = new google.maps.Map(hostRef.current, {
          center,
          ...initialCamera,
          mapId: data.maps.mapId,
          renderingType: google.maps.RenderingType?.VECTOR || "VECTOR",
          isFractionalZoomEnabled: true,
          tiltInteractionEnabled: true,
          headingInteractionEnabled: true,
          mapTypeControl: true,
          streetViewControl: false,
          fullscreenControl: false, // Fullscreen the complete scene, including the detail viewer.
          zoomControl: false, // Dedicated zoom buttons stay usable in normal and fullscreen layouts.
          draggable: true,
          gestureHandling: "greedy",
          clickableIcons: false,
        });

        // Canonical GLB-attached plot geometry is rendered by the SAME WebGL
        // camera as the masterplan. The lat/lng paths below are for viewport
        // culling only — Google terrain polygons must never be drawn.
        const currentViewport=():GeoBounds|null=>{
          const bounds=map.getBounds?.();
          if(!bounds)return null; // map API not yet ready / older runtime
          const ne=bounds.getNorthEast(),sw=bounds.getSouthWest();
          return {north:ne.lat(),east:ne.lng(),south:sw.lat(),west:sw.lng()};
        };
        refreshPlotPolygons=(enabled)=>{
          if(cancelled||!plotLayer)return;
          // A small estate should never lose an edge merely because Google
          // reports 2D ground bounds during a steep camera pitch.
          // Large projects keep conservative viewport culling for performance.
          const visible=new Set((enabled?
            (preparedPaths.length<=160?preparedPaths:
              visibleGeoPlotPaths(preparedPaths,currentViewport())):[]).map(p=>p.plot.id));
          plotLayer.group.visible=enabled;
          for(const [id,group] of plotLayer.groupsById)group.visible=visible.has(id);
          overlay?.requestRedraw();
        };
        plotRefreshRef.current=visible=>refreshPlotPolygons?.(visible);
        // Google Maps can swallow map "click" events inside its shared
        // WebGL canvas (especially at high tilt) even while DOM pointer events
        // still fire. Pick from the real DOM pointer position first, and retain
        // map.click as a non-destructive fallback. Never disable pan/zoom.
        const selectAtScreenPoint=(x:number,y:number)=>{
          if(cancelled||!plotLayer||!latestProjection||!showPlotsRef.current||
            !hostRef.current)return;
          const id=pickModelGeoPlot(x,y,hostRef.current.getBoundingClientRect(),
            latestProjection,plotLayer.hitMeshes);
          if(id)setSelectedPlot(plotIds.get(id)||null);
        };
        const clickCoordinates=(event:unknown):{x:number;y:number}|null=>{
          if(!event||typeof event!=="object")return null;
          const pointer=event as {clientX?:number;clientY?:number;
            changedTouches?:ArrayLike<{clientX:number;clientY:number}>};
          // Do not use instanceof MouseEvent: Google may wrap a PointerEvent
          // or provide a cross-realm event object.
          if(Number.isFinite(pointer.clientX)&&Number.isFinite(pointer.clientY))
            return {x:pointer.clientX!,y:pointer.clientY!};
          const touch=pointer.changedTouches?.[0];
          return touch&&Number.isFinite(touch.clientX)&&Number.isFinite(touch.clientY)
            ?{x:touch.clientX,y:touch.clientY}:null;
        };
        mapClick=map.addListener("click",event=>{
          const coords=clickCoordinates(event?.domEvent);
          if(coords)selectAtScreenPoint(coords.x,coords.y);
        });
        pointerHost=hostRef.current;
        let pressed:{id:number;x:number;y:number;time:number}|null=null;
        const mapControlTarget=(target:EventTarget|null)=>{
          const element=target instanceof Element?target:null;
          return Boolean(element?.closest(
            "button,a,input,select,textarea,[role='button'],.gmnoprint,.gm-style-mtc,.gm-control-active"
          ));
        };
        onNativePointerDown=event=>{
          pressed=null;
          if(!event.isPrimary||event.button!==0||mapControlTarget(event.target))return;
          pressed={id:event.pointerId,x:event.clientX,y:event.clientY,time:performance.now()};
        };
        onNativePointerUp=event=>{
          const start=pressed;
          pressed=null;
          if(!start||event.pointerId!==start.id||!event.isPrimary||
            mapControlTarget(event.target))return;
          const drift=Math.hypot(event.clientX-start.x,event.clientY-start.y);
          // A real map drag, pinch or long press is never a plot-selection tap.
          if(drift>8||performance.now()-start.time>850)return;
          selectAtScreenPoint(event.clientX,event.clientY);
        };
        pointerHost?.addEventListener("pointerdown",onNativePointerDown,true);
        pointerHost?.addEventListener("pointerup",onNativePointerUp,true);

        const scene = new THREE.Scene();
        const camera = new THREE.Camera();
        root = new THREE.Group();
        root.name = "rekixo-rigid-geo-building";
        scene.add(root);
        scene.add(new THREE.HemisphereLight(0xffffff, 0x66717b, 1.35));
        const sun = new THREE.DirectionalLight(0xffffff, 2.0);
        sun.position.set(30, -20, 60);
        scene.add(sun);

        const armContextTimer = () => {
          clearContextTimer();
          if (contextRestored || cancelled) return;
          contextTimer = window.setTimeout(() => {
            if (cancelled || contextRestored) return;
            setFailure(webglTimeoutMessage(map));
            overlay?.setMap(null);
          }, WEBGL_CONTEXT_TIMEOUT_MS);
        };

        overlay = new WebGLOverlayView();
        overlay.onAdd = () => {
          if (cancelled) return;
        };
        overlay.onContextRestored = ({ gl }) => {
          if (cancelled) return;
          contextRestored = true;
          clearContextTimer();
          renderer = new THREE.WebGLRenderer({
            canvas: gl.canvas as HTMLCanvasElement,
            context: gl,
            ...(gl.getContextAttributes() || {}),
          });
          renderer.autoClear = false;
          renderer.autoClearDepth = false;
          renderer.outputColorSpace = THREE.SRGBColorSpace;
          renderer.toneMapping = THREE.ACESFilmicToneMapping;
          renderer.toneMappingExposure = 0.95;
          overlay?.requestRedraw();
        };
        overlay.onDraw = ({ gl, transformer }) => {
          if (cancelled || !renderer) return;
          const projection = transformer.fromLatLngAltitude({
            lat: data.placement.anchor.latitude,
            lng: data.placement.anchor.longitude,
            altitude: mapAltitude(data),
          });
          camera.projectionMatrix.fromArray(projection);
          latestProjection=camera.projectionMatrix.clone();
          gl.disable(gl.SCISSOR_TEST);
          renderer.render(scene, camera);
          renderer.resetState();
        };
        overlay.onContextLost = () => {
          contextRestored = false;
          renderer?.dispose();
          renderer = undefined;
          if (!cancelled) {
            armContextTimer();
          }
        };
        overlay.onRemove = () => {
          contextRestored = false;
          clearContextTimer();
          renderer?.dispose();
          renderer = undefined;
        };
        overlay.setMap(map);

        // Map initialization no longer waits for the complete, verified GLB.
        // Asset download/verification/parsing continues in parallel.
        void modelResultPromise
          .then(({ model, error }) => {
            if (cancelled) {
              if (model && model !== loadedModel) disposeObject(model);
              return;
            }
            if (error || !model) {
              setFailure(
                error instanceof Error
                  ? error.message
                  : "Verified 3D Geo model could not be loaded.",
              );
              return;
            }
            const modelRoot = root;
            if (!modelRoot) {
              disposeObject(model);
              setFailure("3D Geo map initialized without a model container.");
              return;
            }
            loadedModel = model;
            // Measure canonical model-local ground BEFORE Geo placement converts its axes.
            const modelGroundY = new THREE.Box3().setFromObject(model).min.y;
            // Sample GLB surface elevations while its coordinates are still
            // canonical model-local. After placement its world matrix is ENU;
            // mixing those coordinates with saved X/Z plot points would drift.
            const candidateLayer=data.plotMapping?.geoReleaseId===data.geoRelease.id &&
              data.plotMapping.plots.length>0
              ?buildModelGeoPlotLayer(model,data.plotMapping.plots):null;
            const placement=applyRigidBuildingPlacement(
              modelRoot,
              model,
              data.modelAnchor.localPositionM,
              {
                eastOffsetM: data.placement.eastOffsetM,
                northOffsetM: data.placement.northOffsetM,
                verticalOffsetM: data.placement.verticalOffsetM,
                headingDeg: data.placement.headingDeg,
                pitchDeg: data.placement.pitchDeg,
                rollDeg: data.placement.rollDeg,
                scale: data.placement.scale,
              },
            );
            if(candidateLayer){
              // Same original X/Z frame as the model; placement is shared.
              plotLayer=candidateLayer;
              placement.anchorOffset.add(plotLayer.group);
              preparedPaths=(data.plotMapping?.plots||[]).map(plot=>{
                const path=geoPlotWorldPath(plot,data,
                  Number.isFinite(plot.planeY)?plot.planeY!:modelGroundY);
                return {plot,path,bounds:geoPathBounds(path)};
              });
              refreshPlotPolygons?.(showPlotsRef.current);
              overlay?.requestRedraw();
            }
            model.traverse((node) => {
              if (!(node instanceof THREE.Mesh)) return;
              node.frustumCulled = true;
              node.castShadow = false;
              node.receiveShadow = false;
            });
            overlay?.requestRedraw();
            if (contextRestored) setFailure("");
          })
          .catch((reason: unknown) => {
            if (cancelled) return;
            setFailure(
              reason instanceof Error
                ? reason.message
                : "Verified 3D Geo model could not be placed.",
            );
          });

        const applyCamera = (view: GeoCameraView) => {
          const preset = cameraPreset(view, data.placement.headingDeg);
          activeCameraView = view;
          setCameraView(view);
          setZoomNotice("");
          // The maximum satellite *imagery detail* is not an application camera cap.
          // Let Google Maps apply its own native, location-specific zoom bounds.
          map.moveCamera?.({ center, ...preset });
          overlay?.requestRedraw();
        };
        cameraActionRef.current = applyCamera;
        // A whole zoom level is 2x the map scale. Do not impose an additional
        // satellite imagery ceiling on the real map camera or manual gestures.
        zoomActionRef.current = (step) => {
          const current = map.getZoom?.() ?? cameraPreset(activeCameraView, data.placement.headingDeg).zoom;
          const requested = Math.max(0, current + step);
          if (zoomCheckTimer !== undefined) window.clearTimeout(zoomCheckTimer);
          setZoomNotice("");
          map.setZoom(requested);
          if (step > 0) {
            zoomCheckTimer = window.setTimeout(() => {
              if (cancelled) return;
              const actual = map.getZoom?.();
              if (actual !== undefined && actual < requested - 0.1) {
                setZoomNotice("Google Maps has reached its native zoom limit here. Use 3D Detail for a closer model view.");
              }
            }, 650);
          }
        };

        const maxZoomService = google.maps.MaxZoomService
          ? new google.maps.MaxZoomService()
          : undefined;
        const refreshSatelliteLimit = async () => {
          if (!maxZoomService) return;
          try {
            const result = await maxZoomService.getMaxZoomAtLatLng(center);
            if (cancelled) return;
            const candidate = Number(result.zoom);
            if (!Number.isFinite(candidate)) return;
            // This reports the last level of *native image detail*, not the
            // maximum selectable vector camera zoom. Never snap the map back.
            setSatelliteMaxZoom(candidate);
          } catch {
            // Google still enforces its own imagery ceiling if this optional lookup fails.
          }
        };

        mapZoomChanged = map.addListener("zoom_changed", () => {
          overlay?.requestRedraw();
        });
        mapIdle = map.addListener("idle", () => {
          overlay?.requestRedraw();
          refreshPlotPolygons?.(showPlotsRef.current);
        });
        mapTypeChanged = map.addListener("maptypeid_changed", () => {
          if (isSatelliteMapType(map.getMapTypeId?.())) void refreshSatelliteLimit();
          overlay?.requestRedraw();
        });
        void refreshSatelliteLimit();
        armContextTimer();
        applyCamera("overview");
      })
      .catch((reason) => {
        if (cancelled) return;
        clearContextTimer();
        void modelResultPromise.then(({ model }) => {
          if (model && model !== loadedModel) disposeObject(model);
        });
        setFailure(
          reason instanceof Error
            ? reason.message
            : "Integrated 3D Geo scene initialize nahi hui.",
        );
      });

    return () => {
      cancelled = true;
      clearContextTimer();
      if (zoomCheckTimer !== undefined) window.clearTimeout(zoomCheckTimer);
      cameraActionRef.current = null;
      zoomActionRef.current = null;
      mapZoomChanged?.remove();
      mapClick?.remove();
      if(pointerHost&&onNativePointerDown)
        pointerHost.removeEventListener("pointerdown",onNativePointerDown,true);
      if(pointerHost&&onNativePointerUp)
        pointerHost.removeEventListener("pointerup",onNativePointerUp,true);
      plotLayer?.dispose();
      plotLayer=null;latestProjection=null;preparedPaths=[];
      plotRefreshRef.current=null;
      mapIdle?.remove();
      mapTypeChanged?.remove();
      overlay?.setMap(null);
      renderer?.dispose();
      if (loadedModel) disposeObject(loadedModel);
      if (hostRef.current) hostRef.current.replaceChildren();
    };
  }, [data]);

  return (
    <div ref={sceneRef} className="geo-integrated-scene">
      <div ref={hostRef} className="geo-integrated-map" aria-label={`${data.project.name} integrated 3D geographic scene`} />
      {inspectMode ? <GeoModelInspector model={data.model} /> : null}
      <nav className="geo-map-quick-actions" aria-label="Geo zoom and 3D detail controls">
        <button type="button" aria-pressed={inspectMode} onClick={() => setInspectMode((value) => !value)} title="Switch between satellite map and close-up 3D model">{inspectMode ? "Map view" : "3D Detail"}</button>
        {!inspectMode ? <>
          <button type="button" aria-label="Zoom out 2×" title="Zoom out 2×" onClick={() => zoomActionRef.current?.(-1)}>−</button>
          <button type="button" aria-label="Zoom in 2×" title="Zoom in 2× (one full map zoom level)" onClick={() => zoomActionRef.current?.(1)}>+</button>
        </> : null}
        <button type="button" aria-label="Reset Geo camera" title="Return to overview" onClick={() => { setInspectMode(false); cameraActionRef.current?.("overview"); }}>⌖</button>
        <button type="button" aria-label="Toggle Geo fullscreen" title="Fullscreen" onClick={() => {
          const scene = sceneRef.current;
          if (!scene) return;
          if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
          else void scene.requestFullscreen?.().catch(() => undefined);
        }}>⛶</button>
      </nav>
      {data.plotMapping?.plots.length ? <div className="geo-plot-public-controls">
        <button type="button" onClick={() => setShowPlotBoundaries(v=>!v)}
          aria-pressed={showPlotBoundaries}>Plots {showPlotBoundaries?"ON":"OFF"}</button>
        <span>{data.plotMapping.plots.length} mapped</span>
        {data.plotMapping.publicationMode==="preliminary"&&
          <span className="geo-plot-preliminary-notice" role="status">
            Preliminary plot mapping · Details pending source review
          </span>}
      </div> : null}
      {selectedPlot && <aside className="geo-plot-public-details" aria-label="Selected plot details">
        <button type="button" className="geo-plot-public-close" aria-label="Close plot details" onClick={()=>setSelectedPlot(null)}>×</button>
        <strong>Plot {selectedPlot.id}</strong>
        {data.plotMapping?.publicationMode==="preliminary"&&
          <small className="geo-plot-preliminary-detail">Preliminary mapped boundary; source measurements shown only when reviewed.</small>}
        {(()=>{
          const commercial=data.plotMapping?.commercial?.[selectedPlot.id];
          return commercial?<span>
            {commercial.status==="available"?"Available":commercial.status==="booked"?"Booked":"Sold"}
            {Number.isSafeInteger(commercial.pricePaise)&&commercial.pricePaise!==null
              ?" · "+new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR"})
                .format(commercial.pricePaise/100):""}
          </span>:<small>Commercial status/price not independently approved for this mapping release.</small>;
        })()}
        {selectedPlot.area&&<span>Area: {selectedPlot.area.value} {selectedPlot.area.unit}</span>}
        {selectedPlot.facing&&<span>Facing: {selectedPlot.facing}</span>}
        {selectedPlot.road&&<span>Road: {selectedPlot.road}</span>}
        {Object.entries(selectedPlot.sides).map(([role,side])=><span key={role}>{role}: {side.length} {side.unit}{side.roadFacing?" · Road":""}</span>)}
        {data.plotMapping?.publicationMode==="preliminary"&&(!selectedPlot.area||!selectedPlot.facing)&&
          <small>Unreviewed measurements and directions are not publicly asserted.</small>}
        {selectedPlot.notes&&<small>{selectedPlot.notes}</small>}
      </aside>}
      {zoomNotice && !inspectMode ? <div className="geo-zoom-notice" role="status">{zoomNotice}</div> : null}
      {toolbarContainer ? createPortal(<nav className="geo-camera-toolbar geo-camera-toolbar--normal-row" aria-label="Geo map navigation">
          {GEO_CAMERA_VIEWS.map((view) => (
            <button
              key={view.id}
              type="button"
              className={cameraView === view.id ? "is-active" : ""}
              aria-pressed={cameraView === view.id}
              title={
                view.id === "entry" && satelliteMaxZoom !== null
                  ? `Closest available satellite detail at this site is zoom ${satelliteMaxZoom}`
                  : `${view.label} camera view`
              }
              onClick={() => { setInspectMode(false); cameraActionRef.current?.(view.id); }}
            >
              {view.label}
            </button>
          ))}
          <a
            className="geo-building-link"
            href={`/3Dprojects/${encodeURIComponent(data.project.slug)}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${data.project.name} building website in a new tab`}
            title={`Open ${data.project.name} building website`}
          >
            Building <span aria-hidden="true">↗</span>
          </a>
      </nav>, toolbarContainer) : null}
      {failure && (
        <div className="geo-integrated-fallback">
          <Viewer3D
            modelUrl={data.model.url}
            modelLabel={data.model.name}
            compactUi
            presentationView="building"
          />
          <div className="geo-fallback-note">
            <strong>Geospatial WebGL fallback</strong>
            <span>{failure}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function slugFromGeoPathname(pathname: string) {
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.length !== 3 || parts[0] !== "3Dprojects" || parts[2] !== "geo")
    return "";
  return parts[1]?.trim().toLowerCase() || "";
}

export default function GeoPublicDemo() {
  const slug = useMemo(() => slugFromGeoPathname(window.location.pathname), []);
  const [data, setData] = useState<GeoPayload>();
  const [branding, setBranding] = useState<PublicProjectBranding | null>(null);
  const [toolbarContainer, setToolbarContainer] = useState<HTMLDivElement | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!slug) {
      setError("3D Geo project slug missing hai.");
      return;
    }
    const controller = new AbortController();
    setBranding(null);
    void loadPublicBranding(slug, "geo", controller.signal).then(setBranding);
    fetch(`/3Dprojects/api/projects/${encodeURIComponent(slug)}/geo-placement`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json()) as GeoPayload;
        if (!response.ok)
          throw new Error(body.error || `3D Geo load failed (${response.status}).`);
        return body;
      })
      .then((body) => {
        setData(body);
        setError("");
      })
      .catch((reason) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "3D Geo load nahi hua.");
      });
    return () => controller.abort();
  }, [slug]);

  if (error)
    return (
      <main className="jio-public-state">
        <p className="eyebrow">REKIXO AR3D ENGINE</p>
        <h1>3D Geo unavailable</h1>
        <p>{error}</p>
      </main>
    );

  if (!data)
    return (
      <main className="jio-public-state">
        <p className="eyebrow">REKIXO AR3D ENGINE</p>
        <h1>Loading integrated 3D Geo…</h1>
      </main>
    );


  const mapFallbackReason = !data.maps.apiKey
    ? "Google Maps browser key is not configured"
    : !data.maps.mapId
      ? "Production Google Maps JavaScript Vector Map ID is not configured"
      : "Integrated Google Maps runtime is not configured";

  return (
    <main className="jio-public-shell">
      <header className="jio-public-header">
        <div className="jio-public-branding">
          {branding?.logoUrl ? <img className="jio-public-project-logo" src={branding.logoUrl} alt="" /> : null}
          <div>
            <h1>{data.project.name}</h1>
            <p>{data.project.location || "Rekixo AR3D Engine"}</p>
          </div>
        </div>
      </header>

      {data.publicContacts && <section className="jio-public-customer-contact" aria-label="Project contacts and location">
        <div className="jio-public-contact-details">
          {data.publicContacts.projectNumber&&<span>Project No. {data.publicContacts.projectNumber}</span>}
          {data.publicContacts.builderName&&<span>Developer: {data.publicContacts.builderName}</span>}
          {data.publicContacts.ownerName&&<span>Owner: {data.publicContacts.ownerName}</span>}
          {data.publicContacts.contactName&&<span>Contact: {data.publicContacts.contactName}</span>}
          {data.publicContacts.address&&<span>{data.publicContacts.address}</span>}
        </div>
        <nav aria-label="Contact project team" className="jio-public-contact-actions">
          {data.publicContacts.phone&&<a href={"tel:"+data.publicContacts.phone.replace(/[^+0-9]/g,"")}
            aria-label="Call project contact">Call</a>}
          {geoWhatsAppHref(data.publicContacts.whatsapp||data.publicContacts.phone)&&
            <a target="_blank" rel="noopener noreferrer"
              href={geoWhatsAppHref(data.publicContacts.whatsapp||data.publicContacts.phone)}
              aria-label="Contact project team on WhatsApp">WhatsApp</a>}
          {geoPublicMapHref(data.publicContacts)&&<a target="_blank" rel="noopener noreferrer"
            href={geoPublicMapHref(data.publicContacts)} aria-label="Open project in Google Maps">
            {data.publicContacts.mapsUrl?"Directions":"Find on Maps"}</a>}
          {data.publicContacts.phoneSecondary&&<a href={"tel:"+data.publicContacts.phoneSecondary.replace(/[^+0-9]/g,"")}
            aria-label="Call secondary project contact">Call 2</a>}
          {data.publicContacts.websiteUrl&&<a target="_blank" rel="noopener noreferrer"
            href={data.publicContacts.websiteUrl}>Website</a>}
          {data.publicContacts.email&&<a href={"mailto:"+data.publicContacts.email}>Email</a>}
        </nav>
      </section>}
      <section className="jio-public-meta">
        <article>
          <span>GEO RELEASE</span>
          <strong>v{data.geoRelease.version}</strong>
          <small>{data.geoRelease.manifestFormat || "legacy-compatible"}</small>
        </article>
        <article>
          <span>BUILDING SOURCE</span>
          <strong>v{data.buildingRelease.version}</strong>
          <small>{data.buildingRelease.id}</small>
        </article>
        <article>
          <span>RIGID ALIGNMENT</span>
          <strong>{data.placement.headingDeg.toFixed(1)}° heading</strong>
          <small>WGS84 · ENU · scale {data.placement.scale.toFixed(3)}</small>
        </article>
        <article>
          <span>MODEL ANCHOR</span>
          <strong>{data.modelAnchor.name}</strong>
          <small>{data.modelAnchor.kind} · {data.placement.heightMode}</small>
        </article>
      </section>

      {data.maps.configured && data.maps.apiKey && data.maps.mapId ? (
        <div className="geo-public-map-layout">
          <IntegratedGeoScene data={data} toolbarContainer={toolbarContainer} />
          <div ref={setToolbarContainer} className="geo-public-toolbar-slot" aria-label="Map camera controls" />
        </div>
      ) : (
        <section className="geo-integrated-scene geo-integrated-scene--fallback" aria-label={mapFallbackReason}>
          <Viewer3D
            modelUrl={data.model.url}
            modelLabel={data.model.name}
            compactUi
            presentationView="building"
          />
        </section>
      )}

      <footer className="geo-runtime-note">
        Building geometry remains immutable and rigid. Masterplan calibration, when present,
        applies only to the 2D overlay and never warps the Building model.
      </footer>
    </main>
  );
}
