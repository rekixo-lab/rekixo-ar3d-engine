import type { PublicSiteElement } from "@rekixo/3d-contracts";
import * as THREE from "three";
import {
  addPresentationFallback,
  type PresentationLandscapePreset,
} from "./presentationEnvironment";
import { getPublicRuntimeSiteElements } from "./publicRuntimeContext";
import {
  configureProceduralSurfaceTextures,
  createProceduralSurfaceMaterial,
} from "./proceduralSurfaceMaterials";
import {
  createUniversalGrassGroundCover,
  type GrassCoverArea,
} from "./grassGroundCover";

const AREA_KINDS = new Set<PublicSiteElement["kind"]>([
  "garden",
  "lawn",
  "path",
  "road",
  "parking",
]);

const STRUCTURAL_KINDS = new Set<PublicSiteElement["kind"]>([
  "column",
  "beam",
  "slab",
  "roof",
  "duct",
  "balcony",
  "boundary",
  "stair",
  "lift",
]);

function material(
  color: string,
  roughness = 0.82,
  metalness = 0,
) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness,
  });
}

function batchKey(item: PublicSiteElement) {
  return `${item.kind}|${item.color.toLowerCase()}|${item.shape ?? "default"}`;
}

function groupsFor(items: readonly PublicSiteElement[]) {
  const groups = new Map<string, PublicSiteElement[]>();
  for (const item of items) {
    const key = batchKey(item);
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  return groups;
}

function matrixFor(
  item: PublicSiteElement,
  y: number,
  scale: THREE.Vector3,
) {
  const matrix = new THREE.Matrix4();
  matrix.compose(
    new THREE.Vector3(item.x, y, item.z),
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, THREE.MathUtils.degToRad(item.rotation), 0),
    ),
    scale,
  );
  return matrix;
}

function addAreaBatches(root: THREE.Group, items: readonly PublicSiteElement[]) {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  for (const rows of groupsFor(items).values()) {
    const first = rows[0];
    const surfaceKind =
      first.kind === "road" || first.kind === "parking"
        ? "asphalt"
        : first.kind === "lawn" || first.kind === "garden"
          ? "grass"
          : first.kind === "path"
            ? "paving"
            : undefined;
    const surfaceMaterial = surfaceKind
      ? createProceduralSurfaceMaterial(
          first.color,
          surfaceKind,
          first.kind === "road" || first.kind === "parking" ? 0.94 : 0.88,
        )
      : material(
          first.color,
          first.kind === "road" || first.kind === "parking" ? 0.94 : 0.88,
        );
    const mesh = new THREE.InstancedMesh(
      geometry.clone(),
      surfaceMaterial,
      rows.length,
    );
    mesh.name = `Site ${first.kind}`;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    rows.forEach((item, index) => {
      const visibleHeight = Math.max(0.02, item.height);
      mesh.setMatrixAt(
        index,
        matrixFor(
          item,
          item.y + visibleHeight / 2 + 0.01,
          new THREE.Vector3(item.width, visibleHeight, item.depth),
        ),
      );
    });
    mesh.instanceMatrix.needsUpdate = true;
    root.add(mesh);
  }
  geometry.dispose();
}

function addTreeBatches(
  root: THREE.Group,
  items: readonly PublicSiteElement[],
  mobile: boolean,
) {
  if (!items.length) return;
  const trunkGeometry = new THREE.CylinderGeometry(1, 1, 1, mobile ? 7 : 10);
  const trunkMaterial = material("#715139", 0.92);
  const trunks = new THREE.InstancedMesh(
    trunkGeometry,
    trunkMaterial,
    items.length,
  );
  trunks.name = "Site tree trunks";
  trunks.castShadow = !mobile;
  trunks.receiveShadow = true;

  items.forEach((item, index) => {
    const trunkHeight = Math.max(0.65, item.height * 0.48);
    const radius = Math.max(0.04, Math.min(item.width, item.depth) * 0.06);
    trunks.setMatrixAt(
      index,
      matrixFor(
        item,
        item.y + trunkHeight / 2,
        new THREE.Vector3(radius, trunkHeight, radius),
      ),
    );
  });
  trunks.instanceMatrix.needsUpdate = true;
  root.add(trunks);

  const crownGeometry = new THREE.SphereGeometry(1, mobile ? 8 : 14, mobile ? 5 : 9);
  for (const rows of groupsFor(items).values()) {
    const crowns = new THREE.InstancedMesh(
      crownGeometry.clone(),
      material(rows[0].color, 0.96),
      rows.length,
    );
    crowns.name = "Site tree foliage";
    crowns.castShadow = !mobile;
    crowns.receiveShadow = true;
    rows.forEach((item, index) => {
      const radius = Math.max(0.25, Math.min(item.width, item.depth) * 0.42);
      const crownHeight = Math.max(
        radius * 1.2,
        Math.min(item.height * 0.52, radius * 2.6),
      );
      crowns.setMatrixAt(
        index,
        matrixFor(
          item,
          item.y + Math.max(item.height - crownHeight / 2, crownHeight / 2),
          new THREE.Vector3(radius, crownHeight / 2, radius),
        ),
      );
    });
    crowns.instanceMatrix.needsUpdate = true;
    root.add(crowns);
  }
  crownGeometry.dispose();
}

function addPlantBatches(
  root: THREE.Group,
  items: readonly PublicSiteElement[],
  mobile: boolean,
) {
  if (!items.length) return;
  const potGeometry = new THREE.CylinderGeometry(1, 0.82, 1, mobile ? 7 : 10);
  const pots = new THREE.InstancedMesh(
    potGeometry,
    material("#815d43", 0.9),
    items.length,
  );
  pots.name = "Site plant pots";
  pots.castShadow = !mobile;
  pots.receiveShadow = true;
  items.forEach((item, index) => {
    const potHeight = Math.max(0.12, Math.min(0.42, item.height * 0.28));
    const radius = Math.max(0.07, Math.min(item.width, item.depth) * 0.2);
    pots.setMatrixAt(
      index,
      matrixFor(
        item,
        item.y + potHeight / 2,
        new THREE.Vector3(radius, potHeight, radius),
      ),
    );
  });
  pots.instanceMatrix.needsUpdate = true;
  root.add(pots);

  const foliageGeometry = new THREE.SphereGeometry(1, mobile ? 8 : 14, mobile ? 5 : 9);
  for (const rows of groupsFor(items).values()) {
    const foliage = new THREE.InstancedMesh(
      foliageGeometry.clone(),
      material(rows[0].color, 0.96),
      rows.length,
    );
    foliage.name = "Site plant foliage";
    foliage.castShadow = !mobile;
    rows.forEach((item, index) => {
      const radius = Math.max(0.12, Math.min(item.width, item.depth) * 0.38);
      const height = Math.max(radius * 1.2, item.height * 0.68);
      foliage.setMatrixAt(
        index,
        matrixFor(
          item,
          item.y + Math.max(height / 2, item.height * 0.58),
          new THREE.Vector3(radius, height / 2, radius),
        ),
      );
    });
    foliage.instanceMatrix.needsUpdate = true;
    root.add(foliage);
  }
  foliageGeometry.dispose();
}

interface WaterSurfaceRuntime {
  mesh: THREE.Mesh;
  material: THREE.MeshPhysicalMaterial;
  elapsed: number;
}

function addWaterSurfaces(
  root: THREE.Group,
  items: readonly PublicSiteElement[],
  mobile: boolean,
  animate: boolean,
): WaterSurfaceRuntime[] {
  return items.map((item) => {
    const group = new THREE.Group();
    group.name = "Reviewed site water feature";
    group.position.set(item.x, item.y + Math.max(0.025, item.height), item.z);
    group.rotation.y = THREE.MathUtils.degToRad(item.rotation);

    const waterMaterial = new THREE.MeshPhysicalMaterial({
      name: `Reviewed water ${item.id}`,
      color: item.color,
      roughness: 0.14,
      metalness: 0.02,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: THREE.DoubleSide,
      clearcoat: 1,
      clearcoatRoughness: 0.12,
      ior: 1.333,
      envMapIntensity: 1.25,
    });

    waterMaterial.userData.waterAnimationEnabled = animate;
    waterMaterial.userData.elapsed = 0;
    waterMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uRekixoWaterTime = {
        value: waterMaterial.userData.elapsed as number,
      };
      shader.vertexShader = shader.vertexShader.replace(
        "#include <common>",
        "#include <common>\nuniform float uRekixoWaterTime;",
      );
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        if (${animate ? "true" : "false"}) {
          float waveA = sin(position.x * 1.7 + position.y * 0.8 + uRekixoWaterTime * 0.78);
          float waveB = sin(position.y * 2.2 - position.x * 1.1 - uRekixoWaterTime * 0.54);
          float waveC = sin((position.x + position.y) * 3.8 + uRekixoWaterTime * 0.31);
          transformed.z += (waveA * 0.009 + waveB * 0.006 + waveC * 0.0025);
        }`,
      );
      waterMaterial.userData.waterShader = shader;
    };
    waterMaterial.customProgramCacheKey = () =>
      `rekixo-water-surface-v1-${animate ? "animated" : "static"}`;

    const segments = mobile ? 16 : 28;
    const geometry = new THREE.PlaneGeometry(
      Math.max(item.width, 0.2),
      Math.max(item.depth, 0.2),
      segments,
      segments,
    );
    const mesh = new THREE.Mesh(geometry, waterMaterial);
    mesh.name = `Reviewed water surface ${item.id}`;
    mesh.rotation.x = -Math.PI / 2;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.userData.presentationOnly = true;
    mesh.userData.sourceSiteElementId = item.id;
    group.add(mesh);
    root.add(group);

    return { mesh, material: waterMaterial, elapsed: 0 };
  });
}

function addGate(root: THREE.Group, item: PublicSiteElement, mobile: boolean) {
  const group = new THREE.Group();
  group.name = "Site gate";
  group.position.set(item.x, item.y, item.z);
  group.rotation.y = THREE.MathUtils.degToRad(item.rotation);

  const gateMaterial = material("#343a3c", 0.38, 0.68);
  const postWidth = Math.max(0.08, Math.min(0.2, item.width * 0.06));
  const depth = Math.max(0.06, item.depth * 0.55);
  const postGeometry = new THREE.BoxGeometry(postWidth, item.height, depth);
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(postGeometry, material("#77766f", 0.52, 0.48));
    post.position.set(side * (item.width / 2 - postWidth / 2), item.height / 2, 0);
    post.name = "Site gate post";
    post.castShadow = !mobile;
    post.receiveShadow = true;
    group.add(post);
  }

  const clearWidth = Math.max(item.width - postWidth * 2, 0.4);
  const leafWidth = clearWidth / 2;
  const railThickness = Math.max(0.035, Math.min(0.075, item.height * 0.035));
  const barWidth = Math.max(0.018, Math.min(0.04, leafWidth * 0.018));
  const leafDepth = Math.max(0.035, depth * 0.44);
  const railGeometry = new THREE.BoxGeometry(leafWidth, railThickness, leafDepth);
  const barGeometry = new THREE.BoxGeometry(barWidth, item.height * 0.64, leafDepth * 0.72);
  const capGeometry = new THREE.SphereGeometry(barWidth * 0.85, mobile ? 6 : 8, mobile ? 4 : 6);

  const addLeaf = (side: -1 | 1) => {
    const pivot = new THREE.Group();
    pivot.name = side < 0 ? "Site gate leaf left hinge" : "Site gate leaf right hinge";
    pivot.position.set(side * (item.width / 2 - postWidth), 0, 0);
    const spanDirection = side < 0 ? 1 : -1;
    const openAngle = side < 0 ? -Math.PI * 0.47 : Math.PI * 0.47;
    pivot.userData.siteInteraction = {
      kind: "gate-leaf",
      closedAngle: 0,
      openAngle,
      sourceSiteElementId: item.id,
    };

    const railY = [item.height * 0.16, item.height * 0.49, item.height * 0.80];
    for (const y of railY) {
      const rail = new THREE.Mesh(railGeometry, gateMaterial);
      rail.position.set(spanDirection * leafWidth / 2, y, 0);
      rail.castShadow = !mobile;
      rail.receiveShadow = true;
      pivot.add(rail);
    }

    const picketCount = Math.max(3, Math.min(18, Math.floor(leafWidth / 0.16)));
    for (let index = 0; index <= picketCount; index += 1) {
      const fraction = index / picketCount;
      const picket = new THREE.Mesh(barGeometry, gateMaterial);
      picket.name = "Site gate picket";
      picket.position.set(spanDirection * leafWidth * fraction, item.height * 0.48, 0);
      picket.castShadow = !mobile;
      picket.receiveShadow = true;
      pivot.add(picket);

      if (index === 0 || index === picketCount) {
        const cap = new THREE.Mesh(capGeometry, gateMaterial);
        cap.position.set(spanDirection * leafWidth * fraction, item.height * 0.84, 0);
        cap.castShadow = !mobile;
        pivot.add(cap);
      }
    }

    group.add(pivot);
  };

  addLeaf(-1);
  addLeaf(1);
  root.add(group);
}

function addOutdoorLights(
  root: THREE.Group,
  items: readonly PublicSiteElement[],
  mobile: boolean,
) {
  if (!items.length) return undefined;
  const poleGeometry = new THREE.CylinderGeometry(1, 1, 1, mobile ? 7 : 10);
  const poles = new THREE.InstancedMesh(
    poleGeometry,
    material("#4f5357", 0.58, 0.28),
    items.length,
  );
  poles.name = "Site outdoor light poles";
  poles.castShadow = !mobile;
  items.forEach((item, index) => {
    const radius = Math.max(0.035, Math.min(item.width, item.depth) * 0.22);
    const height = Math.max(0.3, item.height * 0.92);
    poles.setMatrixAt(
      index,
      matrixFor(
        item,
        item.y + height / 2,
        new THREE.Vector3(radius, height, radius),
      ),
    );
  });
  poles.instanceMatrix.needsUpdate = true;
  root.add(poles);

  const bulbMaterial = new THREE.MeshStandardMaterial({
    color: "#fff2ce",
    emissive: "#ffd188",
    emissiveIntensity: 0.38,
    roughness: 0.28,
  });
  const bulbGeometry = new THREE.SphereGeometry(1, mobile ? 7 : 10, mobile ? 5 : 7);
  const bulbs = new THREE.InstancedMesh(
    bulbGeometry,
    bulbMaterial,
    items.length,
  );
  bulbs.name = "Site outdoor light bulbs";
  items.forEach((item, index) => {
    const radius = Math.max(0.07, Math.min(item.width, item.depth) * 0.42);
    bulbs.setMatrixAt(
      index,
      matrixFor(
        item,
        item.y + item.height,
        new THREE.Vector3(radius, radius, radius),
      ),
    );
  });
  bulbs.instanceMatrix.needsUpdate = true;
  root.add(bulbs);
  return bulbMaterial;
}

function addStructuralBatches(
  root: THREE.Group,
  items: readonly PublicSiteElement[],
  mobile: boolean,
) {
  for (const rows of groupsFor(items).values()) {
    const first = rows[0];
    const cylinder = first.shape === "cylinder";
    const geometry = cylinder
      ? new THREE.CylinderGeometry(1, 1, 1, mobile ? 10 : 18)
      : new THREE.BoxGeometry(1, 1, 1);
    const mesh = new THREE.InstancedMesh(
      geometry,
      material(first.color, 0.76, 0.03),
      rows.length,
    );
    mesh.name = `Structural ${first.kind}`;
    mesh.castShadow = !mobile;
    mesh.receiveShadow = true;
    rows.forEach((item, index) => {
      mesh.setMatrixAt(
        index,
        matrixFor(
          item,
          item.y + item.height / 2,
          cylinder
            ? new THREE.Vector3(item.width / 2, item.height, item.depth / 2)
            : new THREE.Vector3(item.width, item.height, item.depth),
        ),
      );
    });
    mesh.instanceMatrix.needsUpdate = true;
    root.add(mesh);
  }
}

function disposeRoot(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    geometries.add(node.geometry);
    const values = Array.isArray(node.material) ? node.material : [node.material];
    values.forEach((entry) => materials.add(entry));
  });
  geometries.forEach((entry) => entry.dispose());
  materials.forEach((entry) => entry.dispose());
}

export function createArchitecturalSiteEnvironment(
  bounds: THREE.Box3,
  renderer: THREE.WebGLRenderer,
  mobile: boolean,
  presentation = false,
  groundElevation?: number,
  baselinePolicy: "empty-only" | "always" = "empty-only",
  waterMotion = true,
  sourceSiteIncluded = false,
  landscapePreset: PresentationLandscapePreset = "auto",
  universalGroundCover = presentation,
  buildingBounds: THREE.Box3 = bounds,
  buildingOutline: readonly { x: number; z: number }[] = [],
  grassOnlyPresentation = false,
) {
  configureProceduralSurfaceTextures(renderer);
  const root = new THREE.Group();
  root.name = "source-backed-site-environment";
  const elements = getPublicRuntimeSiteElements();
  root.userData.sourceBackedSiteElementCount = elements.length;
  root.userData.sourceSiteGeometryIncluded = sourceSiteIncluded;

  const areas = elements.filter((item) => AREA_KINDS.has(item.kind));
  const trees = elements.filter((item) => item.kind === "tree");
  const plants = elements.filter((item) => item.kind === "plant");
  const gates = elements.filter((item) => item.kind === "gate");
  const waterElements = elements.filter((item) => item.kind === "water");
  const lights = elements.filter((item) => item.kind === "outdoor-light");
  const structural = elements.filter((item) => STRUCTURAL_KINDS.has(item.kind));

  const presentationBulbs: THREE.MeshStandardMaterial[] = [];
  // This root contains generated presentation dressing and reviewed site visuals only;
  // source Building geometry is never moved by the environment motion controller.
  root.userData.presentationOnly = true;
  root.userData.nonAuthoritative = true;

  // Customer-facing 3D is intentionally just the unmodified source model
  // surrounded by flat green grass. Do not instantiate roads, trees, fences,
  // site-area meshes, vehicles, decorative fallback or other site dressing.
  // The operator/editor path retains the original source-backed functionality.
  if (grassOnlyPresentation) {
    root.userData.environmentMode = "flat-grass-only";
    let grassCover: ReturnType<typeof createUniversalGrassGroundCover> | undefined;
    if (!bounds.isEmpty()) {
      const footprintSize = buildingBounds.getSize(new THREE.Vector3());
      const footprintCenter = buildingBounds.getCenter(new THREE.Vector3());
      const exclusions: GrassCoverArea[] = footprintSize.x > 0 && footprintSize.z > 0
        ? [{
            kind: "building-footprint",
            x: footprintCenter.x,
            z: footprintCenter.z,
            width: footprintSize.x,
            depth: footprintSize.z,
            rotation: 0,
          }]
        : [];
      grassCover = createUniversalGrassGroundCover({
        bounds,
        footprintBounds: buildingBounds,
        footprintOutline: buildingOutline,
        groundElevation: typeof groundElevation === "number" && Number.isFinite(groundElevation)
          ? groundElevation : bounds.min.y,
        mobile,
        excludedAreas: exclusions,
        lawnAreas: [],
        flatSurface: true,
      });
      root.add(grassCover.root);
    }
    return {
      root,
      update(_deltaSeconds: number) {},
      setNight(night: boolean) { grassCover?.setNight(night); },
      dispose() { disposeRoot(root); root.clear(); },
    };
  }

  // Basement bounds are not a ground survey. Omit optional dressing if grade is unknown.
  const knownGrade =
    typeof groundElevation === "number" && Number.isFinite(groundElevation);
  const safeGround = knownGrade || bounds.min.y >= -0.25;
  const shouldAddBaseline =
    presentation &&
    !bounds.isEmpty() &&
    safeGround &&
    (baselinePolicy === "always" || elements.length === 0);
  const hasRoad = areas.some((item) => item.kind === "road");
  const hasPath = areas.some((item) => item.kind === "path");
  const hasLawn = areas.some(
    (item) => item.kind === "garden" || item.kind === "lawn",
  );
  const modelSize = buildingBounds.getSize(new THREE.Vector3());
  const modelCenter = buildingBounds.getCenter(new THREE.Vector3());
  const grassExcludedAreas: GrassCoverArea[] = [
    // The source model's projected footprint is a conservative hard exclusion:
    // grass blades must never sprout through a building, even when its ground floor
    // has openings or the legacy project has no surveyed footprint polygon.
    ...(modelSize.x > 0 && modelSize.z > 0
      ? [{
          kind: "building-footprint",
          x: modelCenter.x,
          z: modelCenter.z,
          width: modelSize.x,
          depth: modelSize.z,
          rotation: 0,
        }]
      : []),
    ...areas
      .filter((item) => item.kind === "road" || item.kind === "parking" || item.kind === "path")
      .map((item) => ({
        kind: item.kind,
        x: item.x,
        z: item.z,
        width: item.width,
        depth: item.depth,
        rotation: item.rotation,
        y: item.y,
        height: item.height,
      })),
  ];
  const lawnAreas: GrassCoverArea[] = areas
    .filter((item) => item.kind === "garden" || item.kind === "lawn")
    .map((item) => ({
      kind: item.kind,
      x: item.x,
      z: item.z,
      width: item.width,
      depth: item.depth,
      rotation: item.rotation,
      y: item.y,
      height: item.height,
    }));

  // Match built-in road/paving footprints so instanced blades never grow
  // through them. The curved turf remains presentation-only, not survey data.
  if (shouldAddBaseline) {
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const span = Math.max(size.x, size.z, size.y * 0.48, 8);
    const margin = Math.max(span * 0.24, 2.8);
    const siteWidth = Math.max(size.x + margin * 2.4, span * 1.9);
    const roadDepth =
      landscapePreset === "rural-farm"
        ? Math.max(span * 0.16, 3.2)
        : Math.max(span * 0.34, 4.8);
    const roadZ = bounds.max.z + margin * 0.58 + roadDepth / 2;
    const sidewalkDepth = Math.max(span * 0.075, 1.2);
    const sidewalkZ = roadZ - roadDepth / 2 - sidewalkDepth / 2 - 0.18;
    if (landscapePreset !== "hillside" && !hasRoad) {
      grassExcludedAreas.push({
        kind: "fallback-road",
        x: center.x,
        z: roadZ,
        width: siteWidth * 8,
        depth: roadDepth,
        rotation: 0,
      });
    }
    const includeFallbackSidewalk =
      landscapePreset !== "rural-farm" &&
      landscapePreset !== "hillside" &&
      !hasPath;
    if (includeFallbackSidewalk) {
      grassExcludedAreas.push({
        kind: "fallback-sidewalk",
        x: center.x,
        z: sidewalkZ,
        width: siteWidth * 1.18,
        depth: sidewalkDepth,
        rotation: 0,
      });
      grassExcludedAreas.push({
        kind: "fallback-curb",
        x: center.x,
        z: sidewalkZ + sidewalkDepth / 2,
        width: siteWidth * 1.18,
        depth: 0.18,
        rotation: 0,
      });
    }
    if (!hasPath) {
      const driveDepth = Math.max(
        sidewalkZ - sidewalkDepth / 2 - bounds.max.z,
        1.2,
      );
      grassExcludedAreas.push({
        kind: "fallback-driveway",
        x: center.x + size.x * 0.16,
        z: bounds.max.z + driveDepth / 2,
        width: Math.max(size.x * 0.28, 2.4),
        depth: driveDepth,
        rotation: 0,
      });
    }
  }

  let universalCover:
    | ReturnType<typeof createUniversalGrassGroundCover>
    | undefined;
  if (universalGroundCover && !bounds.isEmpty() && safeGround) {
    universalCover = createUniversalGrassGroundCover({
      bounds,
      footprintBounds: buildingBounds,
      footprintOutline: buildingOutline,
      groundElevation:
        knownGrade && typeof groundElevation === "number"
          ? groundElevation
          : bounds.min.y,
      mobile,
      excludedAreas: grassExcludedAreas,
      lawnAreas,
    });
    root.add(universalCover.root);
  }

  if (shouldAddBaseline) {
    const baselineOptions = elements.length
      ? {
          includeGround: false,
          includeSurroundingGround: false,
          includeRoad: landscapePreset !== "hillside" && !hasRoad,
          includeCars: false,
          landscapePreset,
          includeSidewalk: landscapePreset !== "rural-farm" && landscapePreset !== "hillside" && !hasPath,
          includeDriveway: !hasPath,
          includeLawn: landscapePreset !== "rural-farm" && !hasLawn,
          includeTrees: trees.length === 0,
          includePlants: false, // Never add the four synthetic entrance-side pots.
          includeLamps: landscapePreset !== "rural-farm" && lights.length === 0,
          includeContextMassing: false,
        }
      : {
          // Until curated vehicle/context GLB assets ship, avoid adding blocky
          // placeholder cars or neighborhood cuboids to the cinematic profile.
          landscapePreset,
          includeGround: false,
          includeSurroundingGround: false,
          includeCars: landscapePreset === "urban" && !mobile,
          includePlants: false, // Keep the frontage clear across every camera preset.
          includeContextMassing: false,
        };

    addPresentationFallback(
      root,
      bounds,
      mobile,
      presentationBulbs,
      knownGrade ? groundElevation : bounds.min.y,
      baselineOptions,
    );
  }

  addAreaBatches(root, areas);
  addTreeBatches(root, trees, mobile);
  addPlantBatches(root, plants, mobile);
  gates.forEach((item) => addGate(root, item, mobile));
  const waterSurfaces = addWaterSurfaces(root, waterElements, mobile, presentation && waterMotion);
  const bulbMaterial = addOutdoorLights(root, lights, mobile);
  addStructuralBatches(root, structural, mobile);

  return {
    root,
    update(deltaSeconds: number) {
      if (!presentation || !Number.isFinite(deltaSeconds)) return;
      const delta = Math.min(Math.max(deltaSeconds, 0), 0.05);
      for (const surface of waterSurfaces) {
        if (surface.material.userData.waterAnimationEnabled !== true) continue;
        surface.elapsed += delta;
        surface.material.userData.elapsed = surface.elapsed;
        const shader = surface.material.userData.waterShader as
          | { uniforms: Record<string, { value: number }> }
          | undefined;
        if (shader?.uniforms.uRekixoWaterTime)
          shader.uniforms.uRekixoWaterTime.value = surface.elapsed;
      }
    },
    setNight(night: boolean) {
      if (bulbMaterial) bulbMaterial.emissiveIntensity = night ? 4.2 : 0.38;
      for (const bulb of presentationBulbs) bulb.emissiveIntensity = night ? 4.2 : 0.38;
      universalCover?.setNight(night);
    },
    dispose() {
      disposeRoot(root);
      root.clear();
    },
  };
}
