import type { GeoGuidedSourcePoint } from "@rekixo/3d-engine-core";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

export type GeoReferencePoint = {
  id: string;
  label: string;
  source: GeoGuidedSourcePoint | null;
};

type Props = {
  modelUrl: string | null;
  modelName: string;
  points: GeoReferencePoint[];
  activePointId: string | null;
  onCapture(pointId: string, point: GeoGuidedSourcePoint): void;
};

type MarkerPosition = {
  id: string;
  label: string;
  left: number;
  top: number;
};

async function loadModel(modelUrl: string, signal: AbortSignal) {
  const response = await fetch(modelUrl, {
    cache: "force-cache",
    headers: { Accept: "model/gltf-binary,application/octet-stream" },
    signal,
  });
  if (!response.ok)
    throw new Error(`Building top reference load failed (${response.status}).`);
  const bytes = await response.arrayBuffer();
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  return new Promise<THREE.Object3D>((resolve, reject) => {
    loader.parse(
      bytes,
      "",
      (gltf) => resolve(gltf.scene),
      (reason) => reject(
        reason instanceof Error ? reason : new Error("Building top reference parse failed."),
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

function fitTopCamera(camera: THREE.OrthographicCamera, box: THREE.Box3, width: number, height: number) {
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const aspect = Math.max(0.25, width / Math.max(1, height));
  let viewWidth = Math.max(2, size.x * 1.22);
  let viewHeight = Math.max(2, size.z * 1.22);
  if (viewWidth / viewHeight < aspect) viewWidth = viewHeight * aspect;
  else viewHeight = viewWidth / aspect;

  camera.left = -viewWidth / 2;
  camera.right = viewWidth / 2;
  camera.top = viewHeight / 2;
  camera.bottom = -viewHeight / 2;
  const verticalSpan = Math.max(size.y, 1);
  const groundSpan = Math.max(size.x, size.z, 1);
  camera.near = 0.01;
  camera.far = verticalSpan + groundSpan * 5 + 100;
  camera.position.set(center.x, box.max.y + groundSpan * 2 + 10, center.z);
  camera.up.set(0, 0, -1);
  camera.lookAt(center.x, center.y, center.z);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}

function roundedPoint(point: THREE.Vector3): GeoGuidedSourcePoint {
  const round = (value: number) => Math.round(value * 10000) / 10000;
  return { x: round(point.x), y: round(point.y), z: round(point.z) };
}

export default function GeoBuildingTopReference({
  modelUrl,
  modelName,
  points,
  activePointId,
  onCapture,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const modelRef = useRef<THREE.Object3D | null>(null);
  const boxRef = useRef<THREE.Box3 | null>(null);
  const activePointRef = useRef(activePointId);
  const captureRef = useRef(onCapture);
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState("");
  const [viewRevision, setViewRevision] = useState(0);
  const [modelDiagnostics, setModelDiagnostics] = useState("");
  const [groundPlanePick, setGroundPlanePick] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const zoomRef = useRef(1);
  const renderRef = useRef<(() => void) | null>(null);

  activePointRef.current = activePointId;
  captureRef.current = onCapture;

  useEffect(() => {
    if (!modelUrl || !canvasRef.current || !hostRef.current) {
      setReady(false);
      return;
    }

    const controller = new AbortController();
    const canvas = canvasRef.current;
    const host = hostRef.current;
    let model: THREE.Object3D | null = null;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x07101b);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x53616f, 1.5));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(30, 80, -20);
    scene.add(sun);
    const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.01, 1000);
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    rendererRef.current = renderer;
    sceneRef.current = scene;
    cameraRef.current = camera;
    setReady(false);
    setFailure("");

    const render = () => {
      const rect = host.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      renderer.setSize(width, height, false);
      if (boxRef.current) fitTopCamera(camera, boxRef.current, width, height);
      camera.zoom = zoomRef.current;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      setViewRevision((value) => value + 1);
    };

    renderRef.current = render;
    const resizeObserver = new ResizeObserver(render);
    resizeObserver.observe(host);

    void loadModel(modelUrl, controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) {
          disposeObject(loaded);
          return;
        }
        model = loaded;
        model.traverse((node) => {
          if (!(node instanceof THREE.Mesh)) return;
          node.frustumCulled = false;
          node.castShadow = false;
          node.receiveShadow = false;
        });
        scene.add(model);
        model.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(model);
        if (box.isEmpty()) throw new Error("Building top reference geometry empty hai.");
        const size = box.getSize(new THREE.Vector3());
        let meshes = 0;
        model.traverse((node) => { if (node instanceof THREE.Mesh) meshes++; });
        setModelDiagnostics(`${meshes} meshes · X ${size.x.toFixed(2)} · Y ${size.y.toFixed(2)} · Z ${size.z.toFixed(2)} model units`);
        modelRef.current = model;
        boxRef.current = box;
        render();
        setReady(true);
      })
      .catch((reason) => {
        if (controller.signal.aborted) return;
        setFailure(reason instanceof Error ? reason.message : "Building top reference load nahi hui.");
        setReady(false);
      });

    return () => {
      controller.abort();
      resizeObserver.disconnect();
      renderRef.current = null;
      if (model) {
        scene.remove(model);
        disposeObject(model);
      }
      renderer.dispose();
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      modelRef.current = null;
      boxRef.current = null;
    };
  }, [modelUrl]);

  const markerPositions = useMemo<MarkerPosition[]>(() => {
    void viewRevision;
    const camera = cameraRef.current;
    const host = hostRef.current;
    if (!camera || !host) return [];
    const rect = host.getBoundingClientRect();
    if (!rect.width || !rect.height) return [];
    return points.flatMap((point) => {
      if (!point.source) return [];
      const projected = new THREE.Vector3(point.source.x, point.source.y, point.source.z).project(camera);
      return [{
        id: point.id,
        label: point.label,
        left: (projected.x * 0.5 + 0.5) * rect.width,
        top: (-projected.y * 0.5 + 0.5) * rect.height,
      }];
    });
  }, [points, viewRevision]);

  const capturePoint = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const pointId = activePointRef.current;
    const camera = cameraRef.current;
    const model = modelRef.current;
    if (!pointId || !camera || !model || !ready) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);
    if (groundPlanePick) {
      const groundY = boxRef.current?.min.y;
      if (groundY === undefined) return;
      const hit = new THREE.Vector3();
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -groundY);
      if (raycaster.ray.intersectPlane(plane, hit)) captureRef.current(pointId, roundedPoint(hit));
      return;
    }
    const hit = raycaster.intersectObject(model, true)[0];
    if (!hit) return;
    captureRef.current(pointId, roundedPoint(hit.point));
  };

  return (
    <div className={`geo-v2-top-reference${expanded ? " geo-v2-top-reference--expanded" : ""}`}>
      <div className="geo-v2-top-reference-head">
        <div>
          <span>CANONICAL TOP REFERENCE</span>
          <strong>{modelName}</strong>
        </div>
        <small>{activePointId ? `Click exact ${activePointId} corner` : "Select P1–P4 source point"}</small>
      </div>
      <div className="geo-v2-top-zoom">
        <button type="button" onClick={() => { zoomRef.current = Math.min(12, zoomRef.current * 1.5); renderRef.current?.(); }}>Zoom +</button>
        <button type="button" onClick={() => { zoomRef.current = Math.max(0.5, zoomRef.current / 1.5); renderRef.current?.(); }}>Zoom −</button>
        <button type="button" onClick={() => { zoomRef.current = 1; renderRef.current?.(); }}>Fit Model</button>
        <button type="button" onClick={() => setExpanded((open) => !open)}>{expanded ? "Close Model Focus" : "Expand Model"}</button>
        <label><input type="checkbox" checked={groundPlanePick} onChange={(event) => setGroundPlanePick(event.target.checked)} /> Ground-plane point</label>
      </div>
      {modelDiagnostics && <small className="geo-v2-top-diagnostics">{modelDiagnostics}</small>}
      <div ref={hostRef} className={`geo-v2-top-reference-canvas${activePointId ? " geo-v2-top-reference-canvas--capture" : ""}`}>
        <canvas
          ref={canvasRef}
          aria-label="Building top reference control-point picker"
          onPointerDown={capturePoint}
        />
        <div className="geo-v2-top-reference-axis" aria-hidden="true">
          <span>N ↑</span>
          <span>E →</span>
        </div>
        {markerPositions.map((marker) => (
          <span
            key={marker.id}
            className="geo-v2-reference-marker"
            style={{ left: marker.left, top: marker.top }}
          >
            {marker.label}
          </span>
        ))}
        {!modelUrl && <div className="geo-v2-top-reference-message">Active immutable Building preview required.</div>}
        {modelUrl && !ready && !failure && <div className="geo-v2-top-reference-message">Loading top reference…</div>}
        {failure && <div className="geo-v2-top-reference-message geo-v2-top-reference-message--error">{failure}</div>}
      </div>
      <p className="geo-v2-guided-help">
        Top view: screen right = +X, screen up = -Z. Normal pick raycasts model geometry. Ground-plane point allows an otherwise empty layout corner at model base height; confirm the chosen corner physically corresponds to the satellite image. Neither mode edits GLB.
      </p>
    </div>
  );
}
