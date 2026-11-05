import {test,expect} from "@playwright/test";
const BASE="http://127.0.0.1:5184";
type Status="available"|"booked"|"sold";
type Detail={plotId:string;ownerName:string;brokerName:string;
 bookingAmountPaise:number|null;soldAmountPaise:number|null;notes:string;revision:number};
test("Client Geo status-first one-form editing and publish feedback on desktop, tablet and phones",async({page})=>{
 const commercial={mappingReleaseId:"map-inline-1",plotCount:3,
  rows:[{plotId:"1",status:"available" as Status,revision:1,pricePaise:10000000,
    publicApproved:false,evidenceRef:"Initial mapping",hasReview:true},
   {plotId:"2",status:"booked" as Status,revision:2,pricePaise:null,
    publicApproved:false,evidenceRef:"Booking evidence",hasReview:true},
   {plotId:"3",status:"sold" as Status,revision:3,pricePaise:null,
    publicApproved:true,evidenceRef:"Sale evidence",hasReview:true}]};
 const details:Detail[]=[
  {plotId:"1",ownerName:"",brokerName:"",bookingAmountPaise:null,soldAmountPaise:null,notes:"",revision:1},
  {plotId:"2",ownerName:"Buyer Two",brokerName:"",bookingAmountPaise:350000,
   soldAmountPaise:null,notes:"Old private note retained",revision:1}
 ];
 let latestStatusWrite:{plotId:string;status:Status;amountPaise:number|null;operationId:string}|null=null;
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
  if(pathname.endsWith("/plot-publish")){
   const submitted=route.request().postDataJSON() as {
    plotId:string;status:Status;amountPaise:number|null;ownerName:string;
    brokerName:string;operationId:string;expectedDetailRevision:number;
    expectedCommercialRevision:number;expectedMappingReleaseId:string};
   latestStatusWrite=submitted;
   const row=commercial.rows.find(r=>r.plotId===submitted.plotId);
   const detail=details.find(r=>r.plotId===submitted.plotId);
   if(!row||!detail)return route.fulfill({status:404,contentType:"application/json",body:'{"error":"Unknown plot"}'});
   if(row.revision!==submitted.expectedCommercialRevision||
     detail.revision!==submitted.expectedDetailRevision)
    return route.fulfill({status:409,contentType:"application/json",body:'{"error":"Stale revision"}'});
   row.status=submitted.status;row.revision+=1;row.publicApproved=true;row.hasReview=true;
   row.evidenceRef="client-admin-operation:"+submitted.operationId;
   if(submitted.status!=="available"){
    detail.ownerName=submitted.ownerName;detail.brokerName=submitted.brokerName;
    if(submitted.status==="booked")detail.bookingAmountPaise=submitted.amountPaise;
    else detail.soldAmountPaise=submitted.amountPaise;
   }
   detail.revision+=1;
   return json(route,{ok:true,commercial,detail,confirmation:{
    plotId:submitted.plotId,status:submitted.status,published:true,
    mappingReleaseId:commercial.mappingReleaseId,operationId:submitted.operationId,
    commercialRevision:row.revision,detailRevision:detail.revision}});
  }
  if(pathname.endsWith("/commercial"))return json(route,commercial);
  if(pathname.endsWith("/plot-details"))return json(route,{mappingReleaseId:"map-inline-1",rows:details});
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
  await expect(first.getByRole("radio",{name:"Available"})).toBeChecked();
  await expect(first.getByText("Private Notes")).toHaveCount(0);
  await expect(first.getByText("Source / signed evidence reference")).toHaveCount(0);
  await expect(first.getByText("Booking Amount (₹)")).toHaveCount(0);
  await expect(first.getByText("Sold Amount (₹)")).toHaveCount(0);
  await expect(first.getByRole("button",{name:"Save & Publish Status"})).toBeDisabled();
  await second.locator("button.client-geo-table-row").click();
  await expect(first.locator(".client-geo-editor--inline")).toHaveCount(0);
  await expect(second.getByRole("heading",{name:"Editing Plot 2"})).toBeVisible();
  await expect(second.getByLabel("Owner / Buyer Name")).toHaveValue("Buyer Two");
  await expect(second.getByLabel("Booking Amount (₹)")).toHaveValue("3500");
  await expect(second.getByText("Sold Amount (₹)")).toHaveCount(0);
  await second.locator("button.client-geo-table-row").click();
  await expect(page.locator(".client-geo-editor--inline")).toHaveCount(0);
  if(width===390){
   await firstRow.click();
   await first.getByRole("radio",{name:"Booked"}).check();
   await expect(first.getByLabel("Booking Amount (₹)")).toBeVisible();
   await expect(first.getByText("Sold Amount (₹)")).toHaveCount(0);
   await first.getByLabel("Owner / Buyer Name").fill("Client One");
   await first.getByLabel("Broker Name").fill("Broker Test");
   await first.getByLabel("Booking Amount (₹)").fill("1750");
   await first.getByRole("button",{name:"Save & Publish Status"}).click();
   await expect(first.locator(".client-geo-publish-success")).toContainText("Successfully Booked");
   await expect(page.locator(".client-geo-toast")).toContainText("Plot 1 Booked");
   await expect(first.getByRole("button",{name:"✓ Published: BOOKED"})).toBeDisabled();
   await expect(firstRow).toContainText("Booked");
   expect(latestStatusWrite).toMatchObject({plotId:"1",status:"booked",amountPaise:175000});
  }
  if(width===320){
   await firstRow.click();
   await expect(first.getByRole("radio",{name:"Booked"})).toBeChecked();
   await first.getByRole("radio",{name:"Sold"}).check();
   await expect(first.getByLabel("Sold Amount (₹)")).toBeVisible();
   await expect(first.getByText("Booking Amount (₹)")).toHaveCount(0);
   await first.getByLabel("Sold Amount (₹)").fill("85000");
   await first.getByRole("button",{name:"Save & Publish Status"}).click();
   await expect(first.locator(".client-geo-publish-success")).toContainText("Successfully Sold");
   await expect(page.locator(".client-geo-toast")).toContainText("Plot 1 Sold");
   expect(latestStatusWrite).toMatchObject({plotId:"1",status:"sold",amountPaise:8500000});
   expect(details[0].bookingAmountPaise).toBe(175000);
   expect(details[0].soldAmountPaise).toBe(8500000);
   // Status and both independent amounts survive page reload.
   await page.reload();
   await page.getByRole("combobox",{name:"Choose Client Admin section"}).selectOption("plots");
   await page.locator(".client-geo-table-row").first().click();
   await expect(page.getByRole("radio",{name:"Sold"})).toBeChecked();
   await expect(page.getByLabel("Sold Amount (₹)")).toHaveValue("85000");
   await page.getByRole("radio",{name:"Available"}).check();
   await expect(page.getByText("Sold Amount (₹)")).toHaveCount(0);
   await page.getByRole("button",{name:"Save & Publish Status"}).click();
   await expect(page.locator(".client-geo-publish-success")).toContainText("Successfully Available");
   expect(details[0].soldAmountPaise).toBe(8500000);
   expect(details[0].bookingAmountPaise).toBe(175000);
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
