import {expect,test} from "@playwright/test";
import {readFile} from "node:fs/promises";

const rootStyles=await readFile(new URL("../apps/public/src/styles.css",import.meta.url),"utf8");
const geoStyles=await readFile(new URL("../apps/public/src/geo/geo-public-demo.css",import.meta.url),"utf8");
const fullscreenStyles=await readFile(new URL("../apps/public/src/geo/fullscreen-controls.css",import.meta.url),"utf8");

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
          <button class="is-active">Overview</button><button>Front</button><button>Corner</button>
          <button>Aerial</button>
        </nav></div>
      </div></main></body></html>`);
    await page.addStyleTag({content:rootStyles});
    // Same order as the customer website: legacy fullscreen CSS in the
    // document head, then the Geo component's imported styles.
    await page.addStyleTag({content:fullscreenStyles});
    await page.addStyleTag({content:geoStyles});
    // The fixture injects CSS after the buttons enter the DOM. Let their
    // transition from native browser button colors settle before measuring.
    await page.waitForTimeout(220);

    const measured=await page.evaluate(()=>{
      const rect=(selector:string)=>{
        const r=document.querySelector(selector)!.getBoundingClientRect();
        return {top:r.top,bottom:r.bottom,height:r.height};
      };
      return {
        header:rect(".jio-public-header"),
        title:rect(".jio-public-header h1"),
        subtitle:rect(".jio-public-header p"),
        titleText:document.querySelector(".jio-public-header h1")?.textContent?.trim(),
        subtitleText:document.querySelector(".jio-public-header p")?.textContent?.trim(),
        headerDisplay:getComputedStyle(document.querySelector(".jio-public-header")!).display,
        headerVisibility:getComputedStyle(document.querySelector(".jio-public-header")!).visibility,
        shellPosition:getComputedStyle(document.querySelector(".jio-public-shell")!).position,
        scene:rect(".geo-integrated-scene"),
        dock:rect(".geo-public-toolbar-slot"),
        viewportHeight:window.innerHeight,
        documentHeight:document.documentElement.scrollHeight,
        shellHeight:rect(".jio-public-shell").height,
        dockPosition:getComputedStyle(document.querySelector(".geo-public-toolbar-slot")!).position,
        cameraButtons:[...document.querySelectorAll(".geo-camera-toolbar--normal-row button")].map(node=>node.textContent?.trim()),
        dockBackground:getComputedStyle(document.querySelector(".geo-public-toolbar-slot")!).backgroundColor,
        dockBorder:getComputedStyle(document.querySelector(".geo-public-toolbar-slot")!).borderTopWidth,
        buttons:[...document.querySelectorAll(".geo-camera-toolbar--normal-row button")].map(node=>({
          radius:getComputedStyle(node).borderRadius,
          background:getComputedStyle(node).backgroundColor,
          border:getComputedStyle(node).borderTopWidth,
          width:node.getBoundingClientRect().width
        }))
      };
    });
    const label=`${viewport.width}x${viewport.height}`;
    expect(measured.cameraButtons,label+" only four camera buttons").toEqual(["Overview","Front","Corner","Aerial"]);
    expect(measured.dockBackground,label+" dock panel is transparent").toBe("rgba(0, 0, 0, 0)");
    expect(measured.dockBorder,label+" dock panel border removed").toBe("0px");
    expect(measured.buttons.every(button=>button.radius==="10px"),label+" stable rounded corners").toBeTruthy();
    expect(measured.buttons.every(button=>button.border==="1px"),label+" independent button borders").toBeTruthy();
    expect(measured.buttons[0].background,label+" active button has own green fill")
      .not.toBe(measured.buttons[1].background);
    expect(Math.max(...measured.buttons.map(button=>button.width))-
      Math.min(...measured.buttons.map(button=>button.width)),label+" four equal widths").toBeLessThan(2);
    expect(measured.titleText,label+" title restored").toBe("satharai");
    expect(measured.subtitleText,label+" subtitle restored").toContain("Thiruvallur");
    expect(measured.headerDisplay,label+" mobile title row is not legacy fullscreen grid").toBe("flex");
    expect(measured.headerVisibility,label+" header visible").toBe("visible");
    expect(measured.shellPosition,label+" shell spans the browser viewport").toBe("fixed");
    expect(measured.title.height,label+" title has visible height").toBeGreaterThan(15);
    expect(measured.subtitle.height,label+" subtitle has visible height").toBeGreaterThan(10);
    expect(measured.title.top,label+" heading not clipped above viewport").toBeGreaterThanOrEqual(0);
    expect(measured.subtitle.bottom,label+" subtitle not covered by the map").toBeLessThanOrEqual(measured.scene.top);
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
  await page.addStyleTag({content:fullscreenStyles});
  await page.addStyleTag({content:geoStyles});
  const result=await page.evaluate(()=>({
    dockPosition:getComputedStyle(document.querySelector(".geo-public-toolbar-slot")!).position,
    shellDisplay:getComputedStyle(document.querySelector(".jio-public-shell")!).display
  }));
  expect(result.dockPosition).toBe("fixed");
  expect(result.shellDisplay).not.toBe("flex");
});
