import {expect,test} from "@playwright/test";

const slug="e2e-manual-sides";
const json=(value:unknown)=>({status:200,contentType:"application/json",body:JSON.stringify(value)});
const project={id:"manual-geo-id",slug,name:"Manual Geo Mapper",status:"published",
  projectKind:"building_geo",updatedAt:"2026-11-01T00:00:00Z",assetCount:0};
const coords=Array.from({length:7},(_,i)=>{
  const angle=2*Math.PI*i/7;return [Math.cos(angle)*20,Math.sin(angle)*20];
});
const side=(edges:number[],value:number)=>({
  edges,length:value,unit:"ft",verified:true,source:"approved CAD",roadFacing:false
});
const plot={
  id:"2",corners:coords,layout:"four",
  sides:{front:side([0],21.166667),depthA:side([1],34),
    back:side([2],26.083333),depthB:side([3,4,5,6],38)},
  area:{value:92.13,unit:"sqm",source:"approved CAD",verified:true},
  facing:"west",facingSource:"approved CAD",facingVerified:true,
  road:"internal road",notes:"NW chamfer",planeY:0,planeSource:"",planeVerified:false
};
test("manual side range stages independently, previews other groups, applies only with confirmation",async({page})=>{
  let writes=0;
  await page.route("**/3Dprojects/api/cloud/session",r=>r.fulfill(json({
    configured:true,databaseReady:true,authenticated:true,user:{email:"e2e@rekixo.test"}
  })));
  await page.route(/\/3Dprojects\/api\/cloud\/projects\?/,r=>r.fulfill(json({
    projects:[project],total:1,nextOffset:1,hasMore:false
  })));
  await page.route("**/3Dprojects/api/cloud/projects/"+slug+"/geo-plots/inventory",
    r=>r.fulfill(json({revision:1,rows:[{
      id:"2",area:92.13,areaUnit:"sqm",areaSource:"approved CAD",
      front:21.166667,back:26.083333,depthA:34,depthB:38,
      lengthUnit:"ft",measurementSource:"approved CAD",road:"internal road",
      facing:"west",facingSource:"approved CAD",dimensions:"",notes:""
    }]})));
  await page.route("**/3Dprojects/api/cloud/projects/"+slug+"/geo-plots/source",
    r=>r.fulfill(json({
      geoRelease:{id:"geo-release-1"},buildingRelease:{id:"building-release-1"},
      model:{url:"/3Dprojects/e2e-no-model.glb"},
      canonicalModel:{url:"/3Dprojects/e2e-no-model.glb"},
      placement:{headingDeg:0,scale:1}
    })));
  await page.route("**/3Dprojects/e2e-no-model.glb",
    r=>r.fulfill({status:404,body:"No GLB needed for side-picker UI"}));
  await page.route("**/3Dprojects/api/cloud/projects/"+slug+"/geo-plots",r=>{
    if(r.request().method()!=="GET")writes++;
    return r.fulfill(json({
      inventoryRevision:1,alignmentRevision:0,geoReleaseId:"geo-release-1",
      buildingReleaseId:"building-release-1",
      draft:{revision:1,verifiedRevision:null,verifiedInventoryRevision:null,
        verifiedAlignmentRevision:null,stale:false,plots:[plot]},
      activeMapping:null,releases:[]
    }));
  });
  await page.goto("/3Dprojects/geo-plots?project="+slug);
  await page.locator(".geo-plot-inventory-browser > summary").click();
  await page.getByRole("button",{name:"Plot 2 7 corners"}).click();
  await page.getByRole("button",{name:"Edit Sides",exact:true}).click();
  await expect(page.getByRole("button",{name:"Manual · Independent"}))
    .toHaveAttribute("aria-pressed","true");
  await expect(page.locator(".geo-plot-overlay")).toHaveAttribute("data-tool-mode","side");
  await page.getByLabel("Manual start corner").selectOption("3");
  await page.getByLabel("Manual end corner").selectOption("5");
  await expect(page.locator(".geo-plot-manual-lock-list"))
    .toContainText("Corners 4 → 6");
  await expect(page.getByRole("button",{name:"✓ Apply Preview"})).toHaveCount(0);
  expect(writes).toBe(0);
  await page.getByRole("button",{name:/Auto Fill Rest · Preview/}).click();
  await expect(page.locator(".geo-plot-manual-preview")).toContainText("PREVIEW ONLY");
  await expect(page.locator(".geo-plot-manual-preview")).toContainText("Edges 4, 5");
  expect(writes).toBe(0);

  // No confirmation means no mapping change and no hidden save.
  page.once("dialog",dialog=>dialog.dismiss());
  await page.getByRole("button",{name:"✓ Apply Preview"}).click();
  await expect(page.locator(".geo-plot-manual-preview")).toBeVisible();
  expect(writes).toBe(0);

  page.once("dialog",dialog=>dialog.accept());
  await page.getByRole("button",{name:"✓ Apply Preview"}).click();
  await expect(page.getByText(/applied to local editor/)).toBeVisible();
  await expect(page.locator(".geo-plot-manual-preview")).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Undo working plot edit"})).toBeEnabled();
  expect(writes).toBe(0);
});
