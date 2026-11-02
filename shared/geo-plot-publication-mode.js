// Public presentation policy, separate from immutable polygon topology.
export const GEO_PLOT_MODES=Object.freeze(["verified","preliminary"]);
export function normalizeGeoPlotPublicationMode(value){
  if(value==="verified"||value==="preliminary")return value;
  throw Error("Unknown Geo plot publication mode.");
}
export function publicGeoPlotFacts(plot,mode){
  const kind=normalizeGeoPlotPublicationMode(mode);
  if(!plot||typeof plot!=="object")throw Error("Invalid mapped plot.");
  // A historical verified release keeps its existing public contract.
  if(kind==="verified")return plot;
  // Preliminary is already an intentionally published mapping release. Show
  // non-empty measured fields as saved on that release even when their separate
  // source-review checkbox was not checked. Never expose private draft notes,
  // internal source/evidence strings, approval flags or unapproved commercial data.
  const allowedAreaUnits=new Set(["sqft","sqm","sqyd"]);
  const area=Number.isFinite(plot.area?.value)&&plot.area.value>0&&
    allowedAreaUnits.has(plot.area.unit)
    ?{value:plot.area.value,unit:plot.area.unit}:null;
  const allowedSideUnits=new Set(["ft","m"]);
  const sides={};
  for(const role of ["front","back","depthA","depthB"]){
    const side=plot.sides?.[role];
    if(!side||!Number.isFinite(side.length)||side.length<=0||
      !allowedSideUnits.has(side.unit))continue;
    sides[role]={
      edges:Array.isArray(side.edges)?side.edges.filter(
        n=>Number.isInteger(n)&&n>=0&&n<plot.corners.length
      ):[],
      length:side.length,unit:side.unit,roadFacing:side.roadFacing===true
    };
  }
  const facing=typeof plot.facing==="string"&&plot.facing.trim()
    ?plot.facing.trim():null;
  const road=typeof plot.road==="string"&&plot.road.trim()
    ?plot.road.trim():null;
  return {id:plot.id,corners:plot.corners,layout:plot.layout,
    ...(plot.planeVerified===true&&Boolean(plot.planeSource)&&Number.isFinite(plot.planeY)
      ?{planeY:plot.planeY}:{}),
    area,facing,sides,road,notes:""};
}
export function preliminaryPublishPlotGuard(plots,approvedInventory){
  if(!Array.isArray(plots)||!plots.length||plots.length>2500)
    throw Error("Map at least one valid Plot boundary before Preliminary Publish.");
  if(Array.isArray(approvedInventory)&&approvedInventory.length){
    const ids=new Set(approvedInventory.map(row=>String(row.id).toLowerCase()));
    for(const plot of plots)if(!ids.has(String(plot.id).toLowerCase()))
      throw Error("Plot "+plot.id+" is absent from approved CSV Plot IDs. Correct its ID before publication.");
  }
  return true;
}
