// Engine-only private drawing workflow decision. No project, server or
// immutable mapping changes; a mode switch must not delete an in-progress plot.
export function geoPlotToolResumeAction({plot,originalId,shape,requestedShape}){
  if(!plot||shape!==requestedShape||
    !Array.isArray(plot.corners)||!plot.corners.length||
    !["four","irregular"].includes(requestedShape))return "start";
  // An existing server-mapped plot must remain in Edit when the operator
  // returns from Pan; a shape-tool tap must never jump to another CSV Plot ID.
  if(originalId)return "edit";
  if((requestedShape==="four"&&plot.corners.length>=4)||
    plot.corners.length>=80)return "edit";
  return "resume";
}
export function geoPlotPausedDrawingLabel({mode,plot,originalId,shape}){
  if(mode!=="pan"||!plot||originalId||!Array.isArray(plot.corners)||
    plot.corners.length===0||!["four","irregular"].includes(shape)||
    (shape==="four"&&plot.corners.length>=4)||
    plot.corners.length>=80)return null;
  const current=plot.corners.length;
  return {
    text:"Plot "+plot.id+" paused · "+current+(shape==="four"?"/4":"")+
      " corners kept · Resume Drawing for corner "+(current+1),
    nextCorner:current+1,plotId:plot.id
  };
}
