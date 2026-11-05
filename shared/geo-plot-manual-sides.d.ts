import type {GeoSidePlot,GeoPlotRole} from "./geo-plot-side-integrity.js";
export type GeoManualSideLocks=Partial<Record<GeoPlotRole,number[]>>;
export type GeoManualProposal<T extends GeoSidePlot>={
  plot:T;
  changedRoles:GeoPlotRole[];
  changedUnpinned:GeoPlotRole[];
  lockedRoles:GeoPlotRole[];
  changedEdgeCount:number;
  edgeCount:number;
  baseSignature:string;
};
export function geoManualCornerChain(startCorner:number,endCorner:number,pointCount:number):number[];
export function stageGeoManualSideRange<T extends GeoSidePlot>(
  plot:T,locks:GeoManualSideLocks,role:GeoPlotRole,startCorner:number,endCorner:number
):GeoManualSideLocks;
export function geoManualSourceSignature<T extends GeoSidePlot>(plot:T|null|undefined):string;
export function proposeGeoManualSideMapping<T extends GeoSidePlot>(
  plot:T,locks:GeoManualSideLocks
):GeoManualProposal<T>;
export function applyGeoManualSideProposal<T extends GeoSidePlot>(
  current:T,proposal:GeoManualProposal<T>
):T;
