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
  // New fullscreen tabs intentionally keep source reconciliation with the Plot editor.
  await page.getByRole("button",{name:"2 · Plot Details"}).click();
  const review=page.locator(".geo-plot-source-review").first();
  await expect(review).toContainText("1 issue(s)");
  await expect(review).toContainText("front");
  await expect(page.getByText("Source inventory was updated after verification.")).toBeVisible();
  await expect(page.getByRole("button",{name:"Publish Mapping"})).toBeDisabled();
  await page.getByRole("button",{name:"Plot 1 4 corners"}).click();
  // Platform parity: use the browser's native crosshair, not an overlay
  // magnifier or a second synthetic cursor that can drift from the hit point.
  const overlay=page.locator(".geo-plot-overlay");
  await expect(overlay).toHaveAttribute("data-tool-mode","edit");
  // A previously mapped plot must not jump to Plot 2 when returning from Pan.
  await page.getByRole("button",{name:"✋ Pan"}).click();
  await expect(overlay).toHaveAttribute("data-tool-mode","pan");
  await page.getByRole("button",{name:"▱ 4 corners"}).click();
  await expect(overlay).toHaveAttribute("data-tool-mode","edit");
  await expect(page.getByLabel("Current approved CSV plot")).toHaveValue("1");
  await expect.poll(()=>overlay.evaluate(el=>getComputedStyle(el).cursor)).toBe("crosshair");
  await expect(page.locator(".geo-plot-precision-loupe, .geo-plot-precision-crosshair, .geo-plot-precision-pointer-origin")).toHaveCount(0);
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

  // One-centimetre/millimetre-level editing is explicit and never retains
  // a road-side approval after moving an approved ground footprint.
  await page.getByLabel("Selected corner").selectOption("0");
  await page.getByLabel("Corner movement step").selectOption("0.1");
  await page.getByRole("button",{name:"Nudge corner model positive X"}).click();
  await expect(page.locator(".geo-plot-nudge-settings option[value='0']"))
    .toContainText("X 0.100");
  await expect(front.getByLabel("Road side")).not.toBeChecked();
  await expect(page.getByLabel("Verified model-local plot mapping plane")).not.toBeChecked();
  await page.keyboard.press("Control+z");
  await expect(page.locator(".geo-plot-nudge-settings option[value='0']"))
    .toContainText("X 0.000");
  await expect(front.getByLabel("Road side")).toBeChecked();
  await page.keyboard.press("Control+Shift+z");
  await expect(page.locator(".geo-plot-nudge-settings option[value='0']"))
    .toContainText("X 0.100");

  await page.getByRole("button",{name:/Full screen/}).last().click();
  await expect(page.locator(".geo-plot-editor-shell")).toHaveAttribute("data-fullscreen","true");
  await page.getByRole("button",{name:/Exit full screen/}).last().click();
  await expect(page.locator(".geo-plot-editor-shell")).toHaveAttribute("data-fullscreen","false");

  // The Quality tab isolates diagnostic evidence from the fast drawing controls.
  await page.getByRole("button",{name:"3 · Quality"}).click();
  // Evidence dashboard is diagnostic-only, while Clone Previous produces a
  // new canonical ID with unverified source and NO silent polygon publication.
  await expect(page.getByText("Data quality ·")).toBeVisible();
  await expect(page.getByRole("button",{name:"Download Evidence & Quality Review JSON"})).toBeVisible();
  await expect(page.locator(".geo-plot-quality-item")).toHaveCount(1);
  await expect(page.locator(".geo-plot-quality-item")).toContainText("Plot 1");
  await page.getByRole("button",{name:"Review Plot 1 in Editor"}).click();
  await expect(page.getByRole("button",{name:"2 · Plot Details"})).toHaveAttribute("aria-pressed","true");
  await expect(page.getByLabel("Current approved CSV plot")).toHaveValue("1");
  await expect(page.locator(".geo-plot-selected-review-note")).toBeVisible();
  await page.getByRole("button",{name:"3 · Quality"}).click();
  await page.getByText("Clone Previous · unverified footprint template").click();
  await page.getByLabel("Previous mapped Plot ID").selectOption("1");
  await page.getByLabel("X offset (metres)").fill("10");
  await page.getByLabel("Z offset (metres)").fill("0");
  page.on("dialog",dialog=>dialog.accept());
  await page.getByRole("button",{name:"Clone to Unverified Draft"}).click();
  await expect(page.getByRole("heading",{name:"New Plot 2"})).toBeVisible();
  await expect(page.getByLabel("Area verified against source")).not.toBeChecked();
  await expect(page.getByLabel("Facing verified against reference")).not.toBeChecked();
  const clonedFront=page.locator("fieldset").filter({has:page.locator("legend:text-is('front')")});
  await expect(clonedFront.getByLabel("Road side")).not.toBeChecked();
  await expect(clonedFront.getByLabel("Source verified")).not.toBeChecked();
  await expect(page.getByRole("button",{name:"Publish Mapping"})).toBeDisabled();
});
