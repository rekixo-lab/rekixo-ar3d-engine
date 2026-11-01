// Private legacy Geo image -> Building-local X/Z alignment. Nothing here mutates
// published releases, approved plot corners, the Building model or commercial data.
const finite=n=>typeof n==="number"&&Number.isFinite(n);
const sha=s=>typeof s==="string"&&/^[a-f0-9]{64}$/i.test(s);
const id=s=>typeof s==="string"&&/^[A-Za-z0-9_.-]{1,100}$/.test(s);
const trim=s=>String(s||"").trim().slice(0,160);
const MAX_POINTS=48;
function normalizePoints(items,label){
  if(!Array.isArray(items)||items.length>MAX_POINTS)throw Error(label+" must contain up to 48 points.");
  const ids=new Set();
  return items.map((raw,i)=>{
    if(!raw||typeof raw!=="object"||Array.isArray(raw))throw Error(label+" point "+(i+1)+" is invalid.");
    const key=trim(raw.id);
    if(!id(key)||ids.has(key.toLowerCase()))throw Error(label+" points need unique, valid IDs.");
    ids.add(key.toLowerCase());
    if(![raw.u,raw.v,raw.x,raw.z].every(finite)||raw.u<0||raw.u>1||raw.v<0||raw.v>1||
       Math.abs(raw.x)>100000||Math.abs(raw.z)>100000)
      throw Error(label+" "+key+": finite image U/V (0..1) and model X/Z required.");
    const evidence=trim(raw.evidence);
    if(!evidence)throw Error(label+" "+key+": source evidence/reference required.");
    return {id:key,u:raw.u,v:raw.v,x:raw.x,z:raw.z,evidence};
  });
}
export function normalizeImageModelAlignment(value){
  if(!value||typeof value!=="object"||Array.isArray(value))
    throw Error("Alignment draft is missing.");
  if(!id(value.imageAssetId)||!id(value.geoReleaseId)||!id(value.buildingReleaseId)||
     !sha(value.imageSha256)||!sha(value.modelSha256))
    throw Error("Pin the owned original image SHA-256 and the current immutable 3D release.");
  if(!Number.isInteger(value.imageWidth)||!Number.isInteger(value.imageHeight)||
     value.imageWidth<1||value.imageHeight<1||value.imageWidth>40000||
     value.imageHeight>40000||value.imageWidth*value.imageHeight>80_000_000)
    throw Error("The checksum-verified original image width/height are required (max 80 megapixels).");
  const anchors=normalizePoints(value.anchors,"Fit anchors");
  const checkpoints=normalizePoints(value.checkpoints,"Independent checkpoints");
  const keys=new Set(anchors.map(p=>p.id.toLowerCase()));
  const imageLocations=[...anchors,...checkpoints];
  for(const p of checkpoints){
    if(keys.has(p.id.toLowerCase()))throw Error("Checkpoint IDs must differ from fit anchors.");
    keys.add(p.id.toLowerCase());
  }
  for(let i=0;i<imageLocations.length;i++)for(let j=i+1;j<imageLocations.length;j++){
    if(Math.hypot(imageLocations[i].u-imageLocations[j].u,imageLocations[i].v-imageLocations[j].v)<0.0001)
      throw Error("Separate survey points must not reference the same image location.");
  }
  return {imageAssetId:value.imageAssetId,imageSha256:value.imageSha256.toLowerCase(),
    imageWidth:value.imageWidth,imageHeight:value.imageHeight,
    geoReleaseId:value.geoReleaseId,buildingReleaseId:value.buildingReleaseId,
    modelSha256:value.modelSha256.toLowerCase(),anchors,checkpoints};
}
function hasDistributedAnchors(points){
  for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++)for(let k=j+1;k<points.length;k++){
    const a=points[i],b=points[j],c=points[k];
    if(Math.abs((b.u-a.u)*(c.v-a.v)-(b.v-a.v)*(c.u-a.u))>=0.005)return true;
  }
  return false;
}
export function imagePointToModel(t,p){
  const u=p[0]*t.imageAspect;
  return [t.a*u-t.b*p[1]+t.tx,t.b*u+t.a*p[1]+t.tz];
}
export function modelPointToImage(t,p){
  const det=t.a*t.a+t.b*t.b;
  if(!Number.isFinite(det)||det<=1e-12)throw Error("Invalid image/model transform.");
  const x=p[0]-t.tx,z=p[1]-t.tz;
  return [(t.a*x+t.b*z)/det/t.imageAspect,(-t.b*x+t.a*z)/det];
}
export function evaluateImageModelAlignment(value,{requireCheckpoints=false}={}){
  const draft=normalizeImageModelAlignment(value);
  const anchors=draft.anchors,checks=draft.checkpoints;
  const imageAspect=draft.imageWidth/draft.imageHeight;
  if(anchors.length<3||!hasDistributedAnchors(anchors))
    throw Error("At least three non-collinear site-spanning image/model fit anchors are required.");
  const mean=items=>items.reduce((s,p)=>s+p,0)/items.length;
  const u=mean(anchors.map(p=>p.u*imageAspect)),v=mean(anchors.map(p=>p.v));
  const x=mean(anchors.map(p=>p.x)),z=mean(anchors.map(p=>p.z));
  let denom=0,dot=0,cross=0;
  for(const p of anchors){
    const du=p.u*imageAspect-u,dv=p.v-v,dx=p.x-x,dz=p.z-z;
    denom+=du*du+dv*dv;dot+=du*dx+dv*dz;cross+=du*dz-dv*dx;
  }
  if(denom<=1e-8)throw Error("Calibration points are too close together.");
  const a=dot/denom,b=cross/denom,scale=Math.hypot(a,b);
  if(!finite(scale)||scale<0.001||scale>1e7)
    throw Error("Alignment scale is degenerate.");
  const transform={a,b,tx:x-a*u+b*v,tz:z-b*u-a*v,imageAspect};
  const errors=items=>items.map(p=>{
    const [px,pz]=imagePointToModel(transform,[p.u,p.v]);
    return {id:p.id,errorMetres:Math.hypot(px-p.x,pz-p.z)};
  });
  const fit=errors(anchors),independent=errors(checks);
  const span=Math.max(Math.hypot(
    Math.max(...anchors.map(p=>p.x))-Math.min(...anchors.map(p=>p.x)),
    Math.max(...anchors.map(p=>p.z))-Math.min(...anchors.map(p=>p.z))),1);
  // Conservative review: 0.2% of site-spanning distance, at least 0.15m,
  // never looser than 0.5m. It is still NOT a survey certification.
  const limit=Math.min(0.5,Math.max(0.15,span*0.002));
  const max=list=>list.length?Math.max(...list.map(p=>p.errorMetres)):null;
  const rms=list=>list.length?Math.sqrt(list.reduce((s,p)=>s+p.errorMetres**2,0)/list.length):null;
  const maxFit=max(fit),maxIndependent=max(independent);
  const independentSpread=checks.length>=2&&Math.max(...checks.map(p=>p.u))-
    Math.min(...checks.map(p=>p.u)) + Math.max(...checks.map(p=>p.v))-
    Math.min(...checks.map(p=>p.v))>=0.20;
  const issues=[];
  if(maxFit!==null&&maxFit>limit)issues.push("Fit anchor residual exceeds the conservative submeter review threshold.");
  if(checks.length<2)issues.push("At least two independent withheld checkpoints are required.");
  else if(!independentSpread)issues.push("Independent checkpoints must span different parts of the source image.");
  if(maxIndependent!==null&&maxIndependent>limit)
    issues.push("Independent checkpoint error exceeds the review threshold.");
  if(requireCheckpoints&&issues.length)
    throw Error("Alignment is not independently verified: "+issues.join(" "));
  return {transform,fit,independent,fitRmsMetres:rms(fit),checkpointRmsMetres:rms(independent),
    maxFitMetres:maxFit,maxCheckpointMetres:maxIndependent,limitMetres:limit,
    modelSpanMetres:span,verifiedReady:issues.length===0,issues};
}
