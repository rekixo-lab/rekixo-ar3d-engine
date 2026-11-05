// Side-edit preview is PRIVATE UI state. No automatic swap, D1 writes or publish.
// A clicked corner range locks only that named role; remaining changes are only
// proposed after an explicit "Auto Fill Rest" action and are reviewed before Apply.
import {inspectGeoPlotSideCoverage} from "./geo-plot-side-integrity.js";

const ORDER=["front","depthA","back","depthB"];
const inRange=(i,n)=>Number.isInteger(i)&&i>=0&&i<n;
const same=(a,b)=>a.length===b.length&&a.every((x,i)=>x===b[i]);
const isConnected=(edges,n)=>edges.every((edge,i)=>i===0||edge===(edges[i-1]+1)%n);
const availableRoles=plot=>plot?.layout==="three"||plot?.corners?.length===3?ORDER.slice(0,3):ORDER;
const permutations=arr=>arr.length===0?[[]]:arr.flatMap((v,i)=>
  permutations([...arr.slice(0,i),...arr.slice(i+1)]).map(t=>[v,...t]));

export function geoManualCornerChain(startCorner,endCorner,pointCount){
  if(!Number.isInteger(pointCount)||pointCount<3||pointCount>80||
     !inRange(startCorner,pointCount)||!inRange(endCorner,pointCount)||
     startCorner===endCorner)throw Error("Choose two DIFFERENT numbered plot corners.");
  const chain=[];
  for(let p=startCorner; p!==endCorner; p=(p+1)%pointCount){
    chain.push(p);
    if(chain.length>=pointCount)throw Error("Boundary range must not cover the entire plot.");
  }
  return chain;
}

export function stageGeoManualSideRange(plot,locks,role,startCorner,endCorner){
  const n=plot?.corners?.length,roles=availableRoles(plot);
  if(!roles.includes(role))throw Error("This plot does not have a "+role+" side.");
  const edges=geoManualCornerChain(startCorner,endCorner,n);
  const staged={...(locks||{}),[role]:edges};
  for(const other of roles){
    if(other===role||!Array.isArray(staged[other]))continue;
    if(edges.some(edge=>staged[other].includes(edge)))
      throw Error("That range overlaps your locked "+other+
        ". Choose another range or clear that side's selection first.");
  }
  return staged;
}

export function geoManualSourceSignature(plot){
  if(!plot)return "";
  // ALL local draft fields matter: avoid overwriting a concurrent CSV/area
  // update, source verification, road choice or precision edit from the preview.
  return JSON.stringify(plot);
}

function checkLocks(plot,locks){
  const roles=availableRoles(plot),n=plot?.corners?.length;
  if(!Array.isArray(plot?.corners)||n<3||n>80||n<roles.length||
     !inspectGeoPlotSideCoverage(plot).ok)
    throw Error("Finish or Repair Sides on this plot before selecting manual ranges.");
  const reserved=new Map();
  const clean={};
  for(const role of Object.keys(locks||{})){
    if(!roles.includes(role))throw Error("Unknown logical side: "+role);
    const edges=locks[role];
    if(!Array.isArray(edges)||!edges.length||!edges.every(edge=>inRange(edge,n))||
       !isConnected(edges,n)||new Set(edges).size!==edges.length)
      throw Error("Choose one connected start → end corner range for "+role+".");
    clean[role]=[...edges];
    for(const edge of edges){
      if(reserved.has(edge))throw Error("Edge "+(edge+1)+" is locked for both "+
        reserved.get(edge)+" and "+role+". Select non-overlapping ranges.");
      reserved.set(edge,role);
    }
  }
  if(!Object.keys(clean).length)throw Error("Select a side and its two corners first.");
  return {roles,n,clean,reserved};
}

// Exact 3/4-side ring partition with hard locks and a minimum-change objective.
// Every candidate is contiguous and covers the polygon exactly once. All
// 3/4 logical side orders are explored; no assumption about camera north.
export function proposeGeoManualSideMapping(plot,locks){
  const {roles,n,clean,reserved}=checkLocks(plot,locks);
  const currentOwners=inspectGeoPlotSideCoverage(plot).owners.map(owners=>owners[0]);
  const defaultStart=plot.sides?.front?.edges?.[0]??0;
  const starts=clean.front?[clean.front[0]]:
    [...new Set([defaultStart,...Array.from({length:n},(_,i)=>i)])];
  const orderings=permutations(roles.filter(role=>role!=="front"))
    .map(t=>["front",...t]);
  let best=null;
  for(const start of starts){
    const ring=Array.from({length:n},(_,i)=>(start+i)%n);
    for(const roleOrder of orderings){
      const dp=Array.from({length:roles.length+1},()=>Array(n+1).fill(Infinity));
      const prev=Array.from({length:roles.length+1},()=>Array(n+1).fill(-1));
      dp[0][0]=0;
      for(let k=1;k<=roles.length;k++){
        const role=roleOrder[k-1],lock=clean[role];
        const costs=[0];
        for(let i=0;i<n;i++)costs.push(costs[i]+
          (currentOwners[ring[i]]===role?0:1));
        const forbidden=[0];
        for(let i=0;i<n;i++)forbidden.push(forbidden[i]+
          (reserved.has(ring[i])&&reserved.get(ring[i])!==role?1:0));
        const endsStart=k,endsLimit=n-(roles.length-k);
        for(let end=endsStart;end<=endsLimit;end++){
          for(let begin=k-1;begin<end;begin++){
            if(!Number.isFinite(dp[k-1][begin])||forbidden[end]!==forbidden[begin])continue;
            if(lock&&(!same(ring.slice(begin,end),lock)))continue;
            const score=dp[k-1][begin]+costs[end]-costs[begin];
            if(score<dp[k][end]){
              dp[k][end]=score;prev[k][end]=begin;
            }
          }
        }
      }
      const score=dp[roles.length][n];
      if(!Number.isFinite(score)||best&&score>=best.score)continue;
      const grouped={};
      let end=n;
      for(let k=roles.length;k>=1;k--){
        const begin=prev[k][end],role=roleOrder[k-1];
        if(begin<0)throw Error("Invalid manual partition traceback.");
        grouped[role]=ring.slice(begin,end);
        end=begin;
      }
      best={score,grouped};
    }
  }
  if(!best)throw Error("Selected ranges cannot make a complete connected plot. "+
    "Adjust one locked side or clear its selection; no mapping has changed.");
  const changedRoles=roles.filter(role=>
    !same(plot.sides[role].edges,best.grouped[role]));
  const sides={...plot.sides};
  for(const role of changedRoles){
    sides[role]={...plot.sides[role],edges:[...best.grouped[role]],
      verified:false,roadFacing:false,facingDirection:undefined};
  }
  const candidate={...plot,sides,...(changedRoles.length?{facingVerified:false}:{})};
  const coverage=inspectGeoPlotSideCoverage(candidate);
  if(!coverage.ok)throw Error("Manual side preview failed coverage validation. Original plot untouched.");
  const changedUnpinned=changedRoles.filter(role=>!clean[role]);
  return {plot:candidate,changedRoles,changedUnpinned,lockedRoles:Object.keys(clean),
    changedEdgeCount:best.score,edgeCount:n,baseSignature:geoManualSourceSignature(plot)};
}

export function applyGeoManualSideProposal(current,proposal){
  if(!proposal||proposal.baseSignature!==geoManualSourceSignature(current))
    throw Error("The plot changed since the side preview. Regenerate Preview before Apply.");
  if(!inspectGeoPlotSideCoverage(proposal.plot).ok)
    throw Error("Side preview is incomplete; original mapping preserved.");
  return proposal.plot;
}
