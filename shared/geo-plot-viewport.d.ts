export type GeoLatLng={lat:number;lng:number};
export type GeoBounds={north:number;south:number;east:number;west:number};
export function geoPathBounds(path:ReadonlyArray<GeoLatLng>):GeoBounds;
export function geoViewportIntersects(pathBounds:GeoBounds,viewport:GeoBounds|null,margin?:number):boolean;
export function visibleGeoPlotPaths<T extends {bounds:GeoBounds}>(prepared:ReadonlyArray<T>,viewport:GeoBounds|null,margin?:number):T[];
