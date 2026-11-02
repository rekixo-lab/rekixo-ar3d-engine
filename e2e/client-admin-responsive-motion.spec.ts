import {test,expect} from "@playwright/test";
const BASE="http://127.0.0.1:5184";
async function stubLogin(page:import("@playwright/test").Page,projectName="Modern Client"){
 await page.route("**/3Dprojects/api/client-portal/**",route=>{
  const url=new URL(route.request().url());
  return route.fulfill({status:200,contentType:"application/json",
   body:JSON.stringify(url.pathname.endsWith("/login-meta")
    ?{projectName}
    :{authenticated:false,user:null})});
 });
}
test("Compact AR3D login centers at desktop, tablet and phone without overflow",async({page})=>{
 await stubLogin(page);
 for(const [width,height] of [[1366,768],[768,920],[390,844],[320,640]]){
  await page.setViewportSize({width,height});
  await page.goto(BASE+"/3Dprojects/demo-a/client-admin");
  await expect(page.getByRole("heading",{name:"Modern Client",level:1})).toBeVisible();
  await expect(page.getByRole("heading",{name:"Sign in",level:2})).toBeVisible();
  await expect(page.getByLabel("Mobile Number or Email ID")).toBeVisible();
  const dimensions=await page.evaluate(()=>{
   const root=document.querySelector(".engine-client-admin-auth");
   const card=document.querySelector(".engine-client-admin-signin")?.getBoundingClientRect();
   const header=document.querySelector(".engine-client-admin-head")?.getBoundingClientRect();
   const input=document.querySelector(".engine-client-admin-field")?.getBoundingClientRect();
   if(!root||!card||!header||!input)throw Error("Missing login elements");
   return {screen:innerWidth,scroll:document.documentElement.scrollWidth,
    card:{x:card.x,y:card.y,w:card.width,right:card.right},
    header:{x:header.x,w:header.width,right:header.right},
    input:{w:input.width,left:input.left,right:input.right},
    bodyHeight:document.documentElement.scrollHeight,viewportHeight:innerHeight};
  });
  expect(dimensions.scroll).toBeLessThanOrEqual(width+1);
  expect(dimensions.card.w).toBeLessThanOrEqual(390);
  expect(dimensions.card.x).toBeGreaterThanOrEqual(0);
  expect(dimensions.card.right).toBeLessThanOrEqual(width+1);
  expect(Math.abs(dimensions.card.x-(width-dimensions.card.w)/2)).toBeLessThanOrEqual(3);
  expect(dimensions.header.right).toBeLessThanOrEqual(width);
  expect(dimensions.input.w).toBeGreaterThan(190);
  expect(dimensions.input.left).toBeGreaterThanOrEqual(0);
  expect(dimensions.input.right).toBeLessThanOrEqual(width);
  if(height>=640)expect(dimensions.bodyHeight).toBeLessThanOrEqual(height+5);
 }
});
test("Password visibility toggle stays accessible and animates only when allowed",async({page})=>{
 await stubLogin(page);
 await page.setViewportSize({width:390,height:844});
 await page.goto(BASE+"/3Dprojects/demo-a/client-admin");
 const pwd=page.getByLabel("Password",{exact:true});
 await pwd.fill("OnlyForVisibility123");
 await expect(pwd).toHaveAttribute("type","password");
 await page.getByRole("button",{name:"Show password"}).click();
 await expect(pwd).toHaveAttribute("type","text");
 await expect(page.getByRole("button",{name:"Hide password"})).toHaveAttribute("aria-pressed","true");
 await page.getByRole("button",{name:"Hide password"}).click();
 await expect(pwd).toHaveAttribute("type","password");
 const anim=await page.locator(".engine-client-admin-mark i").first().evaluate(el=>getComputedStyle(el).animationName);
 expect(anim).toContain("client-auth-mark");
 await page.emulateMedia({reducedMotion:"reduce"});
 const reduced=await page.locator(".engine-client-admin-mark i").first().evaluate(el=>getComputedStyle(el).animationName);
 expect(reduced).toBe("none");
 const heading=await page.locator(".engine-client-admin-signin").evaluate(el=>getComputedStyle(el).animationName);
 expect(heading).toBe("none");
});
