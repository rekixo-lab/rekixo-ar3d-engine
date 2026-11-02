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
  if(path.endsWith("/login-meta"))return ok({projectName:"Satharai Sample Project"});
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
 await expect(page.getByRole("heading",{name:"Satharai Sample Project"})).toBeVisible();
 await expect(page.getByText("AR3D STUDIO · CLIENT ADMIN")).toBeVisible();
 const login=page.getByRole("heading",{name:"Sign in",level:2});
 await expect(login).toBeVisible();
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
 await expect(page.getByRole("heading",{name:"Project overview"})).toBeVisible();
 await expect(page.getByRole("button",{name:"Plots",exact:true})).toBeVisible();
 await expect(page.getByRole("button",{name:"Contact",exact:true})).toBeVisible();
 const dims=await page.evaluate(()=>({width:document.documentElement.scrollWidth,
  screen:window.innerWidth}));
 expect(dims.width-dims.screen).toBeLessThanOrEqual(1);
});
test("Project Client Admin login is project-specific, not the Rekixo Owner panel",async({page})=>{
 await page.setViewportSize({width:320,height:660});
 await page.route("**/3Dprojects/api/client-portal/**",async route=>{
  const p=new URL(route.request().url()).pathname;
  return route.fulfill({status:200,contentType:"application/json",
    body:JSON.stringify(p.endsWith("/login-meta")?{projectName:"Demo B"}:
      {authenticated:false,user:null})});
 });
 await page.goto(BASE+"/3Dprojects/demo-b/client-admin");
 await expect(page.getByRole("heading",{name:"Demo B"})).toBeVisible();
 await expect(page.getByRole("button",{name:"Sign in",exact:true})).toBeVisible();
 await expect(page.getByText(/Rekixo Super Admin/)).toHaveCount(0);
 const width=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
 expect(width).toBeLessThanOrEqual(1);
});
