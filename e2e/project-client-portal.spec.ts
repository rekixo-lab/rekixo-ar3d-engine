import {test,expect} from "@playwright/test";

test("Project-specific invite fragment stripped before Client Admin login, no owner shell",async({page})=>{
 const token="a".repeat(64);
 await page.route("**/3Dprojects/api/client-portal/session?project=demo-a",async route=>
  route.fulfill({status:200,contentType:"application/json",
   body:JSON.stringify({authenticated:false,user:null})}));
 await page.goto("http://127.0.0.1:5174/3Dprojects/demo-a/client-admin#invite="+token);
 await expect(page.getByRole("heading",{name:"Project Client Admin",level:2})).toBeVisible();
 await expect.poll(()=>page.url()).not.toContain("#invite=");
 await expect(page.getByLabel("Invited email address")).toBeVisible();
 await expect(page.getByText("Open your project's private invitation link")).toHaveCount(0);
 await expect(page.getByText("Engine Owner", {exact:true})).toHaveCount(0);
});

test("Viewer sees scoped dashboard and plot list without editing or owner actions",async({page})=>{
 let loggedIn=false;
 const user={displayName:"Demo Viewer",email:"viewer@example.test",role:"viewer",
  projectSlug:"demo-a",projectName:"Demo A",projectKind:"building_geo"};
 await page.route("**/3Dprojects/api/client-portal/**",async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.pathname.endsWith("/session"))
   return route.fulfill({status:200,contentType:"application/json",
    body:JSON.stringify({authenticated:loggedIn,user:loggedIn?user:null})});
  if(url.pathname.endsWith("/enroll")){
   const payload=request.postDataJSON();
   expect(payload.projectSlug).toBe("demo-a");
   loggedIn=true;
   return route.fulfill({status:200,contentType:"application/json",
    body:JSON.stringify({ok:true,role:"viewer"})});
  }
  if(url.pathname.endsWith("/projects/demo-a/overview"))
   return route.fulfill({status:200,contentType:"application/json",
    body:JSON.stringify({project:{slug:"demo-a",name:"Demo A",status:"published",kind:"building_geo"},
     role:"viewer",permissions:{commercialRead:true,commercialPrepare:false,commercialApprove:false,
      dealsRead:false,dealsWrite:false}})});
  if(url.pathname.endsWith("/projects/demo-a/commercial"))
   return route.fulfill({status:200,contentType:"application/json",
    body:JSON.stringify({mappingReleaseId:"map-test",plotCount:2,rows:[{
     plotId:"12",status:"booked",pricePaise:null,revision:1,
     publicApproved:false,evidenceRef:"Signed memo"}]})});
  if(url.pathname.endsWith("/logout")){
   loggedIn=false;
   return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({ok:true})});
  }
  return route.abort();
 });
 await page.goto("http://127.0.0.1:5174/3Dprojects/demo-a/client-admin#invite="+"a".repeat(64));
 await page.getByLabel("Invited email address").fill("viewer@example.test");
 await page.getByRole("button",{name:"Activate project access"}).click();
 await expect(page.getByRole("heading",{name:"Demo A"})).toBeVisible();
 await expect(page.getByRole("heading",{name:"Project overview"})).toBeVisible();
 await expect(page.getByText("Demo Viewer")).toBeVisible();
 await page.getByRole("button",{name:"Plots",exact:true}).click();
 await expect(page.getByRole("heading",{name:"Geo plot management"})).toBeVisible();
 await expect(page.getByRole("button",{name:/Plot 12/})).toBeVisible();
 await expect(page.getByRole("button",{name:"Save scoped listing"})).toHaveCount(0);
 await expect(page.getByRole("button",{name:"Issue scoped invitation"})).toHaveCount(0);
 await expect(page.getByRole("button",{name:"Deals"})).toHaveCount(0);
 await page.getByRole("button",{name:"Sign out"}).click();
 await expect(page.getByRole("heading",{name:"Project Client Admin",level:2})).toBeVisible();
});

test("Project client admin on small phones does not horizontally overflow",async({page})=>{
 await page.setViewportSize({width:320,height:640});
 await page.route("**/3Dprojects/api/client-portal/session?project=demo-a",async route=>
  route.fulfill({status:200,contentType:"application/json",
   body:JSON.stringify({authenticated:false,user:null})}));
 await page.goto("http://127.0.0.1:5174/3Dprojects/demo-a/client-admin");
 await expect(page.getByRole("heading",{name:"Project Client Admin",level:2})).toBeVisible();
 const bounds=await page.evaluate(()=>({
  width:document.documentElement.scrollWidth,view:window.innerWidth
 }));
 expect(bounds.width-bounds.view).toBeLessThanOrEqual(1);
});
