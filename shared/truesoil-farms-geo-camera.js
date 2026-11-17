/**
 * Truesoil Farms customer Geo camera only. The immutable model placement and
 * mapped polygons are unchanged; calculate a north-up visual camera from the
 * already placed metre-space GLB footprint.
 */
export const TRUESOIL_FARMS_GEO_SLUG = "truesoil-farms-3d-8a7cf13c";

const finite = value => typeof value === "number" && Number.isFinite(value);

export function truesoilFarmsOpeningPreset(slug, view) {
  if (slug !== TRUESOIL_FARMS_GEO_SLUG || view !== "overview") return null;
  // Top-down during model verification; the viewport-specific fit replaces
  // the temporary safe zoom once the verified immutable GLB finishes loading.
  return { zoom: 17.5, tilt: 0, heading: 0 };
}

export function truesoilFarmsFitCamera(slug, anchor, bounds, viewport) {
  if (slug !== TRUESOIL_FARMS_GEO_SLUG) return null;
  const min=bounds?.min,max=bounds?.max;
  const width=viewport?.width,height=viewport?.height;
  if (!min || !max || !finite(anchor?.lat) || !finite(anchor?.lng) ||
      ![min.x,min.y,max.x,max.y,width,height].every(finite) ||
      Math.abs(anchor.lat)>85 || Math.abs(anchor.lng)>180 ||
      max.x<=min.x || max.y<=min.y || width<100 || height<100) return null;

  // Local Google overlay placement uses ENU X=east, Y=north, Z=height.
  const phi=anchor.lat*Math.PI/180;
  const northMetres=111132.92-559.82*Math.cos(2*phi)+1.175*Math.cos(4*phi);
  const eastMetres=111412.84*Math.cos(phi)-93.5*Math.cos(3*phi)+.118*Math.cos(5*phi);
  if (!(northMetres>0) || !(eastMetres>0)) return null;

  const center={
    lat:anchor.lat+(min.y+max.y)/2/northMetres,
    lng:anchor.lng+(min.x+max.x)/2/eastMetres,
  };
  if (!finite(center.lat) || !finite(center.lng) ||
      Math.abs(center.lat)>85 || Math.abs(center.lng)>180) return null;

  // For an unrotated, tilt=0 map, screen axes correspond to local ENU east/north.
  // Reserve generous gutters so the entire long access road and mapped plots
  // stay within the screen on portrait phones and short desktop viewports.
  const metresPerPixelAtZoomZero=156543.03392804097*Math.cos(phi);
  const requiredMetresPerPixel=Math.max(
    (max.x-min.x)/(width*0.78),
    (max.y-min.y)/(height*0.76),
  );
  if (!(metresPerPixelAtZoomZero>0) || !(requiredMetresPerPixel>0)) return null;
  const fitZoom=Math.log2(metresPerPixelAtZoomZero/requiredMetresPerPixel);
  if (!finite(fitZoom)) return null;
  return {
    center,
    zoom:Math.max(1,Math.min(21,Math.floor(fitZoom*100)/100)),
    tilt:0,
    heading:0,
  };
}
