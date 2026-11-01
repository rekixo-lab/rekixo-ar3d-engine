// Pure Geo plot viewport filter: bounded O(N) scan after precomputed paths.
// Shared boundaries and polygons crossing the viewport remain visible.
const finite=n=>typeof n==="number"&&Number.isFinite(n);
export function geoPathBounds(path){
 if(!Array.isArray(path)||path.length<3||path.some(p=>!p||!finite(p.lat)||!finite(p.lng)))
   throw Error("Geo plot path requires at least 3 finite latitude/longitude points.");
 return path.reduce((b,p)=>({
  north:Math.max(b.north,p.lat),south:Math.min(b.south,p.lat),
  east:Math.max(b.east,p.lng),west:Math.min(b.west,p.lng)
 }),{north:-Infinity,south:Infinity,east:-Infinity,west:Infinity});
}
export function geoViewportIntersects(pathBounds,viewport,margin=0.12){
 if(!viewport)return true; // only for map runtimes that cannot expose bounds
 if(!finite(margin)||margin<0||margin>1)throw Error("Viewport margin out of range.");
 const [north,south,east,west]=[viewport.north,viewport.south,viewport.east,viewport.west];
 if(![north,south,east,west].every(finite)||north<south||east<west)
   return true; // fallback for dateline/polar unsupported camera bounds
 const latMargin=(north-south)*margin,lngMargin=(east-west)*margin;
 return pathBounds.north>=south-latMargin&&pathBounds.south<=north+latMargin&&
  pathBounds.east>=west-lngMargin&&pathBounds.west<=east+lngMargin;
}
export function visibleGeoPlotPaths(prepared,viewport,margin=0.12){
 if(!Array.isArray(prepared))throw Error("Prepared plot paths required.");
 return prepared.filter(p=>geoViewportIntersects(p.bounds,viewport,margin));
}
