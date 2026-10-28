export type GeoGuidedLatLng = {
  latitude: number;
  longitude: number;
};

export type GeoGuidedSourcePoint = {
  x: number;
  y: number;
  z: number;
};

export type GeoGuidedControlPair = {
  id: string;
  source: GeoGuidedSourcePoint;
  target: GeoGuidedLatLng;
};

export type GeoGuidedPointDiagnostic = {
  id: string;
  errorM: number;
};

export type GeoGuidedRigidSolution = {
  pointCount: number;
  eastOffsetM: number;
  northOffsetM: number;
  headingDeg: number;
  scale: number;
  rmsErrorM: number;
  maxErrorM: number;
  worstPointId: string | null;
  points: GeoGuidedPointDiagnostic[];
};

type LocalPoint = { east: number; north: number };

const EARTH_RADIUS_M = 6378137;
const MIN_SOURCE_SPREAD_M2 = 0.01;
const MIN_TARGET_SPREAD_M2 = 0.01;
const MIN_GUIDED_SCALE = 0.5;
const MAX_GUIDED_SCALE = 1.5;
// An operator must explicitly acknowledge the source unit and ground survey
// discrepancy before expanding the fitting envelope. Never silently loosen
// ordinary drafting limits or mutate the underlying canonical geometry.
const MIN_EXTENDED_GUIDED_SCALE = 0.1;
const MAX_EXTENDED_GUIDED_SCALE = 5;

function finite(value: number, label: string) {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite.`);
  return value;
}

function validLatLng(point: GeoGuidedLatLng) {
  finite(point.latitude, "Geo latitude");
  finite(point.longitude, "Geo longitude");
  if (point.latitude < -90 || point.latitude > 90)
    throw new Error("Geo latitude must be between -90 and 90.");
  if (point.longitude < -180 || point.longitude > 180)
    throw new Error("Geo longitude must be between -180 and 180.");
}

function normalizeHeading(value: number) {
  let heading = value % 360;
  if (heading <= -180) heading += 360;
  if (heading > 180) heading -= 360;
  return heading;
}

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Converts a geographic point into a small-site local ENU metre frame around
 * the immutable Geo draft WGS84 anchor. This equirectangular tangent-plane
 * approximation is intentionally limited to authoring/site-scale alignment;
 * published geographic truth remains the original WGS84 anchor plus ENU.
 */
export function geoLatLngToLocalEnu(
  origin: GeoGuidedLatLng,
  point: GeoGuidedLatLng,
): LocalPoint {
  validLatLng(origin);
  validLatLng(point);
  const radians = Math.PI / 180;
  const meanLatitude = (origin.latitude + point.latitude) * 0.5 * radians;
  return {
    east:
      (point.longitude - origin.longitude) * radians * EARTH_RADIUS_M *
      Math.max(1e-7, Math.cos(meanLatitude)),
    north: (point.latitude - origin.latitude) * radians * EARTH_RADIUS_M,
  };
}

/**
 * Canonical Rekixo Buildings are +Y-up. The shared rigid Geo transform first
 * rotates that frame +90deg about X, so the ground plane becomes X=east and
 * -Z=north before heading is applied. Keep this mapping in one shared helper so
 * the guided solver cannot drift from Admin/Public placement math.
 */
export function geoCanonicalPointToAnchorEnu(
  point: GeoGuidedSourcePoint,
  anchor: GeoGuidedSourcePoint,
): LocalPoint {
  return {
    east: finite(point.x, "Guided source X") - finite(anchor.x, "Guided anchor X"),
    north: -(finite(point.z, "Guided source Z") - finite(anchor.z, "Guided anchor Z")),
  };
}

/**
 * Best-fit 2D rigid/similarity solve for Building-to-ground control pairs.
 *
 * - minimum 2 pairs: heading + East/North translation
 * - 3/4 pairs: least-squares fit with real residual diagnostics
 * - uniform scale is fixed at 1 by default and can only be solved explicitly
 * - opt-in extended scale requires at least 3 real paired points and operator review
 * - no shear, homography, perspective warp, or non-uniform scale can enter
 */
export function solveGeoGuidedRigidAlignment(
  origin: GeoGuidedLatLng,
  anchor: GeoGuidedSourcePoint,
  pairs: GeoGuidedControlPair[],
  options: { allowScale?: boolean; allowExtendedScale?: boolean } = {},
): GeoGuidedRigidSolution {
  validLatLng(origin);
  if (pairs.length < 2) throw new Error("Guided rigid alignment needs at least 2 paired points.");
  if (pairs.length > 12) throw new Error("Guided rigid alignment supports at most 12 paired points.");
  if (options.allowExtendedScale && !options.allowScale)
    throw new Error("Extended scale requires explicit uniform-scale solving.");
  if (options.allowExtendedScale && pairs.length < 3)
    throw new Error("Extended scale needs at least 3 independently matched site points.");
  const ids = new Set<string>();
  for (const pair of pairs) {
    if (!pair.id.trim()) throw new Error("Guided point id is required.");
    if (ids.has(pair.id)) throw new Error(`Duplicate guided point id: ${pair.id}`);
    ids.add(pair.id);
    validLatLng(pair.target);
  }

  const source = pairs.map((pair) => geoCanonicalPointToAnchorEnu(pair.source, anchor));
  const target = pairs.map((pair) => geoLatLngToLocalEnu(origin, pair.target));
  const sourceMean = {
    east: mean(source.map((point) => point.east)),
    north: mean(source.map((point) => point.north)),
  };
  const targetMean = {
    east: mean(target.map((point) => point.east)),
    north: mean(target.map((point) => point.north)),
  };

  let sourceEnergy = 0;
  let targetEnergy = 0;
  let dot = 0;
  let cross = 0;
  for (let index = 0; index < pairs.length; index += 1) {
    const sx = source[index].east - sourceMean.east;
    const sy = source[index].north - sourceMean.north;
    const tx = target[index].east - targetMean.east;
    const ty = target[index].north - targetMean.north;
    sourceEnergy += sx * sx + sy * sy;
    targetEnergy += tx * tx + ty * ty;
    dot += sx * tx + sy * ty;
    cross += sx * ty - sy * tx;
  }
  if (sourceEnergy < MIN_SOURCE_SPREAD_M2)
    throw new Error("Building control points are too close together. Pick separated corners.");
  if (targetEnergy < MIN_TARGET_SPREAD_M2)
    throw new Error("Map control points are too close together. Pick separated real corners.");

  const theta = Math.atan2(cross, dot);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  let scale = 1;
  if (options.allowScale) {
    scale = Math.hypot(dot, cross) / sourceEnergy;
    const minimum = options.allowExtendedScale ? MIN_EXTENDED_GUIDED_SCALE : MIN_GUIDED_SCALE;
    const maximum = options.allowExtendedScale ? MAX_EXTENDED_GUIDED_SCALE : MAX_GUIDED_SCALE;
    if (!Number.isFinite(scale) || scale < minimum || scale > maximum)
      throw new Error(
        `Measured uniform scale ${Number.isFinite(scale) ? scale.toFixed(3) : "invalid"}x is outside ${minimum}–${maximum}x. Review the canonical model units and real plot dimensions.`,
      );
  }

  const rotatedSourceMean = {
    east: scale * (cos * sourceMean.east - sin * sourceMean.north),
    north: scale * (sin * sourceMean.east + cos * sourceMean.north),
  };
  const eastOffsetM = targetMean.east - rotatedSourceMean.east;
  const northOffsetM = targetMean.north - rotatedSourceMean.north;

  const diagnostics = pairs.map((pair, index) => {
    const sx = source[index].east;
    const sy = source[index].north;
    const predictedEast = eastOffsetM + scale * (cos * sx - sin * sy);
    const predictedNorth = northOffsetM + scale * (sin * sx + cos * sy);
    const errorM = Math.hypot(
      predictedEast - target[index].east,
      predictedNorth - target[index].north,
    );
    return { id: pair.id, errorM };
  });
  const rmsErrorM = Math.sqrt(
    diagnostics.reduce((sum, item) => sum + item.errorM * item.errorM, 0) /
      diagnostics.length,
  );
  const maxErrorM = Math.max(...diagnostics.map((item) => item.errorM));
  const worstPoint = diagnostics.reduce<GeoGuidedPointDiagnostic | null>(
    (worst, item) => !worst || item.errorM > worst.errorM ? item : worst,
    null,
  );

  return {
    pointCount: pairs.length,
    eastOffsetM,
    northOffsetM,
    headingDeg: normalizeHeading(-theta * 180 / Math.PI),
    scale,
    rmsErrorM,
    maxErrorM,
    worstPointId: worstPoint?.id || null,
    points: diagnostics,
  };
}
