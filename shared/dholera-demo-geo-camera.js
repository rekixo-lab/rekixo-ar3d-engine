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
  // This is a close-up promotional camera, NOT a geometry correction.
  // Previous symmetric fitting shrank the already correctly framed model
  // after loading whenever Google reported transient oversized clip bounds.
  // Never zoom OUT automatically: only fill remaining screen room on zoom IN.
  const widthFactor = (viewWidth * 0.86) / width;
  const heightFactor = (viewHeight * 0.80) / height;
  const ratio = Math.min(widthFactor, heightFactor);
  if (!finite(ratio) || ratio <= 0) return null;
  return Math.max(0, Math.min(1.4, Math.log2(ratio)));
}

/**
 * Convert the already placed ENU Box3 into on-screen pixels using Google's
 * actual WebGL overlay projection matrix. Camera tilt/perspective are thus
 * accounted for rather than inferred from the nominal map zoom level.
 */
export function dholeraProjectedModelSize(slug, bounds, matrix, viewport) {
  if (slug !== DHOLERA_GLB_DEMO_SLUG) return null;
  const m = matrix?.elements ?? matrix;
  const min = bounds?.min, max = bounds?.max;
  const width = viewport?.width, height = viewport?.height;
  if (!m || m.length !== 16 || !min || !max ||
      !finite(width) || !finite(height) || width <= 0 || height <= 0 ||
      ![min.x,min.y,min.z,max.x,max.y,max.z].every(finite)) return null;
  let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity;
  for (const x of [min.x,max.x])
    for (const y of [min.y,max.y])
      for (const z of [min.z,max.z]) {
        const w=m[3]*x+m[7]*y+m[11]*z+m[15];
        if (!finite(w) || w <= 0.000001) return null;
        const sx=(m[0]*x+m[4]*y+m[8]*z+m[12])/w;
        const sy=(m[1]*x+m[5]*y+m[9]*z+m[13])/w;
        if (!finite(sx) || !finite(sy)) return null;
        const px=(sx+1)*0.5*width,py=(1-sy)*0.5*height;
        minX=Math.min(minX,px);maxX=Math.max(maxX,px);
        minY=Math.min(minY,py);maxY=Math.max(maxY,py);
      }
  return {width:maxX-minX,height:maxY-minY};
}

/**
 * First close camera for a long, shallow conceptual GLB. Use its *saved-scale*
 * ENU footprint rather than transient Google WebGL clip bounds during loading.
 * Google still owns its native maximum zoom and perspective.
 */
export function dholeraDemoGroundTargetZoom(slug, bounds, latitude, viewport) {
  if (slug !== DHOLERA_GLB_DEMO_SLUG || !finite(latitude) || Math.abs(latitude) > 85) return null;
  const min=bounds?.min, max=bounds?.max;
  const width=viewport?.width,height=viewport?.height;
  if (!min || !max || ![min.x,min.y,max.x,max.y,width,height].every(finite) ||
      width <= 0 || height <= 0) return null;
  const eastExtent=max.x-min.x,northExtent=max.y-min.y;
  if (eastExtent <= 0 || northExtent < 0) return null;
  // Latitude-correct spherical Mercator metres/pixel at zoom zero.
  const metresPerPixelAtZoomZero=156543.03392804097*Math.cos(latitude*Math.PI/180);
  const requiredMetresPerPixel=Math.max(
    eastExtent/(width*0.83),
    northExtent/(height*0.90),
  );
  if (!(requiredMetresPerPixel>0) || !(metresPerPixelAtZoomZero>0)) return null;
  return Math.max(0,Math.log2(metresPerPixelAtZoomZero/requiredMetresPerPixel));
}
