// UI-only precision/selection helpers. No D1, Cloudflare or published release writes.
import {assignFourCornerRoadFront} from "./geo-plot-source-operations.js";
import {assignCoveredGeoPlotEdge,inspectGeoPlotSideCoverage} from "./geo-plot-side-integrity.js";
const ROLES=["front","back","depthA","depthB"];
const finite=n=>typeof n==="number"&&Number.isFinite(n);
const clean=x=>String(x??"").trim().toLowerCase();
export function nextCsvPlotForDrawing(rows,mapped,afterId=null){
  if(!Array.isArray(rows)||rows.length===0)return null;
  const taken=new Set((mapped||[]).map(p=>clean(typeof p==="string"?p:p.id)));
  const index=afterId==null?-1:rows.findIndex(row=>clean(row.id)===clean(afterId));
  for(let offset=1;offset<=rows.length;offset++){
    const row=rows[(index+offset+rows.length)%rows.length];
    if(row?.id&&!taken.has(clean(row.id)))return row;
  }
  return null;
}
export function assignVisiblePlotEdge(plot,role,edge,{extend=false}={}){
  if(!plot||!Array.isArray(plot.corners)||plot.corners.length<3||
     !ROLES.includes(role)||!Number.isInteger(edge)||edge<0||edge>=plot.corners.length)
    throw Error("Select a valid plot side and a visible boundary edge.");
  if(plot.layout==="three"&&role==="depthB")
    throw Error("Three-sided plots do not have Depth B.");
  if(!inspectGeoPlotSideCoverage(plot).ok)
    throw Error("Incomplete side mapping. Choose Repair Sides before changing the Front or Depth.");
  // Keep the existing four-corner road-facing rotation contract.
  if(plot.layout==="four"&&plot.corners.length===4&&role==="front"&&!extend)
    return assignFourCornerRoadFront(plot,edge);
  // Irregular and triangular groups use lossless transfer or whole-side swap.
  // No direct edit may make the polygon unsaveable.
  return assignCoveredGeoPlotEdge(plot,role,edge,{extend});
}
const RX=/^[A-Za-z0-9][A-Za-z0-9._/-]{0,47}$/;
export function draftStorageKey(slug){
  if(typeof slug!=="string"||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))return null;
  return "rekixo:engine-geo-plot-unapplied:v1:"+slug;
}
export function packLocalPlotDraft({projectSlug,geoReleaseId,buildingReleaseId,mappingRevision,plot,originalId,
  shape,checkedAt=Date.now()}){
  if(!draftStorageKey(projectSlug)||typeof geoReleaseId!=="string"||!geoReleaseId||
    typeof buildingReleaseId!=="string"||!buildingReleaseId||
    !Number.isSafeInteger(mappingRevision)||mappingRevision<0||
    !plot||!RX.test(plot.id)||!["four","irregular"].includes(shape)||
    (originalId!==null&&originalId!==undefined&&!RX.test(originalId))||
    !Array.isArray(plot.corners)||plot.corners.length>80||
    plot.corners.some(p=>!Array.isArray(p)||p.length!==2||!p.every(n=>finite(n)&&Math.abs(n)<=100000)))
    return null;
  return JSON.stringify({schema:"rekixo-engine-geo-local-plot-draft-v1",
    projectSlug,geoReleaseId,buildingReleaseId,mappingRevision,
    plot,originalId:originalId||null,shape,checkedAt});
}
export function unpackLocalPlotDraft(raw,expected,now=Date.now()){
  try{
    if(typeof raw!=="string"||raw.length>150000||!expected)return null;
    const d=JSON.parse(raw);
    if(d?.schema!=="rekixo-engine-geo-local-plot-draft-v1"||
      d.projectSlug!==expected.projectSlug||d.geoReleaseId!==expected.geoReleaseId||
      d.buildingReleaseId!==expected.buildingReleaseId||
      d.mappingRevision!==expected.mappingRevision||
      !finite(d.checkedAt)||d.checkedAt>now+300000||
      now-d.checkedAt>7*24*60*60*1000)return null;
    if(!packLocalPlotDraft(d))return null;
    if(!d.plot.corners.length)return null;
    if(!d.plot.sides||typeof d.plot.sides!=="object"||Array.isArray(d.plot.sides)||
      !d.plot.area||typeof d.plot.area!=="object")return null;
    return {plot:d.plot,originalId:d.originalId,shape:d.shape,checkedAt:d.checkedAt};
  }catch{return null;}
}
export function visibleMappingProgress(inventoryRows,plots){
  const rows=Array.isArray(inventoryRows)?inventoryRows:[];
  const mapped=Array.isArray(plots)?plots:[];
  const covered=new Set(rows.map(x=>clean(x.id)));
  const count=mapped.filter(p=>covered.has(clean(p.id))).length;
  return {inventory:rows.length,confirmed:count,pending:Math.max(0,rows.length-count),
    unexpected:mapped.filter(p=>!covered.has(clean(p.id))).length};
}
