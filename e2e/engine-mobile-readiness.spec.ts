import {test,expect} from "@playwright/test";
test.use({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
test("Mobile client portal remains readable, touch-accessible and never exposes owner controls",async({page})=>{
 await page.route("**/3Dprojects/api/client-portal/session?project=demo-a",route=>
  route.fulfill({status:200,contentType:"application/json",
   body:JSON.stringify({authenticated:false,user:null})}));
 await page.goto("http://127.0.0.1:5174/3Dprojects/demo-a/client-admin");
 await expect(page.getByRole("heading",{name:"Project Client Admin",level:1})).toBeVisible();
 await expect(page.getByRole("heading",{name:"Project Client Admin",level:2})).toBeVisible();
 await expect(page.getByRole("button",{name:"Issue scoped invitation"})).toHaveCount(0);
 const geometry=await page.evaluate(()=>({
  viewport:window.innerWidth,document:document.documentElement.scrollWidth,
  heading:document.querySelector("h1")?.getBoundingClientRect().width||0
 }));
 expect(geometry.document).toBeLessThanOrEqual(geometry.viewport+8);
 expect(geometry.heading).toBeGreaterThan(120);
});
test("Mobile one-time invite form supports virtual keyboard and single-finger tap",async({page})=>{
 await page.route("**/3Dprojects/api/client-portal/session?project=demo-a",route=>
  route.fulfill({status:200,contentType:"application/json",
   body:JSON.stringify({authenticated:false,user:null})}));
 await page.goto("http://127.0.0.1:5174/3Dprojects/demo-a/client-admin#invite="+"b".repeat(64));
 const email=page.getByLabel("Invited email address");
 await expect(email).toBeVisible();
 await email.tap();
 await email.fill("client@example.test");
 await expect(page.getByRole("button",{name:"Activate project access"})).toBeEnabled();
 const rect=await email.boundingBox();
 expect(rect).not.toBeNull();
 expect(rect!.width).toBeGreaterThan(150);
 expect(rect!.x).toBeGreaterThanOrEqual(0);
 expect(rect!.x+rect!.width).toBeLessThanOrEqual(395);
});
