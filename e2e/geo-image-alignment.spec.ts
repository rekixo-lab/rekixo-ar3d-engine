import {expect,test} from "@playwright/test";
const slug="e2e-geo";
const sha="00cbf4aed459027a84b7bdc22a1d15cc25fba49dc4119ffa594379718cde863f";
const img=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAZAAAADICAIAAABJdyC1AAACUElEQVR42u3XwY3EQAwDQc1h8haV+YZw/hkyqkLgowGeJAWwwa2q7jbEEzNjK1vZ6sWh/qwAbCFYgGABCBYgWACCBSBYgGABCBaAYAGCBSBYAIIFCBaAYAEIFiBYAIIFIFiAYAEIFoBgAYIFIFgAggUIFoBgAQgWIFgAggUIlgkAwQIQLECwAAQLQLAAwQIQLADBAgQLQLAABAsQLADBAhAsQLAABAtAsIAPOUmsAKxwq6q7DfHEzNjKVrZ6cSiXEFhDsADBAhAsQLAABAtAsADBAhAsAMECBAtAsAAECxAsAMECECxAsAAEC0CwAMECECwAwQIEC0CwAAQLECwAwQIQLECwAAQLECwTAIIFIFiAYAEIFoBgAYIFIFgAggUIFoBgAQgWIFgAggUgWIBgAQgWgGABH3KSWAFY4VZVdxviiZmxla1s9eJQLiGwhmABggUgWIBgAQgWgGABggUgWACCBQgWgGABCBaAYAEIFiBYAIIFIFiAYAEIFiBYJgAEC0CwAMECECwAwQIEC0CwAAQLECwAwQIQLECwAAQLQLAAwQIQLADBAj7kJLECsMKtqu42xBMzYytb2erFoVxCYA3BAgQLQLAAwQIQLADBAgQLQLAABAsQLADBAhAsQLAABAtAsADBAhAsAMECBAtAsAAECxAsAMECECxAsAAEC0CwAMECECxAsEwACBaAYAGCBSBYAIIFCBaAYAEIFiBYAIIFIFiAYAEIFoBgAYIFIFgA/ztJrACs8AMvozkUOdN+cwAAAABJRU5ErkJggg==","base64");
const json=(value:unknown)=>({status:200,contentType:"application/json",body:JSON.stringify(value)});
test("private original image captures real pixels and source-pinned alignment draft without touching published maps",async({page})=>{
  await page.route("**/3Dprojects/api/cloud/session",r=>r.fulfill(json({
    configured:true,databaseReady:true,authenticated:true,user:{email:"e2e@rekixo.test"}
  })));
  await page.route(/\/3Dprojects\/api\/cloud\/projects\?/,r=>r.fulfill(json({
    projects:[{id:"e2e-id",slug,name:"E2E Geo",status:"published",projectKind:"legacy",assetCount:1,
      updatedAt:"2026-11-01T00:00:00Z"}],total:1,nextOffset:1,hasMore:false
  })));
  await page.route("**/3Dprojects/api/cloud/projects/e2e-geo/assets*",r=>r.fulfill(json({assets:[{
    id:"approved-reference",projectId:"e2e-id",kind:"reference",name:"approved-400x200.png",
    mimeType:"image/png",byteSize:img.length,sha256:sha,refCount:0,
    createdAt:"2026-11-01T00:00:00Z",contentUrl:"/3Dprojects/e2e-image.png"
  }]})));
  await page.route("**/3Dprojects/e2e-image.png",r=>r.fulfill({
    status:200,contentType:"image/png",body:img
  }));
  await page.route("**/3Dprojects/api/cloud/projects/e2e-geo/releases",r=>r.fulfill(json({releases:[]})));
  await page.route("**/3Dprojects/api/cloud/projects/e2e-geo/geo-releases",r=>r.fulfill(json({
    schemaReady:true,experienceId:"experience-1",activeRelease:{id:"geo-release-1"},releases:[]
  })));
  await page.route("**/3Dprojects/api/cloud/projects/e2e-geo/geo-plots/source",r=>r.fulfill(json({
    geoRelease:{id:"geo-release-1"},buildingRelease:{id:"building-release-1"},
    model:{url:"/3Dprojects/no-glb-in-fixture.glb"},canonicalModel:{url:"/3Dprojects/no-glb-in-fixture.glb"},
    placement:{headingDeg:0,scale:1}
  })));
  await page.route("**/3Dprojects/no-glb-in-fixture.glb",r=>r.fulfill({status:404,body:"mock GLB unavailable"}));
  await page.route("**/3Dprojects/api/cloud/projects/e2e-geo/geo-plots/inventory",r=>r.fulfill(json({
    revision:0,rows:[],updatedBy:null,updatedAt:null
  })));
  await page.route("**/3Dprojects/api/cloud/projects/e2e-geo/geo-plots",r=>r.fulfill(json({
    inventoryRevision:0,alignmentRevision:0,geoReleaseId:"geo-release-1",
    buildingReleaseId:"building-release-1",
    draft:{revision:0,verifiedRevision:null,verifiedInventoryRevision:null,
      verifiedAlignmentRevision:null,stale:false,plots:[]},activeMapping:null,releases:[]
  })));
  let saved:any=null;
  await page.route("**/3Dprojects/api/cloud/projects/e2e-geo/geo-plots/alignment",async r=>{
    if(r.request().method()==="PUT"){
      saved=r.request().postDataJSON();
      await r.fulfill(json({revision:1,verifiedRevision:null,stale:false,
        modelSha256:"c".repeat(64),draft:saved.draft}));
    }else await r.fulfill(json({revision:0,verifiedRevision:null,stale:false,
      modelSha256:"c".repeat(64),draft:null}));
  });
  await page.goto("/3Dprojects/geo-plots?project=e2e-geo");
  await expect(page.getByRole("heading",{name:"3D Geo Plot Mapper"}).last()).toBeVisible();
  const panel=page.locator(".geo-align-panel");
  await panel.locator("summary").click();
  await panel.getByLabel("Approved original reference image").selectOption("approved-reference");
  await expect(panel.getByText(/Original resolution 400 × 200 pixels/)).toBeVisible();
  await panel.getByRole("button",{name:"Save Alignment Draft"}).click();
  await expect.poll(()=>saved).not.toBeNull();
  expect(saved.expectedRevision).toBe(0);
  expect(saved.draft.imageWidth).toBe(400);
  expect(saved.draft.imageHeight).toBe(200);
  expect(saved.draft.imageSha256).toBe(sha);
  expect(saved.draft.geoReleaseId).toBe("geo-release-1");
  await panel.locator("svg").click({position:{x:45,y:35}});
  await panel.getByLabel("Signed drawing / survey evidence for new pair").fill("Signed site control p5");
  await expect(panel.getByRole("button",{name:"Pair Fit Point on 3D Canvas"})).toBeEnabled();
  await panel.getByRole("button",{name:"Pair Fit Point on 3D Canvas"}).click();
  await expect(page.getByRole("button",{name:"Cancel alignment capture"})).toBeVisible();
  await expect(page.getByRole("button",{name:"Publish Mapping"})).toBeDisabled();
});
