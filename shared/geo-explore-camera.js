/**
 * Fit an immutable GLB's ACTUAL object-space bounds into an independent
 * perspective camera. No WGS84 scale, heading or Google projection involved.
 * All 8 corners must fit for full/top/aerial; close intentionally crops edges.
 */
export function geoExploreCameraShot(bounds, aspect, view="full") {
  const min=bounds?.min,max=bounds?.max;
  const values=[min?.x,min?.y,min?.z,max?.x,max?.y,max?.z,aspect];
  if(!values.every(v=>typeof v==="number"&&Number.isFinite(v))||aspect<=0||
    max.x<min.x||max.y<min.y||max.z<min.z) return null;
  const target={x:(min.x+max.x)/2,y:(min.y+max.y)/2,z:(min.z+max.z)/2};
  const extents={x:max.x-target.x,y:max.y-target.y,z:max.z-target.z};
  const radius=Math.max(Math.hypot(extents.x,extents.y,extents.z),0.5);
  const directions={
    full:[0.48,1.12,0.85],
    top:[0.005,1,0.005],
    aerial:[0.9,1.25,1.1],
    close:[0.85,0.65,0.95],
  };
  if(!Object.prototype.hasOwnProperty.call(directions,view)) return null;
  const [dx,dy,dz]=directions[view];
  const directionLength=Math.hypot(dx,dy,dz);
  const dir={x:dx/directionLength,y:dy/directionLength,z:dz/directionLength};
  // Camera-right = world-up cross backward-camera direction.
  const sideLength=Math.hypot(dir.z,dir.x);
  const right={x:dir.z/sideLength,y:0,z:-dir.x/sideLength};
  const up={
    x:dir.y*right.z*(-1), // cross(dir,right)
    y:dir.z*right.x-dir.x*right.z,
    z:dir.x*right.y-dir.y*right.x,
  };
  const fov=view==="top"?40:42;
  const tanVertical=Math.tan(fov*Math.PI/360);
  const tanHorizontal=tanVertical*aspect;
  let needed=0;
  for(const x of [-extents.x,extents.x])
    for(const y of [-extents.y,extents.y])
      for(const z of [-extents.z,extents.z]){
        const depth=x*dir.x+y*dir.y+z*dir.z;
        const horizontal=Math.abs(x*right.x+y*right.y+z*right.z);
        const vertical=Math.abs(x*up.x+y*up.y+z*up.z);
        needed=Math.max(needed,depth+horizontal/tanHorizontal,depth+vertical/tanVertical);
      }
  const distance=Math.max(needed*1.12,radius*0.65);
  const focusDistance=view==="close"?distance*0.58:distance;
  const position={
    x:target.x+dir.x*focusDistance,
    y:target.y+dir.y*focusDistance,
    z:target.z+dir.z*focusDistance,
  };
  return {position,target,fov,minDistance:Math.max(radius*0.007,0.3),
    maxDistance:Math.max(radius*18,60),boundsRadius:radius};
}
