import {expect,test} from "@playwright/test";

const slug="e2e-geo";
const reviewedSide=(edge:number,roadFacing=false)=>({
  edges:[edge],length:10,unit:"m",source:"Approved survey p5",verified:true,roadFacing
});
const mapped={
  id:"1",corners:[[0,0],[10,0],[10,10],[0,10]],layout:"four",
  sides:{front:reviewedSide(0,true),depthA:reviewedSide(1),
    back:reviewedSide(2),depthB:reviewedSide(3)},
  area:{value:100,unit:"sqm",source:"Approved survey p5",verified:true},
  facing:"east",facingSource:"Survey compass",facingVerified:true,
  road:"23 feet road",planeY:0,planeSource:"Survey datum",planeVerified:true,notes:""
};
const sourceRow={id:"1",area:100,areaUnit:"sqm",areaSource:"Approved survey p5",
  front:12,back:10,depthA:10,depthB:10,lengthUnit:"m",
  measurementSource:"Approved survey p5",road:"23 feet road",
  facing:"east",facingSource:"Survey compass",dimensions:"10x10",notes:""};
const project={id:"e2e-geo-id",slug,name:"E2E Geo",status:"published",projectKind:"legacy",
  updatedAt:"2026-10-31T00:00:00Z",assetCount:0};
const json=(value:unknown)=>({status:200,contentType:"application/json",body:JSON.stringify(value)});
test("legacy Geo editor reveals stale CSV evidence and offers safe road Front reassignment in fullscreen",async({page})=>{
  await page.route("**/3Dprojects/api/cloud/session",r=>r.fulfill(json({
    configured:true,databaseReady:true,authenticated:true,user:{email:"e2e@rekixo.test"}
  })));
  await page.route(/\/3Dprojects\/api\/cloud\/projects\?/,r=>r.fulfill(json({
    projects:[project],total:1,nextOffset:1,hasMore:false
  })));
  await page.route("**/3Dprojects/api/cloud/projects/e2e-geo/releases",r=>r.fulfill(json({releases:[]})));
  await page.route("**/3Dprojects/api/cloud/projects/e2e-geo/geo-releases",r=>r.fulfill(json({
    schemaReady:true,experienceId:"experience-1",activeRelease:{id:"geo-release-1"},releases:[]
  })));
  await page.route("**/3Dprojects/api/cloud/projects/e2e-geo/assets*",r=>r.fulfill(json({assets:[]})));
  await page.route("**/3Dprojects/api/cloud/projects/e2e-geo/geo-plots/inventory",r=>r.fulfill(json({
    revision:2,rows:[sourceRow],updatedBy:"e2e@rekixo.test",updatedAt:"2026-10-31T00:00:00Z"
  })));
  await page.route("**/3Dprojects/api/cloud/projects/e2e-geo/geo-plots/source",r=>r.fulfill(json({
    geoRelease:{id:"geo-release-1"},buildingRelease:{id:"building-release-1"},
    model:{url:"/3Dprojects/model-fixture-404.glb"},canonicalModel:{url:"/3Dprojects/model-fixture-404.glb"},
    placement:{headingDeg:0,scale:1}
  })));
  await page.route("**/3Dprojects/model-fixture-404.glb",r=>r.fulfill({status:404,body:"No GLB in mocked browser UI fixture"}));
  await page.route("**/3Dprojects/api/cloud/projects/e2e-geo/geo-plots",r=>r.fulfill(json({
    inventoryRevision:2,geoReleaseId:"geo-release-1",buildingReleaseId:"building-release-1",
    draft:{revision:3,verifiedRevision:3,verifiedInventoryRevision:1,
      stale:false,plots:[mapped]},
    activeMapping:null,releases:[]
  })));
  await page.goto("/3Dprojects/geo-plots?project=e2e-geo");
  await expect(page.getByRole("heading",{name:"3D Geo Plot Mapper"}).last()).toBeVisible();
  const review=page.locator(".geo-plot-source-review").first();
  await expect(review).toContainText("1 issue(s)");
  await expect(review).toContainText("front");
  await expect(page.getByText("Source inventory was updated after verification.")).toBeVisible();
  await expect(page.getByRole("button",{name:"Publish Mapping"})).toBeDisabled();
  await page.getByRole("button",{name:"Plot 1 4 corners"}).click();
  await expect(page.getByRole("button",{name:/Apply Latest Approved CSV/})).toBeVisible();

  page.once("dialog",dialog=>dialog.accept());
  await page.getByRole("button",{name:/Apply Latest Approved CSV/}).click();
  const front=page.locator("fieldset").filter({has:page.locator("legend:text-is('front')")});
  await expect(front.getByRole("spinbutton",{name:"Length"})).toHaveValue("12");
  await expect(front.getByLabel("Source verified")).not.toBeChecked();

  page.once("dialog",dialog=>dialog.accept());
  await page.getByLabel("Road-facing FRONT boundary").selectOption("2");
  await expect(front.getByLabel("Edges (0…3)")).toHaveValue("2");
  await expect(front.getByLabel("Road side")).toBeChecked();
  await expect(front.getByLabel("Source verified")).not.toBeChecked();

  await page.getByRole("button",{name:/Full screen/}).last().click();
  await expect(page.locator(".geo-plot-editor-shell")).toHaveAttribute("data-fullscreen","true");
  await page.getByRole("button",{name:/Exit full screen/}).last().click();
  await expect(page.locator(".geo-plot-editor-shell")).toHaveAttribute("data-fullscreen","false");
});
