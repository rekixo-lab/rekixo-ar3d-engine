/**
 * Public Geo availability is sourced ONLY from release-bound, owner-approved
 * commercial facts. Never infer "Available" from an unreviewed/missing record.
 */
export const GEO_PLOT_STATUS_VALUES=Object.freeze(["available","booked","sold"]);

export function summarizeApprovedGeoPlotStatuses(mapping){
  const plots=Array.isArray(mapping?.plots)?mapping.plots:[];
  const totals={available:0,booked:0,sold:0};
  const statusById=Object.create(null);
  const verified=mapping?.publicationMode==="verified";
  const commercial=verified&&mapping?.commercial&&
    typeof mapping.commercial==="object"&&!Array.isArray(mapping.commercial)
    ?mapping.commercial:null;
  const seen=new Set();
  let total=0,approved=0;
  for(const plot of plots){
    const id=plot?.id;
    if(typeof id!=="string"||!id||seen.has(id.toLowerCase()))continue;
    seen.add(id.toLowerCase());
    total++;
    if(!commercial||!Object.prototype.hasOwnProperty.call(commercial,id))continue;
    const status=commercial[id]?.status;
    if(status!=="available"&&status!=="booked"&&status!=="sold")continue;
    totals[status]++;
    statusById[id]=status;
    approved++;
  }
  return {total,available:totals.available,booked:totals.booked,
    sold:totals.sold,approved,pending:total-approved,statusById};
}
