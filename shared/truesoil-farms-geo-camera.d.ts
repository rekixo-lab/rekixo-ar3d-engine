export const TRUESOIL_FARMS_GEO_SLUG: "truesoil-farms-3d-8a7cf13c";
export type TruesoilGeoCameraView = "overview" | "front" | "corner" | "entry" | "aerial";
export type TruesoilGeoVector = {x:number;y:number;z?:number};
export function truesoilFarmsOpeningPreset(
  slug:string,
  view:TruesoilGeoCameraView,
):{zoom:number;tilt:number;heading:number}|null;
export function truesoilFarmsFitCamera(
  slug:string,
  anchor:{lat:number;lng:number},
  bounds:{min:TruesoilGeoVector;max:TruesoilGeoVector},
  viewport:{width:number;height:number},
):{center:{lat:number;lng:number};zoom:number;tilt:number;heading:number}|null;
