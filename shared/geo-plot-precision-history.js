// Operator-only, reversible editor state. Never stores to D1 or affects
// immutable public releases until the normal Apply -> Save -> Verify flow.
import {polygonAreaSqm,polygonHasCrossings} from "../workers/geo-plot-geometry.mjs";
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const MAX_HISTORY=100;
const bounded=(items,item)=>[...items.slice(-(MAX_HISTORY-1)),structuredClone(item)];
export function newPlotEditHistory(present=null){
  return {past:[],present,future:[]};
}
export function replacePlotEditHistory(history,present=null){
  return newPlotEditHistory(present);
}
export function updatePlotEditHistory(history,next,{grouped=false}={}){
  if(same(history.present,next))return history;
  // Switching/clearing plots has no cross-plot undo state.
  if(history.present===null||next===null)return newPlotEditHistory(next);
  return {past:grouped?history.past:bounded(history.past,history.present),
    present:next,future:[]};
}
export function closeGroupedPlotEdit(history,started){
  if(!started||!history.present||same(started,history.present))return history;
  return {past:bounded(history.past,started),present:history.present,future:[]};
}
export function undoPlotEdit(history){
  if(!history.past.length)return history;
  const previous=history.past.at(-1);
  return {past:history.past.slice(0,-1),present:structuredClone(previous),
    future:bounded(history.future,history.present)};
}
export function redoPlotEdit(history){
  if(!history.future.length)return history;
  const following=history.future.at(-1);
  return {past:bounded(history.past,history.present),present:structuredClone(following),
    future:history.future.slice(0,-1)};
}
export function geometryWithRevokedApprovals(plot,corners){
  if(!plot||!Array.isArray(corners)||corners.length!==plot.corners.length)
    throw Error("Cannot revise a plot with mismatched corners.");
  return {...plot,corners:corners.map(p=>[p[0],p[1]]),
    area:{...plot.area,verified:false},facingVerified:false,planeVerified:false,
    sides:Object.fromEntries(Object.entries(plot.sides||{}).map(([role,side])=>
      [role,{...side,verified:false,roadFacing:false}]))};
}
export function nudgePlotCorner(plot,index,dx,dz){
  if(!plot||!Number.isInteger(index)||index<0||index>=plot.corners.length||
     ![dx,dz].every(n=>typeof n==="number"&&Number.isFinite(n)&&Math.abs(n)<=10))
    return {plot,issue:"Select a valid corner and a model-local nudge of at most 10 m."};
  if(dx===0&&dz===0)return {plot,issue:null};
  const corners=plot.corners.map((p,i)=>i===index?[p[0]+dx,p[1]+dz]:[...p]);
  if(corners.some(([x,z])=>!Number.isFinite(x)||!Number.isFinite(z)||
    Math.abs(x)>100000||Math.abs(z)>100000))
    return {plot,issue:"Corner lies outside valid Building-local model coordinates."};
  if(corners.some((p,i)=>{
    const q=corners[(i+1)%corners.length];
    return Math.hypot(p[0]-q[0],p[1]-q[1])<0.001;
  })||polygonAreaSqm(corners)<0.01||polygonHasCrossings(corners))
    return {plot,issue:"Nudge would create a zero-length, crossing or degenerate plot boundary."};
  return {plot:geometryWithRevokedApprovals(plot,corners),issue:null};
}
