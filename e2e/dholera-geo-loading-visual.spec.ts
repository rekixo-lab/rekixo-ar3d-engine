import {test,expect} from "@playwright/test";
import {readFile} from "node:fs/promises";
const css=await readFile(new URL("../apps/public/src/geo/geo-public-demo.css",import.meta.url),"utf8");

test("Dholera GLB map hides native satellite zoom bounce until stable demo is ready",async({page})=>{
  for(const viewport of [{width:1280,height:800},{width:393,height:852}]){
    await page.setViewportSize(viewport);
    await page.setContent(`<div class="geo-integrated-scene" style="width:100%;height:500px">
      <div class="geo-integrated-map" style="background:linear-gradient(70deg,#1c3f42,#3a6459)"></div>
      <div class="geo-demo-preparing" role="status">Preparing 3D map view…</div>
    </div>`);
    await page.addStyleTag({content:css});
    const before=await page.evaluate(()=>{
      const x=document.querySelector(".geo-demo-preparing");
      const r=x?.getBoundingClientRect(),s=document.querySelector(".geo-integrated-scene")?.getBoundingClientRect();
      return {width:r?.width,height:r?.height,sceneWidth:s?.width,sceneHeight:s?.height,z:getComputedStyle(x!).zIndex};
    });
    expect(before.width).toBeGreaterThan(0);
    expect(before.height).toBeGreaterThanOrEqual(480);
    // The scene has a one-pixel border; the overlay fills its inner box.
    expect(Math.abs(before.width!-before.sceneWidth!)).toBeLessThanOrEqual(3);
    expect(Math.abs(before.height!-before.sceneHeight!)).toBeLessThanOrEqual(3);
    expect(Number(before.z)).toBeGreaterThan(0);
    await page.locator(".geo-demo-preparing").evaluate(el=>el.remove());
    await page.locator(".geo-integrated-scene").evaluate(el=>{
      el.insertAdjacentHTML("beforeend",'<div class="geo-demo-view-note">Concept demo · visual scale</div>');
    });
    await expect(page.locator(".geo-demo-view-note")).toBeVisible();
    const pointerEvents=await page.locator(".geo-demo-view-note").evaluate(el=>getComputedStyle(el).pointerEvents);
    expect(pointerEvents).toBe("none");
  }
});
