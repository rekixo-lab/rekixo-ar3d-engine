/**
 * Triangle containment in projected map screen space. All coordinates are NDC,
 * so the hit region exactly matches the plotted mesh shown by WebGL.
 * Pure geometry: does not depend on the Google Maps API or 3D model data.
 */
export function pointInScreenTriangle(px,py,ax,ay,bx,by,cx,cy) {
  const values=[px,py,ax,ay,bx,by,cx,cy];
  if(!values.every(Number.isFinite))return false;
  const denominator=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);
  if(Math.abs(denominator)<1e-12)return false;
  const a=((by-cy)*(px-cx)+(cx-bx)*(py-cy))/denominator;
  const b=((cy-ay)*(px-cx)+(ax-cx)*(py-cy))/denominator;
  const c=1-a-b;
  // Avoid dead pixels on a shared boundary without expanding into other plots.
  const epsilon=1e-7;
  return a>=-epsilon&&b>=-epsilon&&c>=-epsilon;
}
