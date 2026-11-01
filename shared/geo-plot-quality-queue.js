// Read-only operator guidance over the existing private Geo Plot quality report.
// Nothing here changes source measurements, geometry, or approval flags.
const numericIdSort=(a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:"base"});
const stepForField=field=>{
  if(field==="frontRoad")return "Open Front / Back & Depth. Match the FRONT edge with the actual road; mark Road side only after checking the approved plan.";
  if(field==="geometry")return "Inspect the actual 3D boundary for crossing or missing corners before reviewing measurements.";
  if(field==="overlap")return "Inspect both plotted boundaries. Shared edges are valid, but two plot interiors must not overlap.";
  if(field==="inventory"||field==="id"||field==="areaSource"||field.endsWith("Source"))
    return "Reconcile this Plot ID against the latest approved CSV before checking any source verification boxes.";
  if(field==="area"||field==="areaVariance")
    return "Compare the mapped area with the approved plan and GLB scale; fix any real discrepancy, then confirm Area verified.";
  if(field==="facing"||field==="facingSource")
    return "Check the original masterplan and Geo North; confirm Facing and its approved source.";
  if(field==="plane")
    return "Review model-local elevation Y and a valid approved model/site-plane source before verifying the plane.";
  if(field.endsWith("Verified")||field==="frontReview")
    return "Review Front/Back/Depth lengths and source documents, then individually confirm the corresponding Source verified box.";
  if(field.endsWith("Variance"))
    return "Check the approved CSV length, real plotted 3D edge and GLB scale; model estimates are not source evidence.";
  if(field==="road")return "Reconcile the Road / Access description with the approved CSV and original drawing.";
  return "Review the indicated source, geometry and current CSV before applying the draft and verifying.";
};
export function geoPlotReviewQueue(plots,issues){
  const byId=new Map((Array.isArray(plots)?plots:[]).map(plot=>[
    String(plot.id).toLowerCase(),{id:String(plot.id),blockers:0,reviews:0,issues:[]}
  ]));
  const general=[];
  for(const issue of Array.isArray(issues)?issues:[]){
    const row=byId.get(String(issue.plotId).toLowerCase());
    if(!row){general.push(issue);continue;}
    if(issue.severity==="blocker")row.blockers++;
    else if(issue.severity==="review")row.reviews++;
    row.issues.push(issue);
  }
  const queue=[...byId.values()].filter(row=>row.issues.length).map(row=>{
    const primary=row.issues.find(issue=>issue.severity==="blocker")||row.issues[0];
    return {...row,primaryField:primary.field,nextAction:stepForField(primary.field)};
  }).sort((a,b)=>Number(b.blockers>0)-Number(a.blockers>0)||numericIdSort(a.id,b.id));
  return {queue,general,affected:queue.length,
    blockedPlots:queue.filter(row=>row.blockers>0).length,
    reviewPlots:queue.filter(row=>row.reviews>0).length};
}
export function geoPlotReviewFieldAction(field){return stepForField(String(field||""));}
