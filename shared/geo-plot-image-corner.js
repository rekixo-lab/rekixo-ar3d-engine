// Owner-side image editor: one exact canonical Plot ID, one immutable Building-local
// X/Z coordinate domain shared with the 3D mapper. Never auto-publishes a polygon.
import {imagePointToModel} from "./geo-plot-image-alignment.js";
import {geometryWithRevokedApprovals} from "./geo-plot-precision-history.js";
import {validateGeoPlotCollection} from "../workers/geo-plot-geometry.mjs";
export function stageVerifiedImageCorner(plots,plotId,cornerIndex,imageUv,transform){
  const plot=plots.find(p=>p.id.toLowerCase()===String(plotId).toLowerCase());
  if(!plot)throw Error("Select an existing canonical mapped Plot ID.");
  if(!Number.isInteger(cornerIndex)||cornerIndex<0||cornerIndex>=plot.corners.length)
    throw Error("Select an existing plot corner.");
  if(!Array.isArray(imageUv)||imageUv.length!==2||
    !imageUv.every(n=>typeof n==="number"&&Number.isFinite(n)&&n>=0&&n<=1))
    throw Error("Image point must be inside the verified source U/V range.");
  const calculated=imagePointToModel(transform,imageUv);
  if(!calculated.every(n=>Number.isFinite(n)&&Math.abs(n)<=100000))
    throw Error("Image-to-model transform mapped the corner outside Building-local limits.");
  const modelPoint=calculated.map(n=>Number(n.toFixed(6)));
  if(modelPoint.every((n,i)=>Math.abs(n-plot.corners[cornerIndex][i])<1e-6))
    throw Error("Image point matches existing corner; no geometry change to stage.");
  const corners=plot.corners.map((p,i)=>i===cornerIndex?modelPoint:[...p]);
  const edited=geometryWithRevokedApprovals(plot,corners);
  const staged=plots.map(p=>p.id.toLowerCase()===plot.id.toLowerCase()?edited:p);
  // Reject self-crossings, degenerate edges, and overlaps with other canonical IDs
  // before presenting an unverified draft to the normal server-side publish gate.
  validateGeoPlotCollection(staged);
  return {plots:staged,plotId:plot.id,cornerIndex,modelPoint};
}
