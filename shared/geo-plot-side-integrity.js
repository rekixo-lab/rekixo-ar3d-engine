// Private editor-only integrity checks and explicit repair of legacy/unapplied
// side assignments. Does NOT change polygon coordinates, source measurements,
// commercial history, D1 records or any published release.
const ORDER=["front","depthA","back","depthB"];
const defaultSide=()=>({edges:[],length:0,unit:"ft",roadFacing:false,source:"",verified:false});
const rolesFor=plot=>plot?.corners?.length===3||plot?.layout==="three"?ORDER.slice(0,3):ORDER;
const isEdge=(i,n)=>Number.isInteger(i)&&i>=0&&i<n;
const consecutive=(edges,n)=>edges.every((edge,i)=>i===0||edge===(edges[i-1]+1)%n);

export function inspectGeoPlotSideCoverage(plot){
  const n=Array.isArray(plot?.corners)?plot.corners.length:0;
  const roles=rolesFor(plot);
  const owners=Array.from({length:n},()=>[]);
  const invalidEdges=[],missingRoles=[],disconnectedRoles=[];
  for(const role of roles){
    const edges=plot?.sides?.[role]?.edges;
    if(!Array.isArray(edges)||!edges.length){missingRoles.push(role);continue;}
    if(!consecutive(edges,n))disconnectedRoles.push(role);
    const seen=new Set();
    for(const edge of edges){
      if(!isEdge(edge,n)){invalidEdges.push({role,edge});continue;}
      if(seen.has(edge)){disconnectedRoles.push(role);continue;}
      seen.add(edge);owners[edge].push(role);
    }
  }
  if(roles.length===3&&plot?.sides?.depthB!=null)
    invalidEdges.push({role:"depthB",edge:plot.sides.depthB.edges?.[0]??null});
  const missingEdges=[],duplicateEdges=[];
  owners.forEach((list,i)=>{if(!list.length)missingEdges.push(i);else if(list.length>1)duplicateEdges.push(i);});
  const uniqueDisconnected=[...new Set(disconnectedRoles)];
  return {ok:n>=3&&n<=80&&!missingEdges.length&&!duplicateEdges.length&&
      !invalidEdges.length&&!missingRoles.length&&!uniqueDisconnected.length,
    edgeCount:n,roles,owners,missingEdges,duplicateEdges,invalidEdges,missingRoles,
    disconnectedRoles:uniqueDisconnected};
}

function cleanRevision(plot,sides){
  return {...plot,sides, facingVerified:false};
}

// On a valid partition, selecting a different role exchanges WHOLE connected
// groups. Replacing only the target group's edges would silently orphan them.
export function assignCoveredGeoPlotEdge(plot,role,edge,{extend=false}={}){
  const inspection=inspectGeoPlotSideCoverage(plot),n=inspection.edgeCount;
  if(!inspection.roles.includes(role)||!isEdge(edge,n))
    throw Error("Select a valid plot side and a visible boundary edge.");
  if(!inspection.ok)throw Error("Some plot edges are not assigned correctly. Use Repair Sides before editing.");
  const sides=Object.fromEntries(inspection.roles.map(key=>[key,{
    ...defaultSide(),...(plot.sides?.[key]||{}),
    edges:[...plot.sides[key].edges]}]));
  const owner=inspection.owners[edge][0];
  if(!extend){
    if(owner!==role){
      // When a connected boundary ring follows the four/three logical side
      // order, rotate WHOLE side groups. Thus selecting a new road Front also
      // reorients Back and both Depths without losing corner/arc segments.
      const ordered=inspection.roles.every((key,i)=>{
        const next=inspection.roles[(i+1)%inspection.roles.length];
        return (sides[key].edges.at(-1)+1)%n===sides[next].edges[0];
      });
      if(ordered&&n!==4){
        const offset=(inspection.roles.indexOf(owner)-inspection.roles.indexOf(role)+inspection.roles.length)%inspection.roles.length;
        const old=Object.fromEntries(inspection.roles.map(key=>[key,[...sides[key].edges]]));
        for(let i=0;i<inspection.roles.length;i++)
          sides[inspection.roles[i]].edges=[...old[inspection.roles[(i+offset)%inspection.roles.length]]];
        for(const key of inspection.roles){
          sides[key].verified=false;
          sides[key].facingDirection=undefined;
          sides[key].roadFacing=key==="front"&&role==="front";
        }
      }else{
        // Legacy manually reordered layouts remain editable without data loss.
        const previous=sides[role].edges;
        sides[role].edges=sides[owner].edges;
        sides[owner].edges=previous;
        for(const changed of [role,owner]){
          sides[changed].verified=false;
          sides[changed].facingDirection=undefined;
          sides[changed].roadFacing=changed==="front"&&role==="front";
        }
      }
    }else if(role==="front"){
      sides.front.roadFacing=true;
      sides.front.verified=false;
      sides.front.facingDirection=undefined;
    }
  }else if(owner!==role){
    const original=sides[owner].edges;
    if(original.length<=1)
      throw Error("Cannot take the last boundary edge from "+owner+". Select a side without Extend to swap whole groups.");
    const target=sides[role].edges;
    if((target[target.length-1]+1)%n===edge&&original[0]===edge){
      sides[role].edges=[...target,edge];
      sides[owner].edges=original.slice(1);
    }else if((edge+1)%n===target[0]&&original[original.length-1]===edge){
      sides[role].edges=[edge,...target];
      sides[owner].edges=original.slice(0,-1);
    }else throw Error("Only adjoining chain-end edges can be moved. Choose the neighboring segment.");
    for(const changed of [role,owner]){
      sides[changed].verified=false;
      sides[changed].roadFacing=changed==="front";
      sides[changed].facingDirection=undefined;
    }
  }else{
    const original=sides[role].edges;
    if(original.length<=1)throw Error("A logical side must retain at least one boundary edge.");
    if(edge!==original[0]&&edge!==original[original.length-1])
      throw Error("Shrink a side only at its first or last boundary segment.");
    const neighborEdge=edge===original[0]?(edge-1+n)%n:(edge+1)%n;
    const neighbor=inspection.owners[neighborEdge][0];
    if(!neighbor||neighbor===role)throw Error("No adjoining logical side found.");
    if(edge===original[0]){
      sides[role].edges=original.slice(1);
      sides[neighbor].edges=[...sides[neighbor].edges,edge];
    }else{
      sides[role].edges=original.slice(0,-1);
      sides[neighbor].edges=[edge,...sides[neighbor].edges];
    }
    for(const changed of [role,neighbor]){
      sides[changed].verified=false;
      sides[changed].roadFacing=changed==="front";
      sides[changed].facingDirection=undefined;
    }
  }
  const result=cleanRevision(plot,sides);
  if(!inspectGeoPlotSideCoverage(result).ok)
    throw Error("This edit would leave a side missing or an edge unassigned.");
  return result;
}

// Explicit repair for old broken local drafts: find the four (or three)
// contiguous groups that preserve the most existing edge-to-role assignments.
// Starts at the user's existing Front, NEVER changes their polygon vertices.
export function repairGeoPlotSideCoverage(plot){
  const audit=inspectGeoPlotSideCoverage(plot),n=audit.edgeCount,roles=audit.roles;
  if(n<roles.length||n>80)throw Error("Finish a valid polygon before repairing sides.");
  if(audit.ok)return plot;
  const currentFront=plot.sides?.front?.edges?.find(i=>isEdge(i,n));
  const start=Number.isInteger(currentFront)?currentFront:0;
  const mismatch=(role,position)=>{
    const owners=audit.owners[(start+position)%n];
    return owners.includes(role)?0:owners.length?4:1;
  };
  // Dynamic programming over ordered ring partitions. Every role receives
  // at least one segment, every edge exactly one role, including wraparound.
  const m=roles.length,dp=Array.from({length:m+1},()=>Array(n+1).fill(Infinity));
  const back=Array.from({length:m+1},()=>Array(n+1).fill(-1));
  dp[0][0]=0;
  for(let k=1;k<=m;k++){
    const role=roles[k-1];
    const prefix=[0];
    for(let i=0;i<n;i++)prefix.push(prefix[i]+mismatch(role,i));
    for(let end=k;end<=n-(m-k);end++){
      for(let begin=k-1;begin<end;begin++){
        const cost=dp[k-1][begin]+prefix[end]-prefix[begin];
        if(cost<dp[k][end]){
          dp[k][end]=cost;back[k][end]=begin;
        }
      }
    }
  }
  if(!Number.isFinite(dp[m][n]))throw Error("Unable to find complete connected side groups.");
  const newSides={...plot.sides};
  let end=n;
  for(let k=m;k>=1;k--){
    const begin=back[k][end],role=roles[k-1];
    const edges=Array.from({length:end-begin},(_,i)=>(start+begin+i)%n);
    newSides[role]={...defaultSide(),...(plot.sides?.[role]||{}),edges,
      verified:false,roadFacing:false,facingDirection:undefined};
    end=begin;
  }
  if(m===3)delete newSides.depthB;
  const repaired=cleanRevision(plot,newSides);
  if(!inspectGeoPlotSideCoverage(repaired).ok)
    throw Error("Automatic repair was incomplete; original plot remains unchanged.");
  return repaired;
}
