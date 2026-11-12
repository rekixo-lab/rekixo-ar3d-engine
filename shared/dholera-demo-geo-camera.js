/**
 * Dholera's published Geo placement is intentionally a scaled conceptual
 * demo. Its site camera may focus on the actual GLB's placed ENU bounds, not
 * the original anchor pin. This is presentation-only: no model-space or WGS84
 * placement value is modified.
 *
 * Do not apply to unrelated live projects.
 */
export const DHOLERA_GLB_DEMO_SLUG = "dholera-villas-glb-demo-5809b995";

const finite = (value) => typeof value === "number" && Number.isFinite(value);

export function dholeraDemoFocusCenter(slug, anchor, bounds) {
  if (slug !== DHOLERA_GLB_DEMO_SLUG) return null;
  const { min, max } = bounds || {};
  if (!min || !max || !finite(anchor?.lat) || !finite(anchor?.lng) ||
      ![min.x, min.y, max.x, max.y].every(finite) ||
      max.x < min.x || max.y < min.y || Math.abs(anchor.lat) > 85) return null;

  // The shared Geo rigid plan is expressed as X=east, Y=north, Z=up metres.
  const phi = anchor.lat * Math.PI / 180;
  const latitudeMetres = 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi);
  const longitudeMetres = 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi) + 0.118 * Math.cos(5 * phi);
  if (Math.abs(longitudeMetres) < 1 || latitudeMetres <= 0) return null;
  const lat = anchor.lat + ((min.y + max.y) / 2) / latitudeMetres;
  const lng = anchor.lng + ((min.x + max.x) / 2) / longitudeMetres;
  if (Math.abs(lat) > 85 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/**
 * Change Google camera zoom so the *rendered* model is large but wholly inside
 * the current viewport. Browser map projection supplies actual pixel bounds;
 * no guessed Earth scale, GLB resizing, or artificial Google maxZoom.
 */
export function dholeraDemoZoomCorrection(slug, rendered, viewport) {
  if (slug !== DHOLERA_GLB_DEMO_SLUG) return null;
  const { width, height } = rendered || {};
  const { width: viewWidth, height: viewHeight } = viewport || {};
  if (![width, height, viewWidth, viewHeight].every(finite) ||
      width <= 0 || height <= 0 || viewWidth <= 0 || viewHeight <= 0) return null;
  const widthFactor = (viewWidth * 0.79) / width;
  const heightFactor = (viewHeight * 0.66) / height;
  const ratio = Math.min(widthFactor, heightFactor);
  if (!finite(ratio) || ratio <= 0) return null;
  return Math.max(-1.4, Math.min(1.4, Math.log2(ratio)));
}
