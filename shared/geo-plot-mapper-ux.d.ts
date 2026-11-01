import type {GeoInventoryRow} from "./geo-plot-inventory.js";
import type {ReviewedPlot} from "./geo-plot-source-operations.js";
export type GeoPlotSideRole="front"|"back"|"depthA"|"depthB";
export function nextCsvPlotForDrawing<T extends {id:string}>(
  rows:readonly T[],mapped:readonly (string|{id:string})[],afterId?:string|null):T|null;
export function positionCursorLoupe(
  screen:readonly [number,number],viewport:readonly [number,number],
  size?:number,gap?:number):{left:number;top:number};
export function assignVisiblePlotEdge<T extends ReviewedPlot>(
  plot:T,role:GeoPlotSideRole,edge:number,options?:{extend?:boolean}):T;
export function draftStorageKey(slug:string):string|null;
export type GeoPlotLocalDraftIdentity={
  projectSlug:string;geoReleaseId:string;buildingReleaseId:string;mappingRevision:number;
};
export type GeoPlotLocalDraft<T extends ReviewedPlot>={
  plot:T;originalId:string|null;shape:"four"|"irregular";checkedAt:number;
};
export function packLocalPlotDraft<T extends ReviewedPlot>(
  value:GeoPlotLocalDraftIdentity&{
    plot:T;originalId:string|null;shape:"four"|"irregular";checkedAt?:number;
  }):string|null;
export function unpackLocalPlotDraft<T extends ReviewedPlot=ReviewedPlot>(
  raw:string|null,expected:GeoPlotLocalDraftIdentity,now?:number):GeoPlotLocalDraft<T>|null;
export function visibleMappingProgress(
  inventoryRows:readonly GeoInventoryRow[],plots:readonly {id:string}[]):{
    inventory:number;confirmed:number;pending:number;unexpected:number;
  };
