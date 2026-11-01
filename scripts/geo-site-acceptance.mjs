// Field QA input: source-backed, independently surveyed observations.
// Never declares a site accepted without ten real, distinct source-referenced plots.
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {evaluateImageModelAlignment,imagePointToModel} from "../shared/geo-plot-image-alignment.js";
import {polygonAreaSqm} from "../workers/geo-plot-geometry.mjs";
const scaleSqm={sqm:1,sqft:0.09290304,sqyd:0.83612736};
const finite=x=>typeof x==="number"&&Number.isFinite(x);
export function reviewGeoSiteSurvey(input){
 if(!input||input.schema!=="rekixo-geo-site-field-review-v1"||
    typeof input.projectSlug!=="string"||!input.projectSlug.trim())
   throw Error("Named real project and Geo site field review schema are required.");
 if(!Array.isArray(input.plots)||!Array.isArray(input.samples))
   throw Error("Provide mapped plots and independent real-survey samples.");
 const alignment=evaluateImageModelAlignment(input.alignment,{requireCheckpoints:true});
 if(!alignment.verifiedReady)throw Error("Independent alignment QA did not pass.");
 const scale=input.geoScale;
 if(!finite(scale)||scale<=0)throw Error("A verified positive Geo scale is required.");
 const index=new Map(input.plots.map(p=>[String(p.id).toLowerCase(),p]));
 if(index.size!==input.plots.length)throw Error("Duplicate canonical Plot IDs in site acceptance.");
 const results=[],seen=new Set();
 for(const item of input.samples){
  const id=String(item.plotId||"").toLowerCase();
  if(!id||seen.has(id))throw Error("Field samples must reference distinct mapped Plot IDs.");
  seen.add(id);
  const plot=index.get(id);
  if(!plot)throw Error("Field sample references an unmapped Plot ID: "+id);
  if(!Number.isInteger(item.cornerIndex)||item.cornerIndex<0||item.cornerIndex>=plot.corners.length)
   throw Error("Field sample has invalid model footprint corner for Plot "+id);
  if(![item.u,item.v].every(x=>finite(x)&&x>=0&&x<=1))
   throw Error("Field image landmark U/V must be within the signed source.");
  if(typeof item.signedSourceRef!=="string"||item.signedSourceRef.trim().length<4)
   throw Error("Each Plot ID requires a traceable, signed survey/source reference.");
  if(!finite(item.approvedArea)||item.approvedArea<=0||!scaleSqm[item.areaUnit])
   throw Error("Approved area and source unit required for each Plot ID.");
  const [mx,mz]=imagePointToModel(alignment.transform,[item.u,item.v]);
  const target=plot.corners[item.cornerIndex];
  const error=Math.hypot(mx-target[0],mz-target[1]);
  const expected=item.approvedArea*scaleSqm[item.areaUnit];
  const actual=polygonAreaSqm(plot.corners)*scale*scale;
  const areaErrorFraction=Math.abs(actual-expected)/expected;
  results.push({plotId:plot.id,sourceRef:item.signedSourceRef,
   modelCornerErrorMetres:Number(error.toFixed(5)),
   geoAreaErrorPct:Number((areaErrorFraction*100).toFixed(3)),
   passed:error<=alignment.limitMetres&&areaErrorFraction<=0.05});
 }
 if(seen.size<10)throw Error("At least TEN independently surveyed distinct plots are required.");
 return {schema:"rekixo-geo-site-field-acceptance-report-v1",projectSlug:input.projectSlug,
   independentlyVerifiedAlignment:true,checkpointMaxMetres:alignment.maxCheckpointMetres,
   modelToleranceMetres:alignment.limitMetres,areaTolerancePct:5,
   inspected:seen.size,failed:results.filter(x=>!x.passed).length,
   passed:results.every(x=>x.passed),results,
   warning:"Checks image/model points and geo-scaled source area only. Independent GPS, mobile browser, legal boundary and physical site sign-off are separate."};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const file=process.argv[2];
 if(!file)throw Error("Usage: node scripts/geo-site-acceptance.mjs survey-evidence.json");
 const report=reviewGeoSiteSurvey(JSON.parse(readFileSync(file,"utf8")));
 process.stdout.write(JSON.stringify(report,null,2)+"\n");
 if(!report.passed)process.exitCode=1;
}
