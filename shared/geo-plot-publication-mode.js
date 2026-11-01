// Public presentation policy, separate from immutable polygon topology.
export const GEO_PLOT_MODES=Object.freeze(["verified","preliminary"]);
export function normalizeGeoPlotPublicationMode(value){
  if(value==="verified"||value==="preliminary")return value;
  throw Error("Unknown Geo plot publication mode.");
}
export function publicGeoPlotFacts(plot,mode){
  const kind=normalizeGeoPlotPublicationMode(mode);
  if(!plot||typeof plot!=="object")throw Error("Invalid mapped plot.");
  // A fully source-approved historical release retains existing content.
  if(kind==="verified")return plot;
  // Preliminary releases may show the polygon and its canonical ID, but
  // NOT unapproved area, lengths, facing, road or free-text notes.
  const area=plot.area?.verified===true&&Boolean(plot.area?.source)?{
    value:plot.area.value,unit:plot.area.unit
  }:null;
  const facing=plot.facingVerified===true&&Boolean(plot.facingSource)?plot.facing:null;
  const sides={};
  for(const [role,side] of Object.entries(plot.sides||{})){
    if(side?.verified===true&&Boolean(side.source)){
      sides[role]={length:side.length,unit:side.unit,
        roadFacing:side.roadFacing===true};
    }
  }
  const road=plot.road&&plot.sides?.front?.verified===true&&
    plot.sides.front.roadFacing===true&&Boolean(plot.sides.front.source)
    ?plot.road:null;
  return {id:plot.id,corners:plot.corners,layout:plot.layout,
    ...(Number.isFinite(plot.planeY)?{planeY:plot.planeY}:{}),
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
