// Geo-facing semantics for Admin and public customer diagrams.
// Canonical Building: X east / Z model horizontal. The shared rigid placement
// converts (+Y up) to ENU with +90° X and clockwise heading = -Z rotation.
// No screen/camera yaw is involved in geographic facing calculations.
export const GEO_COMPASS_DIRECTIONS=Object.freeze([
  {id:"north",label:"North",arrow:"↑"},
  {id:"north-east",label:"North-East",arrow:"↗"},
  {id:"east",label:"East",arrow:"→"},
  {id:"south-east",label:"South-East",arrow:"↘"},
  {id:"south",label:"South",arrow:"↓"},
  {id:"south-west",label:"South-West",arrow:"↙"},
  {id:"west",label:"West",arrow:"←"},
  {id:"north-west",label:"North-West",arrow:"↖"},
]);
const ROLES=["front","back","depthA","depthB"];
export function isGeoCompassDirection(value){
  return typeof value==="string"&&GEO_COMPASS_DIRECTIONS.some(v=>v.id===value);
}
export function suggestGeoSideFacing(corners,edges,headingDeg){
  if(!Array.isArray(corners)||corners.length<3||corners.length>80||
     !Array.isArray(edges)||!edges.length||!Number.isFinite(headingDeg)||
     corners.some(p=>!Array.isArray(p)||p.length!==2||p.some(n=>!Number.isFinite(n))))return null;
  const signed2=corners.reduce((sum,a,i)=>{
    const b=corners[(i+1)%corners.length];
    return sum+a[0]*b[1]-b[0]*a[1];
  },0);
  if(Math.abs(signed2)<1e-8)return null;
  const winding=signed2>0?1:-1;
  let outwardX=0,outwardZ=0;
  for(const i of [...new Set(edges)]){
    if(!Number.isInteger(i)||i<0||i>=corners.length)continue;
    const a=corners[i],b=corners[(i+1)%corners.length];
    const dx=b[0]-a[0],dz=b[1]-a[1];
    // Sum length-weighted outward normals. Works for contiguous irregular edges.
    outwardX+=winding*dz;
    outwardZ-=winding*dx;
  }
  if(Math.hypot(outwardX,outwardZ)<1e-7)return null;
  // Rotation +90° about X maps model Z to -north (ENU Y).
  const localEast=outwardX,localNorth=-outwardZ;
  const radians=headingDeg*Math.PI/180;
  const east=localEast*Math.cos(radians)+localNorth*Math.sin(radians);
  const north=-localEast*Math.sin(radians)+localNorth*Math.cos(radians);
  const compassDeg=(Math.atan2(east,north)*180/Math.PI+360)%360;
  return GEO_COMPASS_DIRECTIONS[Math.round(compassDeg/45)%8].id;
}
export function geoPlotFacingEntries(plot,headingDeg){
  if(!plot||!Array.isArray(plot.corners)||!plot.sides)return [];
  const result=[],seen=new Set();
  const sides=plot.sides;
  const hasRoadFacing=ROLES.some(role=>sides[role]?.roadFacing===true);
  for(const role of ROLES){
    const side=sides[role];
    if(!side||!Array.isArray(side.edges)||!side.edges.length)continue;
    // Old single-facing records remain readable, but never assume that the
    // default "north" from a blank editor is an operator-confirmed direction.
    const legacyFront=role==="front"&&!hasRoadFacing&&
      plot.facingVerified===true&&Boolean(plot.facingSource);
    if(side.roadFacing!==true&&!legacyFront)continue;
    let direction=isGeoCompassDirection(side.facingDirection)?
      side.facingDirection:null;
    if(!direction&&role==="front"&&plot.facingVerified===true&&plot.facingSource&&
       isGeoCompassDirection(plot.facing))direction=plot.facing;
    direction=direction||suggestGeoSideFacing(plot.corners,side.edges,headingDeg);
    if(!direction||seen.has(direction))continue;
    seen.add(direction);
    const compass=GEO_COMPASS_DIRECTIONS.find(item=>item.id===direction);
    result.push({role,direction,label:compass.label,arrow:compass.arrow});
  }
  return result.slice(0,4);
}
