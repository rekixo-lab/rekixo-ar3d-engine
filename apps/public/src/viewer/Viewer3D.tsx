import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import "./walkthrough-ui.css";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import {
  DEFAULT_BUILDING_ENVIRONMENT_PROFILE_V1,
  type BuildingPresentationManifestV1,
  type CameraPreset3D,
  type PublicWalkthroughGraph,
} from "@rekixo/3d-contracts";
import { createFloorExploder, enhanceArchitecturalModel } from "./realism";
import { deriveBuildingFootprintBounds, deriveBuildingFootprintOutline } from "./buildingFootprint";
import {
  deriveFloorGeometryFromModel,
  floorFocusElevation,
  floorGeometryFor,
  resolveFloorGeometry,
  type FloorGeometryInput,
  type FloorGeometryLevel,
  type ModelMeshBounds,
} from "./floorGeometry";
import {
  clampWalkPosition,
  collectWalkColliders,
  publicWalkConnections,
  walkRaycastCandidates,
  publicWalkStart,
  resolvePublicWalkStep,
  walkDelta,
  walkStartPosition,
  type WalkDirection,
} from "./walkthrough";
import WalkGraphPanel from "./WalkGraphPanel";
import {
  applyModelProfileExterior,
  loadModelProfileMaterialEnhancer,
  loadProfileExperience,
  type ExperienceMode,
  type ExperienceFeature,
  type ExperienceRuntime,
  type ModelProfileRuntime,
} from "./projectProfiles";
import {
  applyPreset,
  fitCamera,
  updateCameraDepthRange,
  type HomeView,
} from "./viewerCamera";
import { applySourcePresentation, sha256Hex, type SourcePresentation } from "./sourcePresentation";
import {
  applyBuildingPresentationMaterials,
  authoredExteriorView,
  presentationStartsAtNight,
} from "./buildingPresentationRuntime";
import { createExteriorSky } from "./exteriorSky";
import { createPremiumPresentationMotion } from "./premiumPresentationMotion";
import { exteriorCameraView, type ExteriorView } from "./exteriorCamera";
import { createPreviewBuilding } from "./viewerPreview";
import { disposeViewerObject } from "./viewerResources";
import type { FloorVisibilityController } from "./floorVisibility";

type ViewerMode = "booting" | "loading" | "model" | "demo" | "error";
type PresentationView = "default" | "aerial" | "building" | "top" | "balcony" | "context";
type ClientFloorReviewMode = "stacked" | "isolate";

interface Viewer3DProps {
  sourcePresentation?: SourcePresentation;
  buildingPresentation?: BuildingPresentationManifestV1;
  clientPresentation?: boolean;
  /** Customer public 3D views all use flat grass, independently of optional floor UI. */
  flatGrassOnly?: boolean;
  /** Show the floor-isolation strip on a customer-facing Building viewer. */
  showClientFloorControls?: boolean;
  projectLocation?: string;
  allowInteriorControls?: boolean;
  allowWalkControls?: boolean;
  modelUrl?: string;
  cameraPreset?: CameraPreset3D;
  modelLabel?: string;
  interactionMode?: "section" | "detail";
  initialWalk?: boolean;
  initialWalkFloor?: number | null;
  presentationView?: PresentationView;
  initialFloor?: number | null;
  initialExploded?: boolean;
  compactUi?: boolean;
  experienceMode?: ExperienceMode;
  visualPreset?: "default" | "reference-render";
  onFeatureSelect?: (feature: Omit<ExperienceFeature, "object">) => void;
  availableFloors?: number[];
  floorGeometry?: FloorGeometryInput[];
  walkthrough?: PublicWalkthroughGraph;
}

function isMobileDevice() {
  return (
    window.matchMedia("(max-width: 760px)").matches ||
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  );
}

export function Viewer3D({
  sourcePresentation,
  buildingPresentation,
  clientPresentation = false,
  flatGrassOnly = true,
  showClientFloorControls = false,
  projectLocation,
  allowInteriorControls = true,
  allowWalkControls = allowInteriorControls,
  modelUrl,
  cameraPreset,
  modelLabel,
  interactionMode,
  initialWalk = false,
  initialWalkFloor = null,
  presentationView = "default",
  initialFloor = null,
  initialExploded = false,
  compactUi = false,
  experienceMode = "site",
  visualPreset = "default",
  onFeatureSelect,
  availableFloors = [],
  floorGeometry = [],
  walkthrough,
}: Viewer3DProps) {
  const floorSignature = [
    availableFloors.join(","),
    floorGeometry
      .map(
        (item) =>
          `${item.floor}:${item.elevationM}:${item.topElevationM ?? ""}`,
      )
      .join("|"),
  ].join("::");
  const hostRef = useRef<HTMLDivElement>(null);
  const exteriorViewRef = useRef<((view: ExteriorView, instant?: boolean) => void) | null>(null);
  const selectedExteriorRef = useRef<ExteriorView>("hero");
  const [exteriorView, setExteriorView] = useState<ExteriorView>("hero");
  const resetRef = useRef<(() => void) | null>(null);
  const floorRef = useRef<((floor: number | null) => void) | null>(null);
  const clientFloorViewRef = useRef<((selection: number | "roof" | "top" | null) => void) | null>(null);
  const clientFloorReviewModeRef = useRef<ClientFloorReviewMode>("stacked");
  const sectionRef = useRef<((enabled: boolean) => void) | null>(null);
  const lightingRef = useRef<((night: boolean) => void) | null>(null);
  const explodeRef = useRef<((enabled: boolean) => void) | null>(null);
  const walkModeRef = useRef<((enabled: boolean, floor: number | null) => void) | null>(null);
  const walkStepRef = useRef<((direction: WalkDirection) => void) | null>(null);
  const presentationRef = useRef<((view: PresentationView, instant?: boolean) => void) | null>(null);
  const experienceRef = useRef<((mode: ExperienceMode, instant?: boolean) => void) | null>(null);
  const featureCallbackRef = useRef(onFeatureSelect);
  const enterRoomRef = useRef<((id: string) => void) | null>(null);
  const holdWalkRef = useRef<((direction: WalkDirection, held: boolean) => void) | null>(null);
  const [rooms, setRooms] = useState<Array<{ id: string; label: string; category: string }>>([]);
  const [activeRoom, setActiveRoom] = useState("");
  const [mode, setMode] = useState<ViewerMode>("booting");
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string>();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectedFloor, setSelectedFloor] = useState<number | null>(initialFloor);
  const [clientFloorSelection, setClientFloorSelection] = useState<number | "roof" | "top" | null>(null);
  const [clientFloorReviewMode, setClientFloorReviewMode] = useState<ClientFloorReviewMode>("stacked");
  const [clientFloorIds, setClientFloorIds] = useState<number[]>([]);
  const [clientRoofAvailable, setClientRoofAvailable] = useState(false);
  const [clientFloorControlsReady, setClientFloorControlsReady] = useState(false);
  const [sectionEnabled, setSectionEnabled] = useState(interactionMode === "section");
  const [nightMode, setNightMode] = useState(false);
  const [exploded, setExploded] = useState(initialExploded);
  const [walkMode, setWalkMode] = useState(false);
  const [walkNotice, setWalkNotice] = useState("");

  useEffect(() => {
    featureCallbackRef.current = onFeatureSelect;
  }, [onFeatureSelect]);

  useEffect(() => {
    const candidate = hostRef.current;
    if (candidate === null) return;
    const hostElement: HTMLDivElement = candidate;

    let disposed = false;
    setClientFloorIds([]);
    setClientRoofAvailable(false);
    setClientFloorControlsReady(false);
    setClientFloorSelection(null);
    clientFloorReviewModeRef.current = "stacked";
    setClientFloorReviewMode("stacked");
    let abortModelLoad: (() => void) | undefined;
    let animationFrame = 0;
    let activeObject: THREE.Object3D | undefined;
    let floorVisibilityController: FloorVisibilityController | undefined;
    const floorVisibilityModulePromise = clientPresentation
      ? import("./floorVisibility").catch((error) => {
          console.warn("Customer floor review module could not be loaded.", error);
          return undefined;
        })
      : Promise.resolve(undefined);
    const siteEnvironmentModulePromise = import("./siteEnvironment").catch((error) => {
      console.warn("Customer site environment module could not be loaded.", error);
      return undefined;
    });
    let homeView: HomeView | undefined;
    let floorExploder: ReturnType<typeof createFloorExploder> | undefined;
    let siteEnvironment: ReturnType<typeof import("./siteEnvironment").createArchitecturalSiteEnvironment> | undefined;
    let presentationMotion: ReturnType<typeof createPremiumPresentationMotion> | undefined;
    let siteInteractionController: ReturnType<typeof import("./siteInteractionController").createSiteInteractionController> | undefined;
    let modelProfile: ModelProfileRuntime | undefined;
    let projectExperience: ExperienceRuntime | undefined;
    let referenceExterior: ModelProfileRuntime["exterior"];
    let profileLoadGeneration = 0;
    let currentNight = false;
    let cameraTween: { start: number; duration: number; fromPosition: THREE.Vector3; toPosition: THREE.Vector3; fromTarget: THREE.Vector3; toTarget: THREE.Vector3; fromFov: number; toFov: number } | undefined;
    let walkActive = false;
    let walkYaw = 0;
    let walkPitch = 0;
    let dragPointerId: number | undefined;
    let dragX = 0;
    let dragY = 0;
    const walkKeys = new Set<string>();
    const heldDirections = new Set<WalkDirection>();
    let currentExperienceMode = experienceMode;
    let walkBounds: THREE.Box3 | undefined;
    let walkScale = 1;
    let graphWalkRoomId = "";
    let pressX = 0;
    let pressY = 0;
    let pointerTravel = 0;
    const collisionRay = new THREE.Raycaster();
    const collisionDirection = new THREE.Vector3();
    const clearInput = () => { walkKeys.clear(); heldDirections.clear(); dragPointerId = undefined; };
    holdWalkRef.current = (direction, held) => {
      if (held) heldDirections.add(direction); else heldDirections.delete(direction);
    };

    const mobile = isMobileDevice();
    const presentationAppearance = buildingPresentation?.appearance;
    // Historical V1 releases predate environment profiles. Give them the same
    // safe default at runtime without rewriting immutable release manifests.
    const environmentProfile = buildingPresentation?.environment.profile ??
      (buildingPresentation?.environment.mode === "minimal"
        ? undefined
        : DEFAULT_BUILDING_ENVIRONMENT_PROFILE_V1);
    const environmentMobileQuality =
      mobile || environmentProfile?.quality === "performance";
    const referenceVisual =
      visualPreset === "reference-render" ||
      presentationAppearance?.referenceVisual === true;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const baseFogDensity = referenceVisual ? 0.00082 : 0.0015;
    const baseSunIntensity = presentationAppearance?.sunIntensity ?? (referenceVisual ? 1.78 : 2.25);
    const baseHemisphereIntensity = presentationAppearance?.hemisphereIntensity ?? (referenceVisual ? 0.62 : 1.45);
    const baseFillIntensity = referenceVisual ? 0.10 : 0.55;
    const baseExposure = presentationAppearance?.exposure ?? (referenceVisual ? 0.84 : 0.9);
    const baseEnvironmentIntensity = referenceVisual ? 0.34 : 0.65;
    const dawnSunColor = new THREE.Color("#ffad72");
    const daySunColor = new THREE.Color(referenceVisual ? "#ffd3a6" : "#ffe4c2");
    const dawnFillColor = new THREE.Color("#f7b579");
    const dayFillColor = new THREE.Color("#99bfe0");
    const dawnFogColor = new THREE.Color("#e8b09a");
    const dayFogColor = new THREE.Color(referenceVisual ? "#71859a" : "#a9bfd0");
    const scene = new THREE.Scene();
    const sky = clientPresentation
      ? createExteriorSky(reducedMotion, environmentProfile?.motion.clouds === "drifting")
      : undefined;
    if (sky) scene.add(sky.root);
    scene.background = new THREE.Color(
      presentationAppearance?.background ?? (referenceVisual ? "#65798f" : "#8faec8"),
    );
    scene.fog = new THREE.FogExp2(
      referenceVisual ? 0x71859a : 0xa9bfd0,
      baseFogDensity,
    );
    let modelBounds: THREE.Box3 | undefined;
    let resolvedFloorGeometry: FloorGeometryLevel[] = [];
    let resolvedRoofGeometry: FloorGeometryLevel | undefined;
    let walkColliders: THREE.Object3D[] = [];

    const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 2000);
    camera.position.set(8, 6, 9);

    const renderer = new THREE.WebGLRenderer({
      antialias: referenceVisual || !environmentMobileQuality,
      alpha: false,
      powerPreference: "high-performance",
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure =
      baseExposure;
    renderer.shadowMap.enabled = referenceVisual || !environmentMobileQuality;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, environmentMobileQuality ? (referenceVisual ? 1.55 : 1.35) : 2));
    renderer.domElement.className = "viewer-canvas";
    renderer.domElement.style.touchAction = "none";
    renderer.domElement.setAttribute("aria-label", "Interactive 3D project viewer");
    hostElement.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.065;
    controls.enablePan = true;
    controls.rotateSpeed = 0.72;
    controls.zoomSpeed = 0.82;
    controls.panSpeed = 0.65;
    controls.screenSpacePanning = true;
    controls.minPolarAngle = THREE.MathUtils.degToRad(18);
    controls.maxPolarAngle = THREE.MathUtils.degToRad(clientPresentation ? 110 : 87);

    const applyWalkRotation = () => {
      const euler = new THREE.Euler(walkPitch, walkYaw, 0, "YXZ");
      camera.quaternion.setFromEuler(euler);
    };

    const hemi = new THREE.HemisphereLight(
      0xdcecff,
      0x514b45,
      baseHemisphereIntensity,
    );
    if (referenceVisual) {
      hemi.color.setHex(0xd6e4ef);
      hemi.groundColor.setHex(0x5b5148);
    }
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(
      0xffe4c2,
      baseSunIntensity,
    );
    if (referenceVisual) sun.color.setHex(0xffd3a6);
    sun.position.set(referenceVisual ? 14 : 10, referenceVisual ? 13 : 18, referenceVisual ? 17 : 12);
    sun.castShadow = renderer.shadowMap.enabled;
    sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 80;
    sun.shadow.bias = -0.00025;
    sun.shadow.normalBias = 0.018;
    scene.add(sun);

    const fill = new THREE.DirectionalLight(0x99bfe0, baseFillIntensity);
    fill.position.set(-10, 8, -7);
    scene.add(fill);

    const warmFill = new THREE.PointLight(0xffa35c, referenceVisual ? 2.6 : 0, 120, 1.65);
    warmFill.position.set(0, referenceVisual ? 11 : 18, referenceVisual ? 14 : 18);
    scene.add(warmFill);

    const pmrem = new THREE.PMREMGenerator(renderer);
    let environmentTexture: THREE.Texture | undefined;
    let environmentWorkHandle: number | undefined;
    let environmentWorkUsesIdleCallback = false;
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const buildEnvironmentTexture = () => {
      if (disposed) return;
      try {
        environmentTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        if (disposed) {
          environmentTexture.dispose();
          environmentTexture = undefined;
          return;
        }
        scene.environment = environmentTexture;
      } catch (error) {
        console.warn("Deferred 3D environment map could not be generated.", error);
      }
    };
    if (idleWindow.requestIdleCallback) {
      environmentWorkUsesIdleCallback = true;
      environmentWorkHandle = idleWindow.requestIdleCallback(buildEnvironmentTexture, { timeout: 1500 });
    } else {
      environmentWorkHandle = window.setTimeout(buildEnvironmentTexture, 200);
    }
    scene.environmentIntensity = baseEnvironmentIntensity;

    const updateSize = () => {
      const width = Math.max(hostElement.clientWidth, 1);
      const height = Math.max(hostElement.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      if (clientPresentation) exteriorViewRef.current?.(selectedExteriorRef.current, true);
    };

    const observer = new ResizeObserver(updateSize);
    observer.observe(hostElement);
    updateSize();

    const resetCamera = () => {
      cameraTween = undefined;
      if (clientPresentation && exteriorViewRef.current) {
        applyFloor(null);
        setSelectedFloor(null);
        setClientFloorSelection(null);
        selectedExteriorRef.current = "hero";
        setExteriorView("hero");
        exteriorViewRef.current("hero");
        return;
      }
      if (!homeView) return;
      camera.position.copy(homeView.position);
      camera.fov = homeView.fov;
      camera.updateProjectionMatrix();
      controls.target.copy(homeView.target);
      controls.update();
    };
    resetRef.current = resetCamera;

    const applyFloorLevel = (level: FloorGeometryLevel | null): THREE.Box3 | undefined => {
      if (!modelBounds) return undefined;
      let selectedBounds: THREE.Box3 | undefined;

      // The customer viewer uses original mesh visibility, never floor clipping.
      // The legacy/admin path intentionally keeps its current clipping behavior.
      if (clientPresentation && floorVisibilityController) {
        renderer.clippingPlanes = sectionEnabledRef.current
          ? renderer.clippingPlanes.filter((plane) => Math.abs(plane.normal.x) > 0.5)
          : [];
        selectedBounds = level === null
          ? floorVisibilityController.showAll()
          : floorVisibilityController.showFloor(level, clientFloorReviewModeRef.current);
      } else if (level === null) {
        renderer.clippingPlanes = sectionEnabledRef.current
          ? renderer.clippingPlanes.filter(
              (plane) => Math.abs(plane.normal.x) > 0.5,
            )
          : [];
      } else {
        const sectionPlanes = sectionEnabledRef.current
          ? renderer.clippingPlanes.filter(
              (plane) => Math.abs(plane.normal.x) > 0.5,
            )
          : [];
        renderer.clippingPlanes = [
          ...sectionPlanes,
          new THREE.Plane(new THREE.Vector3(0, 1, 0), -level.elevationM),
          new THREE.Plane(new THREE.Vector3(0, -1, 0), level.topElevationM),
        ];
      }

      if (level && !walkActive && currentExperienceMode === "site") {
        controls.target.y = floorFocusElevation(level);
        controls.update();
      }
      return selectedBounds;
    };

    const applyFloor = (floor: number | null) => {
      if (floor === null) {
        applyFloorLevel(null);
        return;
      }
      const level = floorGeometryFor(resolvedFloorGeometry, floor);
      if (level) applyFloorLevel(level);
    };

    const sectionEnabledRef = { current: interactionMode === "section" };

    const applySection = (enabled: boolean) => {
      sectionEnabledRef.current = enabled;
      if (!modelBounds) return;
      const centerX = (modelBounds.min.x + modelBounds.max.x) / 2;
      const floorPlanes = renderer.clippingPlanes.filter((plane) => Math.abs(plane.normal.y) > 0.5);
      renderer.clippingPlanes = enabled
        ? [...floorPlanes, new THREE.Plane(new THREE.Vector3(-1, 0, 0), centerX)]
        : floorPlanes;
    };

    const windowMaterials = new Map<THREE.MeshStandardMaterial, { color: THREE.Color; intensity: number }>();
    const applyLighting = (night: boolean) => {
      currentNight = night;
      scene.background = new THREE.Color(
        night
          ? 0x101827
          : presentationAppearance?.background ?? (referenceVisual ? "#65798f" : "#8faec8"),
      );
      scene.fog = new THREE.FogExp2(
        night ? 0x182130 : referenceVisual ? 0x71859a : 0xa9bfd0,
        night ? 0.0025 : baseFogDensity,
      );
      hemi.intensity = night
        ? 0.72
        : baseHemisphereIntensity;
      sun.color.setHex(night ? 0xb1caff : referenceVisual ? 0xffd3a6 : 0xffe4c2);
      fill.color.setHex(night ? 0xffb370 : 0x99bfe0);
      sun.intensity = night
        ? 0.38
        : baseSunIntensity;
      fill.intensity = night ? 0.3 : baseFillIntensity;
      warmFill.intensity = night ? 7 : referenceVisual ? 2.6 : 0;
      renderer.toneMappingExposure = night
        ? Math.min(presentationAppearance?.exposure ?? 0.82, 0.9)
        : baseExposure;
      scene.environmentIntensity = night ? 0.42 : baseEnvironmentIntensity;
      for (const [material, original] of windowMaterials) {
        material.emissive.copy(night ? new THREE.Color("#ffbe72") : original.color);
        material.emissiveIntensity = night ? 0.28 : original.intensity;
      }
      sky?.setNight(night);
      siteEnvironment?.setNight(night);
      projectExperience?.setNight(night);
      referenceExterior?.setNight(night);
      if (referenceExterior) scene.background = night ? referenceExterior.eveningSky : referenceExterior.daylightSky;
    };

    const graphRoom = (id: string) =>
      walkthrough?.rooms.find((room) => room.id === id);

    const enterGraphRoom = (id: string, preserveDirection = false) => {
      if (clientPresentation) floorVisibilityController?.showAll();
      if (!walkthrough) return false;
      const room = graphRoom(id);
      if (!room) return false;
      const start = publicWalkStart(walkthrough, room);
      const centerX =
        room.boundary.reduce((sum, point) => sum + point[0], 0) /
        room.boundary.length;
      const centerZ =
        room.boundary.reduce((sum, point) => sum + point[1], 0) /
        room.boundary.length;
      graphWalkRoomId = room.id;
      walkActive = true;
      setWalkMode(true);
      setActiveRoom(room.id);
      setWalkNotice(
        `${room.unit} · ${room.name} · ${publicWalkConnections(
          walkthrough,
          room.id,
        ).length} reviewed door connection${publicWalkConnections(
          walkthrough,
          room.id,
        ).length === 1 ? "" : "s"}`,
      );
      clearInput();
      cameraTween = undefined;
      floorExploder?.reset();
      renderer.clippingPlanes = [];
      controls.enabled = false;
      walkScale = 1 / Math.max(walkthrough.metresPerUnit, 0.0001);
      walkBounds = modelBounds;
      walkColliders = [];
      if (activeObject) activeObject.visible = true;
      if (siteEnvironment) siteEnvironment.root.visible = false;
      if (projectExperience) {
        projectExperience.setWalk(false);
        projectExperience.root.visible = false;
      }
      camera.position.set(
        start.x,
        room.elevation + 1.6 / Math.max(walkthrough.metresPerUnit, 0.0001),
        start.z,
      );
      camera.near = Math.max(0.015 * walkScale, 0.005);
      camera.fov = 68;
      camera.updateProjectionMatrix();
      if (!preserveDirection) {
        walkYaw = Math.atan2(
          camera.position.x - centerX,
          camera.position.z - centerZ,
        );
        walkPitch = -0.12;
      }
      applyWalkRotation();
      return true;
    };

    const enterWalkMode = (enabled: boolean, floor: number | null) => {
      if (enabled && clientPresentation) floorVisibilityController?.showAll();
      walkActive = enabled;
      setWalkMode(enabled);
      cameraTween = undefined;
      clearInput();
      controls.enabled = !enabled;

      if (!enabled) {
        projectExperience?.setWalk(false);
        if (currentExperienceMode === "interior") experienceRef.current?.("interior", true);
        else resetCamera();
        return;
      }

      if (!modelBounds) return;
      floorExploder?.reset();
      renderer.clippingPlanes = [];

      if (walkthrough?.rooms.length) {
        const current = graphRoom(graphWalkRoomId || activeRoom);
        let target = current;
        if (!target && floor !== null) {
          const level = floorGeometryFor(resolvedFloorGeometry, floor);
          if (level)
            target = [...walkthrough.rooms].sort(
              (left, right) =>
                Math.abs(left.elevation - level.elevationM) -
                Math.abs(right.elevation - level.elevationM),
            )[0];
        }
        target ??= walkthrough.rooms[0];
        if (target && enterGraphRoom(target.id)) return;
      }

      camera.position.copy(
        walkStartPosition(modelBounds, floor, resolvedFloorGeometry),
      );
      walkBounds = modelBounds;
      walkScale = 1;
      walkColliders = collectWalkColliders(
        currentExperienceMode === "interior"
          ? projectExperience?.root
          : activeObject,
      );

      if (currentExperienceMode === "interior" && projectExperience) {
        const defaultRoomId =
          modelProfile?.defaultInteriorRoomId ?? projectExperience.rooms[0]?.id;
        if (defaultRoomId) {
          enterRoom(defaultRoomId);
          return;
        }
      }
      const center = modelBounds.getCenter(new THREE.Vector3());
      const direction = center.sub(camera.position).normalize();
      walkYaw = Math.atan2(-direction.x, -direction.z);
      walkPitch = Math.asin(THREE.MathUtils.clamp(direction.y, -0.92, 0.92));
      applyWalkRotation();
    };

    const enterRoom = (id: string) => {
      if (clientPresentation) floorVisibilityController?.showAll();
      if (walkthrough && graphRoom(id)) {
        enterGraphRoom(id);
        return;
      }
      if (!projectExperience || currentExperienceMode !== "interior") return;
      const entry = projectExperience.roomEntry(id);
      if (!entry) return;
      clearInput();
      cameraTween = undefined;
      floorExploder?.reset();
      renderer.clippingPlanes = [];
      controls.enabled = false;
      projectExperience.setWalk(true);
      walkActive = true;
      walkScale = entry.scale;
      walkBounds = projectExperience.focus("interior").box;
      walkColliders = collectWalkColliders(projectExperience.root);
      camera.position.copy(entry.point);
      camera.near = Math.max(0.015 * walkScale, 0.005);
      camera.fov = 68;
      camera.updateProjectionMatrix();
      walkYaw = Math.PI;
      walkPitch = -0.18;
      applyWalkRotation();
      setActiveRoom(id);
      setWalkMode(true);
    };
    enterRoomRef.current = enterRoom;

    // Swept, short steps at torso and eye level; slide along walls by trying
    // axes independently. Invisible cutaway/ceiling meshes do not obstruct.
    const moveWalk = (direction: WalkDirection, distance: number) => {
      if (!walkActive || !walkBounds) return;
      const delta = walkDelta(walkYaw, direction, distance);

      if (walkthrough && graphWalkRoomId) {
        const room = graphRoom(graphWalkRoomId);
        if (!room) return;
        const fromX = camera.position.x;
        const fromZ = camera.position.z;
        let result = resolvePublicWalkStep(
          walkthrough,
          room,
          fromX,
          fromZ,
          fromX + delta.x,
          fromZ + delta.z,
        );
        if (
          result.roomId === room.id &&
          result.x === fromX &&
          result.z === fromZ
        ) {
          const slideX = resolvePublicWalkStep(
            walkthrough,
            room,
            fromX,
            fromZ,
            fromX + delta.x,
            fromZ,
          );
          if (
            slideX.roomId !== room.id ||
            slideX.x !== fromX ||
            slideX.z !== fromZ
          )
            result = slideX;
          else
            result = resolvePublicWalkStep(
              walkthrough,
              room,
              fromX,
              fromZ,
              fromX,
              fromZ + delta.z,
            );
        }
        camera.position.x = result.x;
        camera.position.z = result.z;
        if (result.roomId !== room.id && result.openingId) {
          const destination = graphRoom(result.roomId);
          graphWalkRoomId = result.roomId;
          setActiveRoom(result.roomId);
          if (destination) {
            camera.position.y =
              destination.elevation +
              1.6 / Math.max(walkthrough.metresPerUnit, 0.0001);
            const connections = publicWalkConnections(
              walkthrough,
              destination.id,
            ).length;
            setWalkNotice(
              `Entered ${destination.unit} · ${destination.name} through reviewed door · ${connections} connection${connections === 1 ? "" : "s"}`,
            );
          }
        }
        return;
      }

      const obstacles = walkColliders;
      const radius = 0.18 * walkScale;
      for (const axis of ["x", "z"] as const) {
        const amount = delta[axis];
        if (!amount) continue;
        collisionDirection.set(0, 0, 0);
        collisionDirection[axis] = Math.sign(amount);
        let blocked = false;
        for (const level of [0, -0.8 * walkScale, -1.3 * walkScale]) {
          for (const offset of [-radius, 0, radius]) {
            const origin = camera.position.clone();
            origin.y += level;
            origin[axis === "x" ? "z" : "x"] += offset;
            collisionRay.set(origin, collisionDirection);
            collisionRay.near = 0;
            collisionRay.far = Math.abs(amount) + radius;
            const candidates = walkRaycastCandidates(
              obstacles,
              origin,
              collisionDirection,
              Math.abs(amount) + radius,
              radius,
            );
            if (collisionRay.intersectObjects(candidates, false).length) {
              blocked = true;
              break;
            }
          }
          if (blocked) break;
        }
        if (!blocked) camera.position[axis] += amount;
      }
      clampWalkPosition(camera.position, walkBounds);
    };

    const stepWalk = (direction: WalkDirection) => {
      if (!walkActive || !modelBounds) return;
      moveWalk(direction, 0.15 * walkScale);
    };

    walkModeRef.current = enterWalkMode;
    walkStepRef.current = stepWalk;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!walkActive) return;
      if (event.target instanceof HTMLElement && /INPUT|SELECT|TEXTAREA/.test(event.target.tagName)) return;
      if (event.key === "Escape") { enterWalkMode(false, null); return; }
      const key = event.key.toLowerCase();
      if (["w","a","s","d","arrowup","arrowdown","arrowleft","arrowright"].includes(key)) {
        event.preventDefault();
        walkKeys.add(key);
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      walkKeys.delete(event.key.toLowerCase());
    };
    const handlePointerDown = (event: PointerEvent) => {
      pressX = event.clientX;
      pressY = event.clientY;
      pointerTravel = 0;
      if (!walkActive) return;
      if (dragPointerId !== undefined || event.button !== 0) return;
      dragPointerId = event.pointerId;
      dragX = event.clientX;
      dragY = event.clientY;
      renderer.domElement.setPointerCapture?.(event.pointerId);
    };
    const handlePointerMove = (event: PointerEvent) => {
      pointerTravel = Math.max(pointerTravel, Math.hypot(event.clientX - pressX, event.clientY - pressY));
      if (!walkActive || dragPointerId !== event.pointerId) return;
      const dx = event.clientX - dragX;
      const dy = event.clientY - dragY;
      dragX = event.clientX;
      dragY = event.clientY;
      walkYaw -= dx * 0.004;
      walkPitch = THREE.MathUtils.clamp(walkPitch - dy * 0.003, -1.15, 1.15);
      applyWalkRotation();
    };
    const handlePointerUp = (event: PointerEvent) => {
      if (dragPointerId === event.pointerId) {
        dragPointerId = undefined;
        if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
      }
    };

    window.addEventListener("keydown", handleKeyDown, { passive: false });
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", clearInput);
    document.addEventListener("visibilitychange", clearInput);
    renderer.domElement.addEventListener("pointerdown", handlePointerDown);
    renderer.domElement.addEventListener("pointermove", handlePointerMove);
    renderer.domElement.addEventListener("pointerup", handlePointerUp);
    renderer.domElement.addEventListener("pointercancel", handlePointerUp);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const handleFeatureClick = (event: MouseEvent) => {
      if (walkActive || !projectExperience || pointerTravel > 6) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / Math.max(rect.height, 1)) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObject(projectExperience.root, true);
      for (const hit of hits) {
        let ancestor: THREE.Object3D | null = hit.object;
        let visible = true;
        while (ancestor) { if (!ancestor.visible) visible = false; ancestor = ancestor.parent; }
        if (!visible) continue;
        let current: THREE.Object3D | null = hit.object;
        while (current) {
          const id = current.userData.experienceFeatureId as string | undefined;
          if (id) {
            const found = projectExperience.features.find((item) => item.id === id);
            if (found) {
              if (currentExperienceMode === "interior" && projectExperience.rooms.some((room) => room.id === id)) enterRoom(id);
              featureCallbackRef.current?.({
                id: found.id,
                label: found.label,
                category: found.category,
                description: found.description,
              });
              renderer.domElement.classList.add("viewer-canvas--feature-selected");
              window.setTimeout(() => renderer.domElement.classList.remove("viewer-canvas--feature-selected"), 220);
              return;
            }
          }
          current = current.parent;
        }
      }
    };
    renderer.domElement.addEventListener("click", handleFeatureClick);

    floorRef.current = applyFloor;
    sectionRef.current = applySection;
    lightingRef.current = applyLighting;

    const mountObject = async (object: THREE.Object3D, usePreset: boolean) => {
      const [floorVisibilityModule, siteEnvironmentModule] = await Promise.all([
        floorVisibilityModulePromise,
        siteEnvironmentModulePromise,
      ]);
      if (disposed) {
        disposeViewerObject(object);
        return;
      }
      floorVisibilityController?.dispose();
      floorVisibilityController = undefined;
      if (activeObject) {
        referenceExterior?.dispose();
        scene.remove(activeObject);
        disposeViewerObject(activeObject);
      }
      activeObject = object;
      scene.add(object);
      object.updateMatrixWorld(true);
      modelBounds = new THREE.Box3().setFromObject(object);
      modelProfile = applyModelProfileExterior(object, referenceVisual);
      referenceExterior = modelProfile?.exterior;
      const configuredFloorGeometry = resolveFloorGeometry({
        floorIds: availableFloors,
        minY: modelBounds.min.y,
        maxY: modelBounds.max.y,
        scene: floorGeometry,
        profile: modelProfile?.floorGeometry,
      });
      const meshBounds: ModelMeshBounds[] = [];
      const worldBoundsByMesh = new Map<THREE.Mesh, THREE.Box3>();
      let includedSourceSite = false;
      object.traverse((node) => {
        if (node.userData.sourceGeometry?.siteGeometry === "included-in-source")
          includedSourceSite = true;
        if (!(node instanceof THREE.Mesh)) return;
        const meshBox = new THREE.Box3().setFromObject(node);
        worldBoundsByMesh.set(node, meshBox);
        if (meshBox.isEmpty()) return;
        meshBounds.push({
          minX: meshBox.min.x,
          minY: meshBox.min.y,
          minZ: meshBox.min.z,
          maxX: meshBox.max.x,
          maxY: meshBox.max.y,
          maxZ: meshBox.max.z,
        });
      });
      // First detect physical floor bands without assuming that project metadata
      // already has the same number of floor IDs as the uploaded model.
      const detectedFloorGeometry = deriveFloorGeometryFromModel({
        modelBounds: {
          minX: modelBounds.min.x,
          minY: modelBounds.min.y,
          minZ: modelBounds.min.z,
          maxX: modelBounds.max.x,
          maxY: modelBounds.max.y,
          maxZ: modelBounds.max.z,
        },
        meshBounds,
      });
      // Keep explicit project IDs only when the configuration count matches the
      // source-detected bands. Stale/missing IDs must not hide valid model floors.
      const modelDerivedFloorGeometry =
        availableFloors.length === detectedFloorGeometry.floors.length
          ? {
              ...detectedFloorGeometry,
              floors: detectedFloorGeometry.floors.map((level, index) => ({
                ...level,
                floor: availableFloors[index],
              })),
            }
          : detectedFloorGeometry;
      const explicitGeometryMatchesDetectedCount =
        configuredFloorGeometry.length > 0 &&
        (detectedFloorGeometry.floors.length === 0 ||
          configuredFloorGeometry.length === detectedFloorGeometry.floors.length);
      resolvedFloorGeometry = explicitGeometryMatchesDetectedCount
        ? configuredFloorGeometry
        : modelDerivedFloorGeometry.floors;
      resolvedRoofGeometry = modelDerivedFloorGeometry.roof
        ? {
            ...modelDerivedFloorGeometry.roof,
            floor: resolvedFloorGeometry.length,
          }
        : undefined;
      if (referenceExterior) {
        scene.background = referenceExterior.daylightSky;
        sun.position.set(-16, 30, 16);
        sun.target.position.set(13, 8, -12);
        scene.add(sun.target);
        Object.assign(sun.shadow.camera, { left: -25, right: 25, top: 28, bottom: -28 });
        sun.shadow.camera.updateProjectionMatrix();
      }
      const profileGeneration = ++profileLoadGeneration;
      const materialEnhancerPromise =
        loadModelProfileMaterialEnhancer(modelProfile);
      enhanceArchitecturalModel(object, renderer, referenceVisual);
      // Capture the post-enhancement materials so All/reset restores the actual customer presentation.
      floorVisibilityController = floorVisibilityModule
        ? floorVisibilityModule.createFloorVisibilityController(object, worldBoundsByMesh)
        : undefined;
      if (clientPresentation && floorVisibilityController) {
        // Do not display a floor control unless the published model has original
        // meshes that can actually be shown for that level.
        resolvedFloorGeometry = resolvedFloorGeometry.filter((level) =>
          floorVisibilityController!.hasFloor(level),
        );
        if (resolvedRoofGeometry && !floorVisibilityController.hasFloor(resolvedRoofGeometry))
          resolvedRoofGeometry = undefined;
        else if (resolvedRoofGeometry)
          resolvedRoofGeometry = { ...resolvedRoofGeometry, floor: resolvedFloorGeometry.length };
        setClientFloorIds(resolvedFloorGeometry.map((level) => level.floor));
        setClientRoofAvailable(Boolean(resolvedRoofGeometry));
        setClientFloorControlsReady(resolvedFloorGeometry.length > 0);
      }

      windowMaterials.clear();
      if (clientPresentation) object.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
          if (material instanceof THREE.MeshStandardMaterial && /glass|window/i.test(material.name) && !/tile/i.test(material.name)) windowMaterials.set(material, { color: material.emissive.clone(), intensity: material.emissiveIntensity });
        }
      });
      void materialEnhancerPromise
        .then((enhancer) => {
          if (
            !enhancer ||
            disposed ||
            profileGeneration !== profileLoadGeneration ||
            activeObject !== object
          )
            return;
          enhancer(object, renderer, referenceVisual);
        })
        .catch((error) => {
          console.error("Project material profile load failed", error);
        });
      floorExploder = createFloorExploder(
        object,
        modelBounds,
        resolvedFloorGeometry,
      );
      explodeRef.current = (enabled) => floorExploder?.setExploded(enabled);

      homeView =
        usePreset && cameraPreset
          ? applyPreset(cameraPreset, camera, controls)
          : fitCamera(object, camera, controls);

      const bounds = modelBounds;
      // Frame the measured building, not the much wider site/paving mesh.
      const cameraBounds = modelProfile?.cameraBounds ?? bounds;
      const buildingFootprintBounds = deriveBuildingFootprintBounds(
        object,
        bounds,
        modelProfile?.cameraBounds,
      );
      const buildingFootprintOutline = deriveBuildingFootprintOutline(
        object,
        buildingFootprintBounds,
      );
      const sphere = cameraBounds.getBoundingSphere(new THREE.Sphere());
      const sizeForView = bounds.getSize(new THREE.Vector3());
      const centerForView = sphere.center.clone();
      const radiusForView = Math.max(sphere.radius, 1);
      if (referenceVisual) {
        controls.minDistance = Math.max(radiusForView * 0.30, 1.25);
        controls.maxDistance = Math.max(radiusForView * 5.5, 28);
      }

      presentationMotion?.dispose();
      presentationMotion = undefined;
      siteInteractionController?.dispose();
      siteInteractionController = undefined;
      siteEnvironment?.dispose();
      if (siteEnvironment) scene.remove(siteEnvironment.root);
      const additiveBaseline = environmentProfile?.baseline === "always";
      if (siteEnvironmentModule) {
        siteEnvironment = siteEnvironmentModule.createArchitecturalSiteEnvironment(
          bounds,
          renderer,
          environmentMobileQuality,
          clientPresentation &&
            (additiveBaseline || (!environmentProfile && buildingPresentation?.environment.mode !== "minimal" && (buildingPresentation?.environment.genericDressing ?? true))) &&
            (!includedSourceSite || additiveBaseline),
          floorGeometry.find((level) => level.floor === 0 && Number.isFinite(level.elevationM))?.elevationM ?? modelProfile?.floorGeometry?.find((level) => level.floor === 0)?.elevationM,
          additiveBaseline ? "always" : "empty-only",
          environmentProfile?.preset === "cinematic-exterior" && environmentProfile.motion.water !== "off",
          includedSourceSite,
          environmentProfile?.landscape ?? "auto",
          clientPresentation, // Restore grass cover in all customer camera views.
          buildingFootprintBounds,
          buildingFootprintOutline,
          flatGrassOnly, // Flat grass across standard, premium twin and all public 3D modules.
        );
        scene.add(siteEnvironment.root);
        if (
          clientPresentation &&
          environmentProfile?.preset === "cinematic-exterior" &&
          environmentProfile.motion.vegetation !== "off"
        ) {
          presentationMotion = createPremiumPresentationMotion(siteEnvironment.root, {
            reducedMotion,
            mobile: environmentMobileQuality,
          });
        }
        if (
          clientPresentation &&
          environmentProfile?.preset === "cinematic-exterior"
        ) {
          void import("./siteInteractionController")
            .then(({ createSiteInteractionController }) => {
              if (disposed || activeObject !== object || !siteEnvironment) return;
              siteInteractionController?.dispose();
              siteInteractionController = createSiteInteractionController(
                siteEnvironment.root,
                camera,
                renderer.domElement,
                reducedMotion,
              );
            })
            .catch((error) => {
              console.warn("Customer site interaction module could not be loaded.", error);
            });
        }
      }
      if (clientPresentation) {
        const span = Math.max(sizeForView.x, sizeForView.y, sizeForView.z, 1);
        sun.position.copy(centerForView).add(new THREE.Vector3(span * -0.7, span * 1.2, span));
        sun.target.position.copy(centerForView);
        scene.add(sun.target);
        Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 0.1, far: span * 5 });
        sun.shadow.camera.updateProjectionMatrix();
        warmFill.position.set(centerForView.x, bounds.min.y + sizeForView.y * 0.15, bounds.max.z + span * 0.1);
        warmFill.distance = span * 3;
      }
      walkColliders = collectWalkColliders(object);

      projectExperience?.dispose();
      if (projectExperience) scene.remove(projectExperience.root);
      projectExperience = undefined;
      setRooms(
        walkthrough?.rooms.length
          ? walkthrough.rooms.map((room) => ({
              id: room.id,
              label: room.name,
              category: room.unit,
            }))
          : [],
      );
      const preserveSourceSite = includedSourceSite;
      const experiencePromise = loadProfileExperience(modelProfile, bounds, {
        mobile,
        referenceVisual,
        preserveSourceSite,
      });

      const viewTarget = (view: PresentationView) => {
        if (view === "aerial") {
          if (referenceVisual) return {
            position: new THREE.Vector3(
              centerForView.x - radiusForView * (mobile ? 0.84 : 0.96),
              bounds.min.y + sizeForView.y * (mobile ? 0.20 : 0.23),
              centerForView.z + radiusForView * (mobile ? 0.98 : 1.10),
            ),
            target: new THREE.Vector3(
              centerForView.x + sizeForView.x * 0.01,
              bounds.min.y + sizeForView.y * 0.50,
              centerForView.z,
            ),
            fov: mobile ? 30 : 29,
          };
          return {
            position: new THREE.Vector3(centerForView.x + radiusForView * 1.65, centerForView.y + radiusForView * 1.45, centerForView.z + radiusForView * 1.65),
            target: centerForView.clone().add(new THREE.Vector3(0, sizeForView.y * 0.08, 0)),
            fov: 36,
          };
        }
        if (view === "top") return {
          position: new THREE.Vector3(centerForView.x, bounds.max.y + radiusForView * 1.55, centerForView.z + radiusForView * 0.06),
          target: centerForView.clone(),
          fov: 34,
        };
        if (view === "balcony") return {
          position: new THREE.Vector3(bounds.max.x + radiusForView * 0.45, bounds.min.y + sizeForView.y * 0.62, bounds.max.z + radiusForView * 0.28),
          target: new THREE.Vector3(centerForView.x, bounds.min.y + sizeForView.y * 0.52, centerForView.z),
          fov: 38,
        };
        if (view === "context") return {
          position: new THREE.Vector3(centerForView.x + radiusForView * 2.25, centerForView.y + radiusForView * 1.2, centerForView.z + radiusForView * 2.25),
          target: centerForView.clone(),
          fov: 42,
        };
        if (view === "building") return {
          position: referenceVisual
            ? new THREE.Vector3(
                centerForView.x - radiusForView * (mobile ? 0.78 : 0.88),
                bounds.min.y + sizeForView.y * (mobile ? 0.18 : 0.21),
                centerForView.z + radiusForView * (mobile ? 0.93 : 1.02),
              )
            : new THREE.Vector3(centerForView.x + radiusForView * 1.15, centerForView.y + radiusForView * 0.58, centerForView.z + radiusForView * 1.15),
          target: referenceVisual
            ? new THREE.Vector3(centerForView.x, bounds.min.y + sizeForView.y * 0.51, centerForView.z)
            : centerForView.clone().add(new THREE.Vector3(0, sizeForView.y * 0.08, 0)),
          fov: referenceVisual ? (mobile ? 29 : 28) : 39,
        };
        return homeView ? { position: homeView.position.clone(), target: homeView.target.clone(), fov: homeView.fov } : undefined;
      };

      const setView = (view: PresentationView, instant = false) => {
        if (walkActive || currentExperienceMode === "interior") return;
        const targetView = viewTarget(view);
        if (!targetView) return;
        // Preserve the reference angle while fitting the complete source model
        // inside both landscape and narrow portrait viewports.
        if (referenceVisual && (view === "aerial" || view === "building")) {
          const verticalHalf = THREE.MathUtils.degToRad(targetView.fov / 2);
          const horizontalHalf = Math.atan(Math.tan(verticalHalf) * camera.aspect);
          const distance = radiusForView / Math.sin(Math.min(verticalHalf, horizontalHalf)) * 1.08;
          const direction = targetView.position.clone().sub(targetView.target).normalize();
          if (referenceExterior) direction.set(-0.90, -0.20, 0.44).normalize();
          let fitDistance = distance;
          if (referenceExterior) {
            const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), direction).normalize();
            const up = new THREE.Vector3().crossVectors(direction, right).normalize();
            fitDistance = 0;
            for (const x of [cameraBounds.min.x, cameraBounds.max.x]) {
              for (const y of [cameraBounds.min.y, cameraBounds.max.y]) {
                for (const z of [cameraBounds.min.z, cameraBounds.max.z]) {
                  const offset = new THREE.Vector3(x, y, z).sub(targetView.target);
                  fitDistance = Math.max(fitDistance, offset.dot(direction) + Math.abs(offset.dot(right)) / Math.tan(horizontalHalf), offset.dot(direction) + Math.abs(offset.dot(up)) / Math.tan(verticalHalf));
                }
              }
            }
            fitDistance *= 1.13;
          }
          targetView.position.copy(targetView.target).addScaledVector(direction, fitDistance);
          if (referenceExterior) targetView.position.y = Math.max(1.6, targetView.position.y);
          controls.maxDistance = Math.max(controls.maxDistance, distance * 2);
        }
        controls.enabled = true;
        if (instant) {
          camera.position.copy(targetView.position);
          controls.target.copy(targetView.target);
          camera.fov = targetView.fov;
          camera.updateProjectionMatrix();
          controls.update();
          cameraTween = undefined;
          return;
        }
        cameraTween = {
          start: performance.now(),
          duration: 900,
          fromPosition: camera.position.clone(),
          toPosition: targetView.position,
          fromTarget: controls.target.clone(),
          toTarget: targetView.target,
          fromFov: camera.fov,
          toFov: targetView.fov,
        };
      };
      presentationRef.current = setView;
      exteriorViewRef.current = (view, instant = false) => {
        if (!homeView || walkActive || currentExperienceMode !== "site") return;
        const next = authoredExteriorView(buildingPresentation, view) ??
          exteriorCameraView(
            cameraBounds,
            homeView,
            camera.aspect,
            view,
            sourcePresentation?.heroDirection,
          );
        controls.minDistance = Math.max(radiusForView * 0.15, 1);
        controls.maxDistance = Math.max(controls.maxDistance, next.position.distanceTo(next.target) * 3);
        if (instant || reducedMotion) {
          cameraTween = undefined;
          camera.position.copy(next.position);
          controls.target.copy(next.target);
          camera.fov = next.fov;
          camera.updateProjectionMatrix();
          controls.update();
        } else {
          cameraTween = { start: performance.now(), duration: 850, fromPosition: camera.position.clone(), toPosition: next.position, fromTarget: controls.target.clone(), toTarget: next.target, fromFov: camera.fov, toFov: next.fov };
        }
      };
      clientFloorViewRef.current = (selection) => {
        if (!modelBounds || walkActive || currentExperienceMode !== "site") return;
        cameraTween = undefined;

        if (selection === null) {
          applyFloor(null);
          setSelectedFloor(null);
          setClientFloorSelection(null);
          const returnView = selectedExteriorRef.current;
          setExteriorView(returnView);
          exteriorViewRef.current?.(returnView);
          return;
        }

        if (selection === "top") {
          applyFloor(null);
          setSelectedFloor(null);
          setClientFloorSelection("top");
          setView("top");
          return;
        }

        const level = selection === "roof"
          ? resolvedRoofGeometry
          : floorGeometryFor(resolvedFloorGeometry, selection);
        if (!level) return;

        // Return the actual original meshes assigned to this floor and frame
        // that geometry, not the whole building, in the top camera.
        const selectedBounds = applyFloorLevel(level);
        setSelectedFloor(typeof selection === "number" ? selection : null);
        setClientFloorSelection(selection);

        const bounds =
          selectedBounds && !selectedBounds.isEmpty()
            ? selectedBounds
            : modelBounds;
        const size = bounds.getSize(new THREE.Vector3());
        const center = bounds.getCenter(new THREE.Vector3());
        const fov = 34;
        const verticalTangent = Math.tan(THREE.MathUtils.degToRad(fov / 2));
        const horizontalTangent = verticalTangent * Math.max(camera.aspect, 0.25);
        const floorHeight = Math.max(level.topElevationM - level.elevationM, 0.1);
        const stackedView = clientFloorReviewModeRef.current === "stacked";
        const fitDistance = Math.max(
          size.x / (2 * horizontalTangent),
          size.z / (2 * verticalTangent),
          stackedView ? size.y / (2 * verticalTangent) : 0,
          floorHeight * 2,
          1.5,
        ) * (stackedView ? 1.18 : 1.12);
        // In Stacked View, centre the camera on the visible lower-to-selected
        // stack and use an oblique angle so connected lower storeys are visible.
        // Isolate View remains near top-down for interior/layout inspection.
        const targetY = stackedView
          ? (bounds.min.y + level.topElevationM) / 2
          : floorFocusElevation(level);
        const target = new THREE.Vector3(center.x, targetY, center.z);
        const position = new THREE.Vector3(
          center.x,
          level.topElevationM + fitDistance * (stackedView ? 0.92 : 1),
          center.z + fitDistance * (stackedView ? 0.68 : 0.025),
        );
        controls.minDistance = Math.max(0.2, Math.min(floorHeight * 0.45, fitDistance * 0.15));
        controls.maxDistance = Math.max(controls.maxDistance, fitDistance * 4);

        if (reducedMotion) {
          camera.position.copy(position);
          controls.target.copy(target);
          camera.fov = fov;
          camera.updateProjectionMatrix();
          controls.update();
          cameraTween = undefined;
        } else {
          cameraTween = {
            start: performance.now(),
            duration: 750,
            fromPosition: camera.position.clone(),
            toPosition: position,
            fromTarget: controls.target.clone(),
            toTarget: target,
            fromFov: camera.fov,
            toFov: fov,
          };
        }
      };
      if (clientPresentation) {
        const startsAtNight = presentationStartsAtNight(buildingPresentation);
        if (startsAtNight) {
          applyLighting(true);
          setNightMode(true);
        }
        selectedExteriorRef.current = "hero";
        setExteriorView("hero");
        exteriorViewRef.current("hero", true);
        if (!reducedMotion) {
          const destination = camera.position.clone();
          const reveal = destination.clone().sub(controls.target).applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.055).multiplyScalar(1.06).add(controls.target);
          camera.position.copy(reveal);
          cameraTween = { start: performance.now(), duration: 1800, fromPosition: reveal, toPosition: destination, fromTarget: controls.target.clone(), toTarget: controls.target.clone(), fromFov: camera.fov, toFov: camera.fov };
        }
      }


      const setExperience = (nextMode: ExperienceMode, instant = false) => {
        if (clientPresentation) {
          floorVisibilityController?.showAll();
          setClientFloorSelection(null);
          setSelectedFloor(null);
        }
        currentExperienceMode = nextMode;
        if (!projectExperience || !activeObject || !siteEnvironment) return;
        walkActive = false;
        setWalkMode(false);
        clearInput();
        controls.enabled = true;
        cameraTween = undefined;
        renderer.clippingPlanes = [];
        projectExperience.setWalk(false);
        projectExperience.setMode(nextMode);

        const interior = nextMode === "interior";
        controls.minDistance = interior ? 0.5 : Math.max(radiusForView * 0.55, 1.5);
        controls.maxPolarAngle = THREE.MathUtils.degToRad(interior ? 88 : 87);
        activeObject.visible = !interior;
        siteEnvironment.root.visible = !interior;

        if (nextMode === "site") {
          setView(presentationView, instant);
          return;
        }

        const focus = projectExperience.focus(nextMode);
        const sphere = focus.box.getBoundingSphere(new THREE.Sphere());
        const radius = Math.max(sphere.radius, 1);
        const target = focus.target.clone();
        const position =
          nextMode === "interior"
            ? target.clone().add(new THREE.Vector3(radius * 0.42, radius * 1.75, radius * 0.82))
            : target.clone().add(new THREE.Vector3(radius * 0.75, radius * 1.35, radius * 1.05));
        const toFov = nextMode === "interior" ? 38 : 39;

        if (instant) {
          camera.position.copy(position);
          controls.target.copy(target);
          camera.fov = toFov;
          camera.updateProjectionMatrix();
          controls.update();
          cameraTween = undefined;
          return;
        }

        cameraTween = {
          start: performance.now(),
          duration: 800,
          fromPosition: camera.position.clone(),
          toPosition: position,
          fromTarget: controls.target.clone(),
          toTarget: target,
          fromFov: camera.fov,
          toFov,
        };
      };
      experienceRef.current = setExperience;
      setExperience(experienceMode, true);
      if (experienceMode === "site" && !clientPresentation) setView(presentationView, true);

      void experiencePromise
        .then((experience) => {
          if (!experience) return;
          if (
            disposed ||
            profileGeneration !== profileLoadGeneration ||
            activeObject !== object
          ) {
            experience.dispose();
            return;
          }

          const resumeInteriorWalk =
            walkActive && currentExperienceMode === "interior";
          projectExperience = experience;
          scene.add(experience.root);
          experience.setNight(currentNight);
          setRooms(
            walkthrough?.rooms.length
              ? walkthrough.rooms.map((room) => ({
                  id: room.id,
                  label: room.name,
                  category: room.unit,
                }))
              : experience.rooms.map(({ id, label, category }) => ({
                  id,
                  label,
                  category,
                })),
          );
          setExperience(currentExperienceMode, true);
          if (resumeInteriorWalk)
            enterWalkMode(true, initialWalkFloor);
        })
        .catch((error) => {
          console.error("Project experience bundle load failed", error);
        });

      if (initialExploded) {
        floorExploder?.setExploded(true);
      }
      if (initialFloor !== null) {
        applyFloor(initialFloor);
      }

      if (interactionMode === "detail") {
        const sphere = modelBounds.getBoundingSphere(new THREE.Sphere());
        const direction = new THREE.Vector3(1, 0.25, 1).normalize();
        camera.position.copy(sphere.center.clone().add(direction.multiplyScalar(Math.max(sphere.radius * 1.35, 4))));
        controls.target.copy(sphere.center.clone().add(new THREE.Vector3(0, sphere.radius * 0.08, 0)));
        controls.update();
      }
      if (interactionMode === "section") applySection(true);
      setWalkMode(initialWalk);
      if (initialWalk) {
        enterWalkMode(true, initialWalkFloor);
      }
    };

    const mountPreview = (message: string) => {
      if (disposed) return;
      void mountObject(createPreviewBuilding(), false);
      setErrorMessage(message);
      setProgress(100);
      setMode("demo");
    };

    if (modelUrl) {
      setMode("loading");
      setProgress(2);
      setErrorMessage(undefined);

      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      if (sourcePresentation || buildingPresentation) {
        const controller = new AbortController();
        abortModelLoad = () => controller.abort();
        void fetch(modelUrl, { signal: controller.signal }).then(async (response) => {
          if (!response.ok) throw new Error(`Model request failed: ${response.status}`);
          const bytes = await response.arrayBuffer();
          if (disposed) return;
          setProgress(60);
          const gltf = await loader.parseAsync(bytes, new URL(".", new URL(modelUrl, window.location.href)).href);
          if (disposed) { disposeViewerObject(gltf.scene); return; }
          await mountObject(gltf.scene, Boolean(cameraPreset));
          if (disposed || activeObject !== gltf.scene) return;
          setProgress(100);
          setMode("model");
          // Both optional presentation layers verify the same immutable bytes.
          // Compute SHA-256 once, then preserve each layer's independent comparison.
          const verifiedModelSha256 = await sha256Hex(bytes);
          if (disposed || activeObject !== gltf.scene) return;
          if (sourcePresentation)
            await applySourcePresentation(
              gltf.scene,
              sourcePresentation,
              bytes,
              renderer,
              () => disposed || activeObject !== gltf.scene,
              verifiedModelSha256,
            );
          if (buildingPresentation)
            await applyBuildingPresentationMaterials(
              gltf.scene,
              buildingPresentation,
              bytes,
              () => disposed || activeObject !== gltf.scene,
              verifiedModelSha256,
            );
        }).catch((error) => {
          if (!disposed) { console.error("3D model load failed", error); mountPreview("The building could not be loaded. Please reload to try again."); }
        });
      } else loader.load(
        modelUrl,
        (gltf) => {
          if (disposed) {
            disposeViewerObject(gltf.scene);
            return;
          }

          mountObject(gltf.scene, Boolean(cameraPreset));
          setProgress(100);
          setMode("model");
        },
        (event) => {
          if (!event.total) return;
          setProgress(
            Math.min(98, Math.max(2, Math.round((event.loaded / event.total) * 100))),
          );
        },
        (error) => {
          console.error("3D model load failed", error);
          mountPreview(
            "Approved model asset could not be loaded. Showing safe preview geometry.",
          );
        },
      );
    } else {
      mountPreview(
        "Approved optimized GLB has not been published yet. Showing preview geometry.",
      );
    }

    const clock = new THREE.Clock();
    const render = () => {
      if (disposed) return;
      animationFrame = window.requestAnimationFrame(render);
      if (document.hidden) return;

      const delta = Math.min(clock.getDelta(), 0.05);
      sky?.update(delta, camera);
      if (sky && !currentNight) {
        const solar = sky.solarState;
        sun.position.copy(solar.direction).multiplyScalar(50);
        // Keep the low sunrise light just above the architectural horizon.
        if (solar.timeOfDay < 6.2) sun.position.y = Math.max(sun.position.y, 5);
        sun.color.lerpColors(dawnSunColor, daySunColor, solar.daylight);
        sun.intensity = baseSunIntensity * (0.18 + solar.daylight * 0.82);
        fill.color.lerpColors(dawnFillColor, dayFillColor, solar.daylight);
        fill.intensity = baseFillIntensity * (0.6 + solar.daylight * 0.4);
        hemi.intensity = baseHemisphereIntensity * (0.72 + solar.daylight * 0.28);
        renderer.toneMappingExposure = baseExposure + (1 - solar.daylight) * 0.035;
        scene.environmentIntensity = baseEnvironmentIntensity * (0.72 + solar.daylight * 0.28);
        if (scene.fog instanceof THREE.FogExp2) {
          scene.fog.color.lerpColors(dawnFogColor, dayFogColor, solar.daylight);
          scene.fog.density = baseFogDensity + (0.00185 - baseFogDensity) * (1 - solar.daylight);
        }
      }
      presentationMotion?.update(delta);
      siteEnvironment?.update(delta);
      siteInteractionController?.update(delta);

      if (cameraTween && !walkActive) {
        const elapsed = performance.now() - cameraTween.start;
        const raw = THREE.MathUtils.clamp(elapsed / cameraTween.duration, 0, 1);
        const eased = raw < 0.5 ? 4 * raw * raw * raw : 1 - Math.pow(-2 * raw + 2, 3) / 2;
        camera.position.lerpVectors(cameraTween.fromPosition, cameraTween.toPosition, eased);
        controls.target.lerpVectors(cameraTween.fromTarget, cameraTween.toTarget, eased);
        camera.fov = THREE.MathUtils.lerp(cameraTween.fromFov, cameraTween.toFov, eased);
        camera.updateProjectionMatrix();
        controls.update();
        if (raw >= 1) cameraTween = undefined;
      }

      if (walkActive && modelBounds) {
        const directions = new Set(heldDirections);
        if (walkKeys.has("w") || walkKeys.has("arrowup")) directions.add("forward");
        if (walkKeys.has("s") || walkKeys.has("arrowdown")) directions.add("back");
        if (walkKeys.has("a") || walkKeys.has("arrowleft")) directions.add("left");
        if (walkKeys.has("d") || walkKeys.has("arrowright")) directions.add("right");
        const speed = 1.65 * walkScale * delta / Math.sqrt(Math.max(directions.size, 1));
        for (const direction of directions) moveWalk(direction, speed);
      } else {
        controls.update();
      }
      if (clientPresentation && modelBounds && !walkActive) {
        camera.position.y = Math.max(camera.position.y, modelBounds.min.y + 0.4);
        updateCameraDepthRange(camera, controls.target, modelBounds);
      }
      renderer.render(scene, camera);
    };
    render();

    const cancelCameraTween = () => { cameraTween = undefined; };
    controls.addEventListener("start", cancelCameraTween);

    const handleContextLost = (event: Event) => {
      event.preventDefault();
      setMode("error");
      setErrorMessage(
        "The browser paused the 3D graphics context. Reload this page to restart the viewer.",
      );
    };
    renderer.domElement.addEventListener("webglcontextlost", handleContextLost, false);

    return () => {
      disposed = true;
      abortModelLoad?.();
      profileLoadGeneration += 1;
      window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
      controls.removeEventListener("start", cancelCameraTween);
      controls.dispose();
      sky?.dispose();
      presentationMotion?.dispose();
      presentationMotion = undefined;
      siteInteractionController?.dispose();
      siteInteractionController = undefined;
      renderer.domElement.removeEventListener("webglcontextlost", handleContextLost);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", clearInput);
      document.removeEventListener("visibilitychange", clearInput);
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      renderer.domElement.removeEventListener("pointermove", handlePointerMove);
      renderer.domElement.removeEventListener("pointerup", handlePointerUp);
      renderer.domElement.removeEventListener("pointercancel", handlePointerUp);
      renderer.domElement.removeEventListener("click", handleFeatureClick);
      floorVisibilityController?.dispose();
      floorVisibilityController = undefined;
      if (activeObject) disposeViewerObject(activeObject);
      referenceExterior?.dispose();
      if (siteEnvironment) {
        scene.remove(siteEnvironment.root);
        siteEnvironment.dispose();
      }
      if (projectExperience) {
        scene.remove(projectExperience.root);
        projectExperience.dispose();
      }
      modelProfile = undefined;
      if (environmentWorkHandle !== undefined) {
        if (environmentWorkUsesIdleCallback) idleWindow.cancelIdleCallback?.(environmentWorkHandle);
        else window.clearTimeout(environmentWorkHandle);
      }
      environmentTexture?.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      exteriorViewRef.current = null;
      clientFloorViewRef.current = null;
      resetRef.current = null;
      floorRef.current = null;
      sectionRef.current = null;
      lightingRef.current = null;
      explodeRef.current = null;
      walkModeRef.current = null;
      walkStepRef.current = null;
      presentationRef.current = null;
      experienceRef.current = null;
      enterRoomRef.current = null;
      holdWalkRef.current = null;
      setWalkNotice("");
    };
  }, [
    sourcePresentation,
    buildingPresentation,
    clientPresentation,
    modelUrl,
    cameraPreset,
    interactionMode,
    initialWalk,
    initialWalkFloor,
    visualPreset,
    floorSignature,
    walkthrough,
  ]);

  useEffect(() => {
    presentationRef.current?.(presentationView);
  }, [presentationView]);

  useEffect(() => {
    experienceRef.current?.(experienceMode);
  }, [experienceMode]);

  useEffect(() => {
    setSelectedFloor(initialFloor);
    floorRef.current?.(initialFloor);
  }, [initialFloor]);

  useEffect(() => {
    setExploded(initialExploded);
    explodeRef.current?.(initialExploded);
  }, [initialExploded]);

  useEffect(() => {
    const update = () => {
      setIsFullscreen(document.fullscreenElement === hostRef.current);
    };
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);

  async function toggleFullscreen() {
    const host = hostRef.current;
    if (!host) return;
    if (document.fullscreenElement === host) {
      await document.exitFullscreen();
      return;
    }
    await host.requestFullscreen?.();
  }

  const statusLabel =
    mode === "model"
      ? "Live model"
      : mode === "demo"
        ? "Preview geometry"
        : mode === "loading"
          ? `Loading ${progress}%`
          : mode === "error"
            ? "Viewer paused"
            : "Starting";

  const activeGraphRoom =
    walkthrough?.rooms.find((room) => room.id === activeRoom) ??
    walkthrough?.rooms[0];

  return (
    <div className="viewer-shell" ref={hostRef}>
      {compactUi && experienceMode !== "interior" && <div className="viewer-compact-tools">
        <button type="button" onClick={() => { const next = !nightMode; setNightMode(next); lightingRef.current?.(next); }}>{nightMode ? "Daylight" : "Evening"}</button>
        <button type="button" onClick={() => void toggleFullscreen()}>{isFullscreen ? "Exit full screen" : "Full screen"}</button>
      </div>}
      {walkMode && walkthrough && activeGraphRoom && (
        <WalkGraphPanel
          walkthrough={walkthrough}
          activeRoom={activeGraphRoom}
          notice={walkNotice}
          onEnterRoom={(roomId) => enterRoomRef.current?.(roomId)}
        />
      )}
      {experienceMode === "interior" && mode === "model" && (
        <div className="viewer-room-toolbar">
          <label htmlFor="walk-room">Enter a room</label>
          <select id="walk-room" value={activeRoom} onChange={(event) => enterRoomRef.current?.(event.target.value)}>
            <option value="" disabled>Select a room</option>
            {rooms.map((room) => <option key={room.id} value={room.id}>{room.category} · {room.label}</option>)}
          </select>
          {walkMode && <button type="button" onClick={() => walkModeRef.current?.(false, null)}>Floor plan</button>}
          <small>
            {walkMode
              ? walkthrough?.rooms.length
                ? "Drag to look · WASD / arrows · reviewed doors connect rooms"
                : "Drag to look · Hold arrows / WASD to move · Esc to exit"
              : "Tap a room or select it above to enter"}
          </small>
        </div>
      )}
      {!compactUi && <div className="viewer-toolbar" aria-label="3D viewer controls">
        {!clientPresentation && <span className={`viewer-status viewer-status--${mode}`}>
          <i aria-hidden="true" />
          {statusLabel}
        </span>}
        <div className="viewer-actions">
          <button
            type="button"
            className="viewer-action"
            onClick={() => resetRef.current?.()}
          >
            Reset
          </button>
          <button
            type="button"
            className={nightMode ? "viewer-action viewer-action--active" : "viewer-action"}
            onClick={() => {
              const next = !nightMode;
              setNightMode(next);
              lightingRef.current?.(next);
            }}
          >
            {nightMode ? "Day" : "Night"}
          </button>
          {allowWalkControls && !clientPresentation && <button
            type="button"
            className={walkMode ? "viewer-action viewer-action--active" : "viewer-action"}
            onClick={() => {
              const next = !walkMode;
              setWalkMode(next);
              if (next) {
                setExploded(false);
                setSectionEnabled(false);
                explodeRef.current?.(false);
                sectionRef.current?.(false);
              }
              walkModeRef.current?.(next, selectedFloor);
            }}
          >
            {walkMode ? "Orbit" : "Walk"}
          </button>}
          {allowInteriorControls && !clientPresentation && <>
          <button
            type="button"
            className={exploded ? "viewer-action viewer-action--active" : "viewer-action"}
            disabled={walkMode}
            onClick={() => {
              const next = !exploded;
              setExploded(next);
              explodeRef.current?.(next);
            }}
          >
            Explode
          </button>
          <button
            type="button"
            className={sectionEnabled ? "viewer-action viewer-action--active" : "viewer-action"}
            onClick={() => {
              const next = !sectionEnabled;
              setSectionEnabled(next);
              sectionRef.current?.(next);
            }}
          >
            Section
          </button>
          </>}
          <button
            type="button"
            className="viewer-action"
            onClick={() => void toggleFullscreen()}
          >
            {isFullscreen ? "Exit" : "Full screen"}
          </button>
        </div>
      </div>}

      {!compactUi && allowInteriorControls && !clientPresentation && <div className="viewer-floor-controls" aria-label="Building floor selector">
        <button
          type="button"
          className={selectedFloor === null ? "viewer-floor viewer-floor--active" : "viewer-floor"}
          onClick={() => {
            setSelectedFloor(null);
            if (walkMode) {
              walkModeRef.current?.(true, null);
            } else {
              floorRef.current?.(null);
            }
          }}
        >
          All
        </button>
        {availableFloors.map((floor) => (
          <button
            type="button"
            key={floor}
            className={selectedFloor === floor ? "viewer-floor viewer-floor--active" : "viewer-floor"}
            onClick={() => {
              setSelectedFloor(floor);
              if (walkMode) {
                walkModeRef.current?.(true, floor);
              } else {
                floorRef.current?.(floor);
              }
            }}
          >
            {floor === 0 ? "Ground" : `F${floor}`}
          </button>
        ))}
      </div>}

      {clientPresentation && showClientFloorControls && mode === "model" && clientFloorControlsReady && clientFloorIds.length > 0 && (
        <nav className="client-floor-controls" aria-label="Select building floor">
          <span className="client-floor-controls__label">FLOOR</span>
          <span className="client-floor-controls__mode-label">VIEW</span>
          <button
            type="button"
            aria-label="Stacked floor view"
            aria-pressed={clientFloorReviewMode === "stacked"}
            className={clientFloorReviewMode === "stacked" ? "client-floor-control client-floor-control--mode client-floor-control--active" : "client-floor-control client-floor-control--mode"}
            title="Show the selected floor connected to all lower floors"
            onClick={() => {
              clientFloorReviewModeRef.current = "stacked";
              setClientFloorReviewMode("stacked");
              if (typeof clientFloorSelection === "number" || clientFloorSelection === "roof")
                clientFloorViewRef.current?.(clientFloorSelection);
            }}
          >
            Stacked
          </button>
          <button
            type="button"
            aria-label="Isolate selected floor"
            aria-pressed={clientFloorReviewMode === "isolate"}
            className={clientFloorReviewMode === "isolate" ? "client-floor-control client-floor-control--mode client-floor-control--active" : "client-floor-control client-floor-control--mode"}
            title="Show only the selected floor, with shared structural context"
            onClick={() => {
              clientFloorReviewModeRef.current = "isolate";
              setClientFloorReviewMode("isolate");
              if (typeof clientFloorSelection === "number" || clientFloorSelection === "roof")
                clientFloorViewRef.current?.(clientFloorSelection);
            }}
          >
            Isolate
          </button>
          <button
            type="button"
            aria-pressed={clientFloorSelection === null}
            className={clientFloorSelection === null ? "client-floor-control client-floor-control--active" : "client-floor-control"}
            title="Show the complete building"
            onClick={() => clientFloorViewRef.current?.(null)}
          >
            All
          </button>
          {clientFloorIds.map((floor) => {
            const label = floor === 0 ? "Ground" : floor < 0 ? `B${Math.abs(floor)}` : `${floor}F`;
            return (
              <button
                type="button"
                key={floor}
                aria-label={floor === 0
                  ? clientFloorReviewMode === "stacked" ? "Show Ground Floor" : "Show Ground Floor only"
                  : floor < 0
                    ? clientFloorReviewMode === "stacked"
                      ? `Show stacked view through Basement ${Math.abs(floor)}`
                      : `Show Basement ${Math.abs(floor)} only`
                    : clientFloorReviewMode === "stacked"
                      ? `Show stacked view through Floor ${floor}`
                      : `Show Floor ${floor} only`}
                aria-pressed={clientFloorSelection === floor}
                className={clientFloorSelection === floor ? "client-floor-control client-floor-control--active" : "client-floor-control"}
                title={clientFloorReviewMode === "stacked"
                  ? `Show this floor with all lower floors; hide upper floors`
                  : floor === 0 ? "Isolate ground floor, top view" : floor < 0 ? `Isolate basement ${Math.abs(floor)}, top view` : `Isolate floor ${floor}, top view`}
                onClick={() => clientFloorViewRef.current?.(floor)}
              >
                {label}
              </button>
            );
          })}
          {clientRoofAvailable && (
            <button
              type="button"
              aria-label={clientFloorReviewMode === "stacked" ? "Show roof and lower floors" : "Show roof only"}
              aria-pressed={clientFloorSelection === "roof"}
              className={clientFloorSelection === "roof" ? "client-floor-control client-floor-control--active" : "client-floor-control"}
              title={clientFloorReviewMode === "stacked" ? "Show the roof with all lower floors; hide upper structures above the roof" : "Isolate the roof and upper structure using detected model bounds"}
              onClick={() => clientFloorViewRef.current?.("roof")}
            >
              Roof
            </button>
          )}
          <button
            type="button"
            aria-pressed={clientFloorSelection === "top"}
            className={clientFloorSelection === "top" ? "client-floor-control client-floor-control--active" : "client-floor-control"}
            title="Top-down view of the complete model; this does not isolate a floor"
            onClick={() => clientFloorViewRef.current?.("top")}
          >
            Top
          </button>
        </nav>
      )}
      {clientPresentation && <nav className="client-camera-views" aria-label="Camera views">
        {(["hero", "front", "corner", "entrance", "aerial"] as ExteriorView[]).map((view) => <button
          type="button" key={view} aria-pressed={exteriorView === view}
          onClick={() => {
            if (clientPresentation && showClientFloorControls) {
              floorRef.current?.(null);
              setSelectedFloor(null);
              setClientFloorSelection(null);
            }
            selectedExteriorRef.current = view;
            setExteriorView(view);
            exteriorViewRef.current?.(view);
          }}
        >{view === "hero" ? "Overview" : view === "entrance" ? "Entry view" : view.charAt(0).toUpperCase() + view.slice(1)}</button>)}
        {projectLocation && <a
          className="client-camera-location"
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(projectLocation)}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${projectLocation} in Google Maps`}
        >
          <span>Location</span>
        </a>}
      </nav>}
      {walkMode && (
        <div className="viewer-walk-controls" aria-label="Walkthrough movement controls">
          {(["forward", "left", "back", "right"] as WalkDirection[]).map((direction, index) => (
            <button key={direction} type="button" aria-label={`Move ${direction}`}
              onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); holdWalkRef.current?.(direction, true); }}
              onPointerUp={() => holdWalkRef.current?.(direction, false)}
              onPointerCancel={() => holdWalkRef.current?.(direction, false)}
              onLostPointerCapture={() => holdWalkRef.current?.(direction, false)}
              onKeyDown={(event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); holdWalkRef.current?.(direction, true); } }}
              onKeyUp={() => holdWalkRef.current?.(direction, false)}
              onBlur={() => holdWalkRef.current?.(direction, false)}
            >{["↑", "←", "↓", "→"][index]}</button>
          ))}
        </div>
      )}

      {(mode === "loading" || mode === "booting") && (
        <div className="viewer-loader" role="status" aria-live="polite">
          <div>
            <span>Preparing 3D experience</span>
            <strong>{progress}%</strong>
          </div>
          <div className="viewer-loader-track">
            <span style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {errorMessage && mode !== "loading" && (
        <div className="viewer-notice">
          <strong>{modelLabel ?? "3D Project"}</strong>
          <span>{errorMessage}</span>
        </div>
      )}

      {!compactUi && !clientPresentation && <div className="viewer-help" aria-hidden="true">
{walkMode ? "Walk: drag to look · WASD/arrow keys or on-screen arrows to move" : "Drag to rotate · Two-finger/secondary drag to pan · Pinch or wheel to zoom"}
      </div>}
    </div>
  );
}
