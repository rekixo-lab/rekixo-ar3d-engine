import test from "node:test";
import assert from "node:assert/strict";
import {auditMasterplanSurvey} from "../scripts/check-masterplan-survey.mjs";

const lat0=22.70,lng0=75.87;
const surveyed=(u,v,latOffset=0)=>({
  u,v,lat:lat0+(v*125)/111000+latOffset,
  lng:lng0+(u*90)/103000,source:"Independent signed survey test fixture",
  verified:true
});
const document=()=>({
  controlPoints:[surveyed(0,0),surveyed(1,0),surveyed(0,1),surveyed(1,1)],
  checkpoints:[surveyed(0.1,0.1),surveyed(0.87,0.22),surveyed(0.15,0.88),surveyed(0.8,0.8)]
});
test("independent site-wide checkpoints validate held-out affine residuals",()=>{
  const result=auditMasterplanSurvey(document());
  assert.equal(result.status,"numerical_check_passed");
  assert.equal(result.fieldCertified,false);
  assert.equal(result.independentCheckpoints,4);
  assert.ok(result.maxCheckpointErrorM<0.01);
  assert.ok(result.estimatedImageSizeM.width>80);
  assert.ok(result.estimatedImageSizeM.height>110);
});
test("materially misplaced surveyed holdout fails even if calibration points fit",()=>{
  const input=document();
  input.checkpoints[2].lat+=0.0001; // about 11m displacement
  assert.throws(()=>auditMasterplanSurvey(input),/exceeds 2m limit/);
});
test("unverified, repeated or clustered holdouts cannot be treated as acceptance",()=>{
  const unverified=document();
  unverified.checkpoints[0].verified=false;
  assert.throws(()=>auditMasterplanSurvey(unverified),/requires reviewed survey source/);
  const repeated=document();
  repeated.checkpoints[0]=surveyed(0,0);
  assert.throws(()=>auditMasterplanSurvey(repeated),/cannot reuse/);
  const clustered=document();
  clustered.checkpoints=[surveyed(0.1,0.1),surveyed(0.2,0.1),surveyed(0.2,0.2)];
  assert.throws(()=>auditMasterplanSurvey(clustered),/span at least 40%/);
  assert.throws(()=>auditMasterplanSurvey({
    controlPoints:document().controlPoints,checkpoints:[]}),/At least three/);
});
