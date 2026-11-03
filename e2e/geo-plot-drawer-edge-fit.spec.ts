import {expect,test} from "@playwright/test";
import {readFile} from "node:fs/promises";

const rootCss=await readFile(new URL("../apps/public/src/styles.css",import.meta.url),"utf8");
const publicCss=await readFile(new URL("../apps/public/src/geo/geo-public-demo.css",import.meta.url),"utf8");
const drawerCss=await readFile(new URL("../apps/public/src/geo/geo-plot-details-drawer.css",import.meta.url),"utf8");
const fullscreenCss=await readFile(new URL("../apps/public/src/geo/fullscreen-controls.css",import.meta.url),"utf8");

test("plot details drawer ends above Google legal footer and outside map strip closes it",async({page})=>{
  for(const screen of [{width:360,height:640},{width:393,height:852},{width:430,height:932},{width:1100,height:850}]){
    await page.setViewportSize(screen);
    await page.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
      <body><main class="jio-public-shell">
      <header class="jio-public-header"><div class="jio-public-branding"><div>
        <h1>satharai</h1><p>Satharai, Thiruvallur, Tamil Nadu – 631203</p>
      </div></div></header>
      <div class="geo-public-map-layout">
        <div class="geo-integrated-scene">
          <div class="geo-integrated-map">
            <div class="gm-style" style="position:absolute;inset:0">
              <div class="satellite-tile" style="position:absolute;inset:0;background:#826d58"></div>
              <a href="https://www.google.com/maps/" style="position:absolute;bottom:3px;left:5px">Google</a>
              <div class="gm-style-cc" style="position:absolute;right:5px;bottom:3px">Imagery attribution</div>
            </div>
          </div>
          <nav class="geo-map-quick-actions"><button>−</button><button>+</button><button>⛶</button></nav>
          <section class="geo-plot-status"><button>STATUS</button></section>
          <button type="button" class="geo-plot-drawer__outside-dismiss"
            aria-label="Close plot details by tapping outside"></button>
          <aside class="geo-plot-drawer is-open" aria-label="Selected plot details">
            <div class="geo-plot-drawer__head"><div class="geo-plot-drawer__heading">
              <span class="geo-plot-drawer__eyebrow">PLOT DETAILS</span><h2>Plot 5</h2>
            </div><button class="geo-plot-drawer__close">×</button></div>
            <div class="geo-plot-drawer__scroll">Plot details</div>
          </aside>
        </div>
        <div class="geo-public-toolbar-slot"><nav class="geo-camera-toolbar geo-camera-toolbar--normal-row">
          <button>Overview</button><button>Front</button><button>Corner</button><button>Re-enter</button>
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
        outside:rect(".geo-plot-drawer__outside-dismiss"),
        outsideZ:Number(getComputedStyle(document.querySelector(".geo-plot-drawer__outside-dismiss")!).zIndex),
        header:rect(".jio-public-header"),
        dock:rect(".geo-public-toolbar-slot"),
        rightStrip:rect(".geo-integrated-scene").right-rect(".geo-plot-drawer").right,
        zoomZ:Number(getComputedStyle(document.querySelector(".geo-map-quick-actions")!).zIndex),
        panelZ:Number(getComputedStyle(document.querySelector(".geo-plot-drawer")!).zIndex),
        statusVisibility:getComputedStyle(document.querySelector(".geo-plot-status")!).visibility,
        mask:getComputedStyle(document.querySelector(".geo-plot-drawer")!).maskImage,
        scrollerOverflow:getComputedStyle(document.querySelector(".geo-plot-drawer__scroll")!).overflowY,
        creditRailBackground:getComputedStyle(document.querySelector(".gm-style")!,"::after").backgroundColor,
        logoZ:Number(getComputedStyle(document.querySelector('.gm-style a[href*="google.com/maps"]')!).zIndex),
        creditZ:Number(getComputedStyle(document.querySelector(".gm-style-cc")!).zIndex),
        headingPadding:getComputedStyle(document.querySelector(".geo-plot-drawer__head")!).paddingTop,
      };
    });
    const tag=screen.width+"×"+screen.height;
    expect(Math.abs(actual.panel.left-actual.map.left),tag+" left edge flush").toBeLessThan(2);
    expect(Math.abs(actual.panel.top-actual.map.top),tag+" top edge flush").toBeLessThan(2);
    expect(Math.abs(actual.map.bottom-actual.panel.bottom-30),tag+" clear 30px map attribution footer").toBeLessThan(2);
    expect(Math.abs(actual.outside.bottom-actual.panel.bottom),tag+" outside-tap ends at same credit footer").toBeLessThan(2);
    expect(Math.abs(actual.outside.right-actual.map.right),tag+" outside-tap covers the right map strip").toBeLessThan(2);
    if(screen.width<=640)
      expect(Math.abs(actual.rightStrip-55),tag+" right map strip unchanged").toBeLessThan(2);
    else expect(actual.rightStrip,tag+" responsive desktop right gap").toBeGreaterThanOrEqual(55);
    expect(actual.header.bottom,tag+" header outside drawer").toBeLessThanOrEqual(actual.map.top+1);
    if(screen.width<=640)
      expect(actual.dock.top,tag+" four normal camera controls below map").toBeGreaterThanOrEqual(actual.map.bottom-1);
    expect(actual.zoomZ,tag+" zoom buttons now behind drawer").toBeLessThan(actual.panelZ);
    expect(actual.outsideZ,tag+" outside-tap layer below panel").toBeLessThan(actual.panelZ);
    expect(actual.outsideZ,tag+" outside-tap layer above map controls").toBeGreaterThan(actual.zoomZ);
    expect(actual.statusVisibility,tag+" no status panel behind open drawer").toBe("hidden");
    expect(actual.mask,tag+" drawer no longer has see-through footer").toBe("none");
    expect(actual.scrollerOverflow,tag+" internal vertical scrolling").toBe("auto");
    expect(actual.creditRailBackground,tag+" bottom imagery covered by solid credit rail").toBe("rgb(7, 28, 39)");
    expect(actual.logoZ,tag+" Google's original logo remains above credit rail").toBe(101);
    expect(actual.creditZ,tag+" original copyright remains above credit rail").toBe(101);
    if(screen.width<=640)expect(actual.headingPadding,tag+" no extra 60px header gap").toBe("12px");

    await page.evaluate(()=>{
      (window as unknown as {__geoCloseTaps:number;__geoLegalTaps:number}).__geoCloseTaps=0;
      (window as unknown as {__geoCloseTaps:number;__geoLegalTaps:number}).__geoLegalTaps=0;
      const dismiss=document.querySelector(".geo-plot-drawer__outside-dismiss");
      // Mirror the React handler: only a NEW pointerdown dismisses the drawer.
      // Its mounting on plot pointerup must not make the same gesture's click
      // immediately close it. Keyboard activation still dispatches detail=0.
      dismiss?.addEventListener("pointerdown",event=>{
        if(!event.isPrimary||event.button!==0)return;
        event.preventDefault();
        event.stopPropagation();
        (window as unknown as {__geoCloseTaps:number}).__geoCloseTaps++;
      });
      dismiss?.addEventListener("click",event=>{
        if((event as MouseEvent).detail===0)
          (window as unknown as {__geoCloseTaps:number}).__geoCloseTaps++;
      });
      document.querySelector('.gm-style a[href*="google.com/maps"]')?.addEventListener("click",event=>{
        event.preventDefault();
        (window as unknown as {__geoLegalTaps:number}).__geoLegalTaps++;
      });
    });
    // Simulate the click delivered after the map pointerup opens the drawer.
    // It is not a new pointerdown and must leave the panel open.
    await page.evaluate(()=>{
      document.querySelector(".geo-plot-drawer__outside-dismiss")?.dispatchEvent(
        new MouseEvent("click",{bubbles:true,detail:1})
      );
    });
    expect(await page.evaluate(()=>(window as unknown as {__geoCloseTaps:number}).__geoCloseTaps),
      tag+" opening click must not dismiss plot").toBe(0);
    // A subsequent real tap in the right map strip must dismiss once.
    await page.locator(".geo-plot-drawer__outside-dismiss").click({
      position:{x:actual.outside.right-actual.outside.left-15,y:85},
    });
    expect(await page.evaluate(()=>(window as unknown as {__geoCloseTaps:number}).__geoCloseTaps),
      tag+" tapping the map beside drawer closes it").toBe(1);
    // Keyboard and accessibility activation should also be supported.
    await page.locator(".geo-plot-drawer__outside-dismiss").focus();
    await page.keyboard.press("Enter");
    expect(await page.evaluate(()=>(window as unknown as {__geoCloseTaps:number}).__geoCloseTaps),
      tag+" keyboard dismiss").toBe(2);
    await page.locator('.gm-style a[href*="google.com/maps"]').click();
    expect(await page.evaluate(()=>(window as unknown as {__geoLegalTaps:number}).__geoLegalTaps),
      tag+" Google logo remains clickable").toBe(1);
  }
});
