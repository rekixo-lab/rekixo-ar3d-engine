// Engine-owned Geo Plot Mapping geometry. No Platform imports or shared state.
const ROLES = ["front", "back", "depthA", "depthB"];
const DIRECTIONS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
const finite = (n) => typeof n === "number" && Number.isFinite(n);
const positive = (n) => finite(n) && n > 0 && n <= 1e7;

export function polygonAreaSqm(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    sum += a[0] * b[1] - a[1] * b[0];
  }
  return Math.abs(sum) / 2;
}
export function polygonHasCrossings(points) {
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const intersects = (a,b,c,d) => {
    const ab = cross(a,b,c), cd = cross(a,b,d), ca = cross(c,d,a), db = cross(c,d,b);
    if (ab * cd < 0 && ca * db < 0) return true;
    // Collinear overlaps and non-neighbor repeated points are invalid too.
    const on = (p,q,r) => Math.abs(cross(p,r,q)) <= 1e-8 &&
      q[0] >= Math.min(p[0],r[0])-1e-8 && q[0] <= Math.max(p[0],r[0])+1e-8 &&
      q[1] >= Math.min(p[1],r[1])-1e-8 && q[1] <= Math.max(p[1],r[1])+1e-8;
    return (Math.abs(ab) < 1e-8 && on(a,c,b)) || (Math.abs(cd) < 1e-8 && on(a,d,b)) ||
      (Math.abs(ca) < 1e-8 && on(c,a,d)) || (Math.abs(db) < 1e-8 && on(c,b,d));
  };
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      if (intersects(points[i], points[(i+1)%points.length], points[j], points[(j+1)%points.length])) return true;
    }
  }
  return false;
}
// Geometric intersection is independent of plot metadata and permits shared
// boundaries, but never a positive-area overlap of independently numbered plots.
const TOPOLOGY_EPS = 1e-8;
function orientation(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}
function pointOnSegment(point, a, b) {
  if (Math.abs(orientation(a,b,point)) > TOPOLOGY_EPS) return false;
  return point[0] >= Math.min(a[0],b[0]) - TOPOLOGY_EPS &&
    point[0] <= Math.max(a[0],b[0]) + TOPOLOGY_EPS &&
    point[1] >= Math.min(a[1],b[1]) - TOPOLOGY_EPS &&
    point[1] <= Math.max(a[1],b[1]) + TOPOLOGY_EPS;
}
function pointStrictlyInside(point, ring) {
  let inside = false;
  for (let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[i],c=ring[j];
    if (pointOnSegment(point,a,c)) return false;
    if ((a[1]>point[1]) !== (c[1]>point[1]) &&
        point[0] < a[0]+(c[0]-a[0])*(point[1]-a[1])/(c[1]-a[1]))
      inside=!inside;
  }
  return inside;
}
function strictSegmentCross(a,b,c,d) {
  const o1=orientation(a,b,c),o2=orientation(a,b,d),
    o3=orientation(c,d,a),o4=orientation(c,d,b);
  return ((o1>TOPOLOGY_EPS && o2 < -TOPOLOGY_EPS) ||
    (o2>TOPOLOGY_EPS && o1 < -TOPOLOGY_EPS)) &&
    ((o3>TOPOLOGY_EPS && o4 < -TOPOLOGY_EPS) ||
    (o4>TOPOLOGY_EPS && o3 < -TOPOLOGY_EPS));
}
function polygonInsideProbes(ring) {
  const signed = ring.reduce((n,a,i) => {
    const b=ring[(i+1)%ring.length];
    return n+a[0]*b[1]-a[1]*b[0];
  },0);
  const winding = signed>=0 ? 1 : -1;
  return ring.map((a,i)=>{
    const b=ring[(i+1)%ring.length],dx=b[0]-a[0],dy=b[1]-a[1],
      len=Math.hypot(dx,dy), inset=Math.min(1e-5,len*0.01);
    return [(a[0]+b[0])/2-winding*dy/len*inset,
      (a[1]+b[1])/2+winding*dx/len*inset];
  });
}
export function polygonsOverlapInArea(left,right) {
  for (let i=0;i<left.length;i++) for (let j=0;j<right.length;j++)
    if (strictSegmentCross(left[i],left[(i+1)%left.length],
      right[j],right[(j+1)%right.length])) return true;
  // Covers containment, identical footprints and collinear partial overlaps.
  // Boundary-only adjacency is accepted (including shared corner/edge).
  return polygonInsideProbes(left).some(p=>pointStrictlyInside(p,right)) ||
    polygonInsideProbes(right).some(p=>pointStrictlyInside(p,left));
}
function boundingBox(ring) {
  return ring.reduce((b,p)=>({
    minX:Math.min(b.minX,p[0]),maxX:Math.max(b.maxX,p[0]),
    minY:Math.min(b.minY,p[1]),maxY:Math.max(b.maxY,p[1]),
  }),{minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity});
}
export function assertDisjointPlotInteriors(plots) {
  // Sweep by X instead of checking every pair across up to 2,500 plots.
  const ordered=plots.map(plot=>({plot,bounds:boundingBox(plot.corners)}))
    .sort((a,b)=>a.bounds.minX-b.bounds.minX);
  for (let i=0;i<ordered.length;i++) {
    const a=ordered[i];
    for (let j=i+1;j<ordered.length;j++) {
      const b=ordered[j];
      if (b.bounds.minX >= a.bounds.maxX - TOPOLOGY_EPS) break;
      if (b.bounds.minY >= a.bounds.maxY - TOPOLOGY_EPS ||
          a.bounds.minY >= b.bounds.maxY - TOPOLOGY_EPS) continue;
      if (polygonsOverlapInArea(a.plot.corners,b.plot.corners))
        throw Error("Plots "+a.plot.id+" and "+b.plot.id+" overlap in mapped ground area.");
    }
  }
}
function cleanText(value, max = 180) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/[\x00-\x1f\x7f]/g, "").slice(0, max);
}
export function validateGeoPlot(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw Error("Invalid plot record.");
  const id = cleanText(input.id, 48);
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,47}$/.test(id)) throw Error("Plot number contains invalid characters.");
  const corners = input.corners;
  if (!Array.isArray(corners) || corners.length < 3 || corners.length > 80 ||
      corners.some(p => !Array.isArray(p) || p.length !== 2 || !p.every(n => finite(n) && Math.abs(n) <= 100000)))
    throw Error("Plot " + id + ": 3–80 finite [model X, model Z] corners required.");
  for (let i=0; i<corners.length; i++) {
    const a=corners[i], b=corners[(i+1)%corners.length];
    if (Math.hypot(a[0]-b[0],a[1]-b[1]) < 0.001) throw Error("Plot "+id+": duplicate/zero-length corners.");
  }
  if (polygonAreaSqm(corners) < 0.01 || polygonHasCrossings(corners))
    throw Error("Plot " + id + ": degenerate or self-intersecting boundary.");
  const sides = input.sides;
  if (!sides || typeof sides !== "object" || Array.isArray(sides)) throw Error("Plot " + id + ": side roles required.");
  const layout = corners.length === 3 ? "three" : (input.layout === "three" ? "three" : "four");
  const roles = layout === "three" ? ROLES.slice(0,3) : ROLES;
  const normalizedSides = {};
  const assigned = new Set();
  for (const role of roles) {
    const side = sides[role];
    if (!side || !Array.isArray(side.edges) || !side.edges.length ||
        !side.edges.every(n => Number.isInteger(n) && n >= 0 && n < corners.length))
      throw Error("Plot " + id + ": assign " + role + " boundary edge(s).");
    if (!positive(side.length) || !["m","ft"].includes(side.unit))
      throw Error("Plot " + id + ": measured " + role + " length and unit required.");
    const edges = [...new Set(side.edges)];
    if (edges.length !== side.edges.length) throw Error("Plot " + id + ": duplicate side edge.");
    if (edges.some((e,i) => i > 0 && e !== (edges[i-1]+1)%corners.length))
      throw Error("Plot " + id + ": logical side edges must form a forward contiguous corner chain.");
    for (const index of edges) {
      if (assigned.has(index)) throw Error("Plot " + id + ": one edge cannot belong to two side roles.");
      assigned.add(index);
    }
    normalizedSides[role] = { edges, length: side.length, unit: side.unit, roadFacing: side.roadFacing === true,
      source: cleanText(side.source, 160), verified: side.verified === true };
  }
  if (layout === "three" && sides.depthB) throw Error("Plot " + id + ": Depth B is not used in three-side layout.");
  if (!assigned.size || assigned.size !== corners.length) throw Error("Plot "+id+": all polygon edges must be assigned.");
  const area = input.area;
  if (!positive(area?.value) || !["sqft","sqm","sqyd"].includes(area?.unit))
    throw Error("Plot " + id + ": authoritative area value and unit required.");
  const facing = cleanText(input.facing, 24).toLowerCase();
  if (!DIRECTIONS.includes(facing)) throw Error("Plot " + id + ": valid compass-facing direction required.");
  return { id, corners: corners.map(p => [p[0],p[1]]), layout, sides: normalizedSides,
    area: { value: area.value, unit: area.unit, source: cleanText(area.source, 160), verified: area.verified === true },
    facing, facingSource:cleanText(input.facingSource,160), facingVerified:input.facingVerified===true,
    road: cleanText(input.road, 160), notes: cleanText(input.notes, 1000) };
}
export function validateGeoPlotCollection(value, { forPublish = false } = {}) {
  if (!Array.isArray(value) || value.length > 2500 || (forPublish && value.length === 0))
    throw Error("Provide 1–2500 plots for publication.");
  const ids = new Set();
  const plots = value.map(item => {
    const p = validateGeoPlot(item);
    if (ids.has(p.id.toLowerCase())) throw Error("Duplicate plot number: " + p.id);
    ids.add(p.id.toLowerCase());
    if (forPublish && (!p.area.verified || !p.area.source || !p.facingVerified || !p.facingSource ||
      Object.values(p.sides).some(s => !s.verified || !s.source)))
      throw Error("Plot "+p.id+": verify authoritative measurements and source before publish.");
    return p;
  });
  assertDisjointPlotInteriors(plots);
  return plots;
}
