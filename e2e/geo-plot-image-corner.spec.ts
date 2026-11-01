import {expect,test} from "@playwright/test";
import {createHash} from "node:crypto";

const slug="e2e-geo";
const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAZAAAADICAIAAABJdyC1AAACAElEQVR42u3UMQ0AAAgEMcC/50cFA0kr4YbrJAXwwUgAGBaAYQGGBWBYAIYFGBaAYQEYFmBYAIYFYFiAYQEYFoBhAYYFYFgAhgUYFoBhARgWYFgAhgVgWIBhARgWgGEBhgVgWIBhARgWgGEBhgVgWACGBRgWgGEBGBZgWACGBWBYgGEBGBaAYQGGBWBYAIYFGBaAYQEYFmBYAIYFYFiAYQEYFoBhAYYFYFiAYQEYFoBhAYYFYFgAhgUYFoBhARgWYFgAhgVgWIBhARgWgGEBhgVgWACGBRgWgGEBGBZgWACGBWBYgGEBGBaAYQGGBWBYAIYFGBaAYQEYFmBYAIYFYFiAYQEYFoBhAYYFYFgAhgUYFoBhARgWYFgAhgVgWIBhARgWgGEBhgVgWACGBRgWgGEBGBaAYQGGBWBYAIYFGBaAYQEYFmBYAIYFYFiAYQEYFoBhAYYFYFgAhgUYFoBhARgWYFgAhgVgWIBhAdxZVTEEjVPcQrEAAAAASUVORK5CYII=","base64");
const imageHash=createHash("sha256").update(png).digest("hex");
const sha="b".repeat(64);
const json=(body:unknown)=>({status:200,contentType:"application/json",body:JSON.stringify(body)});
const point=(id:string,u:number,v:number)=>({id,u,v,x:20*u,z:10*v,evidence:"Approved survey landmark "+id});
const sides=(index:number,road=false)=>({edges:[index],length:10,unit:"m",
  source:"Survey p5",verified:true,roadFacing:road});
const mapped={id:"1",corners:[[0,0],[10,0],[10,10],[0,10]],layout:"four",
  sides:{front:sides(0,true),depthA:sides(1),back:sides(2),depthB:sides(3)},
  area:{value:100,unit:"sqm",source:"Survey p5",verified:true},
  facing:"east",facingSource:"Survey north",facingVerified:true,
  road:"Road",planeY:0,planeSource:"Model datum",planeVerified:true,notes:""};
test("independently verified image mode stages the SAME Geo Plot ID without publishing old approvals",async({page})=>{
  await page.route("**/3Dprojects/api/cloud/session",r=>r.fulfill(json({
    configured:true,databaseReady:true,authenticated:true,user:{email:"e2e@rekixo.test"}
  })));
  await page.route(/\/3Dprojects\/api\/cloud\/projects\?/,r=>r.fulfill(json({
    projects:[{id:"e2e-geo-id",slug,name:"E2E Geo",status:"published",projectKind:"legacy",
      updatedAt:"2026-11-01T00:00:00Z",assetCount:1}],total:1,nextOffset:1,hasMore:false
  })));
  await page.route("**/3Dprojects/api/cloud/projects/e2e-geo/assets*",r=>r.fulfill(json({
    assets:[{id:"source1",projectId:"e2e-geo-id",kind:"reference",
      name:"approved-masterplan.png",mimeType:"image/png",byteSize:png.length,
      sha256:imageHash,refCount:1,createdAt:"2026-11-01T00:00:00Z",
      contentUrl:"/3Dprojects/private-original-source-image.png"}]
  })));
  await page.route("**/3Dprojects/private-original-source-image.png",r=>r.fulfill({
    status:200,contentType:"image/png",body:png
  }));
  await page.route("**/3Dprojects/api/cloud/projects/e2e-geo/geo-plots/inventory",r=>r.fulfill(json({
    revision:0,rows:[]
  })));
  await page.route("**/3Dprojects/api/cloud/projects/e2e-geo/geo-plots/alignment",r=>r.fulfill(json({
    revision:2,verifiedRevision:2,stale:false,modelSha256:sha,
    draft:{imageAssetId:"source1",imageSha256:imageHash,imageWidth:400,imageHeight:200,
      geoReleaseId:"geo-release-1",buildingReleaseId:"building-release-1",modelSha256:sha,
      anchors:[point("F1",.05,.05),point("F2",.9,.05),point("F3",.05,.9)],
      checkpoints:[point("C1",.25,.25),point("C2",.75,.75)]}
  })));
  await page.route("**/3Dprojects/api/cloud/projects/e2e-geo/geo-plots/source",r=>r.fulfill(json({
    geoRelease:{id:"geo-release-1"},buildingRelease:{id:"building-release-1"},
    model:{url:"/3Dprojects/image-mode-model-404.glb",sha256:sha},
    canonicalModel:{url:"/3Dprojects/image-mode-model-404.glb",sha256:sha},
    placement:{headingDeg:0,scale:1}
  })));
  await page.route("**/3Dprojects/image-mode-model-404.glb",r=>r.fulfill({status:404,body:"GLB fixture unavailable"}));
  await page.route("**/3Dprojects/api/cloud/projects/e2e-geo/geo-plots",r=>r.fulfill(json({
    inventoryRevision:0,alignmentRevision:2,geoReleaseId:"geo-release-1",
    buildingReleaseId:"building-release-1",
    draft:{revision:3,verifiedRevision:3,verifiedInventoryRevision:0,verifiedAlignmentRevision:2,
      stale:false,plots:[mapped]},
    activeMapping:null,releases:[]
  })));
  await page.goto("/3Dprojects/geo-plots?project=e2e-geo");
  await expect(page.getByRole("heading",{name:"3D Geo Plot Mapper"}).last()).toBeVisible();
  await page.locator(".geo-align-panel > summary").click();
  const open=page.getByRole("button",{name:"Edit Existing Plot Corners on Verified Image"});
  await expect(open).toBeEnabled();
  page.once("dialog",dialog=>dialog.accept());
  await open.click();
  await expect(page.locator(".geo-align-panel")).toHaveClass(/geo-align-panel--expanded/);
  await page.getByLabel("Canonical mapped Plot ID").selectOption("1");
  await page.getByLabel("Corner to reposition on original image").selectOption("0");
  const image=page.locator(".geo-align-image-stage svg");
  const rect=await image.boundingBox();
  expect(rect).not.toBeNull();
  await page.mouse.click(rect!.x+rect!.width*.02,rect!.y+rect!.height*.05);
  await expect(page.getByText(/Proposed U/)).toBeVisible();
  page.once("dialog",dialog=>dialog.accept());
  await page.getByRole("button",{name:"Stage Image Corner to Unverified 3D Draft"}).click();
  await expect(page.getByText(/Unverified image corner correction staged/)).toBeVisible();
  await page.getByRole("button",{name:"Exit Image Plot Editor"}).click();
  await page.getByRole("button",{name:"Plot 1 4 corners"}).click();
  await expect(page.getByLabel("Area verified against source")).not.toBeChecked();
  await expect(page.getByLabel("Facing verified against reference")).not.toBeChecked();
  await expect(page.getByLabel("Verified model-local plot mapping plane")).not.toBeChecked();
  const front=page.locator("fieldset").filter({has:page.locator("legend:text-is('front')")});
  await expect(front.getByLabel("Road side")).not.toBeChecked();
  await expect(page.getByRole("button",{name:"Publish Mapping"})).toBeDisabled();
});