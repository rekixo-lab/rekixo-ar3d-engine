import {expect,test} from "@playwright/test";
import {readFile} from "node:fs/promises";

const rootCss=await readFile(new URL("../apps/public/src/styles.css",import.meta.url),"utf8");
const fullscreenCss=await readFile(new URL("../apps/public/src/geo/fullscreen-controls.css",import.meta.url),"utf8");
const geoCss=await readFile(new URL("../apps/public/src/geo/geo-public-demo.css",import.meta.url),"utf8");

async function mountHeader(page:import("@playwright/test").Page) {
  await page.setContent(`<!doctype html><html><head>
    <meta name="viewport" content="width=device-width,initial-scale=1"></head>
    <body><main class="jio-public-shell">
      <header class="jio-public-header">
        <div class="jio-public-branding">
          <span class="jio-public-project-logo"></span><div>
            <h1>Long Satharai Masterplan Residential Development</h1>
            <p class="geo-header-subtitle" title="Satharai, Thiruvallur, Tamil Nadu – 631203 and additional address details"><span class="geo-header-subtitle-text">Satharai, Thiruvallur, Tamil Nadu – 631203 and additional address details</span></p>
          </div>
        </div>
        <nav class="jio-public-header-actions" aria-label="Project quick actions">
          <a class="jio-public-header-action jio-public-header-action--call" href="tel:+919876543210" aria-label="Call project contact"><svg viewBox="0 0 24 24"><path d="M2 2L22 22"/></svg></a>
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
  // Match production's measured overflow / CSS-variable contract.
  await page.evaluate(()=>{
    const viewport=document.querySelector<HTMLElement>(".geo-header-subtitle")!;
    const text=document.querySelector<HTMLElement>(".geo-header-subtitle-text")!;
    const overflow=Math.max(0,Math.ceil(text.scrollWidth-viewport.clientWidth));
    viewport.classList.toggle("is-overflowing",overflow>1);
    viewport.style.setProperty("--geo-subtitle-shift",`-${overflow}px`);
    viewport.style.setProperty("--geo-subtitle-duration","12s");
  });
}

test("Only Call and Admin remain compact, aligned and clickable on phones, tablets, desktop",async({page})=>{
  for(const viewport of [
    {width:320,height:640},{width:360,height:740},{width:393,height:852},
    {width:768,height:900},{width:1024,height:768},{width:1366,height:768}
  ]){
    await page.setViewportSize(viewport);
    await mountHeader(page);
    const measured=await page.evaluate(()=>{
      const r=(e:Element)=>e.getBoundingClientRect();
      const header=r(document.querySelector(".jio-public-header")!);
      const brand=r(document.querySelector(".jio-public-branding")!);
      const actions=r(document.querySelector(".jio-public-header-actions")!);
      const links=[...document.querySelectorAll<HTMLAnchorElement>(".jio-public-header-actions a")];
      const subtitle=document.querySelector<HTMLElement>(".geo-header-subtitle")!;
      const map=r(document.querySelector(".geo-integrated-scene")!);
      return {
        headerRight:header.right,headerBottom:header.bottom,headerTop:header.top,
        brandRight:brand.right,actionsLeft:actions.left,actionsRight:actions.right,
        buttons:links.map(a=>({width:r(a).width,height:r(a).height,right:r(a).right,
          beforeInset:getComputedStyle(a,"::before").top})),
        names:links.map(a=>a.getAttribute("aria-label")),
        hrefs:links.map(a=>a.getAttribute("href")),
        labels:links.map(a=>a.textContent?.trim()),
        titleHeight:r(document.querySelector(".jio-public-branding h1")!).height,
        subtitleHeight:r(subtitle).height,
        subtitleText:subtitle.textContent,
        mapTop:map.top,
        overflow:document.documentElement.scrollWidth-innerWidth
      };
    });
    const label=`${viewport.width}x${viewport.height}`;
    expect(measured.names,label).toEqual(["Call project contact","Open project admin panel"]);
    expect(measured.hrefs).toEqual(["tel:+919876543210","/3Dprojects?project=satharai-50a45356"]);
    expect(measured.labels).toEqual(["",""]);
    expect(measured.buttons.every(b=>b.width===40&&b.height===40&&b.beforeInset==="3px"),
      label+" compact 34px face within 40px touch area").toBe(true);
    expect(measured.brandRight-measured.actionsLeft,label+" no branding overlap").toBeLessThanOrEqual(1);
    expect(measured.actionsRight-measured.headerRight,label+" header right alignment").toBeLessThanOrEqual(1);
    expect(measured.buttons[0].right).toBeLessThan(measured.buttons[1].right);
    expect(measured.titleHeight).toBeGreaterThan(14);
    expect(measured.subtitleHeight).toBeGreaterThan(9);
    expect(measured.subtitleText).toContain("631203 and additional address details");
    expect(measured.headerTop).toBeGreaterThanOrEqual(0);
    expect(measured.mapTop).toBeGreaterThanOrEqual(measured.headerBottom-1);
    expect(measured.overflow,label+" no horizontal scroll").toBeLessThanOrEqual(1);
  }
});

test("Mobile clipped subtitle scrolls all the way left then back; reduced motion permits manual scrolling",async({page})=>{
  await page.setViewportSize({width:320,height:640});
  await mountHeader(page);
  const result=await page.evaluate(()=>{
    const viewport=document.querySelector<HTMLElement>(".geo-header-subtitle")!;
    const text=document.querySelector<HTMLElement>(".geo-header-subtitle-text")!;
    const overflow=Math.max(0,text.scrollWidth-viewport.clientWidth);
    const animation=text.getAnimations()[0];
    if(!animation)return {overflow,exists:false,atEnd:0,atStart:0,remaining:0};
    animation.pause();
    animation.currentTime=0;
    const atStart=text.getBoundingClientRect().left;
    animation.currentTime=12_000*.57;
    const atEnd=text.getBoundingClientRect().left;
    const remaining=text.getBoundingClientRect().right-viewport.getBoundingClientRect().right;
    return {overflow,exists:true,atStart,atEnd,remaining};
  });
  expect(result.overflow).toBeGreaterThan(30);
  expect(result.exists).toBe(true);
  expect(result.atStart-result.atEnd).toBeGreaterThan(result.overflow-2);
  expect(Math.abs(result.remaining)).toBeLessThanOrEqual(2);
  await page.emulateMedia({reducedMotion:"reduce"});
  const reduced=await page.evaluate(()=>{
    const viewport=document.querySelector<HTMLElement>(".geo-header-subtitle")!;
    return {overflowX:getComputedStyle(viewport).overflowX,
      animations:viewport.querySelector(".geo-header-subtitle-text")!.getAnimations().length};
  });
  expect(reduced).toEqual({overflowX:"auto",animations:0});
});
