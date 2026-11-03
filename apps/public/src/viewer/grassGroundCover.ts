import * as THREE from "three";
import { proceduralSurfaceTexture } from "./proceduralSurfaceMaterials";

export interface GrassCoverArea {
  kind: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  rotation: number;
  y?: number;
  height?: number;
}

export interface GrassGroundCoverOptions {
  /** Overall loaded site/model bounds used to size the distant landscape. */
  bounds: THREE.Box3;
  /** Measured building bounds used only for the inner ground cutout. */
  footprintBounds?: THREE.Box3;
  /** Optional measured outer building outline in world X/Z, for non-rectangular walls. */
  footprintOutline?: readonly FootprintPoint[];
  groundElevation: number;
  mobile: boolean;
  /** Reviewed paving/road areas plus any generated fallback hardscape. */
  excludedAreas: readonly GrassCoverArea[];
  /** Reviewed lawn rectangles get blades rooted at the lawn's actual top surface. */
  lawnAreas: readonly GrassCoverArea[];
  /** A truly level, uniformly green surface instead of a curved sky-tinted horizon. */
  flatSurface?: boolean;
}

interface GrassBladeInstance {
  x: number;
  y: number;
  z: number;
  rotation: number;
  color: THREE.Color;
  variation: number;
}

const GRASS_HEIGHTS_METRES = [0.0254, 0.0508, 0.0762] as const;
const TAU = Math.PI * 2;

function smooth01(value: number) {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function seededRandom(initialSeed: number) {
  let seed = initialSeed >>> 0;
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function containsArea(x: number, z: number, area: GrassCoverArea, padding = 0) {
  const angle = THREE.MathUtils.degToRad(area.rotation || 0);
  const dx = x - area.x;
  const dz = z - area.z;
  const localX = dx * Math.cos(angle) - dz * Math.sin(angle);
  const localZ = dx * Math.sin(angle) + dz * Math.cos(angle);
  return (
    Math.abs(localX) <= area.width / 2 + padding &&
    Math.abs(localZ) <= area.depth / 2 + padding
  );
}

function surfaceYFor(
  x: number,
  z: number,
  groundElevation: number,
  lawnAreas: readonly GrassCoverArea[],
) {
  for (let index = lawnAreas.length - 1; index >= 0; index -= 1) {
    const area = lawnAreas[index];
    if (!containsArea(x, z, area, -0.015)) continue;
    const height = Math.max(0.02, area.height ?? 0.02);
    return (area.y ?? groundElevation) + height + 0.012;
  }
  return groundElevation + 0.004;
}

interface FootprintPoint {
  x: number;
  z: number;
}

/** Normalize, de-duplicate, and order a projected source-mesh footprint. */
function normalizeFootprint(points: readonly FootprintPoint[]): FootprintPoint[] {
  const unique: FootprintPoint[] = [];
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.z)) continue;
    if (unique.every((other) => Math.hypot(other.x - point.x, other.z - point.z) > 1e-4)) {
      unique.push(point);
    }
  }
  if (unique.length < 3) return [];
  const center = unique.reduce(
    (sum, point) => ({ x: sum.x + point.x / unique.length, z: sum.z + point.z / unique.length }),
    { x: 0, z: 0 },
  );
  unique.sort((left, right) =>
    Math.atan2(left.z - center.z, left.x - center.x) -
    Math.atan2(right.z - center.z, right.x - center.x),
  );
  return unique;
}

function polygonArea(points: readonly FootprintPoint[]) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    area += a.x * b.z - b.x * a.z;
  }
  return Math.abs(area) * 0.5;
}

function pointOnSegment(
  point: FootprintPoint,
  start: FootprintPoint,
  end: FootprintPoint,
) {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared < 1e-12) return Math.hypot(point.x - start.x, point.z - start.z) < 1e-5;
  const t = THREE.MathUtils.clamp(
    ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared,
    0,
    1,
  );
  return Math.hypot(point.x - (start.x + t * dx), point.z - (start.z + t * dz)) < 1e-5;
}

function insidePolygon(point: FootprintPoint, polygon: readonly FootprintPoint[]) {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const a = polygon[current];
    const b = polygon[previous];
    if (pointOnSegment(point, a, b)) return true;
    const crosses = (a.z > point.z) !== (b.z > point.z) &&
      point.x < ((b.x - a.x) * (point.z - a.z)) / (b.z - a.z) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function distanceToSegment(point: FootprintPoint, a: FootprintPoint, b: FootprintPoint) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared < 1e-12
    ? 0
    : THREE.MathUtils.clamp(
        ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSquared,
        0,
        1,
      );
  return Math.hypot(point.x - (a.x + dx * t), point.z - (a.z + dz * t));
}

/** A rounded buffer of the measured polygon keeps turf just outside the wall line. */
function insideBufferedFootprint(
  point: FootprintPoint,
  polygon: readonly FootprintPoint[],
  padding: number,
) {
  if (insidePolygon(point, polygon)) return true;
  for (let index = 0; index < polygon.length; index += 1) {
    if (distanceToSegment(point, polygon[index], polygon[(index + 1) % polygon.length]) <= padding) {
      return true;
    }
  }
  return false;
}

function radialBoundary(
  angle: number,
  polygon: readonly FootprintPoint[],
  fallbackHalfX: number,
  fallbackHalfZ: number,
  center: FootprintPoint,
  padding: number,
) {
  const direction = { x: Math.cos(angle), z: Math.sin(angle) };
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    const edge = { x: b.x - a.x, z: b.z - a.z };
    const offset = { x: a.x - center.x, z: a.z - center.z };
    const denominator = direction.x * edge.z - direction.z * edge.x;
    if (Math.abs(denominator) < 1e-9) continue;
    const distance = (offset.x * edge.z - offset.z * edge.x) / denominator;
    const along = (offset.x * direction.z - offset.z * direction.x) / denominator;
    if (distance >= 0 && along >= -1e-7 && along <= 1 + 1e-7) {
      nearest = Math.min(nearest, distance);
    }
  }
  if (Number.isFinite(nearest)) return nearest + padding;
  const x = fallbackHalfX / Math.max(Math.abs(direction.x), 1e-6);
  const z = fallbackHalfZ / Math.max(Math.abs(direction.z), 1e-6);
  return Math.min(x, z) + padding;
}

function createCurvedGroundGeometry(
  radius: number,
  rise: number,
  mobile: boolean,
  footprintHalfX: number,
  footprintHalfZ: number,
  footprintOutline: readonly FootprintPoint[],
  footprintCenter: FootprintPoint,
  flatSurface = false,
) {
  const baseSegments = mobile ? 64 : 112;
  const rings = mobile ? 22 : 36;
  const polygon = normalizeFootprint(footprintOutline);
  const innerRadiusAt = (angle: number) =>
    radialBoundary(
      angle,
      polygon,
      footprintHalfX,
      footprintHalfZ,
      footprintCenter,
      0.18,
    );
  const cornerHalfX = Math.max(footprintHalfX + 0.18, 0.6);
  const cornerHalfZ = Math.max(footprintHalfZ + 0.18, 0.6);
  const cornerAngle = Math.atan2(cornerHalfZ, cornerHalfX);
  const angles = Array.from(
    { length: baseSegments },
    (_, segment) => (segment / baseSegments) * TAU,
  );
  if (polygon.length >= 3) {
    for (const point of polygon) {
      angles.push(Math.atan2(point.z - footprintCenter.z, point.x - footprintCenter.x));
    }
  } else {
    angles.push(cornerAngle, Math.PI - cornerAngle, Math.PI + cornerAngle, TAU - cornerAngle);
  }
  angles.sort((left, right) => left - right);
  const uniqueAngles = angles.filter(
    (angle, index) => index === 0 || Math.abs(angle - angles[index - 1]) > 1e-7,
  );
  const segments = uniqueAngles.length;

  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const turfNear = new THREE.Color("#557e3e");
  const turfFar = new THREE.Color("#748f60");
  const horizonHaze = new THREE.Color("#a3bdba");
  const cloudEdge = new THREE.Color("#c7d9e0");

  for (let ring = 0; ring <= rings; ring += 1) {
    const t = ring / rings;
    const bend = smooth01((t - 0.70) / 0.30);
    const lift = rise * bend * bend;
    const tint = flatSurface
      ? turfNear.clone()
      : t < 0.70
        ? turfNear.clone().lerp(turfFar, smooth01(t / 0.70) * 0.22)
        : t < 0.84
          ? turfFar.clone().lerp(horizonHaze, smooth01((t - 0.70) / 0.14))
          : horizonHaze.clone().lerp(cloudEdge, smooth01((t - 0.84) / 0.16));
    for (const angle of uniqueAngles) {
      const innerRadius = innerRadiusAt(angle);
      const ringRadius = innerRadius + (radius - innerRadius) * t;
      const x = Math.cos(angle) * ringRadius;
      const z = Math.sin(angle) * ringRadius;
      positions.push(x, lift, z);
      colors.push(tint.r, tint.g, tint.b);
      uvs.push(x / 8, z / 8);
    }
  }

  // Annular topology: no triangles are created inside the polygon cutout.
  for (let ring = 0; ring < rings; ring += 1) {
    const inner = ring * segments;
    const outer = (ring + 1) * segments;
    for (let segment = 0; segment < segments; segment += 1) {
      const next = (segment + 1) % segments;
      const a = inner + segment;
      const b = inner + next;
      const c = outer + next;
      const d = outer + segment;
      indices.push(a, b, d, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
function createGrassClumpGeometry() {
  const positions: number[] = [];
  const indices: number[] = [];
  const addVertex = (x: number, y: number, z: number) => {
    positions.push(x, y, z);
    return positions.length / 3 - 1;
  };
  const triangle = (a: number, b: number, c: number) => {
    indices.push(a, b, c);
  };

  for (let blade = 0; blade < 5; blade += 1) {
    const angle = (blade / 5) * TAU;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const px = -dz;
    const pz = dx;
    const spread = 0.12 + (blade % 2) * 0.035;
    const baseX = dx * (0.06 + (blade % 3) * 0.025);
    const baseZ = dz * (0.06 + (blade % 3) * 0.025);
    const halfBase = 0.12;
    const halfMid = 0.075;

    const baseLeft = addVertex(baseX + px * halfBase, 0, baseZ + pz * halfBase);
    const baseRight = addVertex(baseX - px * halfBase, 0, baseZ - pz * halfBase);
    const midLeft = addVertex(baseX + dx * spread + px * halfMid, 0.54, baseZ + dz * spread + pz * halfMid);
    const midRight = addVertex(baseX + dx * spread - px * halfMid, 0.54, baseZ + dz * spread - pz * halfMid);
    const tip = addVertex(baseX + dx * (spread * 1.9) + px * 0.055, 1, baseZ + dz * (spread * 1.9) + pz * 0.055);

    triangle(baseLeft, midLeft, baseRight);
    triangle(baseRight, midLeft, midRight);
    triangle(midLeft, tip, midRight);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createInstances(
  parent: THREE.Group,
  geometry: THREE.BufferGeometry,
  instances: readonly GrassBladeInstance[],
  tier: 0 | 1 | 2,
) {
  if (instances.length === 0) return;
  const material = new THREE.MeshStandardMaterial({
    color: "#ffffff",
    roughness: 0.96,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, instances.length);
  mesh.name = `Universal grass blades ${GRASS_HEIGHTS_METRES[tier] * 1000}mm`;
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  const dummy = new THREE.Object3D();
  instances.forEach((instance, index) => {
    const height = GRASS_HEIGHTS_METRES[tier] * instance.variation;
    const width = Math.max(0.045, height * 1.8);
    dummy.position.set(instance.x, instance.y, instance.z);
    dummy.rotation.set(0, instance.rotation, 0);
    dummy.scale.set(width, height, width);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
    mesh.setColorAt(index, instance.color);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  parent.add(mesh);
}

/** Presentation-only grass underlay with a low-cost curved, cloud-tinted horizon. */
export function createUniversalGrassGroundCover(options: GrassGroundCoverOptions) {
  const { bounds, groundElevation, mobile, excludedAreas, lawnAreas } = options;
  const flatSurface = options.flatSurface === true;
  const root = new THREE.Group();
  root.name = flatSurface ? "Flat green grass site" : "Universal grass ground cover and curved horizon";
  root.userData.presentationOnly = true;
  root.userData.nonAuthoritative = true;
  root.userData.staticSiteContext = true;

  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  // The loaded source may contain an outer compound wall or site paving. Only
  // the measured Building bounds should become an interior grass-free hole.
  const footprintBounds = options.footprintBounds ?? bounds;
  const footprintSize = footprintBounds.getSize(new THREE.Vector3());
  const footprintCenter = footprintBounds.getCenter(new THREE.Vector3());
  const span = Math.max(size.x, size.z, 8);
  const siteCorners = [
    [bounds.min.x, bounds.min.z],
    [bounds.min.x, bounds.max.z],
    [bounds.max.x, bounds.min.z],
    [bounds.max.x, bounds.max.z],
  ];
  const farthestSiteCorner = Math.max(
    ...siteCorners.map(([x, z]) =>
      Math.hypot(x - footprintCenter.x, z - footprintCenter.z),
    ),
  );
  const preferredRadius = Math.min(Math.max(span * 5, 75), 2000);
  const radius = Math.max(
    preferredRadius,
    farthestSiteCorner + Math.max(span * 0.12, 10),
    footprintSize.x / 2 + footprintSize.z / 2 + 5,
  );
  const rise = flatSurface ? 0 : Math.min(Math.max(span * 0.65, 5), 12);
  const outline = normalizeFootprint(options.footprintOutline ?? []);
  const groundCenter = outline.length >= 3
    ? outline.reduce(
        (sum, point) => ({ x: sum.x + point.x / outline.length, z: sum.z + point.z / outline.length }),
        { x: 0, z: 0 },
      )
    : { x: footprintCenter.x, z: footprintCenter.z };
  const localOutline = outline.map((point) => ({
    x: point.x - groundCenter.x,
    z: point.z - groundCenter.z,
  }));
  const geometry = createCurvedGroundGeometry(
    radius,
    rise,
    mobile,
    footprintSize.x / 2,
    footprintSize.z / 2,
    localOutline,
    { x: 0, z: 0 },
    flatSurface,
  );
  const terrainMaterial = new THREE.MeshStandardMaterial({
    name: "Procedural turf blending into a soft cloud horizon",
    color: "#ffffff",
    map: proceduralSurfaceTexture("grass"),
    vertexColors: true,
    roughness: 0.98,
    metalness: 0,
  });
  const ground = new THREE.Mesh(geometry, terrainMaterial);
  ground.name = flatSurface ? "Flat green grass surface" : "Curved turf and horizon surface";
  ground.castShadow = false;
  ground.receiveShadow = !mobile;
  root.add(ground);
  // The annular terrain is centered on the actual building footprint, while
  // its radius is large enough to cover the full loaded site bounds.
  root.position.set(
    groundCenter.x,
    groundElevation - 0.055,
    groundCenter.z,
  );

  const targetCount = mobile ? 720 : 3600;
  const bladeRadius = Math.min(Math.max(span * 0.78, 12), 28);
  const random = seededRandom(
    Math.floor(span * 1000) ^
      Math.floor(Math.abs(center.x) * 17) ^
      Math.floor(Math.abs(center.z) * 31) ^
      0x5f3759df,
  );
  const instances: GrassBladeInstance[][] = [[], [], []];
  let attempts = 0;
  const maxAttempts = targetCount * 12;
  while (instances[0].length + instances[1].length + instances[2].length < targetCount && attempts < maxAttempts) {
    attempts += 1;
    const angle = random() * TAU;
    const distance = Math.sqrt(random()) * bladeRadius;
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;
    const worldX = center.x + x;
    const worldZ = center.z + z;

    if (
      (outline.length >= 3 &&
        insideBufferedFootprint({ x: worldX, z: worldZ }, outline, 0.18)) ||
      excludedAreas.some((area) => containsArea(worldX, worldZ, area, 0.035))
    ) continue;

    const slot = instances[0].length + instances[1].length + instances[2].length;
    const tier: 0 | 1 | 2 = slot % 10 < 5 ? 0 : slot % 10 < 8 ? 1 : 2;
    const color = new THREE.Color().setHSL(
      0.255 + random() * 0.055,
      0.34 + random() * 0.25,
      0.27 + random() * 0.12,
    );
    const surfaceY = surfaceYFor(worldX, worldZ, groundElevation, lawnAreas);
    instances[tier].push({
      // Blade instances are rooted relative to the building-centered ground
      // mesh, not the overall source-model/site center.
      x: worldX - groundCenter.x,
      y: surfaceY - (groundElevation - 0.055) + 0.001,
      z: worldZ - groundCenter.z,
      rotation: random() * TAU,
      color,
      variation: 0.88 + random() * 0.24,
    });
  }

  const blades = createGrassClumpGeometry();
  for (const tier of [0, 1, 2] as const) {
    createInstances(root, blades, instances[tier], tier);
  }

  const setNight = (night: boolean) => {
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const entry of materials) {
        if (entry instanceof THREE.MeshStandardMaterial) {
          entry.color.set(night ? "#5d6879" : "#ffffff");
        }
      }
    });
  };

  root.userData.grassBladeInstanceCount = instances.reduce((sum, tier) => sum + tier.length, 0);
  root.userData.grassBladeTierCounts = instances.map((tier) => tier.length);
  root.userData.horizonRadius = radius;
  root.userData.horizonRise = rise;
  root.userData.flatGrassOnly = flatSurface;

  return {
    root,
    setNight,
    dispose() {
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      root.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        geometries.add(object.geometry);
        const list = Array.isArray(object.material) ? object.material : [object.material];
        list.forEach((entry) => materials.add(entry));
      });
      geometries.forEach((entry) => entry.dispose());
      materials.forEach((entry) => entry.dispose());
      root.clear();
    },
  };
}
