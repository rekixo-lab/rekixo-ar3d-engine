import {expect,test} from "@playwright/test";

const slug="e2e-geo-resume";
const json=(value:unknown)=>({status:200,contentType:"application/json",body:JSON.stringify(value)});
const project={id:"e2e-resume-id",slug,name:"Resume Plot Demo",status:"published",
  projectKind:"building_geo",updatedAt:"2026-11-01T00:00:00Z",assetCount:0};
const sourceRow={id:"1",area:100,areaUnit:"sqm",areaSource:"Plan",front:10,back:10,
  depthA:10,depthB:10,lengthUnit:"m",measurementSource:"Approved Plan",
  road:"23 feet road",facing:"east",facingSource:"Approved Plan",dimensions:"10 x 10",notes:""};
for(const {shape,cornerCount,toolKey,toolLabel} of [
  {shape:"four",cornerCount:1,toolKey:"d",toolLabel:"4 corners"},
  {shape:"irregular",cornerCount:3,toolKey:"i",toolLabel:"Irregular"}
] as const){
  test("Pan then Resume preserves same "+shape+" Plot 1 with "+cornerCount+" corners",async({page})=>{
    const cornerPoints=Array.from({length:cornerCount},(_,i)=>[i*2,i*2+1]);
    const draft={
      schema:"rekixo-engine-geo-local-plot-draft-v1",
      projectSlug:slug,geoReleaseId:"geo-release-1",buildingReleaseId:"building-release-1",
      mappingRevision:0,checkedAt:Date.now(),originalId:null,shape,
      plot:{id:"1",corners:cornerPoints,layout:"four",sides:{},
        area:{value:100,unit:"sqm",source:"Plan",verified:false},
        facing:"east",facingSource:"",facingVerified:false,
        road:"23 feet road",planeY:0,planeSource:"",planeVerified:false,notes:""}
    };
    await page.addInitScript(({key,value})=>window.localStorage.setItem(key,JSON.stringify(value)),
      {key:"rekixo:engine-geo-plot-unapplied:v1:"+slug,value:draft});
    await page.route("**/3Dprojects/api/cloud/session",r=>r.fulfill(json({
      configured:true,databaseReady:true,authenticated:true,user:{email:"e2e@rekixo.test"}
    })));
    await page.route(/\/3Dprojects\/api\/cloud\/projects\?/,r=>r.fulfill(json({
      projects:[project],total:1,nextOffset:1,hasMore:false
    })));
    await page.route("**/3Dprojects/api/cloud/projects/"+slug+"/geo-plots/inventory",
      r=>r.fulfill(json({revision:1,rows:[sourceRow]})));
    await page.route("**/3Dprojects/api/cloud/projects/"+slug+"/geo-plots/source",
      r=>r.fulfill(json({
        geoRelease:{id:"geo-release-1"},buildingRelease:{id:"building-release-1"},
        model:{url:"/3Dprojects/mock-model-404.glb"},
        canonicalModel:{url:"/3Dprojects/mock-model-404.glb"},
        placement:{headingDeg:0,scale:1}
      })));
    await page.route("**/3Dprojects/mock-model-404.glb",
      r=>r.fulfill({status:404,body:"No real GLB required for Pan/Resume tool mode regression"}));
    await page.route("**/3Dprojects/api/cloud/projects/"+slug+"/geo-plots",
      r=>r.fulfill(json({
        inventoryRevision:1,alignmentRevision:0,geoReleaseId:"geo-release-1",
        buildingReleaseId:"building-release-1",
        draft:{revision:0,verifiedRevision:null,verifiedInventoryRevision:null,
          verifiedAlignmentRevision:null,stale:false,plots:[]},
        activeMapping:null,releases:[]
      })));
    await page.goto("/3Dprojects/geo-plots?project="+slug);
    await expect(page.getByRole("button",{name:"Restore unfinished plot"})).toBeVisible();
    page.once("dialog",dialog=>dialog.accept());
    await page.getByRole("button",{name:"Restore unfinished plot"}).click();
    const overlay=page.locator(".geo-plot-overlay");
    // Recovery opens a >=3-corner outline in conservative Edit mode. Pan
    // must still offer Resume to extend an unfinished irregular boundary.
    await expect(overlay).toHaveAttribute("data-tool-mode",shape==="irregular"?"edit":"draw");
    const status=page.locator(".geo-plot-scene-status");
    const countText=shape==="four"?cornerCount+"/4":cornerCount+" (irregular)";
    await expect(status).toContainText(countText);
    await page.getByRole("button",{name:"✋ Pan"}).click();
    await expect(overlay).toHaveAttribute("data-tool-mode","pan");
    await expect(status).toContainText(countText);
    await expect(page.getByRole("button",{name:"Resume Drawing Plot 1"})).toBeVisible();
    await expect(page.locator(".geo-plot-paused-banner")).toContainText("corner "+(cornerCount+1));
    await page.getByRole("button",{name:"Resume Drawing Plot 1"}).click();
    await expect(overlay).toHaveAttribute("data-tool-mode","draw");
    await expect(status).toContainText(countText);
    // Re-selecting the same shape also resumes; it must not silently restart Plot 1.
    await page.getByRole("button",{name:"✋ Pan"}).click();
    await page.getByRole("button",{name:toolLabel,exact:false}).first().click();
    await expect(overlay).toHaveAttribute("data-tool-mode","draw");
    await expect(status).toContainText(countText);
    await page.keyboard.press("p");
    await expect(overlay).toHaveAttribute("data-tool-mode","pan");
    await page.keyboard.press(toolKey);
    await expect(overlay).toHaveAttribute("data-tool-mode","draw");
    await expect(status).toContainText(countText);
    // Restored partial polygons must never be saveable until every edge has a
    // complete side assignment; the repair preserves all original corners.
    const confirm=page.getByRole("button",{name:/Confirm Plot 1 & Next/});
    await expect(confirm).toBeDisabled();
    if(shape==="irregular"){
      const repair=page.getByRole("button",{name:"Repair Sides · Keep Polygon"});
      await expect(repair).toBeVisible();
      page.once("dialog",dialog=>dialog.accept());
      await repair.click();
      await expect(confirm).toBeEnabled();
      await expect(status).toContainText(countText);
    }
  });
}
