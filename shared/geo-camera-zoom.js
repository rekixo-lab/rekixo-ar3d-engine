// Google Maps zoom values are logarithmic: +1 is 2× magnification.
// Give the Geo customer's camera presets a 50% closer starting view without
// inventing a larger Google Maps native max zoom or rescaling any GLB geometry.
export const GEO_EXTRA_CAMERA_MAGNIFICATION=1.5;
export const GEO_EXTRA_CAMERA_ZOOM=Math.log2(GEO_EXTRA_CAMERA_MAGNIFICATION);
export function closerGeoCameraZoom(baseZoom){
  return Number.isFinite(baseZoom)?baseZoom+GEO_EXTRA_CAMERA_ZOOM:baseZoom;
}
