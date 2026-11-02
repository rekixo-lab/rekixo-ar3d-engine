import {expect,test} from "@playwright/test";
import {readFile} from "node:fs/promises";

const rootCss=await readFile(new URL("../apps/public/src/styles.css",import.meta.url),"utf8");
const fullscreenCss=await readFile(new URL("../apps/public/src/geo/fullscreen-controls.css",import.meta.url),"utf8");
const geoCss=await readFile(new URL("../apps/public/src/geo/geo-public-demo.css",import.meta.url),"utf8");

test("Call, WhatsApp, Admin stay opposite long project title at phone, tablet and desktop sizes",async({page})=>{
  for(const viewport of [
    {width:320,height:640},{width:360,height:740},{width:393,height:852},
    {width:768,height:900},{width:1024,height:768},{width:1366,height:768}
  ]){
    await page.setViewportSize(viewport);
    await page.setContent(`<!doctype html><html><head>
      <meta name="viewport" content="width=device-width,initial-scale=1"></head>
      <body><main class="jio-public-shell">
        <header class="jio-public-header">
          <div class="jio-public-branding">
            <span class="jio-public-project-logo"></span><div>
              <h1>Long Satharai Masterplan Residential Development</h1>
              <p>Satharai, Thiruvallur, Tamil Nadu – 631203 and additional address details</p>
            </div>
          </div>
          <nav class="jio-public-header-actions" aria-label="Project quick actions">
            <a class="jio-public-header-action jio-public-header-action--call" href="tel:+919876543210" aria-label="Call project contact"><svg viewBox="0 0 24 24"><path d="M2 2L22 22"/></svg></a>
            <a class="jio-public-header-action jio-public-header-action--whatsapp" href="https://wa.me/919876543210" aria-label="Contact project team on WhatsApp"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg></a>
            <a class="jio-public-header-action jio-public-header-action--admin" href="/3Dprojects?project=satharai-50a45356" aria-label="Open project admin panel"><svg viewBox="0 0 24 24"><rect width="8" height="8"/></svg></a>
          </nav>
        </header>
        <div class="geo-public-map-layout">
          <div class="geo-integrated-scene"><div class="geo-integrated-map"></div></div>
          <div class="geo-public-toolbar-slot"><nav class="geo-camera-toolbar geo-camera-toolbar--normal-row">
            <button>Overview</button><button>Front</button><button>Corner</button><button>Aerial</button>
          </nav></div>
        </div>
      </main></body></html>`);
    await page.addStyleTag({content:rootCss});
    await page.addStyleTag({content:fullscreenCss});
    await page.addStyleTag({content:geoCss});
    const result=await page.evaluate(()=>{
      const rect=(node:Element)=>node.getBoundingClientRect();
      const header=rect(document.querySelector(".jio-public-header")!);
      const brand=rect(document.querySelector(".jio-public-branding")!);
      const actions=rect(document.querySelector(".jio-public-header-actions")!);
      const links=[...document.querySelectorAll(".jio-public-header-actions a")];
      const buttons=links.map(node=>rect(node));
      const title=document.querySelector(".jio-public-branding h1")!;
      const subtitle=document.querySelector(".jio-public-branding p")!;
      const map=rect(document.querySelector(".geo-integrated-scene")!);
      return {
        headerRight:header.right,brandRight:brand.right,actionsLeft:actions.left,
        actionsRight:actions.right,headerTop:header.top,headerBottom:header.bottom,
        buttons:buttons.map(b=>({width:b.width,height:b.height,top:b.top,right:b.right})),
        names:links.map(node=>node.getAttribute("aria-label")),
        labels:links.map(node=>node.textContent?.trim()),
        titleHeight:rect(title).height,subtitleHeight:rect(subtitle).height,
        titleOverflow:getComputedStyle(title).textOverflow,
        mapTop:map.top,mapHeight:map.height,
        overflow:document.documentElement.scrollWidth-window.innerWidth
      };
    });
    const label=`${viewport.width}x${viewport.height}`;
    expect(result.names,label+" button order").toEqual([
      "Call project contact","Contact project team on WhatsApp","Open project admin panel"
    ]);
    expect(result.labels,label+" no visible text").toEqual(["","",""]);
    expect(result.buttons.length).toBe(3);
    expect(result.buttons.every(b=>b.width>=43&&b.height>=43),label+" touch targets").toBe(true);
    expect(result.brandRight-result.actionsLeft,label+" branding must not overlap icons").toBeLessThanOrEqual(1);
    expect(result.actionsRight-result.headerRight,label+" group aligned to right edge").toBeLessThanOrEqual(1);
    expect(result.buttons[0].right).toBeLessThan(result.buttons[1].right);
    expect(result.buttons[1].right).toBeLessThan(result.buttons[2].right);
    expect(result.titleHeight).toBeGreaterThan(14);
    expect(result.subtitleHeight).toBeGreaterThan(9);
    expect(result.titleOverflow).toBe("ellipsis");
    expect(result.headerTop).toBeGreaterThanOrEqual(0);
    expect(result.mapTop).toBeGreaterThanOrEqual(result.headerBottom-1);
    expect(result.overflow,label+" no horizontal scroll").toBeLessThanOrEqual(1);
  }
});
