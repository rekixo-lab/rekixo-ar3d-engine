import {expect,test} from "@playwright/test";
import {readFile} from "node:fs/promises";

const geoCss=await readFile(new URL("../apps/public/src/geo/geo-public-demo.css",import.meta.url),"utf8");

test("Geo status opens upward without background cards at mobile and desktop sizes",async({page})=>{
  for(const viewport of [{width:360,height:640},{width:393,height:852},{width:1200,height:800}]){
    await page.setViewportSize(viewport);
    await page.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
      <body><main class="geo-integrated-scene" style="position:relative;height:calc(100vh - 100px);background:#19303c">
      <div data-testid="attribution" style="position:absolute;bottom:2px;left:4px;width:94px;height:21px">Google</div>
      <section class="geo-plot-status" aria-label="Plot availability status">
        <div class="geo-plot-status-options" id="geo-plot-status-options" aria-hidden="true">
          <button class="geo-plot-status-option geo-plot-status-option--available"><span>Available</span><b>10</b></button>
          <button class="geo-plot-status-option geo-plot-status-option--booked"><span>Booked</span><b>7</b></button>
          <button class="geo-plot-status-option geo-plot-status-option--sold"><span>Sold</span><b>5</b></button>
          <div class="geo-plot-status-total"><span>Total Plots</span><b>36</b></div>
        </div>
        <button type="button" class="geo-plot-status-toggle" aria-controls="geo-plot-status-options" aria-expanded="false">
          <span>STATUS</span><span class="geo-plot-status-switch"><i></i></span>
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
      const a=document.querySelector('[data-testid="attribution"]').getBoundingClientRect();
      return {left:b.left-s.left,bottom:s.bottom-b.bottom,attributionGap:a.top-b.bottom,
        opacity:legend.opacity,visibility:legend.visibility};
    });
    // The scene has a 1px border at some device widths, which is part of
    // the positioned containing block, not extra Status spacing.
    expect(Math.abs(before.left-(viewport.width<=640?8:12))).toBeLessThanOrEqual(1);
    expect(Math.abs(before.bottom-(viewport.width<=640?29:34))).toBeLessThanOrEqual(1);
    expect(before.attributionGap).toBeGreaterThanOrEqual(4);
    expect(await page.locator(".geo-plot-status-pending").count()).toBe(0);
    expect(await page.locator(".geo-plot-status-toggle-state").count()).toBe(0);
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
    expect(after.booked).toBe("rgb(255, 194, 10)");
    expect(after.total).toContain("36");
    expect(after.total).not.toMatch(/pending/i);
  }
});
