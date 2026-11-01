// Operator-only Geo customer launch acceptance. Never publishes, edits D1/R2 or
// treats self-reported physical checks as independently authenticated facts.
import {createHash} from "node:crypto";
import {existsSync,lstatSync,readFileSync,realpathSync,statSync} from "node:fs";
import {resolve,relative,isAbsolute} from "node:path";
import {pathToFileURL} from "node:url";
import {reviewGeoSiteSurvey} from "./geo-site-acceptance.mjs";
import {verifyGeoSocialPreview} from "./geo-social-preview-check.mjs";
import {rehearseFullGeoRestore} from "./geo-cloud-restore-rehearsal.mjs";

const sha256=value=>createHash("sha256").update(value).digest("hex");
const required=(condition,message)=>{if(!condition)throw Error("Geo launch acceptance: "+message);};
const text=(value,max=200)=>typeof value==="string"&&value.trim().length>0&&
  value.trim().length<=max&&!/[\x00-\x1f\x7f]/.test(value);
const shaPattern=/^[a-f0-9]{64}$/i;
const recentDate=(value)=>{
  const time=typeof value==="string"?Date.parse(value):NaN;
  return Number.isFinite(time)&&time>Date.UTC(2020,0,1)&&time<=Date.now()+300000;
};
function verifyEvidenceFile(base,ref){
  required(ref&&text(ref.path,500)&&shaPattern.test(ref.sha256||""),
    "each physical acceptance observation needs a file path and SHA-256.");
  const root=realpathSync(resolve(base));
  const candidate=resolve(root,ref.path);
  const rel=relative(root,candidate);
  required(!isAbsolute(ref.path)&&rel!==""&&!rel.startsWith("..")&&!isAbsolute(rel),
    "evidence file must be inside the provided evidence folder.");
  required(existsSync(candidate)&&lstatSync(candidate).isFile(),
    "evidence file does not exist or is not a regular file.");
  const real=realpathSync(candidate),inside=relative(root,real);
  required(inside!==""&&!inside.startsWith("..")&&!isAbsolute(inside),
    "evidence file must not escape through a symlink.");
  const bytes=statSync(real).size;
  required(bytes>0&&bytes<=12*1024*1024,
    "evidence file must be 1 byte to 12 MiB.");
  required(sha256(readFileSync(real))===ref.sha256.toLowerCase(),
    "evidence SHA-256 does not match its local bytes.");
  return {path:ref.path,sha256:ref.sha256.toLowerCase(),bytes};
}
function deviceAcceptance(entry,platform,root,slug,releaseId){
  required(entry&&entry.platform===platform,
    "separate Android Chrome and iOS Safari observations required.");
  required(entry.browser===(platform==="android"?"Chrome":"Safari"),
    "required physical browser/platform combination missing.");
  required(entry.emulated!==true&&entry.realDevice===true,
    "browser-emulated observations cannot count as real device acceptance.");
  required(entry.projectSlug===slug&&entry.mappingReleaseId===releaseId,
    "mobile evidence project or mapping release mismatch.");
  for(const key of ["deviceModel","osVersion","browserVersion","tester"]){
    required(text(entry[key],160),"physical device observation missing "+key+".");
  }
  required(recentDate(entry.checkedAt),"physical device observation missing a valid timestamp.");
  for(const key of ["geoPlacement","panZoom","plotClick","mobileLayout","performance"]){
    required(entry.checks?.[key]===true,"mobile "+platform+" check failed or unrecorded: "+key+".");
  }
  const site=verifyEvidenceFile(root,entry.siteScreenshot);
  const card=verifyEvidenceFile(root,entry.whatsappScreenshot);
  return {platform,browser:entry.browser,deviceModel:entry.deviceModel,
    checkedAt:entry.checkedAt,siteEvidenceSha256:site.sha256,
    whatsAppEvidenceSha256:card.sha256,claimedRealDevice:true,
    independentlyAuthenticated:false};
}
export function assessGeoCustomerLaunchEvidence(manifest,{surveyReport,socialReport,restoreReport,evidenceRoot}){
  required(manifest?.schema==="rekixo-geo-customer-launch-evidence-v1",
    "versioned acceptance manifest required.");
  const slug=manifest.projectSlug,releaseId=manifest.mappingReleaseId;
  required(typeof slug==="string"&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug),
    "canonical project slug required.");
  required(text(releaseId,150),"immutable Geo mapping release ID required.");
  required(surveyReport?.schema==="rekixo-geo-site-field-acceptance-report-v1"&&
    surveyReport.projectSlug===slug&&surveyReport.passed===true&&
    surveyReport.failed===0&&surveyReport.inspected>=10&&
    surveyReport.independentlyVerifiedAlignment===true&&
    surveyReport.results?.length===surveyReport.inspected&&
    surveyReport.results.every(x=>x.passed===true&&text(x.sourceRef,250)),
    "ten independently referenced numerical survey samples must pass.");
  const shareUrl=manifest.shareUrl;
  required(text(shareUrl,1500),"canonical published Geo share URL required.");
  const parsed=new URL(shareUrl);
  required(parsed.protocol==="https:"&&parsed.pathname===
    "/3Dprojects/"+slug+"/geo"&&parsed.searchParams.has("share"),
    "expected version-bound HTTPS share URL for this Geo project.");
  required(socialReport?.schema==="rekixo-social-crawler-probe-v1"&&
    socialReport.ok===true&&socialReport.publicUrl===parsed.toString()&&
    socialReport.version===parsed.searchParams.get("share")&&
    socialReport.imageBytes>=64,
    "public Open Graph image bytes/version crawler probe must pass.");
  required(restoreReport?.schema==="rekixo-full-geo-isolated-restore-test-v1"&&
    restoreReport.projectSlug===slug&&restoreReport.d1Restored===true&&
    restoreReport.productionChanged===false&&
    Number.isInteger(restoreReport.r2BytesVerified)&&restoreReport.r2BytesVerified>=0,
    "complete offline D1/R2 byte restore rehearsal must pass.");
  const deviceEntries=manifest.devices;
  required(Array.isArray(deviceEntries)&&deviceEntries.length===2,
    "record exactly two physical Android/iOS observations.");
  const platforms=new Set(deviceEntries.map(x=>x?.platform));
  required(platforms.size===2&&platforms.has("android")&&platforms.has("ios"),
    "both Android and iOS must be independently inspected.");
  const devices=["android","ios"].map(platform=>deviceAcceptance(
    deviceEntries.find(x=>x.platform===platform),platform,evidenceRoot,slug,releaseId));
  const cloud=manifest.isolatedCloudRestore;
  required(cloud?.success===true&&cloud.projectSlug===slug&&
    cloud.mappingReleaseId===releaseId&&recentDate(cloud.verifiedAt)&&
    text(cloud.operator,200)&&text(cloud.database,150)&&
    text(cloud.bucket,150)&&
    cloud.database!=="rekixo-3d-production"&&cloud.bucket!=="rekixo-3d-assets"&&
    cloud.productionChanged===false,
    "separately authorized isolated cloud restore and proof required; offline SQLite alone does not qualify.");
  const isolatedEvidence=verifyEvidenceFile(evidenceRoot,cloud.evidence);
  return {schema:"rekixo-geo-customer-launch-evidence-review-v1",
    projectSlug:slug,mappingReleaseId:releaseId,
    review:"EVIDENCE_COMPLETE_PENDING_INDEPENDENT_OWNER_SIGNOFF",
    surveyedPlots:surveyReport.inspected,devices,
    publicShareImageBytes:socialReport.imageBytes,
    offlineR2ObjectsVerified:restoreReport.r2BytesVerified,
    isolatedCloudRestoreEvidenceSha256:isolatedEvidence.sha256,
    fieldCertified:false,productionChanged:false,
    warning:"Physical evidence and cloud restore are operator-supplied; SHA checks prove local byte integrity, not physical authenticity. An authorized owner must independently inspect and sign off."};
}
export async function verifyGeoCustomerLaunchFromFiles(manifestPath,backupFolder,sqliteTarget,evidenceRoot,
  fetcher=fetch){
  const manifest=JSON.parse(readFileSync(resolve(manifestPath),"utf8"));
  required(manifest&&text(manifest.surveyFile,500),
    "a real-sample survey JSON file is required.");
  const surveyFile=resolve(evidenceRoot,manifest.surveyFile);
  const rel=relative(resolve(evidenceRoot),surveyFile);
  required(!isAbsolute(manifest.surveyFile)&&rel!==""&&!rel.startsWith("..")&&!isAbsolute(rel),
    "survey input must reside in the evidence folder.");
  const survey=JSON.parse(readFileSync(surveyFile,"utf8"));
  const surveyReport=reviewGeoSiteSurvey(survey);
  const socialReport=await verifyGeoSocialPreview(manifest.shareUrl,fetcher);
  const restoreReport=await rehearseFullGeoRestore(backupFolder,sqliteTarget);
  return assessGeoCustomerLaunchEvidence(manifest,{surveyReport,socialReport,restoreReport,evidenceRoot});
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const [,,manifest,backup,sqlite,evidence]=process.argv;
  if(!manifest||!backup||!sqlite||!evidence){
    console.error("Usage: node scripts/geo-customer-launch-gate.mjs launch-evidence.json complete-backup-folder /new/offline-restore.sqlite evidence-folder");
    process.exitCode=2;
  }else{
    try{console.log(JSON.stringify(await verifyGeoCustomerLaunchFromFiles(
      manifest,backup,sqlite,evidence),null,2));}
    catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}
  }
}
