import { buildGeoRigidPlacementPlan, type GeoRigidPlacement } from "@rekixo/3d-engine-core";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import type { GeoHeightMode, GeoV2Anchor } from "./geoV2Api";

export type GeoIntegratedPreviewState =
  | "map-key-required"
  | "loading-map"
  | "map-ready"
  | "loading-model"
  | "waiting-coordinate"
  | "waiting-anchor"
  | "invalid-alignment"
  | "ready"
  | "error";

export type GeoAlignmentMapTarget = {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
};

type Coordinate = { latitude: number; longitude: number };

type AuthoringPlacement = GeoRigidPlacement & {
  altitudeM: number;
  heightMode: GeoHeightMode;
};

type Props = {
  apiKey: string;
  projectKey: string;
  modelUrl: string | null;
  modelName: string;
  coordinate: Coordinate | null;
  anchor: GeoV2Anchor | null;
  placement: AuthoringPlacement | null;
  alignmentCaptureId: string | null;
  alignmentTargets: GeoAlignmentMapTarget[];
  onCoordinateChange(latitude: number, longitude: number): void;
  onAlignmentTargetCapture(pointId: string, latitude: number, longitude: number): void;
  onPreviewStateChange(state: GeoIntegratedPreviewState): void;
};

type MapsListener = { remove(): void };
type LatLngLike = { lat(): number; lng(): number };
type MapMouseEvent = { latLng?: LatLngLike | null };
type MapCapabilities = { isWebGLOverlayViewAvailable?: boolean };
type GoogleMap = {
  addListener(name: "click", listener: (event: MapMouseEvent) => void): MapsListener;
  addListener(name: string, listener: () => void): MapsListener;
  setCenter(position: { lat: number; lng: number }): void;
  setZoom(zoom: number): void;
  moveCamera?(options: Record<string, unknown>): void;
  getRenderingType?(): string;
  getMapCapabilities?(): MapCapabilities;
};
type GoogleMapConstructor = {
  new (node: HTMLElement, options: Record<string, unknown>): GoogleMap;
};
type GoogleMarker = {
  setMap(map: GoogleMap | null): void;
  setPosition(position: { lat: number; lng: number }): void;
  setDraggable(value: boolean): void;
  addListener(name: string, listener: () => void): MapsListener;
  getPosition(): LatLngLike | null;
};
type WebGLTransformer = {
  fromLatLngAltitude(input: { lat: number; lng: number; altitude: number }): number[];
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
    Map: GoogleMapConstructor;
    Marker: new (options: Record<string, unknown>) => GoogleMarker;
    WebGLOverlayView?: new () => GoogleWebGLOverlay;
    RenderingType?: { VECTOR?: string; RASTER?: string; UNINITIALIZED?: string };
  };
};
type GeoWindow = Window & typeof globalThis & {
  google?: GoogleRoot;
  __rekixoEngineGeoV2MapsReady?: () => void;
};
type MapIdSettings = {
  mapId: string | null;
  configured: boolean;
  error?: string;
};

type PlacementNodes = {
  root: THREE.Group;
  yUpToEnu: THREE.Group;
  anchorOffset: THREE.Group;
};

const INDIA_FALLBACK = { lat: 20.5937, lng: 78.9629 };
const WEBGL_CONTEXT_TIMEOUT_MS = 12_000;
const MAP_ID_CONFIG_URL = "/3Dprojects/api/geo-v2/maps-config";
let mapsPromise: Promise<GoogleRoot> | null = null;
let mapsKeyLoaded = "";

function loadGoogleMaps(apiKey: string) {
  const geoWindow = window as GeoWindow;
  if (geoWindow.google?.maps?.Map && mapsKeyLoaded === apiKey)
    return Promise.resolve(geoWindow.google);
  if (mapsPromise && mapsKeyLoaded === apiKey) return mapsPromise;

  mapsKeyLoaded = apiKey;
  mapsPromise = new Promise<GoogleRoot>((resolve, reject) => {
    const callback = "__rekixoEngineGeoV2MapsReady";
    geoWindow[callback] = () => {
      if (geoWindow.google?.maps?.Map) resolve(geoWindow.google);
      else reject(new Error("Google Maps initialize nahi hui."));
    };
    document.getElementById("rekixo-engine-geo-v2-maps-js")?.remove();
    const script = document.createElement("script");
    script.id = "rekixo-engine-geo-v2-maps-js";
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&loading=async&callback=${callback}`;
    script.onerror = () => {
      mapsPromise = null;
      reject(new Error("Google Maps load nahi hui."));
    };
    document.head.appendChild(script);
  });
  return mapsPromise;
}

async function readMapIdSettings() {
  const response = await fetch(MAP_ID_CONFIG_URL, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  const body = (await response.json().catch(() => ({}))) as MapIdSettings;
  if (!response.ok)
    throw new Error(body.error || `Google Maps Map ID settings load failed (${response.status}).`);
  return body;
}

async function writeMapIdSetting(mapId: string) {
  const response = await fetch(MAP_ID_CONFIG_URL, {
    method: "PUT",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ mapId }),
  });
  const body = (await response.json().catch(() => ({}))) as MapIdSettings;
  if (!response.ok)
    throw new Error(body.error || `Google Maps Map ID save failed (${response.status}).`);
  return body;
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
  return `Integrated vector WebGL context ${WEBGL_CONTEXT_TIMEOUT_MS / 1000}s me ready nahi hua (${renderingType}). Reload karke retry karein.`;
}

async function loadModel(modelUrl: string, signal: AbortSignal) {
  const response = await fetch(modelUrl, {
    cache: "force-cache",
    headers: { Accept: "model/gltf-binary,application/octet-stream" },
    signal,
  });
  if (!response.ok)
    throw new Error(`Immutable Building preview load failed (${response.status}).`);
  const bytes = await response.arrayBuffer();
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  return new Promise<THREE.Object3D>((resolve, reject) => {
    loader.parse(
      bytes,
      "",
      (gltf) => resolve(gltf.scene),
      (reason) => reject(
        reason instanceof Error
          ? reason
          : new Error("Immutable Building GLB parse failed."),
      ),
    );
  });
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    node.geometry?.dispose();
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      material.dispose();
    }
  });
}

function projectionAltitude(placement: AuthoringPlacement | null) {
  if (!placement || placement.heightMode !== "absolute") return 0;
  return placement.altitudeM;
}

function applyPlacement(nodes: PlacementNodes, anchor: GeoV2Anchor, placement: AuthoringPlacement) {
  const plan = buildGeoRigidPlacementPlan(
    { x: anchor.xM, y: anchor.yM, z: anchor.zM },
    placement,
  );
  nodes.root.position.set(plan.positionM.x, plan.positionM.y, plan.positionM.z);
  nodes.root.rotation.order = "ZYX";
  nodes.root.rotation.set(
    plan.rotationRad.x,
    plan.rotationRad.y,
    plan.rotationRad.z,
  );
  nodes.root.scale.setScalar(plan.scale);
  nodes.yUpToEnu.rotation.set(plan.yUpToEnuRotationXRad, 0, 0);
  nodes.anchorOffset.position.set(
    plan.anchorOffsetM.x,
    plan.anchorOffsetM.y,
    plan.anchorOffsetM.z,
  );
}

export default function GeoIntegratedAuthoringMap({
  apiKey,
  projectKey,
  modelUrl,
  modelName,
  coordinate,
  anchor,
  placement,
  alignmentCaptureId,
  alignmentTargets,
  onCoordinateChange,
  onAlignmentTargetCapture,
  onPreviewStateChange,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<GoogleMap | null>(null);
  const markerRef = useRef<GoogleMarker | null>(null);
  const overlayRef = useRef<GoogleWebGLOverlay | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.Camera | null>(null);
  const nodesRef = useRef<PlacementNodes | null>(null);
  const alignmentMarkersRef = useRef<Map<string, GoogleMarker>>(new Map());
  const coordinateRef = useRef<Coordinate | null>(coordinate);
  const placementRef = useRef<AuthoringPlacement | null>(placement);
  const alignmentCaptureIdRef = useRef<string | null>(alignmentCaptureId);
  const coordinateChangeRef = useRef(onCoordinateChange);
  const alignmentTargetCaptureRef = useRef(onAlignmentTargetCapture);
  const previewStateChangeRef = useRef(onPreviewStateChange);
  const [mapReady, setMapReady] = useState(false);
  const [webglReady, setWebglReady] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [frameReady, setFrameReady] = useState(false);
  const [mapFailure, setMapFailure] = useState("");
  const [modelFailure, setModelFailure] = useState("");
  const [modelDiagnostics, setModelDiagnostics] = useState("");
  const [showGeometryCheck, setShowGeometryCheck] = useState(false);
  const [mapIdInput, setMapIdInput] = useState("");
  const [configuredMapId, setConfiguredMapId] = useState("");
  const [mapIdBusy, setMapIdBusy] = useState(false);
  const [mapIdMessage, setMapIdMessage] = useState("");
  const [mapIdFailure, setMapIdFailure] = useState("");

  coordinateRef.current = coordinate;
  placementRef.current = placement;
  alignmentCaptureIdRef.current = alignmentCaptureId;
  coordinateChangeRef.current = onCoordinateChange;
  alignmentTargetCaptureRef.current = onAlignmentTargetCapture;
  previewStateChangeRef.current = onPreviewStateChange;

  useEffect(() => {
    let live = true;
    setMapIdFailure("");
    void readMapIdSettings()
      .then((value) => {
        if (!live) return;
        const mapId = value.mapId?.trim() || "";
        setMapIdInput(mapId);
        setConfiguredMapId(mapId);
      })
      .catch((reason) => {
        if (!live) return;
        setMapIdFailure(
          reason instanceof Error ? reason.message : "Production Map ID settings load nahi hui.",
        );
      });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!apiKey || !configuredMapId || !hostRef.current) {
      setMapReady(false);
      return;
    }

    let cancelled = false;
    let mapClick: MapsListener | null = null;
    let mapIdle: MapsListener | null = null;
    let markerDrag: MapsListener | null = null;
    let overlay: GoogleWebGLOverlay | null = null;
    let marker: GoogleMarker | null = null;
    let contextTimer: number | null = null;
    let contextRestored = false;
    setMapReady(false);
    setWebglReady(false);
    setFrameReady(false);
    setMapFailure("");

    const clearContextTimer = () => {
      if (contextTimer !== null) window.clearTimeout(contextTimer);
      contextTimer = null;
    };

    void loadGoogleMaps(apiKey)
      .then((google) => {
        if (cancelled || !hostRef.current) return;
        if (!browserSupportsWebGL())
          throw new Error("Browser WebGL unavailable hai. Hardware acceleration/WebGL enable karke reload karein.");
        const WebGLOverlayView = google.maps.WebGLOverlayView;
        if (!WebGLOverlayView)
          throw new Error("This browser/map runtime does not expose WebGLOverlayView.");

        const initial = coordinateRef.current;
        const center = initial
          ? { lat: initial.latitude, lng: initial.longitude }
          : INDIA_FALLBACK;
        const map = new google.maps.Map(hostRef.current, {
          center,
          zoom: initial ? 19 : 5,
          tilt: initial ? 55 : 0,
          heading: 0,
          mapId: configuredMapId,
          renderingType: google.maps.RenderingType?.VECTOR || "VECTOR",
          tiltInteractionEnabled: true,
          headingInteractionEnabled: false,
          streetViewControl: false,
          mapTypeControl: true,
          fullscreenControl: true,
          gestureHandling: "greedy",
          clickableIcons: false,
        });
        mapRef.current = map;

        marker = new google.maps.Marker({
          map,
          position: center,
          draggable: true,
          title: "WGS84 Building anchor",
        });
        markerRef.current = marker;

        const setCoordinate = (lat: number, lng: number) => {
          coordinateChangeRef.current(lat, lng);
        };
        mapClick = map.addListener("click", (event) => {
          if (!event.latLng) return;
          const next = { lat: event.latLng.lat(), lng: event.latLng.lng() };
          const captureId = alignmentCaptureIdRef.current;
          if (captureId) {
            alignmentTargetCaptureRef.current(captureId, next.lat, next.lng);
            return;
          }
          marker?.setPosition(next);
          setCoordinate(next.lat, next.lng);
        });
        markerDrag = marker.addListener("dragend", () => {
          if (alignmentCaptureIdRef.current) return;
          const next = marker?.getPosition();
          if (next) setCoordinate(next.lat(), next.lng());
        });
        mapIdle = map.addListener("idle", () => {
          overlay?.requestRedraw();
        });

        const scene = new THREE.Scene();
        const camera = new THREE.Camera();
        scene.add(new THREE.HemisphereLight(0xffffff, 0x66717b, 1.35));
        const sun = new THREE.DirectionalLight(0xffffff, 2);
        sun.position.set(30, -20, 60);
        scene.add(sun);
        sceneRef.current = scene;
        cameraRef.current = camera;

        const armContextTimer = () => {
          clearContextTimer();
          if (contextRestored || cancelled) return;
          contextTimer = window.setTimeout(() => {
            if (cancelled || contextRestored) return;
            setMapFailure(webglTimeoutMessage(map));
            setWebglReady(false);
            overlay?.setMap(null);
          }, WEBGL_CONTEXT_TIMEOUT_MS);
        };

        overlay = new WebGLOverlayView();
        overlayRef.current = overlay;
        overlay.onAdd = () => {
          if (cancelled) return;
          setMapFailure("");
        };
        overlay.onContextRestored = ({ gl }) => {
          if (cancelled) return;
          contextRestored = true;
          clearContextTimer();
          setMapFailure("");
          const renderer = new THREE.WebGLRenderer({
            canvas: gl.canvas as HTMLCanvasElement,
            context: gl,
            ...(gl.getContextAttributes() || {}),
          });
          renderer.autoClear = false;
          renderer.autoClearDepth = false;
          renderer.outputColorSpace = THREE.SRGBColorSpace;
          renderer.toneMapping = THREE.ACESFilmicToneMapping;
          renderer.toneMappingExposure = 0.95;
          rendererRef.current = renderer;
          setWebglReady(true);
          overlay?.requestRedraw();
        };
        overlay.onDraw = ({ gl, transformer }) => {
          const renderer = rendererRef.current;
          const drawCamera = cameraRef.current;
          const drawScene = sceneRef.current;
          if (cancelled || !renderer || !drawCamera || !drawScene) return;
          const current = coordinateRef.current;
          const anchorCoordinate = current
            ? { lat: current.latitude, lng: current.longitude }
            : center;
          drawCamera.projectionMatrix.fromArray(
            transformer.fromLatLngAltitude({
              ...anchorCoordinate,
              altitude: projectionAltitude(placementRef.current),
            }),
          );
          gl.disable(gl.SCISSOR_TEST);
          renderer.render(drawScene, drawCamera);
          renderer.resetState();
          if (nodesRef.current?.root.visible) setFrameReady(true);
        };
        overlay.onContextLost = () => {
          contextRestored = false;
          rendererRef.current?.dispose();
          rendererRef.current = null;
          setWebglReady(false);
          armContextTimer();
        };
        overlay.onRemove = () => {
          contextRestored = false;
          clearContextTimer();
          rendererRef.current?.dispose();
          rendererRef.current = null;
          setWebglReady(false);
        };
        overlay.setMap(map);
        armContextTimer();
        setMapReady(true);
      })
      .catch((reason) => {
        if (cancelled) return;
        clearContextTimer();
        setMapFailure(reason instanceof Error ? reason.message : "Integrated Geo map initialize nahi hui.");
        setMapReady(false);
      });

    return () => {
      cancelled = true;
      clearContextTimer();
      mapClick?.remove();
      mapIdle?.remove();
      markerDrag?.remove();
      marker?.setMap(null);
      for (const controlMarker of alignmentMarkersRef.current.values()) controlMarker.setMap(null);
      alignmentMarkersRef.current.clear();
      overlay?.setMap(null);
      rendererRef.current?.dispose();
      rendererRef.current = null;
      setWebglReady(false);
      mapRef.current = null;
      markerRef.current = null;
      overlayRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      nodesRef.current = null;
      if (hostRef.current) hostRef.current.replaceChildren();
    };
  }, [apiKey, projectKey, configuredMapId]);

  useEffect(() => {
    const map = mapRef.current;
    const google = (window as GeoWindow).google;
    for (const marker of alignmentMarkersRef.current.values()) marker.setMap(null);
    alignmentMarkersRef.current.clear();
    if (!mapReady || !map || !google?.maps?.Marker) return;
    for (const target of alignmentTargets) {
      const marker = new google.maps.Marker({
        map,
        position: { lat: target.latitude, lng: target.longitude },
        title: `${target.label} real-site control point`,
        label: {
          text: target.label,
          color: "#111111",
          fontSize: "11px",
          fontWeight: "800",
        },
        clickable: false,
        optimized: true,
        zIndex: 20,
      });
      alignmentMarkersRef.current.set(target.id, marker);
    }
    return () => {
      for (const marker of alignmentMarkersRef.current.values()) marker.setMap(null);
      alignmentMarkersRef.current.clear();
    };
  }, [mapReady, alignmentTargets]);

  useEffect(() => {
    markerRef.current?.setDraggable(!alignmentCaptureId);
    if (!alignmentCaptureId) return;
    mapRef.current?.moveCamera?.({ tilt: 0, heading: 0, zoom: 20 });
  }, [alignmentCaptureId]);

  useEffect(() => {
    if (!mapReady || !sceneRef.current || !modelUrl) {
      setModelReady(false);
      return;
    }

    const controller = new AbortController();
    let loadedModel: THREE.Object3D | null = null;
    let nodes: PlacementNodes | null = null;
    setModelReady(false);
    setFrameReady(false);
    setModelFailure("");
    setModelDiagnostics("");

    void loadModel(modelUrl, controller.signal)
      .then((model) => {
        if (controller.signal.aborted || !sceneRef.current) {
          disposeObject(model);
          return;
        }
        loadedModel = model;
        model.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(model);
        if (bounds.isEmpty()) throw new Error("GLB model has empty rendered geometry bounds.");
        const size = bounds.getSize(new THREE.Vector3());
        let meshCount = 0;
        let triangleCount = 0;
        model.traverse((node) => {
          if (node instanceof THREE.Mesh) {
            meshCount++;
            triangleCount += Math.floor((node.geometry.index?.count || node.geometry.getAttribute("position")?.count || 0) / 3);
          }
        });
        setModelDiagnostics(`Meshes ${meshCount} · Triangles ${triangleCount} · Bounds ${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} model units`);
        model.traverse((node) => {
          if (!(node instanceof THREE.Mesh)) return;
          // Map's external camera projection may invalidate Three.js frustum tests.
          // Keep original geometry; do not let culling silently hide plot groups.
          node.frustumCulled = false;
          node.castShadow = false;
          node.receiveShadow = false;
        });

        const root = new THREE.Group();
        root.name = "rekixo-admin-rigid-geo-building";
        const yUpToEnu = new THREE.Group();
        yUpToEnu.name = "rekixo-y-up-to-enu";
        const anchorOffset = new THREE.Group();
        anchorOffset.name = "rekixo-building-anchor-offset";
        anchorOffset.add(model);
        yUpToEnu.add(anchorOffset);
        root.add(yUpToEnu);
        root.visible = false;
        sceneRef.current.add(root);
        nodes = { root, yUpToEnu, anchorOffset };
        nodesRef.current = nodes;
        setModelReady(true);
        overlayRef.current?.requestRedraw();
      })
      .catch((reason) => {
        if (controller.signal.aborted) return;
        setModelFailure(reason instanceof Error ? reason.message : "Building preview load nahi hui.");
        setModelReady(false);
      });

    return () => {
      controller.abort();
      if (nodes && sceneRef.current) sceneRef.current.remove(nodes.root);
      if (nodesRef.current === nodes) nodesRef.current = null;
      if (loadedModel) disposeObject(loadedModel);
    };
  }, [mapReady, modelUrl]);

  useEffect(() => {
    setFrameReady(false);
    if (coordinate) {
      const next = { lat: coordinate.latitude, lng: coordinate.longitude };
      markerRef.current?.setPosition(next);
    }

    const nodes = nodesRef.current;
    if (nodes) {
      if (coordinate && anchor && placement) {
        try {
          applyPlacement(nodes, anchor, placement);
          nodes.root.visible = true;
        } catch {
          nodes.root.visible = false;
        }
      } else {
        nodes.root.visible = false;
      }
    }
    overlayRef.current?.requestRedraw();
  }, [coordinate, anchor, placement, modelReady]);

  useEffect(() => {
    let next: GeoIntegratedPreviewState;
    if (!apiKey) next = "map-key-required";
    else if (mapFailure || modelFailure) next = "error";
    else if (!mapReady || !webglReady) next = "loading-map";
    else if (!coordinate) next = "waiting-coordinate";
    else if (!modelUrl) next = "map-ready";
    else if (!modelReady) next = "loading-model";
    else if (!anchor) next = "waiting-anchor";
    else if (!placement) next = "invalid-alignment";
    else if (!frameReady) next = "loading-model";
    else next = "ready";
    previewStateChangeRef.current(next);
  }, [apiKey, mapFailure, modelFailure, mapReady, webglReady, modelReady, frameReady, modelUrl, coordinate, anchor, placement]);

  const recenter = () => {
    if (!coordinate || !mapRef.current) return;
    mapRef.current.moveCamera?.({
      center: { lat: coordinate.latitude, lng: coordinate.longitude },
      zoom: 19,
    });
    if (!mapRef.current.moveCamera) {
      mapRef.current.setCenter({ lat: coordinate.latitude, lng: coordinate.longitude });
      mapRef.current.setZoom(19);
    }
  };

  const setTopView = () => {
    mapRef.current?.moveCamera?.({ tilt: 0, heading: 0, zoom: 20 });
  };

  const setThreeDView = () => {
    mapRef.current?.moveCamera?.({ tilt: 60, heading: 0, zoom: 19 });
  };

  const saveProductionMapId = async () => {
    const mapId = mapIdInput.trim();
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(mapId)) {
      setMapIdFailure("Valid Google Maps JavaScript Vector Map ID enter karein.");
      return;
    }
    setMapIdBusy(true);
    setMapIdFailure("");
    setMapIdMessage("");
    try {
      const saved = await writeMapIdSetting(mapId);
      const next = saved.mapId?.trim() || mapId;
      setMapIdInput(next);
      setConfiguredMapId(next);
      setMapIdMessage("Production Vector Map ID saved. Integrated map reload ho rahi hai.");
    } catch (reason) {
      setMapIdFailure(
        reason instanceof Error ? reason.message : "Production Map ID save nahi hua.",
      );
    } finally {
      setMapIdBusy(false);
    }
  };

  const status = mapFailure || modelFailure || (
    !apiKey ? "Google Maps browser key save karein." :
      !configuredMapId ? "Production JavaScript Vector Map ID save karein." :
        !mapReady || !webglReady ? "Integrated 3D map initialize ho rahi hai…" :
          alignmentCaptureId ? `Capturing ${alignmentCaptureId} real-site point · click the exact ground corner` :
            !coordinate ? "Map par Building ka real WGS84 anchor set karein." :
              !modelUrl ? "Active immutable Building release select karein." :
                !modelReady ? `Immutable Building load ho rahi hai: ${modelName}` :
                  !anchor ? "Exact Building-local model anchor select karein." :
                    !placement ? "Geo alignment values valid range me karein." :
                      !frameReady ? "Current placement map par render ho rahi hai…" :
                        "Integrated Building preview ready · production vector Map ID"
  );

  return (
    <div className="geo-v2-integrated-authoring">
      <div className={`geo-v2-integrated-map-shell${alignmentCaptureId ? " geo-v2-integrated-map-shell--capture" : ""}`}>
        <div ref={hostRef} className="geo3d-map geo-v2-integrated-map" aria-label="Integrated 3D Geo authoring map" />
        <div className="geo-v2-map-tools" aria-label="Geo map view controls">
          <button type="button" disabled={!mapReady} onClick={recenter}>Recenter</button>
          <button type="button" disabled={!mapReady} onClick={setTopView}>Top</button>
          <button type="button" disabled={!mapReady} onClick={setThreeDView}>3D</button>
          <button type="button" aria-pressed={showGeometryCheck} onClick={() => setShowGeometryCheck((value) => !value)}>{showGeometryCheck ? "Hide Check" : "Geometry Check"}</button>
        </div>
        {showGeometryCheck && <div className="geo-v2-model-diagnostics" role="status">
          <b>Loaded 3D geometry · {modelName}</b>
          <span>{modelDiagnostics || "Loading geometry statistics…"}</span>
          <small>This does not prove real-world scale or completeness. Compare original FBX and canonical GLB before publish.</small>
        </div>}
        {alignmentCaptureId && (
          <div className="geo-v2-map-capture-banner" role="status">
            Click exact <strong>{alignmentCaptureId}</strong> ground corner · WGS84 anchor is locked while capture is active
          </div>
        )}
        <div className={`geo-v2-map-status${mapFailure || modelFailure ? " geo-v2-map-status--error" : ""}`} role="status">
          <span>AUTHORING PREVIEW</span>
          <strong>{status}</strong>
        </div>
      </div>
      <div className="geo-v2-map-id-config">
        <label>
          <span>PRODUCTION VECTOR MAP ID</span>
          <input
            value={mapIdInput}
            onChange={(event) => setMapIdInput(event.target.value)}
            placeholder="Google Maps JavaScript Vector Map ID"
            autoComplete="off"
          />
        </label>
        <button type="button" disabled={mapIdBusy} onClick={() => void saveProductionMapId()}>
          {mapIdBusy ? "Saving…" : "Save Map ID"}
        </button>
        <small className={mapIdFailure ? "geo-v2-map-id-note geo-v2-map-id-note--error" : "geo-v2-map-id-note"}>
          {mapIdFailure || mapIdMessage || (configuredMapId
            ? "Production Map ID configured. Verify/Publish can use the same vector runtime as Public Geo."
            : "Production JavaScript Vector Map ID is required for integrated Building rendering and Verify/Publish.")}
        </small>
      </div>
    </div>
  );
}
