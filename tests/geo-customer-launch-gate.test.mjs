import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {assessGeoCustomerLaunchEvidence} from "../scripts/geo-customer-launch-gate.mjs";

const digest=value=>createHash("sha256").update(value).digest("hex");
const slug="field-survey-demo",release="map-release-007";
function fixture(){
  const root=mkdtempSync(join(tmpdir(),"geo-launch-evidence-"));
  const file=name=>{
    const content=Buffer.from("Private test screenshot: "+name);
    writeFileSync(join(root,name),content);
    return {path:name,sha256:digest(content)};
  };
  const now=new Date().toISOString();
  const devices=["android","ios"].map(platform=>({
    platform,browser:platform==="android"?"Chrome":"Safari",
    projectSlug:slug,mappingReleaseId:release,realDevice:true,emulated:false,
    deviceModel:platform==="android"?"Pixel test device":"iPhone test device",
    osVersion:"26.0",browserVersion:"26.0",tester:"QA operator",checkedAt:now,
    checks:{geoPlacement:true,panZoom:true,plotClick:true,mobileLayout:true,performance:true},
    siteScreenshot:file(platform+"-site.png"),
    whatsappScreenshot:file(platform+"-whatsapp.png")
  }));
  const shareUrl="https://example.com/3Dprojects/"+slug+"/geo?share=3";
  const manifest={schema:"rekixo-geo-customer-launch-evidence-v1",
    projectSlug:slug,mappingReleaseId:release,shareUrl,devices,
    isolatedCloudRestore:{success:true,projectSlug:slug,mappingReleaseId:release,
      verifiedAt:now,operator:"Cloud operator",database:"isolated-ar3d-qa",
      bucket:"isolated-ar3d-qa-r2",productionChanged:false,
      evidence:file("isolated-recovery-report.txt")}};
  const surveyReport={schema:"rekixo-geo-site-field-acceptance-report-v1",
    projectSlug:slug,independentlyVerifiedAlignment:true,inspected:10,failed:0,passed:true,
    results:Array.from({length:10},(_,i)=>({plotId:String(i+1),passed:true,sourceRef:"Signed survey "+(i+1)}))};
  const socialReport={schema:"rekixo-social-crawler-probe-v1",ok:true,
    publicUrl:shareUrl,version:"3",imageBytes:123456};
  const restoreReport={schema:"rekixo-full-geo-isolated-restore-test-v1",
    projectSlug:slug,activeMappingReleaseId:release,d1Restored:true,r2BytesVerified:11,productionChanged:false};
  return {manifest,root,surveyReport,socialReport,restoreReport};
}
function evaluate(f){
  return assessGeoCustomerLaunchEvidence(f.manifest,{surveyReport:f.surveyReport,
    socialReport:f.socialReport,restoreReport:f.restoreReport,evidenceRoot:f.root});
}
function withFixture(run){
  const f=fixture();
  try{return run(f);}
  finally{rmSync(f.root,{recursive:true,force:true});}
}
test("launch review binds ten source-referenced plots, physical devices, social bytes and isolated recovery",()=>{
  withFixture(f=>{
    const report=evaluate(f);
    assert.equal(report.review,"EVIDENCE_COMPLETE_PENDING_INDEPENDENT_OWNER_SIGNOFF");
    assert.equal(report.surveyedPlots,10);
    assert.deepEqual(report.devices.map(x=>x.platform),["android","ios"]);
    assert.equal(report.fieldCertified,false,"local files never certify real-world authenticity");
    assert.equal(report.productionChanged,false);
  });
});
test("synthetic or emulated browsers cannot masquerade as physical field acceptance",()=>{
  withFixture(f=>{
    f.manifest.devices[0].emulated=true;
    assert.throws(()=>evaluate(f),/browser-emulated/);
  });
});
test("a missing iPhone check fails closed rather than passing the Android screenshots twice",()=>{
  withFixture(f=>{
    f.manifest.devices[1].platform="android";
    assert.throws(()=>evaluate(f),/both Android and iOS/);
  });
});
test("wrong release or project cannot reuse physical browser evidence",()=>{
  withFixture(f=>{
    f.manifest.devices[1].mappingReleaseId="old-release";
    assert.throws(()=>evaluate(f),/project or mapping release mismatch/);
  });
});
test("stale survey coverage and real-source failures cannot pass launch gate",()=>{
  withFixture(f=>{
    f.surveyReport.inspected=9;
    assert.throws(()=>evaluate(f),/ten independently referenced/);
  });
  withFixture(f=>{
    f.surveyReport.results[4].passed=false;
    assert.throws(()=>evaluate(f),/ten independently referenced/);
  });
});
test("tampered screenshots, fake cloud recovery or production target are refused",()=>{
  withFixture(f=>{
    f.manifest.devices[0].siteScreenshot.sha256="a".repeat(64);
    assert.throws(()=>evaluate(f),/SHA-256 does not match/);
  });
  withFixture(f=>{
    f.manifest.isolatedCloudRestore.database="rekixo-3d-production";
    assert.throws(()=>evaluate(f),/isolated cloud restore/);
  });
  withFixture(f=>{
    f.restoreReport.productionChanged=true;
    assert.throws(()=>evaluate(f),/offline D1\/R2/);
  });
});
test("an old published mapping backup must not pass a new immutable release",()=>{
  withFixture(f=>{
    f.restoreReport.activeMappingReleaseId="previous-map-release";
    assert.throws(()=>evaluate(f),/offline D1\/R2/);
  });
});
test("social poster must bind the actual version and exact Geo public project",()=>{
  withFixture(f=>{
    f.socialReport.version="2";
    assert.throws(()=>evaluate(f),/image bytes\/version/);
  });
  withFixture(f=>{
    f.manifest.shareUrl="https://example.com/3Dprojects/another-project/geo?share=3";
    assert.throws(()=>evaluate(f),/version-bound HTTPS/);
  });
});
test("evidence files cannot traverse or symlink outside the evidence directory",()=>{
  withFixture(f=>{
    f.manifest.devices[0].siteScreenshot.path="../stolen-data.txt";
    assert.throws(()=>evaluate(f),/inside the provided evidence folder/);
  });
});

test("new 3D Geo dashboard distinguishes publication from physical signoff",()=>{
  const dashboard=readFileSync(new URL("../apps/admin/src/dashboard/EngineDashboard.tsx",import.meta.url),"utf8");
  assert.match(dashboard,/selectedProject\\.projectKind === "building_geo"\\) return \\{/);
  assert.match(dashboard,/Geo published · field acceptance required/);
  assert.match(dashboard,/Source-backed mapping is published, not field-certified/);
});
