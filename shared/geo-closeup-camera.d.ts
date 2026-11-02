export type GeoCloseupView="overview"|"front"|"corner"|"aerial";
export type GeoCloseupPlot={corners:Array<[number,number]>;planeY?:number;
 sides?:Record<string,{edges?:number[];roadFacing?:boolean}>};
export function geoCloseupCameraOffset(radius:number,view:GeoCloseupView,
  frontDirection?:readonly number[]):number[];
export function geoCloseupMinDistance(radius:number):number;
export function geoCloseupPlotFocus(plot:GeoCloseupPlot,fallbackY?:number):
  {target:number[];distance:number}|null;
export function geoCloseupFrontDirection(plots:GeoCloseupPlot[]):number[];
