export type GeoPlotResumeShape="four"|"irregular";
export type GeoPlotResumeArgs={
  plot:{id:string;corners:readonly (readonly [number,number])[]}|null;
  originalId:string|null;
  shape:GeoPlotResumeShape;
  requestedShape:GeoPlotResumeShape;
};
export function geoPlotToolResumeAction(args:GeoPlotResumeArgs):"start"|"resume"|"edit";
export function geoPlotPausedDrawingLabel(args:{
  mode:string;
  plot:GeoPlotResumeArgs["plot"];
  originalId:string|null;
  shape:GeoPlotResumeShape;
}):{text:string;nextCorner:number;plotId:string}|null;
