import {expect,test} from "@playwright/test";
import {readFile} from "node:fs/promises";

const rootCss=await readFile(new URL("../apps/public/src/styles.css",import.meta.url),"utf8");
const publicCss=await readFile(new URL("../apps/public/src/geo/geo-public-demo.css",import.meta.url),"utf8");
const drawerCss=await readFile(new URL("../apps/public/src/geo/geo-plot-details-drawer.css",import.meta.url),"utf8");
const fullscreenCss=await readFile(new URL("../apps/public/src/geo/fullscreen-controls.css",import.meta.url),"utf8");

test("plot details drawer flushes to map edges while preserving title, right strip and camera controls",async({page})=>{
  for(const screen of [{width:360,height:640},{width:393,height:852},{width:430,height:932},{width:1100,height:850}]){
    await page.setViewportSize(screen);
    await page.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
      <body><main class="jio-public-shell">
      <header class="jio-public-header"><div class="jio-public-branding"><div>
        <h1>satharai</h1><p>Satharai, Thiruvallur, Tamil Nadu – 631203</p>
      </div></div></header>
      <div class="geo-public-map-layout">
        <div class="geo-integrated-scene">
          <div class="geo-integrated-map"></div>
          <nav class="geo-map-quick-actions"><button>−</button><button>+</button><button>⛶</button></nav>
          <section class="geo-plot-status"><button>STATUS</button></section>
          <aside class="geo-plot-drawer is-open" aria-label="Selected plot details">
            <div class="geo-plot-drawer__head"><div class="geo-plot-drawer__heading">
              <span class="geo-plot-drawer__eyebrow">PLOT DETAILS</span><h2>Plot 5</h2>
            </div><button class="geo-plot-drawer__close">×</button></div>
            <div class="geo-plot-drawer__scroll">Plot details</div>
          </aside>
        </div>
        <div class="geo-public-toolbar-slot"><nav class="geo-camera-toolbar geo-camera-toolbar--normal-row">
          <button>Overview</button><button>Front</button><button>Corner</button><button>Aerial</button>
        </nav></div>
      </div></main></body></html>`);
    await page.addStyleTag({content:rootCss});
    await page.addStyleTag({content:fullscreenCss});
    await page.addStyleTag({content:publicCss});
    await page.addStyleTag({content:drawerCss});
    const actual=await page.evaluate(()=>{
      const rect=(selector:string)=>{
        const r=document.querySelector(selector)!.getBoundingClientRect();
        return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};
      };
      return{
        map:rect(".geo-integrated-scene"),
        panel:rect(".geo-plot-drawer"),
        header:rect(".jio-public-header"),
        dock:rect(".geo-public-toolbar-slot"),
        rightStrip:rect(".geo-integrated-scene").right-rect(".geo-plot-drawer").right,
        zoomZ:Number(getComputedStyle(document.querySelector(".geo-map-quick-actions")!).zIndex),
        panelZ:Number(getComputedStyle(document.querySelector(".geo-plot-drawer")!).zIndex),
        statusVisibility:getComputedStyle(document.querySelector(".geo-plot-status")!).visibility,
        mask:getComputedStyle(document.querySelector(".geo-plot-drawer")!).maskImage,
        scrollerOverflow:getComputedStyle(document.querySelector(".geo-plot-drawer__scroll")!).overflowY,
      };
    });
    const tag=screen.width+"×"+screen.height;
    expect(Math.abs(actual.panel.left-actual.map.left),tag+" left edge flush").toBeLessThan(1);
    expect(Math.abs(actual.panel.top-actual.map.top),tag+" top edge flush").toBeLessThan(1);
    expect(Math.abs(actual.panel.bottom-actual.map.bottom),tag+" bottom edge flush").toBeLessThan(1);
    if(screen.width<=640)
      expect(Math.abs(actual.rightStrip-55),tag+" right map strip unchanged").toBeLessThan(2);
    else expect(actual.rightStrip,tag+" responsive desktop right gap").toBeGreaterThanOrEqual(55);
    expect(actual.header.bottom,tag+" header outside drawer").toBeLessThanOrEqual(actual.map.top+1);
    if(screen.width<=640)
      expect(actual.dock.top,tag+" four normal camera controls below map").toBeGreaterThanOrEqual(actual.map.bottom-1);
    expect(actual.zoomZ,tag+" zoom buttons above drawer").toBeGreaterThan(actual.panelZ);
    expect(actual.statusVisibility,tag+" no status panel behind open drawer").toBe("hidden");
    expect(actual.mask,tag+" attribution cutout retained").toContain("30px");
    expect(actual.scrollerOverflow,tag+" internal vertical scrolling").toBe("auto");
  }
});
