// Plot Studio pointer precision. Distances and thresholds are CSS screen pixels,
// independently of GLB units, camera zoom, DPR and fullscreen size.
// Geometry authority stays in model-local [X,Z], never raster pixels.
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
export function precisionSnap(raw,screen,rings,project,{enabled=false,thresholdPx=6}={}){
  const fallback={point:raw,screen,distance:Infinity,kind:"none"};
  if(!enabled||!Number.isFinite(screen[0])||!Number.isFinite(screen[1]))
    return fallback;
  let vertex=null,edge=null;
  for(const ring of rings){
    const points=ring.points||[],skip=ring.skipIndex??-1;
    if(points.length===0)continue;
    const projected=points.map(p=>project(p));
    for(let i=0;i<points.length;i++){
      if(i===skip)continue;
      const d=distance(screen,projected[i]);
      if(d<=thresholdPx&&(!vertex||d<vertex.distance))
        vertex={point:points[i],screen:projected[i],distance:d,kind:"vertex"};
    }
    if(points.length<2)continue;
    // During handle dragging never snap to its own two adjoining edges.
    const edgeCount=points.length===2?1:points.length;
    for(let i=0;i<edgeCount;i++){
      const next=(i+1)%points.length;
      if(i===skip||next===skip)continue;
      const a=projected[i],z=projected[next];
      const dx=z[0]-a[0],dy=z[1]-a[1],len=dx*dx+dy*dy;
      if(len<0.000001)continue;
      const t=Math.max(0,Math.min(1,
        ((screen[0]-a[0])*dx+(screen[1]-a[1])*dy)/len));
      const snapped=[a[0]+t*dx,a[1]+t*dy];
      const d=distance(screen,snapped);
      if(d<=thresholdPx&&(!edge||d<edge.distance)){
        const w=points[i],v=points[next];
        edge={point:[w[0]+t*(v[0]-w[0]),w[1]+t*(v[1]-w[1])],
          screen:snapped,distance:d,kind:"edge"};
      }
    }
  }
  // Vertices win over nearby segments, as on the Platform mapper.
  return vertex||edge||fallback;
}
export function zoomAnchorDelta(before,after){
  if(!before||!after)return null;
  const x=before[0]-after[0],z=before[1]-after[1];
  return Number.isFinite(x)&&Number.isFinite(z)?[x,z]:null;
}
export function isMappingTap(start,end,thresholdPx=9){
  return Boolean(start&&end&&start.id===end.id&&
    Math.hypot(start.x-end.x,start.y-end.y)<=thresholdPx);
}
