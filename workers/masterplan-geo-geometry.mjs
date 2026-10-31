import { validateGeoPlot, assertDisjointPlotInteriors } from "./geo-plot-geometry.mjs";

const finite=n=>typeof n==="number"&&Number.isFinite(n);
const supportedUnit=u=>["m","ft"].includes(u);
const cleanText=(v,max=160)=>typeof v==="string"?v.trim().slice(0,max):"";
export function validateImagePlot(input,{publish=false}={}){
  if(!input||!Array.isArray(input.corners)||input.corners.length<3||input.corners.length>80||
    input.corners.some(p=>!Array.isArray(p)||p.length!==2||p.some(n=>!finite(n)||n<0||n>1)))
    throw Error("Masterplan plot needs 3–80 normalized image [U,V] corners between 0 and 1.");
  const polygon=validateGeoPlot({...input,corners:input.corners.map(p=>[p[0]*10000,p[1]*10000])});
  const plot={...polygon,corners:input.corners.map(p=>[p[0],p[1]])};
  if(publish&&(!plot.area.verified||!plot.area.source||
    !plot.facingVerified||!plot.facingSource||
    Object.values(plot.sides).some(s=>!s.verified||!s.source||!supportedUnit(s.unit))))
    throw Error("Plot "+plot.id+": approved area, facing and each side need source-backed verification.");
  return plot;
}
export function validateImagePlots(items,{publish=false}={}){
  if(!Array.isArray(items)||items.length>2500||(publish&&!items.length))
    throw Error("Project must contain 1–2500 mapped plots before publishing.");
  const ids=new Set();
  const plots=items.map(p=>{
    const normalized=validateImagePlot(p,{publish});
    if(ids.has(normalized.id.toLowerCase()))throw Error("Duplicate plot number "+normalized.id);
    ids.add(normalized.id.toLowerCase());
    return normalized;
  });
  assertDisjointPlotInteriors(plots.map(p=>({id:p.id,corners:p.corners.map(pt=>[pt[0]*10000,pt[1]*10000])})));
  return plots;
}
export function validateControlPoints(value,{publish=false}={}){
  if(!Array.isArray(value)||value.length>24|| (publish&&value.length<3))
    throw Error("Masterplan Geo requires at least three and at most 24 control points.");
  return value.map((p,i)=>{
    if(!p||!finite(p.u)||!finite(p.v)||p.u<0||p.u>1||p.v<0||p.v>1||
      !finite(p.lat)||!finite(p.lng)||p.lat<=-90||p.lat>=90||p.lng<=-180||p.lng>=180)
      throw Error("Control point "+(i+1)+" needs valid U,V,latitude,longitude.");
    const source=cleanText(p.source,160);
    const verified=p.verified===true;
    if(publish&&(!source||!verified))
      throw Error("Control point "+(i+1)+" requires reviewed survey source.");
    return {u:p.u,v:p.v,lat:p.lat,lng:p.lng,source,verified};
  });
}
function solve3(matrix,vector){
  const rows=matrix.map((line,i)=>[...line,vector[i]]);
  for(let i=0;i<3;i++){
    let p=i;for(let j=i+1;j<3;j++)if(Math.abs(rows[j][i])>Math.abs(rows[p][i]))p=j;
    if(Math.abs(rows[p][i])<1e-9)throw Error("Geo calibration control points are collinear or too close.");
    [rows[p],rows[i]]=[rows[i],rows[p]];
    const pivot=rows[i][i];
    for(let j=i;j<4;j++)rows[i][j]/=pivot;
    for(let k=0;k<3;k++)if(k!==i){
      const t=rows[k][i];for(let j=i;j<4;j++)rows[k][j]-=t*rows[i][j];
    }
  }
  return rows.map(row=>row[3]);
}
export function deriveAffineGeoCalibration(controls){
  const points=validateControlPoints(controls,{publish:true});
  const meanLat=points.reduce((s,p)=>s+p.lat,0)/points.length;
  const meanLng=points.reduce((s,p)=>s+p.lng,0)/points.length;
  const rad=meanLat*Math.PI/180;
  const metresLat=111132.92-559.82*Math.cos(2*rad)+1.175*Math.cos(4*rad);
  const metresLng=111412.84*Math.cos(rad)-93.5*Math.cos(3*rad)+.118*Math.cos(5*rad);
  if(metresLng<10000)throw Error("Geo map latitude is unsuitable for local project calibration.");
  const gram=Array.from({length:3},()=>[0,0,0]),east=[0,0,0],north=[0,0,0];
  for(const p of points){
    const v=[1,p.u,p.v],e=(p.lng-meanLng)*metresLng,n=(p.lat-meanLat)*metresLat;
    for(let i=0;i<3;i++){
      east[i]+=v[i]*e;north[i]+=v[i]*n;
      for(let j=0;j<3;j++)gram[i][j]+=v[i]*v[j];
    }
  }
  const eCoef=solve3(gram,east),nCoef=solve3(gram,north);
  const transform={
    lat:[meanLat+nCoef[0]/metresLat,nCoef[1]/metresLat,nCoef[2]/metresLat],
    lng:[meanLng+eCoef[0]/metresLng,eCoef[1]/metresLng,eCoef[2]/metresLng],
  };
  const residuals=points.map(p=>{
    const actual=geoPoint(transform,[p.u,p.v]);
    return Math.hypot((actual.lat-p.lat)*metresLat,(actual.lng-p.lng)*metresLng);
  });
  const maxResidualM=Math.max(...residuals);
  const metersPerImageU=Math.hypot(eCoef[1],nCoef[1]);
  const metersPerImageV=Math.hypot(eCoef[2],nCoef[2]);
  const determinant=eCoef[1]*nCoef[2]-eCoef[2]*nCoef[1];
  if(metersPerImageU<1||metersPerImageV<1||
     metersPerImageU>50000||metersPerImageV>50000||
     Math.abs(determin)<1)
    throw Error("Implausible or degenerate Geo layout dimensions/calibration.");
  if(maxResidualM>2)throw Error("Geo control point residual "+maxResidualM.toFixed(2)+"m exceeds 2m review limit.");
  return {transform,maxResidualM:Number(maxResidualM.toFixed(5)),
    sizeM:{width:Number(metersPerImageU.toFixed(3)),height:Number(metersPerImageV.toFixed(3))}};
}
export function geoPoint(transform,[u,v]){
  return {lat:transform.lat[0]+transform.lat[1]*u+transform.lat[2]*v,
    lng:transform.lng[0]+transform.lng[1]*u+transform.lng[2]*v};
}
export function validateMasterplanDraft(data,{publish=false}={}){
  if(!data||typeof data!=="object")throw Error("Invalid Masterplan draft.");
  const imageAssetId=String(data.imageAssetId||"");
  const width=data.width,height=data.height;
  if(!/^[a-zA-Z0-9_-]{1,128}$/.test(imageAssetId)||
    !Number.isInteger(width)||width<1||width>50000||
    !Number.isInteger(height)||height<1||height>50000)
    throw Error("Valid owned masterplan image and pixel dimensions are required.");
  const controlPoints=validateControlPoints(data.controlPoints||[],{publish});
  const plots=validateImagePlots(data.plots||[],{publish});
  const calibration=publish?deriveAffineGeoCalibration(controlPoints):null;
  return {imageAssetId,width,height,controlPoints,plots,calibration};
}
