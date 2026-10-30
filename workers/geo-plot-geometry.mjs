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
  return plots;
}
