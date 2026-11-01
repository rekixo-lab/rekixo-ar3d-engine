import {expect,test} from "@playwright/test";
import {readFile} from "node:fs/promises";

const rootStyles=await readFile(new URL("../apps/public/src/styles.css",import.meta.url),"utf8");
const geoStyles=await readFile(new URL("../apps/public/src/geo/geo-public-demo.css",import.meta.url),"utf8");

test("mobile Geo map reaches camera dock on short and tall phones",async({page})=>{
  for(const viewport of [
    {width:360,height:640},
    {width:393,height:852},
    {width:430,height:932}
  ]){
    await page.setViewportSize(viewport);
    await page.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
      <body><main class="jio-public-shell">
      <header class="jio-public-header"><div class="jio-public-branding"><div>
        <h1>satharai</h1><p>Satharai, Thiruvallur, Tamil Nadu – 631203</p>
      </div></div></header>
      <div class="geo-public-map-layout">
        <div class="geo-integrated-scene"><div class="geo-integrated-map"></div></div>
        <div class="geo-public-toolbar-slot"><nav class="geo-camera-toolbar geo-camera-toolbar--normal-row">
          <button>Overview</button><button>Front</button><button>Corner</button>
          <button>Entry view</button><button>Aerial</button>
          <a class="geo-building-link" href="#">Building ↗</a>
        </nav></div>
      </div></main></body></html>`);
    await page.addStyleTag({content:rootStyles});
    await page.addStyleTag({content:geoStyles});

    const measured=await page.evaluate(()=>{
      const rect=(selector:string)=>{
        const r=document.querySelector(selector)!.getBoundingClientRect();
        return {top:r.top,bottom:r.bottom,height:r.height};
      };
      return {
        header:rect(".jio-public-header"),
        scene:rect(".geo-integrated-scene"),
        dock:rect(".geo-public-toolbar-slot"),
        viewportHeight:window.innerHeight,
        documentHeight:document.documentElement.scrollHeight,
        shellHeight:rect(".jio-public-shell").height,
        dockPosition:getComputedStyle(document.querySelector(".geo-public-toolbar-slot")!).position
      };
    });
    const label=`${viewport.width}x${viewport.height}`;
    expect(measured.dock.top-measured.scene.bottom,label+" no gap above dock").toBeGreaterThanOrEqual(-1);
    expect(measured.dock.top-measured.scene.bottom,label+" no gap above dock").toBeLessThan(2);
    expect(Math.abs(measured.viewportHeight-measured.dock.bottom),label+" dock meets viewport bottom").toBeLessThan(2);
    expect(measured.scene.top-measured.header.bottom,label+" header sits just above map").toBeLessThan(9);
    expect(measured.scene.height,label+" fills most available viewport").toBeGreaterThan(viewport.height*.48);
    expect(measured.documentHeight-measured.viewportHeight,label+" no vertical overflow").toBeLessThan(2);
    expect(measured.dockPosition,label+" dock participates in layout").toBe("relative");
  }
});

test("desktop Geo keeps existing dock and site sizing rules",async({page})=>{
  await page.setViewportSize({width:1200,height:800});
  await page.setContent(`<main class="jio-public-shell">
    <header class="jio-public-header"><h1>Project</h1></header>
    <div class="geo-public-map-layout">
      <div class="geo-integrated-scene"></div>
      <div class="geo-public-toolbar-slot"><nav class="geo-camera-toolbar geo-camera-toolbar--normal-row">Overview</nav></div>
    </div></main>`);
  await page.addStyleTag({content:rootStyles});
  await page.addStyleTag({content:geoStyles});
  const result=await page.evaluate(()=>({
    dockPosition:getComputedStyle(document.querySelector(".geo-public-toolbar-slot")!).position,
    shellDisplay:getComputedStyle(document.querySelector(".jio-public-shell")!).display
  }));
  expect(result.dockPosition).toBe("fixed");
  expect(result.shellDisplay).not.toBe("flex");
});
