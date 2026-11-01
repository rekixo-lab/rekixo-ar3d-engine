// Legacy Geo Plot Studio only. Read-only diagnostic + explicitly unverified
// template creation. Never writes published Geo releases, source inventory, or sales.
import {polygonAreaSqm,polygonHasCrossings,polygonsOverlapInArea} from "../workers/geo-plot-geometry.mjs";
import {geoInventoryReviewIssues} from "./geo-plot-source-review.js";
const ROLES=["front","back","depthA","depthB"];
const SQM={sqm:1,sqft:0.09290304,sqyd:0.83612736};
const METRES={m:1,ft:0.3048};
const finite=n=>typeof n==="number"&&Number.isFinite(n);
const unit=(value,scale)=>finite(value)&&finite(scale)?value*scale:null;
const round=n=>finite(n)?Number(n.toFixed(5)):null;
const sourcePage=ref=>{
  const match=String(ref||"").match(/\b(?:page|pg\.?|p\.?)\s*#?\s*(\d{1,4})\b/i);
  return match?match[1]:null;
};
function perimeterMetres(corners,edges){
  if(!Array.isArray(corners)||!Array.isArray(edges))return null;
  let sum=0;
  for(const i of edges){
    if(!Number.isInteger(i)||i<0||i>=corners.length)return null;
    const a=corners[i],b=corners[(i+1)%corners.length];
    sum+=Math.hypot(b[0]-a[0],b[1]-a[1]);
  }
  return round(sum);
}
const box=ring=>ring.reduce((b,p)=>({
  minX:Math.min(b.minX,p[0]),maxX:Math.max(b.maxX,p[0]),
  minZ:Math.min(b.minZ,p[1]),maxZ:Math.max(b.maxZ,p[1])
}),{minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity});
export function cloneUnverifiedGeoPlot(previous,newId,dx,dz,inventoryRows=[],existing=[]){
  const id=String(newId||"").trim();
  if(!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,47}$/.test(id))
    throw Error("Choose a valid new canonical Plot ID.");
  if(existing.some(p=>p.id.toLowerCase()===id.toLowerCase()))
    throw Error("This Plot ID is already mapped. Use Edit instead.");
  if(!previous||!Array.isArray(previous.corners)||previous.corners.length<3)
    throw Error("Choose a completed previous plot before cloning its footprint.");
  if(!finite(dx)||!finite(dz)||Math.abs(dx)>10000||Math.abs(dz)>10000||
     (Math.abs(dx)<0.000001&&Math.abs(dz)<0.000001))
    throw Error("Supply non-zero, finite model X and/or Z offsets up to 10,000 metres.");
  const corners=previous.corners.map(([x,z])=>[round(x+dx),round(z+dz)]);
  if(corners.some(point=>point.some(v=>!finite(v)||Math.abs(v)>100000)))
    throw Error("The translated geometry lies outside Building-local coordinate limits.");
  const left=box(corners);
  for(const other of existing){
    if(other.id.toLowerCase()===id.toLowerCase())continue;
    const right=box(other.corners);
    if(left.minX>=right.maxX-1e-8||right.minX>=left.maxX-1e-8||
       left.minZ>=right.maxZ-1e-8||right.minZ>=left.maxZ-1e-8)continue;
    if(polygonsOverlapInArea(corners,other.corners))
      throw Error("Cloned footprint overlaps Plot "+other.id+
        ". Adjust the X/Z offset; source plots are not changed.");
  }
  const row=inventoryRows.find(p=>p.id.toLowerCase()===id.toLowerCase());
  const sides={};
  for(const role of ROLES){
    const old=previous.sides?.[role];
    if(!old)continue;
    const fromCsv=row?.[role]>0;
    sides[role]={...old,
      length:fromCsv?row[role]:old.length,
      unit:fromCsv?row.lengthUnit:old.unit,
      // No evidence from the previous plot can authorize this NEW plot.
      source:fromCsv?row.measurementSource:"",
      verified:false,roadFacing:false,edges:[...old.edges]};
  }
  return {...previous,id,corners,sides,
    area:{...previous.area,value:row?.area>0?row.area:previous.area.value,
      unit:row?.area>0?row.areaUnit:previous.area.unit,
      source:row?.area>0?row.areaSource:"",verified:false},
    facing:row?.facing||previous.facing,
    facingSource:row?.facingSource||"",facingVerified:false,
    road:row?.road||"",planeVerified:false,planeSource:"",
    notes:"Unverified footprint template from Plot "+previous.id+
      ". Confirm actual survey, road sides, plane and each measurement independently."};
}
export function geoPlotEvidenceManifest(plots,inventoryRows,geoScale=1,revision={}){
  const factor=finite(geoScale)&&geoScale>0?geoScale:null;
  const csv=new Map((inventoryRows||[]).map(x=>[x.id.toLowerCase(),x]));
  return {schema:"geo-plot-source-evidence-review-v1",units:"m and sqm",
    advisoryOnly:true,authority:"Approved source facts must be checked against signed survey; estimates are not approved.",
    inventoryRevision:revision.inventoryRevision??null,mappingRevision:revision.mappingRevision??null,
    alignmentRevision:revision.alignmentRevision??null,
    scale:factor,plots:plots.map(plot=>{
      const row=csv.get(plot.id.toLowerCase());
      const sqm=polygonAreaSqm(plot.corners);
      const area={approvedSource:row?.area>0?{
        value:row.area,unit:row.areaUnit,reference:row.areaSource,
        rawText:row.dimensions||null,page:sourcePage(row.areaSource),confidence:"not_assessed",
        approvedInMapping:Boolean(plot.area?.verified)}:null,
        mappedSource:{value:plot.area?.value??null,unit:plot.area?.unit??null,
          reference:plot.area?.source||null,verified:Boolean(plot.area?.verified)},
        modelLocalEstimateSqm:round(sqm),
        geoScaledEstimateSqm:factor===null?null:round(sqm*factor*factor)};
      const sides=Object.fromEntries(ROLES.map(role=>{
        const side=plot.sides?.[role],ref=row?.[role]>0;
        const local=perimeterMetres(plot.corners,side?.edges||[]);
        return [role,{approvedSource:ref?{
            value:row[role],unit:row.lengthUnit,reference:row.measurementSource,
            rawText:row.dimensions||null,page:sourcePage(row.measurementSource),confidence:"not_assessed",
            approvedInMapping:Boolean(side?.verified)}:null,
          mappedSource:side?{value:side.length,unit:side.unit,
            reference:side.source||null,verified:Boolean(side.verified),
            roadFacing:Boolean(side.roadFacing),edges:side.edges}:null,
          modelLocalEstimateM:local,
          geoScaledEstimateM:local!==null&&factor!==null?round(local*factor):null}];
      }));
      return {plotId:plot.id,sourceInventoryRow:row||null,area,sides,
        facing:{value:plot.facing,source:plot.facingSource,verified:Boolean(plot.facingVerified)},
        plane:{modelLocalY:plot.planeY??null,reference:plot.planeSource||null,
          verified:Boolean(plot.planeVerified)}};
    })};
}
export function geoPlotQualityReport(plots,inventoryRows=[],options={}){
  const issues=[],add=(severity,plotId,field,reason)=>issues.push({severity,plotId,field,reason});
  const byId=new Map(plots.map(p=>[p.id.toLowerCase(),p]));
  if(inventoryRows.length){
    for(const row of inventoryRows)if(!byId.has(row.id.toLowerCase()))
      add("review",row.id,"unmapped","Approved inventory Plot ID is not mapped.");
    for(const p of plots)if(!inventoryRows.some(row=>row.id.toLowerCase()===p.id.toLowerCase()))
      add("blocker",p.id,"inventory","Mapped plot absent from approved inventory.");
  }
  for(const issue of geoInventoryReviewIssues(plots,inventoryRows))
    add("blocker",issue.plotId,issue.field,issue.reason);
  if(options.mappingStale)add("blocker","project","mapping","Geo/Building source has changed; draft mapping is stale.");
  if(options.alignmentStale)add("blocker","project","alignment","Original image/model alignment is stale.");
  if(options.alignmentRevision>0&&options.verifiedAlignmentRevision!==options.alignmentRevision)
    add("blocker","project","alignment","New image/model alignment revision requires mapping review.");
  if(options.alignmentIssueCount>0)
    add("blocker","project","checkpoints","Independent image/model checkpoint QA has unresolved issues.");
  if(options.inventoryRevision!==undefined&&options.verifiedInventoryRevision!==null&&
     options.verifiedInventoryRevision!==options.inventoryRevision)
    add("blocker","project","inventoryRevision","Approved inventory revision differs from mapping verification.");
  for(const p of plots){
    if(!Array.isArray(p.corners)||p.corners.length<3){
      add("blocker",p.id,"geometry","Plot needs three or more mapped corners.");
      continue;
    }
    if(polygonAreaSqm(p.corners)<0.01||polygonHasCrossings(p.corners)){
      add("blocker",p.id,"geometry","Plot boundary is degenerate or self-intersecting.");
      continue;
    }
    if(!p.area?.verified)add("review",p.id,"area","Approved mapped area is not verified.");
    if(!p.facingVerified)add("review",p.id,"facing","Compass/front facing is not verified.");
    if(!p.planeVerified)add("review",p.id,"plane","Building-local mapping plane is not verified.");
    if(p.road&&!p.sides?.front?.roadFacing)
      add("blocker",p.id,"frontRoad","Road/access present without approved road-facing Front.");
    if(p.road&&p.sides?.front?.roadFacing&&
       !p.sides.front.verified)add("review",p.id,"frontReview","Road-facing Front has not been source-verified.");
    for(const role of ROLES){
      const side=p.sides?.[role];if(side&&!side.verified)
        add("review",p.id,role+"Verified","Side requires approved source verification.");
    }
    if(finite(options.geoScale)&&options.geoScale>0&&p.area?.value>0&&SQM[p.area.unit]){
      const approved=p.area.value*SQM[p.area.unit],estimated=polygonAreaSqm(p.corners)*options.geoScale**2;
      if(approved>0&&Math.abs(approved-estimated)/approved>0.1)
        add("review",p.id,"areaVariance","Geo-scaled model estimate differs from approved area by more than 10%.");
    }
    if(finite(options.geoScale)&&options.geoScale>0)for(const role of ROLES){
      const side=p.sides?.[role];
      if(!side?.length||!METRES[side.unit])continue;
      const local=perimeterMetres(p.corners,side.edges);
      if(local===null)continue;
      const approved=side.length*METRES[side.unit],scaled=local*options.geoScale;
      if(approved>0&&Math.abs(approved-scaled)/approved>0.1)
        add("review",p.id,role+"Variance","Geo-scaled model side estimate differs from approved length by more than 10%.");
    }
  }
  // Ordered X/Z sweep: shared edges are valid, interior overlaps are not.
  const ordered=plots.filter(p=>Array.isArray(p.corners)&&p.corners.length>=3)
    .map(plot=>({plot,b:box(plot.corners)})).sort((a,b)=>a.b.minX-b.b.minX);
  for(let i=0;i<ordered.length;i++){
    const a=ordered[i];
    for(let j=i+1;j<ordered.length;j++){
      const b=ordered[j];if(b.b.minX>=a.b.maxX-1e-8)break;
      if(b.b.minZ>=a.b.maxZ-1e-8||a.b.minZ>=b.b.maxZ-1e-8)continue;
      if(polygonsOverlapInArea(a.plot.corners,b.plot.corners))
        add("blocker",a.plot.id+" / "+b.plot.id,"overlap","Two distinct plot footprints overlap in ground area.");
    }
  }
  issues.sort((a,b)=>(a.severity==="blocker"?0:1)-(b.severity==="blocker"?0:1));
  return {schema:"geo-plot-quality-report-v1",advisoryOnly:true,issues,
    summary:{mapped:plots.length,inventory:inventoryRows.length,
      blockers:issues.filter(x=>x.severity==="blocker").length,
      reviews:issues.filter(x=>x.severity==="review").length}};
}
