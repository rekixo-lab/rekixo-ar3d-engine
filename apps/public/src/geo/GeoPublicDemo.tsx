import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { Viewer3D } from "../viewer/Viewer3D";
import { applyRigidBuildingPlacement } from "./geoRigidTransform";
import { loadPublicBranding, type PublicProjectBranding } from "../branding";
import "./geo-public-demo.css";

type GeoCoordinate = {
  longitude: number;
  latitude: number;
  altitudeM?: number;
};

type GeoPayload = {
  project: { id: string; slug: string; name: string; location?: string };
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
  error?: string;
};

type GeoCameraView = "overview" | "front" | "corner" | "entry" | "aerial";
type MapsListener = { remove(): void };
type MapCapabilities = { isWebGLOverlayViewAvailable?: boolean };
type GoogleMap = {
  addListener(name: string, listener: () => void): MapsListener;
  setCenter(position: { lat: number; lng: number }): void;
  setZoom(zoom: number): void;
  moveCamera?(options: Record<string, unknown>): void;
  getRenderingType?(): string;
  getMapCapabilities?(): MapCapabilities;
  getMapTypeId?(): string;
  getZoom?(): number | undefined;
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

function IntegratedGeoScene({ data, toolbarContainer }: { data: GeoPayload; toolbarContainer?: HTMLElement | null }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const cameraActionRef = useRef<((view: GeoCameraView) => void) | null>(null);
  const zoomActionRef = useRef<((step: number) => void) | null>(null);
  const [inspectMode, setInspectMode] = useState(false);
  const [cameraView, setCameraView] = useState<GeoCameraView>("overview");
  const [satelliteMaxZoom, setSatelliteMaxZoom] = useState<number | null>(null);
  const [failure, setFailure] = useState("");

  useEffect(() => {
    if (!hostRef.current || !data.maps.apiKey || !data.maps.mapId) return;
    let cancelled = false;
    let overlay: GoogleWebGLOverlay | undefined;
    let mapIdle: MapsListener | undefined;
    let mapTypeChanged: MapsListener | undefined;
    let mapZoomChanged: MapsListener | undefined;
    let renderer: THREE.WebGLRenderer | undefined;
    let loadedModel: THREE.Object3D | undefined;
    let root: THREE.Group | undefined;
    let contextTimer: number | undefined;
    let contextRestored = false;
    let satelliteLimit: number | undefined;
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
            applyRigidBuildingPlacement(
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
          const satellite = isSatelliteMapType(map.getMapTypeId?.());
          const zoom = satellite && satelliteLimit !== undefined
            ? Math.min(preset.zoom, satelliteLimit)
            : preset.zoom;
          activeCameraView = view;
          setCameraView(view);
          map.moveCamera?.({ center, ...preset, zoom });
          overlay?.requestRedraw();
        };
        cameraActionRef.current = applyCamera;
        // Never reset the user’s pan, heading or manually chosen zoom after imagery metadata arrives.
        zoomActionRef.current = (step) => {
          const current = map.getZoom?.() ?? cameraPreset(activeCameraView, data.placement.headingDeg).zoom;
          const requested = Math.max(0, current + step);
          const zoom = isSatelliteMapType(map.getMapTypeId?.()) && satelliteLimit !== undefined
            ? Math.min(requested, satelliteLimit)
            : requested;
          map.setZoom(zoom);
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
            satelliteLimit = candidate;
            setSatelliteMaxZoom(candidate);
            if (isSatelliteMapType(map.getMapTypeId?.())) {
              const userZoom = map.getZoom?.();
              if (userZoom !== undefined && userZoom > candidate) map.setZoom(candidate);
            }
          } catch {
            // Google still enforces its own imagery ceiling if this optional lookup fails.
          }
        };

        mapZoomChanged = map.addListener("zoom_changed", () => {
          overlay?.requestRedraw();
        });
        mapIdle = map.addListener("idle", () => {
          overlay?.requestRedraw();
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
      cameraActionRef.current = null;
      zoomActionRef.current = null;
      mapZoomChanged?.remove();
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
          <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => zoomActionRef.current?.(-0.5)}>−</button>
          <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => zoomActionRef.current?.(0.5)}>+</button>
        </> : null}
        <button type="button" aria-label="Reset Geo camera" title="Return to overview" onClick={() => { setInspectMode(false); cameraActionRef.current?.("overview"); }}>⌖</button>
        <button type="button" aria-label="Toggle Geo fullscreen" title="Fullscreen" onClick={() => {
          const scene = sceneRef.current;
          if (!scene) return;
          if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
          else void scene.requestFullscreen?.().catch(() => undefined);
        }}>⛶</button>
      </nav>
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
