import {test,expect} from "@playwright/test";
const BASE="http://127.0.0.1:5184";
test("AR3D-branded personal Client Admin supports ID login, mandatory change and scoped dashboard",async({page})=>{
 await page.setViewportSize({width:360,height:780});
 let signedIn=false,mustChangePassword=true,oldPassword="FirstPass1234",lastPassword="";
 const recorded:string[]=[];
 await page.route("**/3Dprojects/api/client-portal/**",async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname;
  recorded.push(path);
  const ok=(body:unknown,status=200)=>route.fulfill({
   status,contentType:"application/json",body:JSON.stringify(body)});
  if(path.endsWith("/login-meta"))return ok({projectName:"Satharai Sample Project",projectKind:"building_geo"});
  if(path.endsWith("/session"))return ok({authenticated:signedIn,
    user:signedIn?{displayName:"Client Owner",email:"",role:"client_admin",
      projectSlug:"demo-a",projectName:"Satharai Sample Project",projectKind:"building_geo",
      mustChangePassword,loginId:"+919876543210"}:null});
  if(path.endsWith("/login")){
   const b=request.postDataJSON();
   expect(b.projectSlug).toBe("demo-a");
   expect(b.loginId).toBe("+919876543210");
   if(b.password!==(mustChangePassword?oldPassword:lastPassword))
    return ok({error:"Invalid client login ID or password."},401);
   signedIn=true;
   return ok({ok:true,mustChangePassword});
  }
  if(path.endsWith("/change-password")){
   const b=request.postDataJSON();
   expect(b.oldPassword).toBe(oldPassword);
   lastPassword=b.newPassword;
   mustChangePassword=false;signedIn=false;
   return ok({ok:true,signInAgain:true});
  }
  if(path.endsWith("/projects/demo-a/overview"))
   return ok({project:{slug:"demo-a",name:"Satharai Sample Project",status:"published",
       kind:"building_geo"},role:"client_admin",
     permissions:{commercialRead:true,commercialPrepare:true,commercialApprove:true,
       dealsRead:false,dealsWrite:false}});
  if(path.endsWith("/projects/demo-a/commercial"))
   return ok({mappingReleaseId:"release-test",plotCount:2,
     rows:[{plotId:"1",status:"available",pricePaise:10000000,revision:1,
       publicApproved:false,evidenceRef:"Reviewed"},{plotId:"2",status:"booked",
       pricePaise:null,revision:1,publicApproved:false,evidenceRef:"Agreement"}]});
  if(path.endsWith("/projects/demo-a/contact"))
   return ok({revision:1,ownerApprovedPublic:false,fields:{
     contactName:"Builder",address:"Satharai",phonePrimary:"+919876543210",
     phoneSecondary:"",whatsapp:"",email:"",websiteUrl:"",mapsUrl:"",brochureUrl:""}});
  return ok({error:"Unexpected request"},404);
 });
 await page.goto(BASE+"/3Dprojects/demo-a/client-admin");
 await expect(page.getByRole("heading",{name:"Builder Admin",level:1})).toBeVisible();
 await expect(page.getByText("Satharai Sample Project")).toBeVisible();
 await expect(page.getByRole("img",{name:"Construction crane"})).toBeVisible();
 await expect(page.locator(".engine-client-admin-head")).toHaveCount(0);
 await expect(page.getByRole("link",{name:"Back to Project"})).toHaveAttribute("href","/3Dprojects/demo-a/geo");

 await expect(page.getByLabel("Mobile Number or Email ID")).toBeVisible();
 await page.getByLabel("Mobile Number or Email ID").fill("+919876543210");
 await page.getByLabel("Password",{exact:true}).fill("FirstPass1234");
 await page.getByRole("button",{name:"Sign in",exact:true}).click();
 await expect(page.getByRole("heading",{name:"Change Temporary Password"})).toBeVisible();
 expect(recorded.some(x=>x.endsWith("/commercial"))).toBe(false);
 await page.getByLabel("Current Temporary Password").fill("FirstPass1234");
 await page.getByLabel("New Password",{exact:true}).fill("ChangedPass789");
 await page.getByLabel("Confirm New Password").fill("ChangedPass789");
 await page.getByRole("button",{name:"Change password",exact:true}).click();
 await expect(page.getByRole("button",{name:"Sign in",exact:true})).toBeVisible();
 await expect(page.getByText(/Password changed successfully/)).toBeVisible();
 await page.getByLabel("Mobile Number or Email ID").fill("+919876543210");
 await page.getByLabel("Password",{exact:true}).fill("ChangedPass789");
 await page.getByRole("button",{name:"Sign in",exact:true}).click();
 await expect(page.getByRole("heading",{name:"Customer website"})).toBeVisible();
 await expect(page.locator(".engine-client-admin-head")).toHaveCount(0);
 await expect(page.locator(".engine-client-admin-page-heading")).toHaveCount(0);
 // On phones the desktop sidebar is replaced by one compact, accessible selector.
 const sections=page.getByRole("combobox",{name:"Choose Client Admin section"});
 await expect(sections).toBeVisible();
 await expect(sections.locator("option",{hasText:"Plots"})).toHaveCount(1);
 await expect(sections.locator("option",{hasText:"Contact"})).toHaveCount(1);
 await sections.selectOption("plots");
 await expect(page.getByRole("heading",{name:"Plot Management"})).toBeVisible();
 await sections.selectOption("overview");
 await expect(page.getByRole("heading",{name:"Customer website"})).toBeVisible();
 await expect(page.locator(".engine-client-admin-head")).toHaveCount(0);
 await expect(page.locator(".engine-client-admin-page-heading")).toHaveCount(0);
 const dims=await page.evaluate(()=>({width:document.documentElement.scrollWidth,
  screen:window.innerWidth}));
 expect(dims.width-dims.screen).toBeLessThanOrEqual(1);
});
test("Project Client Admin login is project-specific, not the Rekixo Owner panel",async({page})=>{
 await page.setViewportSize({width:320,height:660});
 await page.route("**/3Dprojects/api/client-portal/**",async route=>{
  const p=new URL(route.request().url()).pathname;
  return route.fulfill({status:200,contentType:"application/json",
    body:JSON.stringify(p.endsWith("/login-meta")?{projectName:"Demo B",projectKind:"masterplan_geo"}:
      {authenticated:false,user:null})});
 });
 await page.goto(BASE+"/3Dprojects/demo-b/client-admin");
 await expect(page.getByRole("heading",{name:"Builder Admin",level:1})).toBeVisible();
 await expect(page.getByText("Demo B")).toBeVisible();
 await expect(page.getByRole("link",{name:"Back to Project"})).toHaveAttribute("href","/3Dprojects/demo-b/masterplan");
 await expect(page.getByRole("button",{name:"Sign in",exact:true})).toBeVisible();
 await expect(page.getByText(/Rekixo Super Admin/)).toHaveCount(0);
 const width=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
 expect(width).toBeLessThanOrEqual(1);
});

test("Building-only Client Admin goes back to its building homepage",async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.route("**/3Dprojects/api/client-portal/**",route=>{
  const path=new URL(route.request().url()).pathname;
  return route.fulfill({status:200,contentType:"application/json",
   body:JSON.stringify(path.endsWith("/login-meta")
    ?{projectName:"Building Alpha",projectKind:"building"}
    :{authenticated:false,user:null})});
 });
 await page.goto(BASE+"/3Dprojects/building-alpha/client-admin");
 await expect(page.getByRole("heading",{name:"Builder Admin"})).toBeVisible();
 await expect(page.getByText("Building Alpha")).toBeVisible();
 await expect(page.getByRole("link",{name:"Back to Project"}))
  .toHaveAttribute("href","/3Dprojects/building-alpha");
});
