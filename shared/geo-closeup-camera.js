/**
 * Pure scene-framing calculations for the independent customer 3D close-up.
 * No Google Maps zoom levels, CSS scaling or Geo placement mutations.
 */
const UNIT_VIEWS=Object.freeze({
  overview:[1,1.12,1],
  front:[0,0.48,1],
  corner:[1.1,0.75,1],
  aerial:[0.05,2.25,0.05],
});
export function geoCloseupCameraOffset(radius,view,frontDirection=[0,1]){
  const r=Number.isFinite(radius)&&radius>0?radius:10;
  const vector=UNIT_VIEWS[view]||UNIT_VIEWS.overview;
  let dx=vector[0],dy=vector[1],dz=vector[2];
  const frontX=Number(frontDirection?.[0]),frontZ=Number(frontDirection?.[1]);
  const length=Math.hypot(frontX,frontZ);
  if(length>1e-8&&(view==="front"||view==="corner")){
    const ux=frontX/length,uz=frontZ/length;
    const sideX=uz,sideZ=-ux;
    const diagonal=view==="corner"?.8:0;
    dx=ux+sideX*diagonal;
    dz=uz+sideZ*diagonal;
  }
  const length3=Math.hypot(dx,dy,dz)||1;
  const distance=r*(view==="aerial"?3.4:view==="front"?2.6:2.9);
  return [dx/length3*distance,dy/length3*distance,dz/length3*distance];
}
export function geoCloseupMinDistance(radius){
  const r=Number.isFinite(radius)&&radius>0?radius:10;
  return Math.max(0.15,Math.min(r*.006,1.2));
}
export function geoCloseupPlotFocus(plot,fallbackY=0){
  if(!Array.isArray(plot?.corners)||plot.corners.length<3||
      plot.corners.some(p=>!Array.isArray(p)||p.length!==2||
        !Number.isFinite(p[0])||!Number.isFinite(p[1])))return null;
  const pts=plot.corners;
  const x=pts.reduce((sum,p)=>sum+p[0],0)/pts.length;
  const z=pts.reduce((sum,p)=>sum+p[1],0)/pts.length;
  const xs=pts.map(p=>p[0]),zs=pts.map(p=>p[1]);
  const size=Math.hypot(Math.max(...xs)-Math.min(...xs),
    Math.max(...zs)-Math.min(...zs));
  return {target:[x,Number.isFinite(plot.planeY)?plot.planeY:fallbackY,z],
    distance:Math.max(3,size*1.6)};
}
export function geoCloseupFrontDirection(plots){
  if(!Array.isArray(plots))return [0,1];
  for(const plot of plots){
    const pts=plot?.corners,side=plot?.sides?.front;
    if(!Array.isArray(pts)||pts.length<3||
       !side?.roadFacing||!Array.isArray(side.edges)||!side.edges.length)continue;
    if(pts.some(p=>!Array.isArray(p)||p.length!==2||
       !Number.isFinite(p[0])||!Number.isFinite(p[1])))continue;
    const winding=Math.sign(pts.reduce((sum,p,i)=>{
      const q=pts[(i+1)%pts.length];
      return sum+p[0]*q[1]-q[0]*p[1];
    },0));
    if(!winding)continue;
    let dx=0,dz=0;
    for(const i of [...new Set(side.edges)]){
      if(!Number.isInteger(i)||i<0||i>=pts.length)continue;
      const a=pts[i],b=pts[(i+1)%pts.length];
      dx+=winding*(b[1]-a[1]);
      dz-=winding*(b[0]-a[0]);
    }
    if(Math.hypot(dx,dz)>1e-8)return [dx,dz];
  }
  // This is only a fallback visual camera angle, NOT an asserted compass facing.
  return [0,1];
}
