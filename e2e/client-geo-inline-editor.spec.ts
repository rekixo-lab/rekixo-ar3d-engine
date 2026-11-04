import {test,expect} from "@playwright/test";
const BASE="http://127.0.0.1:5184";
test("Client Geo plot editing appears immediately beneath its row across desktop, tablet and phones",async({page})=>{
 const commercial={mappingReleaseId:"map-inline-1",plotCount:3,
  rows:[{plotId:"1",status:"available",revision:1,pricePaise:10000000,
    publicApproved:false,evidenceRef:"Initial mapping"},
   {plotId:"2",status:"booked",revision:2,pricePaise:null,
    publicApproved:false,evidenceRef:"Booking evidence"},
   {plotId:"3",status:"sold",revision:3,pricePaise:null,
    publicApproved:true,evidenceRef:"Sale evidence"}]};
 let latestStatusWrite:{plotId:string;status:"available"|"booked"|"sold";publicApproved:boolean;evidenceRef:string}|null=null;
 const json=(route:import("@playwright/test").Route,body:unknown)=>
  route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
 await page.route("**/3Dprojects/api/client-portal/**",route=>{
  const pathname=new URL(route.request().url()).pathname;
  if(pathname.endsWith("/login-meta"))return json(route,{projectName:"Demo",projectKind:"building_geo"});
  if(pathname.endsWith("/session"))return json(route,{authenticated:true,user:{
   displayName:"Client",email:"",role:"client_admin",projectSlug:"demo-a",
   projectName:"Demo",projectKind:"building_geo",mustChangePassword:false}});
  if(pathname.endsWith("/overview"))return json(route,{project:{
   slug:"demo-a",name:"Demo",status:"published",kind:"building_geo"},role:"client_admin",
   permissions:{commercialRead:true,commercialPrepare:true,commercialApprove:true,
    dealsRead:false,dealsWrite:false}});
  if(pathname.endsWith("/commercial")){
   if(route.request().method()==="PUT"){
    const submitted=route.request().postDataJSON() as {
     plotId:string;status:"available"|"booked"|"sold";publicApproved:boolean;evidenceRef:string};
    latestStatusWrite=submitted;
    const row=commercial.rows.find(r=>r.plotId===submitted.plotId);
    if(!row)return route.fulfill({status:404,contentType:"application/json",body:'{"error":"Unknown plot"}'});
    Object.assign(row,{status:submitted.status,draftStatus:submitted.status,
     publicApproved:submitted.publicApproved,evidenceRef:submitted.evidenceRef,revision:row.revision+1,
     hasReview:true});
   }
   return json(route,commercial);
  }
  if(pathname.endsWith("/plot-details"))return json(route,{mappingReleaseId:"map-inline-1",rows:[
   {plotId:"1",ownerName:"",brokerName:"",bookingAmountPaise:null,notes:"",revision:1},
   {plotId:"2",ownerName:"Buyer Two",brokerName:"",bookingAmountPaise:350000,notes:"",revision:1}
  ]});
  if(pathname.endsWith("/contact"))return json(route,{revision:1,ownerApprovedPublic:false,
   fields:{contactName:"",address:"",phonePrimary:"",phoneSecondary:"",whatsapp:"",
    email:"",websiteUrl:"",mapsUrl:"",brochureUrl:""}});
  return json(route,{});
 });
 for(const [width,height] of [[1440,900],[900,800],[390,844],[320,640]]){
  await page.setViewportSize({width,height});
  await page.goto(BASE+"/3Dprojects/demo-a/client-admin");
  await expect(page.getByRole("heading",{name:"Customer website"})).toBeVisible();
  if(width<=850)await page.getByRole("combobox",{name:"Choose Client Admin section"}).selectOption("plots");
  else await page.getByRole("button",{name:/^Plots/}).click();
  await expect(page.getByRole("heading",{name:"Plot Management"})).toBeVisible();
  const entries=page.locator(".client-geo-list > .client-geo-entry");
  await expect(entries).toHaveCount(3);
  const first=entries.nth(0),second=entries.nth(1);
  const firstRow=first.locator("button.client-geo-table-row");
  await expect(firstRow).toHaveAttribute("aria-expanded","false");
  await expect(page.locator(".client-geo-editor--inline")).toHaveCount(0);
  await firstRow.click();
  await expect(firstRow).toHaveAttribute("aria-expanded","true");
  await expect(first.locator(".client-geo-editor--inline")).toBeVisible();
  await expect(first.getByRole("heading",{name:"Editing Plot 1"})).toBeVisible();
  await expect(first.getByLabel("Owner / Buyer Name")).toBeVisible();
  await expect(first.getByLabel("Plot status")).toHaveValue("available");
  await expect(page.locator(".client-geo-editor--inline")).toHaveCount(1);
  await second.locator("button.client-geo-table-row").click();
  await expect(first.locator(".client-geo-editor--inline")).toHaveCount(0);
  await expect(second.getByRole("heading",{name:"Editing Plot 2"})).toBeVisible();
  await expect(second.getByLabel("Owner / Buyer Name")).toHaveValue("Buyer Two");
  await second.locator("button.client-geo-table-row").click();
  await expect(page.locator(".client-geo-editor--inline")).toHaveCount(0);
  if(width===320){
   await firstRow.click();
   await first.getByLabel("Plot status").selectOption("sold");
   await first.getByLabel("Source / signed evidence reference").fill("Signed sale register 1");
   page.once("dialog",dialog=>void dialog.accept());
   await first.getByRole("button",{name:"Save & Publish Status"}).click();
   await expect(firstRow).toContainText("sold");
   await expect(first.locator(".engine-manage-ok")).toContainText("is now SOLD");
   expect(latestStatusWrite).toMatchObject({plotId:"1",status:"sold",publicApproved:true,
    evidenceRef:"Signed sale register 1"});
   // Re-reading the client-admin commercial endpoint must retain the status.
   await page.reload();
   await page.getByRole("combobox",{name:"Choose Client Admin section"}).selectOption("plots");
   await expect(page.locator(".client-geo-table-row").first()).toContainText("sold");
  }
  const dims=await page.evaluate(()=>{
   const list=document.querySelector(".client-geo-list");
   return {screen:innerWidth,page:document.documentElement.scrollWidth,
    list:list?.clientWidth||0,listScroll:list?.scrollWidth||0};
  });
  expect(dims.page).toBeLessThanOrEqual(dims.screen+1);
  expect(dims.listScroll).toBeLessThanOrEqual(dims.list+2);
 }
});
