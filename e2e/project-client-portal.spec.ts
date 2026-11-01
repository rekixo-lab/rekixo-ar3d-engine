import {test,expect} from "@playwright/test";
test("One-time project invitation fragment is immediately stripped and only the scoped portal appears",async({page})=>{
 const token="a".repeat(64);
 await page.route("**/3Dprojects/api/client-portal/session",async route=>
  route.fulfill({status:200,contentType:"application/json",
   body:JSON.stringify({authenticated:false,user:null})}));
 await page.goto("/3Dprojects/client-portal#invite="+token);
 await expect(page.getByRole("heading",{name:"Scoped Project Access"})).toBeVisible();
 await expect(page.getByText("Accept an owner-issued invitation")).toBeVisible();
 await expect.poll(()=>page.url()).not.toContain("#invite=");
 await expect(page.getByLabel("Invited email address")).toBeVisible();
 await expect(page.getByText("No access", {exact:true})).toHaveCount(0);
});
test("Viewer cannot see owner controls or commercial editing, and logout invalidates scoped session",async({page})=>{
 let loggedIn=false;
 const user={displayName:"Demo Viewer",email:"viewer@example.test",role:"viewer",
  projectSlug:"demo-a",projectName:"Demo A"};
 await page.route("**/3Dprojects/api/client-portal/**",async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.pathname.endsWith("/session"))
   return route.fulfill({status:200,contentType:"application/json",
    body:JSON.stringify({authenticated:loggedIn,user:loggedIn?user:null})});
  if(url.pathname.endsWith("/enroll")){
   loggedIn=true;
   return route.fulfill({status:200,contentType:"application/json",
    body:JSON.stringify({ok:true,role:"viewer"})});
  }
  if(url.pathname.endsWith("/projects/demo-a/overview"))
   return route.fulfill({status:200,contentType:"application/json",
    body:JSON.stringify({project:{slug:"demo-a",name:"Demo A",status:"published"},
     role:"viewer",permissions:{commercialRead:true,commercialPrepare:false,commercialApprove:false}})});
  if(url.pathname.endsWith("/projects/demo-a/commercial"))
   return route.fulfill({status:200,contentType:"application/json",
    body:JSON.stringify({mappingReleaseId:"map-test",rows:[{
     plotId:"12",status:"booked",pricePaise:null,revision:1,
     publicApproved:false,evidenceRef:"Signed memo"}]})});
  if(url.pathname.endsWith("/logout")){
   loggedIn=false;
   return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({ok:true})});
  }
  return route.abort();
 });
 await page.goto("/3Dprojects/client-portal#invite="+"a".repeat(64));
 await page.getByLabel("Invited email address").fill("viewer@example.test");
 await page.getByRole("button",{name:"Accept one-time invitation"}).click();
 await expect(page.getByText("Demo Viewer")).toBeVisible();
 await expect(page.getByRole("heading",{name:"Approved Geo Plot Listing Records"})).toBeVisible();
 await expect(page.getByText("You have read-only access")).toBeVisible();
 await expect(page.getByRole("button",{name:"Save scoped commercial record"})).toHaveCount(0);
 await expect(page.getByRole("button",{name:"Issue scoped invitation"})).toHaveCount(0);
 await page.getByRole("button",{name:"Sign out"}).click();
 await expect(page.getByRole("heading",{name:"Accept an owner-issued invitation"})).toBeVisible();
});
