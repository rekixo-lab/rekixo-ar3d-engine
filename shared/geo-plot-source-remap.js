// Source-review-only remapping. Old and new calibration must BOTH pass
// independent withheld checkpoint QA. Never silently mutate sealed releases.
import {evaluateImageModelAlignment,modelPointToImage,imagePointToModel} from "./geo-plot-image-alignment.js";
import {geometryWithRevokedApprovals} from "./geo-plot-precision-history.js";
import {validateGeoPlotCollection} from "../workers/geo-plot-geometry.mjs";
const key=x=>String(x||"").trim().toLowerCase();
export function geoSourceChangePlan(plots,previous,current,selectedIds=[]){
  if(!Array.isArray(plots)||plots.length>2500||!Array.isArray(selectedIds))
    throw Error("Source remap supports at most 2,500 plots and an explicit plot selection.");
  const oldQA=evaluateImageModelAlignment(previous,{requireCheckpoints:true});
  const newQA=evaluateImageModelAlignment(current,{requireCheckpoints:true});
  if(!oldQA.verifiedReady||!newQA.verifiedReady)
    throw Error("Independent source control checkpoints are required for both models.");
  if(previous.imageSha256!==current.imageSha256)
    throw Error("Different original image checksum: no automatic spatial remap. Reconcile signed landmarks manually.");
  if(previous.imageWidth!==current.imageWidth||previous.imageHeight!==current.imageHeight)
    throw Error("Source image pixel dimensions changed. Recheck source assets manually.");
  const index=new Map(plots.map(p=>[key(p.id),p]));
  if(index.size!==plots.length)throw Error("Source mapping contains duplicate canonical IDs.");
  const keys=new Set();
  for(const id of selectedIds){
    const k=key(id);
    if(!index.has(k)||keys.has(k))throw Error("Select existing, unique canonical Plot IDs only.");
    keys.add(k);
  }
  const rows=plots.map(p=>{
    const projected=p.corners.map(point=>modelPointToImage(oldQA.transform,point));
    if(projected.some(uv=>uv.some(x=>!Number.isFinite(x)||x<-0.05||x>1.05)))
      throw Error("Plot "+p.id+": old footprint falls outside the approved original image; manual survey required.");
    const next=projected.map(uv=>imagePointToModel(newQA.transform,uv));
    if(next.some(point=>point.some(n=>!Number.isFinite(n)||Math.abs(n)>100000)))
      throw Error("Plot "+p.id+": target Building-local coordinates exceed safety bounds.");
    const displacements=next.map((point,i)=>Math.hypot(point[0]-p.corners[i][0],point[1]-p.corners[i][1]));
    return {plotId:p.id,selected:keys.has(key(p.id)),
      maxModelCoordinateMovementM:Math.max(...displacements),
      beforeCorners:p.corners,proposedCorners:next.map(point=>point.map(x=>Number(x.toFixed(6))))};
  });
  return {schema:"geo-plot-source-change-plan-v1",advisoryOnly:true,
    oldGeoReleaseId:previous.geoReleaseId,newGeoReleaseId:current.geoReleaseId,
    sameOriginalImageSha256:current.imageSha256,
    selectedCount:keys.size,unreviewedIds:rows.filter(x=>!x.selected).map(x=>x.plotId),
    rows};
}
export function stageSelectedGeoSourceRemap(plots,previous,current,selectedIds=[]){
  const plan=geoSourceChangePlan(plots,previous,current,selectedIds);
  if(plan.selectedCount===0)throw Error("Select plot IDs explicitly; empty selection cannot stage a remap.");
  const selected=new Set(selectedIds.map(key));
  const moved=plots.map(p=>{
    const row=plan.rows.find(x=>key(x.plotId)===key(p.id));
    if(!selected.has(key(p.id)))return p;
    const edited=geometryWithRevokedApprovals(p,row.proposedCorners);
    // A new model source invalidates the old model-local site plane even if
    // its numeric height happened to be the same.
    const {planeY,...safe}=edited;
    return {...safe,planeSource:"",planeVerified:false};
  });
  // Fail closed on any resulting crossing/overlap before it can enter a draft.
  validateGeoPlotCollection(moved);
  return {plots:moved,plan};
}


// Explicit same-frame replacement, analogous to preserving aligned 2D
// masterplan polygons. This is NEVER automatic and never verification.
// Model X/Z coordinates survive; all signed/model-plane approvals are revoked.
export function stageUnverifiedSameCoordinateModel(plots) {
  const existing=validateGeoPlotCollection(plots);
  const staged=existing.map(plot=>{
    const clean=geometryWithRevokedApprovals(plot,plot.corners);
    const {planeY,...withoutOldElevation}=clean;
    return {...withoutOldElevation,planeSource:"",planeVerified:false};
  });
  return validateGeoPlotCollection(staged);
}
