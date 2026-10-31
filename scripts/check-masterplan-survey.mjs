// Independent, offline, read-only acceptance for surveyed Geo Masterplans.
// Does not mutate D1/R2, publish, or certify the authenticity of survey evidence.
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {deriveAffineGeoCalibration,geoPoint,validateControlPoints}
  from "../workers/masterplan-geo-geometry.mjs";

const tolerance=2;
const finite=n=>typeof n==="number"&&Number.isFinite(n);
export function auditMasterplanSurvey(spec){
  if(!spec||typeof spec!=="object"||Array.isArray(spec))
    throw Error("Expected one survey QA object.");
  const controlPoints=validateControlPoints(spec.controlPoints,{publish:true});
  if(!Array.isArray(spec.checkpoints)||spec.checkpoints.length<3)
    throw Error("At least three independent verified field checkpoints are required.");
  const checkpoints=validateControlPoints(spec.checkpoints,{publish:true});
  // Checkpoints must cover the site, rather than all falling near one mapped corner.
  const us=checkpoints.map(p=>p.u),vs=checkpoints.map(p=>p.v);
  if(Math.max(...us)-Math.min(...us)<0.4 || Math.max(...vs)-Math.min(...vs)<0.4)
    throw Error("Independent checkpoints must span at least 40% of image U and V.");
  for(const check of checkpoints){
    if(controlPoints.some(p=>Math.hypot(check.u-p.u,check.v-p.v)<0.00001))
      throw Error("A field checkpoint cannot reuse a calibration control point.");
  }
  const calibration=deriveAffineGeoCalibration(controlPoints);
  const meanLat=checkpoints.reduce((sum,p)=>sum+p.lat,0)/checkpoints.length;
  const rad=meanLat*Math.PI/180;
  const metresLat=111132.92-559.82*Math.cos(2*rad)+1.175*Math.cos(4*rad);
  const metresLng=111412.84*Math.cos(rad)-93.5*Math.cos(3*rad)+0.118*Math.cos(5*rad);
  const errors=checkpoints.map(p=>{
    const mapped=geoPoint(calibration.transform,[p.u,p.v]);
    return Math.hypot((mapped.lat-p.lat)*metresLat,(mapped.lng-p.lng)*metresLng);
  });
  if(errors.some(v=>!finite(v)))throw Error("Survey residual contains a non-finite value.");
  const maxError=Math.max(...errors);
  if(maxError>tolerance)
    throw Error("Independent surveyed checkpoint error "+maxError.toFixed(2)+"m exceeds 2m limit.");
  return {status:"numerical_check_passed",fieldCertified:false,
    sourceCount:controlPoints.length,independentCheckpoints:checkpoints.length,
    maxControlResidualM:calibration.maxResidualM,
    maxCheckpointErrorM:Number(maxError.toFixed(4)),
    rootMeanSquareCheckpointErrorM:Number(Math.sqrt(
      errors.reduce((sum,v)=>sum+v*v,0)/errors.length).toFixed(4)),
    estimatedImageSizeM:calibration.sizeM,
    disclaimer:"Independent numerical QA only; confirm survey authenticity and physical alignment on site."};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  try{
    const file=process.argv[2];
    if(!file)throw Error("Usage: node scripts/check-masterplan-survey.mjs survey-checkpoints.json");
    const parsed=JSON.parse(readFileSync(resolve(file),"utf8"));
    process.stdout.write(JSON.stringify(auditMasterplanSurvey(parsed),null,2)+"\n");
  }catch(e){
    process.stderr.write("Masterplan survey check failed: "+(e instanceof Error?e.message:"Unknown error")+"\n");
    process.exitCode=1;
  }
}
