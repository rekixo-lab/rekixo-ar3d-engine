import {expect,test,type Page} from "@playwright/test";

const PUBLIC="http://127.0.0.1:5184";
const ADMIN="http://127.0.0.1:5173";

async function holdRequest(page:Page,url:string){
 let release=()=>{};
 const blocked=new Promise<void>(resolve=>{release=resolve;});
 await page.route(url,async route=>{
  await blocked;
  await route.abort("failed");
 });
 return release;
}

test("Geo initial loading shows AR 3D only, including error and mobile state",async({page})=>{
 await page.setViewportSize({width:390,height:844});
 const release=await holdRequest(page,"**/3Dprojects/api/projects/demo-a/geo-placement");
 try{
  await page.goto(PUBLIC+"/3Dprojects/demo-a/geo",{waitUntil:"domcontentloaded"});
  const splash=page.locator(".jio-public-state");
  await expect(splash.getByText("AR 3D",{exact:true})).toBeVisible();
  await expect(splash.getByRole("heading",{name:"Loading integrated 3D Geo…"})).toBeVisible();
  expect(await splash.innerText()).not.toMatch(/rekixo/i);
 }finally{release();}
});

test("Building initial loading keeps AR3D Studio, without Rekixo text",async({page})=>{
 await page.setViewportSize({width:1366,height:768});
 const release=await holdRequest(page,"**/3Dprojects/api/projects/demo-a");
 try{
  await page.goto(PUBLIC+"/3Dprojects/demo-a",{waitUntil:"domcontentloaded"});
  const splash=page.locator(".loading-page");
  await expect(splash.getByText("AR3D STUDIO",{exact:true})).toBeVisible();
  await expect(splash.getByRole("heading",{name:"Preparing 3D project"})).toBeVisible();
  expect(await splash.innerText()).not.toMatch(/rekixo/i);
 }finally{release();}
});

test("Client Admin startup and legacy Client Portal do not flash Rekixo branding",async({page})=>{
 await page.route("**/3Dprojects/api/client-portal/**",route=>{
  const path=new URL(route.request().url()).pathname;
  const body=path.endsWith("/login-meta")?
    {projectName:"Demo Client",projectKind:"building_geo"}:
    {authenticated:false,user:null};
  return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
 });
 await page.goto(PUBLIC+"/3Dprojects/demo-a/client-admin");
 await expect(page.getByRole("heading",{name:"Builder Admin",level:1})).toBeVisible();
 expect((await page.locator("body").innerText())).not.toMatch(/rekixo/i);
 await page.goto(ADMIN+"/3Dprojects/client-portal",{waitUntil:"domcontentloaded"});
 await expect(page).toHaveTitle("AR 3D Projects");
 expect((await page.locator("body").innerText())).not.toMatch(/rekixo/i);
});
