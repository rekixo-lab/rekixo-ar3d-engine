// Engine legacy Geo mapper only. Private CSV inventory is authoritative source
// metadata, not a polygon/status/sales database. Compare values in physical units
// before verifying or publishing a draft. Never mutate an immutable release.
const AREA_TO_SQM={sqm:1,sqft:0.09290304,sqyd:0.83612736};
const LENGTH_TO_M={m:1,ft:0.3048};
const ROLES=["front","back","depthA","depthB"];
const clean=v=>String(v??"").trim().replace(/\s+/g," ").toLowerCase();
const same=(a,b)=>clean(a)===clean(b);
const approx=(a,b,tolerance=0.01)=>{
  if(!Number.isFinite(a)||!Number.isFinite(b)||a<=0||b<=0)return false;
  return Math.abs(a-b)<=Math.max(0.000001,Math.max(a,b)*tolerance);
};
export function geoInventoryReviewIssues(plots,inventoryRows){
  if(!Array.isArray(inventoryRows)||inventoryRows.length===0)return [];
  const index=new Map(inventoryRows.map(row=>[clean(row.id),row]));
  const issues=[];
  for(const plot of plots){
    const row=index.get(clean(plot.id));
    if(!row){issues.push({plotId:plot.id,field:"id",reason:"Plot is absent from the imported source inventory."});continue;}
    const issue=(field,reason)=>issues.push({plotId:plot.id,field,reason});
    if(row.area>0){
      const p=plot.area||{};
      const left=p.value*AREA_TO_SQM[p.unit],right=row.area*AREA_TO_SQM[row.areaUnit];
      if(!approx(left,right))issue("area","Approved area differs from current CSV inventory.");
      if(!same(p.source,row.areaSource))issue("areaSource","Approved area source/reference differs from current inventory.");
    }
    for(const role of ROLES){
      const approved=row[role];
      if(!(approved>0))continue;
      const p=plot.sides?.[role];
      if(!p||!approx(p.length*LENGTH_TO_M[p.unit],approved*LENGTH_TO_M[row.lengthUnit]))
        issue(role,"Approved "+role+" length differs from current CSV inventory.");
      if(!same(p?.source,row.measurementSource))
        issue(role+"Source","Approved "+role+" source/reference differs from current inventory.");
    }
    if(row.facing&&!same(plot.facing,row.facing))
      issue("facing","Compass facing differs from current CSV inventory.");
    if(row.facingSource&&!same(plot.facingSource,row.facingSource))
      issue("facingSource","Compass source differs from current CSV inventory.");
    if(row.road&&!same(plot.road,row.road))
      issue("road","Road/access differs from current CSV inventory.");
  }
  return issues;
}
export function requireGeoInventoryReview(plots,inventoryRows){
  const issues=geoInventoryReviewIssues(plots,inventoryRows);
  if(issues.length){
    const first=issues[0];
    throw Error("Inventory reconciliation required for Plot "+first.plotId+
      " ("+first.field+"): "+first.reason+
      " Open the mapped Plot Editor, apply the current approved CSV values, re-review sources, Save Draft and Verify. "+
      issues.length+" issue(s) found.");
  }
  return true;
}
