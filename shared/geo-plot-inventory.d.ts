export type GeoInventoryRow={
  id:string;area:number;areaUnit:"sqft"|"sqm"|"sqyd"|"";areaSource:string;
  front:number;back:number;depthA:number;depthB:number;
  lengthUnit:"ft"|"m"|"";measurementSource:string;road:string;facing:string;
  facingSource:string;dimensions:string;notes:string;
};
export type GeoInventoryDiff={added:string[];changed:string[];missing:string[];
  mappedChanged:string[];mappedMissing:string[];mapped:number;unmapped:number;unchanged:number};
export const GEO_INVENTORY_HEADERS:readonly string[];
export function parseGeoInventoryCsv(csv:string):Record<string,string>[];
export function normalizeGeoInventoryRows(rows:ReadonlyArray<Record<string,unknown>>):GeoInventoryRow[];
export function geoInventoryDiff(previous:ReadonlyArray<GeoInventoryRow>,upcoming:ReadonlyArray<GeoInventoryRow>,
  mappedIds?:ReadonlyArray<string>):GeoInventoryDiff;
export function nextUnmappedInventory(rows:ReadonlyArray<GeoInventoryRow>,mappedIds?:ReadonlyArray<string>,afterId?:string):GeoInventoryRow|null;
