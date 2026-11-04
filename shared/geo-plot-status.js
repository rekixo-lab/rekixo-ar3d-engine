/**
 * Customer-facing Geo STATUS view of the active published plot mapping.
 * The Platform uses Available as the default category for mapped plots without
 * an explicit publicly approved Booked/Sold status. This is a presentation fallback ONLY:
 * it does not create or approve a sale, change a private ledger, or publish
 * prices. Explicit public statuses always take priority.
 */
export const GEO_PLOT_STATUS_VALUES=Object.freeze(["available","booked","sold"]);
// The same saturated Green / Gold / Red feeds Geo WebGL fills, selected prism
// edges and the CSS customer legend. Keep CSS tokens byte-for-byte in sync.
export const GEO_PLOT_STATUS_COLORS=Object.freeze({
  available:0x00dc84,
  booked:0xffc20a,
  sold:0xff4052
});

export function summarizeApprovedGeoPlotStatuses(mapping){
  const plots=Array.isArray(mapping?.plots)?mapping.plots:[];
  const totals={available:0,booked:0,sold:0};
  const statusById=Object.create(null);
  // The server only sends release-bound, public-approved commercial facts.
  // A preliminary release may have no commercial entries at all.
  // A preliminary geometry publication can still carry separately approved
  // commercial facts; source geometry approval and listing status are distinct.
  const commercial=(mapping?.publicationMode==="verified"||mapping?.publicationMode==="preliminary")&&
    mapping.commercial&&typeof mapping.commercial==="object"&&
    !Array.isArray(mapping.commercial)?mapping.commercial:null;
  const seen=new Set();
  let total=0,approved=0;
  for(const plot of plots){
    const id=plot?.id;
    if(typeof id!=="string"||!id.trim()||seen.has(id.toLowerCase()))continue;
    seen.add(id.toLowerCase());
    total++;
    const record=commercial&&Object.prototype.hasOwnProperty.call(commercial,id)
      ?commercial[id]:null;
    const explicit=record?.status;
    const valid=explicit==="available"||explicit==="booked"||explicit==="sold";
    // Preserve explicitly published Booked and Sold. Never infer a sale.
    // Missing, unrecognized and preliminary-only statuses display as Available.
    const status=valid?explicit:"available";
    totals[status]++;
    statusById[id]=status;
    if(valid)approved++;
  }
  return {total,available:totals.available,booked:totals.booked,
    sold:totals.sold,approved,pending:total-approved,statusById};
}
