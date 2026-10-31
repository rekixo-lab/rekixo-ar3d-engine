// Plot-data operations are private, review-first draft transformations.
// Neither operation writes published releases or buyer/status information.
const roles=["front","depthA","back","depthB"];
export function assignFourCornerRoadFront(plot,frontEdge){
  if(!plot||plot.corners?.length!==4||plot.layout==="three"||
     !Number.isInteger(frontEdge)||frontEdge<0||frontEdge>3)
    throw Error("Select one road-facing edge (0 to 3) of a four-corner plot.");
  const sides={...plot.sides};
  for(let i=0;i<roles.length;i++){
    const role=roles[i],before=plot.sides?.[role];
    sides[role]={...before,edges:[(frontEdge+i)%4],
      roadFacing:role==="front",verified:false};
  }
  return {...plot,sides,facingVerified:false};
}
export function applyApprovedInventoryRow(plot,row){
  if(!plot||!row||String(plot.id).toLowerCase()!==String(row.id).toLowerCase())
    throw Error("Approved inventory Plot ID must match the selected mapped plot.");
  const copy={...plot,sides:{...plot.sides},area:{...plot.area}};
  if(row.area>0){
    copy.area={...copy.area,value:row.area,unit:row.areaUnit,
      source:row.areaSource,verified:false};
  }
  for(const role of roles){
    if(!(row[role]>0))continue;
    const current=copy.sides[role];
    if(!current)continue;
    copy.sides[role]={...current,length:row[role],unit:row.lengthUnit,
      source:row.measurementSource,verified:false};
  }
  if(row.facing){
    copy.facing=row.facing;copy.facingVerified=false;
  }
  if(row.facingSource){
    copy.facingSource=row.facingSource;copy.facingVerified=false;
  }
  if(row.road){
    copy.road=row.road;copy.facingVerified=false;
  }
  // Geometry, approved site plane and source project ownership never change.
  return copy;
}
