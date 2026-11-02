import {expect,test} from "@playwright/test";
import {readFile} from "node:fs/promises";

const geoCss=await readFile(new URL("../apps/public/src/geo/geo-public-demo.css",import.meta.url),"utf8");

test("Geo status opens upward without background cards at mobile and desktop sizes",async({page})=>{
  for(const viewport of [{width:360,height:640},{width:393,height:852},{width:1200,height:800}]){
    await page.setViewportSize(viewport);
    await page.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
      <body><main style="position:relative;height:calc(100vh - 100px);background:#19303c">
      <section class="geo-plot-status" aria-label="Plot availability status">
        <div class="geo-plot-status-options" id="geo-plot-status-options" aria-hidden="true">
          <button class="geo-plot-status-option geo-plot-status-option--available"><span>Available</span><b>10</b></button>
          <button class="geo-plot-status-option geo-plot-status-option--booked"><span>Booked</span><b>7</b></button>
          <button class="geo-plot-status-option geo-plot-status-option--sold"><span>Sold</span><b>5</b></button>
          <div class="geo-plot-status-total"><span>Total Plots</span><b>36</b></div>
          <small class="geo-plot-status-pending">14 statuses pending verification</small>
        </div>
        <button type="button" class="geo-plot-status-toggle" aria-controls="geo-plot-status-options" aria-expanded="false">
          <span>STATUS</span><span>OFF</span><span class="geo-plot-status-switch"><i></i></span>
        </button>
      </section></main></body></html>`);
    await page.addStyleTag({content:geoCss});
    // Styles are injected after markup in this fixture: wait for the initial
    // visibility transition from the unstyled DOM before checking OFF state.
    await expect(page.locator(".geo-plot-status-options")).toBeHidden();
    const before=await page.evaluate(()=>{
      const s=document.querySelector("main").getBoundingClientRect();
      const b=document.querySelector(".geo-plot-status-toggle").getBoundingClientRect();
      const legend=getComputedStyle(document.querySelector(".geo-plot-status-options"));
      return {left:b.left-s.left,bottom:s.bottom-b.bottom,opacity:legend.opacity,visibility:legend.visibility};
    });
    expect(before.left).toBe(viewport.width<=640?8:12);
    expect(Math.abs(before.bottom-(viewport.width<=640?52:58))).toBeLessThan(1);
    expect(before.visibility).toBe("hidden");
    await page.locator(".geo-plot-status").evaluate(el=>el.classList.add("is-open"));
    await page.waitForTimeout(480);
    const after=await page.evaluate(()=>{
      const toggle=document.querySelector(".geo-plot-status-toggle").getBoundingClientRect();
      const list=document.querySelector(".geo-plot-status-options").getBoundingClientRect();
      const rows=[...document.querySelectorAll(".geo-plot-status-option")].map(node=>({
        background:getComputedStyle(node).backgroundColor,
        visible:getComputedStyle(node).visibility
      }));
      const booked=getComputedStyle(document.querySelector(".geo-plot-status-option--booked")).color;
      return {gap:toggle.top-list.bottom,opacity:getComputedStyle(document.querySelector(".geo-plot-status-options")).opacity,
        rows,booked,total:document.querySelector(".geo-plot-status-total")?.textContent?.trim()};
    });
    expect(after.gap).toBeGreaterThan(5);
    expect(after.gap).toBeLessThan(10);
    expect(Number(after.opacity)).toBeGreaterThan(.95);
    expect(after.rows.every(r=>r.background==="rgba(0, 0, 0, 0)"&&r.visible==="visible")).toBeTruthy();
    expect(after.booked).toBe("rgb(255, 211, 91)");
    expect(after.total).toContain("36");
  }
});
