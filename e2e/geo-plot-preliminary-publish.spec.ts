import {expect,test} from "@playwright/test";

const slug="e2e-geo-preliminary";
const json=(value:unknown)=>({status:200,contentType:"application/json",body:JSON.stringify(value)});
const project={id:"e2e-geo-preliminary-id",slug,name:"Preliminary Geo",status:"published",
  projectKind:"building_geo",updatedAt:"2026-11-01T00:00:00Z",assetCount:0};
const plot={
  id:"1",corners:[[0,0],[10,0],[10,10],[0,10]],layout:"four",
  sides:Object.fromEntries(["front","depthA","back","depthB"].map((r,i)=>[
    r,{edges:[i],length:10,unit:"m",verified:false,source:"",roadFacing:false}
  ])),
  area:{value:100,unit:"sqm",source:"",verified:false},
  facing:"east",facingSource:"",facingVerified:false,
  road:"23 feet road",notes:"",planeY:0,planeSource:"",planeVerified:false
};
const draft={revision:36,verifiedRevision:null,verifiedInventoryRevision:null,
  verifiedAlignmentRevision:null,stale:false,plots:[plot]};
test("36/36-style mapped unverified Draft can publish preliminary without misrepresenting verification",async({page})=>{
  let postedAction="",postedRevision=-1;
  await page.route("**/3Dprojects/api/cloud/session",r=>r.fulfill(json({
    configured:true,databaseReady:true,authenticated:true,user:{email:"e2e@rekixo.test"}
  })));
  await page.route(/\/3Dprojects\/api\/cloud\/projects\?/,r=>r.fulfill(json({
    projects:[project],total:1,nextOffset:1,hasMore:false
  })));
  await page.route("**/3Dprojects/api/cloud/projects/"+slug+"/geo-plots/inventory",
    r=>r.fulfill(json({revision:1,rows:[{id:"1",area:100,areaUnit:"sqm",
      road:"23 feet road",front:10,back:10,depthA:10,depthB:10,lengthUnit:"m"}]})));
  await page.route("**/3Dprojects/api/cloud/projects/"+slug+"/geo-plots/source",
    r=>r.fulfill(json({geoRelease:{id:"geo-release-1"},buildingRelease:{id:"building-release-1"},
      model:{url:"/3Dprojects/geo-preview-no-model.glb"},
      canonicalModel:{url:"/3Dprojects/geo-preview-no-model.glb"},
      placement:{headingDeg:0,scale:1}})));
  await page.route("**/3Dprojects/geo-preview-no-model.glb",
    r=>r.fulfill({status:404,body:"No GLB needed to test authenticated preliminary action"}));
  await page.route("**/3Dprojects/api/cloud/projects/"+slug+"/geo-plots?preview=1",
    r=>r.fulfill(json({draftRevision:36,activeReleaseId:null,token:"sealed-test-preview-token",
      diff:{liveCount:0,draftCount:1,added:1,removed:0,changed:0,changes:[]}})));
  await page.route("**/3Dprojects/api/cloud/projects/"+slug+"/geo-plots",async r=>{
    if(r.request().method()==="POST"){
      const body=r.request().postDataJSON();
      postedAction=body.action;postedRevision=body.expectedRevision;
      expect(body.expectedPreflightToken).toBe("sealed-test-preview-token");
      expect(body.expectedActiveReleaseId).toBeNull();
      await r.fulfill(json({
        inventoryRevision:1,alignmentRevision:0,geoReleaseId:"geo-release-1",
        buildingReleaseId:"building-release-1",draft,
        activeMapping:{id:"mapping-1",version:1,current:true,publicationMode:"preliminary"},
        releases:[{id:"mapping-1",version:1,geoReleaseId:"geo-release-1",publicationMode:"preliminary"}]
      }));
      return;
    }
    await r.fulfill(json({
      inventoryRevision:1,alignmentRevision:0,geoReleaseId:"geo-release-1",
      buildingReleaseId:"building-release-1",draft,activeMapping:null,releases:[]
    }));
  });
  await page.goto("/3Dprojects/geo-plots?project="+slug);
  const prelim=page.getByRole("button",{name:"Publish Live · Preliminary"});
  await expect(prelim).toBeEnabled();
  await expect(page.getByRole("button",{name:"Publish Mapping"})).toBeDisabled();
  page.on("dialog",d=>d.accept());
  await prelim.click();
  await expect(page.getByText(/Preliminary Geo Plot Mapping is LIVE/)).toBeVisible();
  expect(postedAction).toBe("publish-preliminary");
  expect(postedRevision).toBe(36);
  await expect(page.locator(".geo-plot-stats")).toContainText("v1 · Preliminary");
  await page.getByRole("button",{name:"4 · Publish"}).click();
  await expect(page.getByRole("button",{name:"Publish Preliminary Mapping · Editable Later"})).toBeEnabled();
});
