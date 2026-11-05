// Front-first mapping suggestions only. Survey values, approvals and published releases
// are never inferred from an image or modified by this helper.
const ROLES = ["front", "depthA", "back", "depthB"];
const finitePoint = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
const fallback = count => ({
  layout: count === 3 ? "three" : "four",
  roles: count === 3
    ? {front:[0],depthA:[1],back:[2]}
    : {front:[0],depthA:[1],back:[2],depthB:Array.from({length:count-3},(_,i)=>i+3)},
  reviewRequired: count > 4,
});

// The FIRST two clicked corners define the Front. For an irregular boundary,
// consecutive nearly-collinear edges form one logical side; never guess which
// of five+ distinct directions represents Back or Depth.
export function inferFrontFirstSideGroups(corners, angleToleranceDeg=12) {
  if (!Array.isArray(corners) || corners.length < 3 || corners.length > 80 ||
      !corners.every(finitePoint)) return null;
  const count = corners.length;
  if (count <= 4) return fallback(count);
  const segments = corners.map((p,i) => {
    const q=corners[(i+1)%count];
    return [q[0]-p[0],q[1]-p[1]];
  });
  if (segments.some(v=>Math.hypot(...v)<1e-6))return fallback(count);
  const cosine=Math.cos(Math.max(0,Math.min(30,angleToleranceDeg))*Math.PI/180);
  const groups=[[0]];
  for(let i=1;i<count;i++) {
    const a=segments[i-1],b=segments[i];
    const dot=(a[0]*b[0]+a[1]*b[1])/(Math.hypot(...a)*Math.hypot(...b));
    if(dot>=cosine)groups[groups.length-1].push(i);
    else groups.push([i]);
  }
  // There must be four unambiguous logical sides to label automatically.
  if(groups.length!==4) return fallback(count);
  const roles={};
  for(let i=0;i<ROLES.length;i++)roles[ROLES[i]]=groups[i];
  return {layout:"four",roles,reviewRequired:false};
}

export function roadFrontPreview(plot,headingDeg,geoFacingSuggest) {
  if(!plot || !Array.isArray(plot.corners) || !Array.isArray(plot.sides?.front?.edges) ||
     !plot.sides.front.edges.length || !Number.isFinite(headingDeg) ||
     typeof geoFacingSuggest!=="function")return null;
  return geoFacingSuggest(plot.corners,plot.sides.front.edges,headingDeg);
}
