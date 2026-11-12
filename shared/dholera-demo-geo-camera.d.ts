export const DHOLERA_GLB_DEMO_SLUG: "dholera-villas-glb-demo-5809b995";
export type GeoVector3 = {x:number;y:number;z:number};
export type GeoBounds3 = {min:GeoVector3;max:GeoVector3};
export type GeoViewport = {width:number;height:number};
export function dholeraDemoFocusCenter(
  slug:string,
  anchor:{lat:number;lng:number},
  bounds:GeoBounds3,
):{lat:number;lng:number}|null;
export function dholeraProjectedModelSize(
  slug:string,
  bounds:GeoBounds3,
  matrix:{elements:ArrayLike<number>}|ArrayLike<number>,
  viewport:GeoViewport,
):GeoViewport|null;
export function dholeraDemoZoomCorrection(
  slug:string,
  rendered:GeoViewport|null,
  viewport:GeoViewport,
):number|null;
export function dholeraDemoGroundTargetZoom(
  slug:string,
  bounds:GeoBounds3,
  latitude:number,
  viewport:GeoViewport,
):number|null;
export function dholeraDemoPresentationBoost(
  slug:string,projected:GeoViewport|null,viewport:GeoViewport,
  hasMappedPlots?:boolean,
):number|null;
