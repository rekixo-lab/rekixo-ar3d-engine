// Owner-private release preflight. Do not use normalized JSON order as a substitute
// for sealed release SHA-256; callers verify the sealed text hash separately.
const cleanId=p=>String(p.id).trim().toLowerCase();
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const facts=[
  ["geometry",p=>[p.corners,p.layout,p.planeY,p.planeSource,p.planeVerified]],
  ["approvedArea",p=>p.area],
  ["sideMeasurements",p=>p.sides],
  ["roadAndFacing",p=>[p.road,p.facing,p.facingSource,p.facingVerified]],
  ["notes",p=>p.notes]
];
export function compareGeoPlotPublication(draftPlots,livePlots){
  if(!Array.isArray(draftPlots)||!Array.isArray(livePlots)||
    draftPlots.length>2500||livePlots.length>2500)
    throw Error("Publication comparison supports at most 2,500 plots per release.");
  const index=arr=>{
    const ids=new Map();
    for(const plot of arr){
      if(!plot||typeof plot.id!=="string"||!plot.id.trim())throw Error("Comparison requires canonical Plot IDs.");
      const id=cleanId(plot);
      if(ids.has(id))throw Error("Comparison contains duplicate Plot ID "+plot.id+".");
      ids.set(id,plot);
    }
    return ids;
  };
  const next=index(draftPlots),prev=index(livePlots);
  const changes=[];
  for(const [id,p] of next){
    const before=prev.get(id);
    if(!before){changes.push({plotId:p.id,kind:"added",fields:["geometry","approvedArea","sideMeasurements","roadAndFacing"],requiresReapproval:true});continue;}
    const fields=facts.filter(([,fn])=>!same(fn(before),fn(p))).map(([label])=>label);
    if(fields.length)changes.push({plotId:p.id,kind:"changed",fields,
      requiresReapproval:fields.some(k=>k!=="notes")});
  }
  for(const [id,p] of prev)if(!next.has(id))
    changes.push({plotId:p.id,kind:"removed",fields:["geometry","approvedArea","sideMeasurements","roadAndFacing"],requiresReapproval:true});
  changes.sort((a,b)=>a.plotId.localeCompare(b.plotId,undefined,{numeric:true}));
  return {schema:"geo-plot-publish-diff-v1",liveCount:livePlots.length,
    draftCount:draftPlots.length,
    added:changes.filter(x=>x.kind==="added").length,
    removed:changes.filter(x=>x.kind==="removed").length,
    changed:changes.filter(x=>x.kind==="changed").length,
    approvalRequired:changes.filter(x=>x.requiresReapproval).map(x=>x.plotId),
    changes};
}
