export type GeoDirection="north"|"north-east"|"east"|"south-east"|"south"|"south-west"|"west"|"north-west";
export type GeoFacingRole="front"|"back"|"depthA"|"depthB";
export interface GeoCompassInfo {id:GeoDirection;label:string;arrow:string;}
export interface GeoFacingEntry {
  role:GeoFacingRole;
  direction:GeoDirection;
  label:string;
  arrow:string;
}
export interface GeoFacingPlot {
  corners: Array<[number,number]>;
  sides: Partial<Record<GeoFacingRole,{
    edges?:number[];roadFacing?:boolean;facingDirection?:GeoDirection|string;
  }>>;
  facing?:string|null;
  facingVerified?:boolean;
  facingSource?:string;
}
export const GEO_COMPASS_DIRECTIONS:ReadonlyArray<GeoCompassInfo>;
export function isGeoCompassDirection(value:unknown):value is GeoDirection;
export function suggestGeoSideFacing(
  corners:Array<[number,number]>,edges:number[],headingDeg:number,
):GeoDirection|null;
export function geoPlotFacingEntries(plot:GeoFacingPlot,headingDeg:number):GeoFacingEntry[];
