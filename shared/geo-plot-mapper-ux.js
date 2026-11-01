// UI-only precision/selection helpers. No D1, Cloudflare or published release writes.
import {assignFourCornerRoadFront} from "./geo-plot-source-operations.js";
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
export function positionCursorLoupe(screen,viewport,size=170,gap=18){
  if(!Array.isArray(screen)||!Array.isArray(viewport)||![...screen,...viewport,size,gap].every(finite))
    return {left:12,top:12};
  const [x,y]=screen,[w,h]=viewport,margin=8;
  const left=x+gap+size>w-margin?x-gap-size:x+gap;
  const top=y+gap+size>h-margin?y-gap-size:y+gap;
  return {left:Math.round(Math.max(margin,Math.min(Math.max(margin,w-size-margin),left))),
    top:Math.round(Math.max(margin,Math.min(Math.max(margin,h-size-margin),top)))};
}
export function assignVisiblePlotEdge(plot,role,edge,{extend=false}={}){
  if(!plot||!Array.isArray(plot.corners)||plot.corners.length<3||
    !ROLES.includes(role)||!Number.isInteger(edge)||edge<0||edge>=plot.corners.length)
    throw Error("Select a valid plot side and a visible boundary edge.");
  if(plot.layout==="three"&&role==="depthB")
    throw Error("Three-sided plots do not have Depth B.");
  if(plot.layout==="four"&&plot.corners.length===4&&role==="front"&&!extend)
    return assignFourCornerRoadFront(plot,edge);
  const count=plot.corners.length;
  const before=plot.sides||{};
  // In an ordinary quadrilateral, switching Back/Depth edges is a permutation,
  // not a delete: every segment must keep exactly one role for draft validation.
  if(count===4&&plot.layout==="four"&&!extend){
    const targetEdge=before[role]?.edges?.[0];
    const owner=ROLES.find(key=>before[key]?.edges?.includes(edge));
    if(owner&&owner!==role&&Number.isInteger(targetEdge)){
      const sides=Object.fromEntries(ROLES.map(key=>[key,{
        ...before[key],edges:[...(before[key]?.edges||[])],
        verified:false
      }]));
      sides[role]={...sides[role],edges:[edge],
        roadFacing:role==="front",verified:false};
      sides[owner]={...sides[owner],edges:[targetEdge],
        roadFacing:owner==="front",verified:false};
      return {...plot,sides,facingVerified:false};
    }
  }
  const sides={};
  for(const key of ROLES){
    const side=before[key]||{length:0,unit:"ft",source:"",roadFacing:false,verified:false,edges:[]};
    const current=Array.isArray(side.edges)?side.edges.filter(x=>x!==edge):[];
    sides[key]={...side,edges:current,verified:false,
      roadFacing:key==="front"&&current.length>0?Boolean(side.roadFacing):false};
  }
  const target=sides[role];
  const old=Array.isArray(before[role]?.edges)?before[role].edges:[];
  let edges=[edge];
  if(extend&&old.length){
    if(old.includes(edge)){
      if(old.length===1)throw Error("A side must retain at least one boundary edge.");
      if(edge!==old[0]&&edge!==old[old.length-1])
        throw Error("Remove grouped side edges only from a chain end.");
      edges=target.edges;
    }else if((old[old.length-1]+1)%count===edge){
      edges=[...target.edges,edge];
    }else if((edge+1)%count===old[0]){
      edges=[edge,...target.edges];
    }else throw Error("Add connected side edges in sequence; avoid disconnected chains.");
  }
  sides[role]={...target,edges,roadFacing:role==="front",verified:false};
  return {...plot,sides,facingVerified:false};
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
