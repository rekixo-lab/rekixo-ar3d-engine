// UI-only precision mapping helpers. No geometry or measurement authority is changed.
export function nextFreePlotId(plots) {
  const taken=new Set(plots.map(p=>String(p.id).trim().toLowerCase()));
  let id=1;
  while(taken.has(String(id)))id++;
  return String(id);
}
export function adjacentPlot(plots,currentId,direction) {
  if(!plots.length||![1,-1].includes(direction))return null;
  const ordered=[...plots].sort((a,b)=>a.id.localeCompare(b.id,undefined,{numeric:true}));
  const index=ordered.findIndex(p=>p.id===currentId);
  if(index===-1)return ordered[direction===1?0:ordered.length-1];
  return ordered[(index+direction+ordered.length)%ordered.length];
}
export function hasPendingPlotEdits(working,saved) {
  if(!working)return false;
  if(saved)return JSON.stringify(working)!==JSON.stringify(saved);
  return Boolean(working.corners?.length||working.area?.value||
    working.area?.source||working.road||working.notes||
    working.planeSource||working.facingSource||
    Object.values(working.sides||{}).some(s=>s?.verified||s?.length>0));
}
export function isTextEditingTarget(target) {
  if(!target||typeof target!=="object")return false;
  const tag=String(target.tagName||"").toLowerCase();
  return ["input","textarea","select"].includes(tag)||
    target.isContentEditable===true||
    Boolean(target.closest?.("[contenteditable='true']"));
}
export function boundedZoom(current,multiplier) {
  if(!Number.isFinite(current)||!Number.isFinite(multiplier)||multiplier<=0)
    return 1;
  return Math.min(32,Math.max(1,Math.round(current*multiplier*1000)/1000));
}
export function sideLabelAnchor(corners,edges) {
  if(!Array.isArray(corners)||corners.length<3||!Array.isArray(edges)||!edges.length)return null;
  let total=0,x=0,y=0;
  for(const index of edges){
    if(!Number.isInteger(index)||index<0||index>=corners.length)return null;
    const a=corners[index],b=corners[(index+1)%corners.length];
    if(!a||!b)return null;
    const distance=Math.hypot(b[0]-a[0],b[1]-a[1]);
    if(!Number.isFinite(distance)||distance<=0)continue;
    x+=(a[0]+b[0])/2*distance;
    y+=(a[1]+b[1])/2*distance;
    total+=distance;
  }
  return total>0?[x/total,y/total]:null;
}
