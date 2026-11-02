import {expect,test} from "@playwright/test";
import {readFile} from "node:fs/promises";
const rootCss=await readFile(new URL("../apps/public/src/styles.css",import.meta.url),"utf8");
const publicCss=await readFile(new URL("../apps/public/src/geo/geo-public-demo.css",import.meta.url),"utf8");
const fullscreenCss=await readFile(new URL("../apps/public/src/geo/fullscreen-controls.css",import.meta.url),"utf8");

test("independent close-up fills mobile map region while keeping project header, camera dock, zoom and mode switch",async({page})=>{
  for(const screen of [{width:360,height:740},{width:393,height:852},{width:430,height:915}]){
    await page.setViewportSize(screen);
    await page.setContent(`<!doctype html><html><head>
      <meta name="viewport" content="width=device-width,initial-scale=1"></head><body>
      <main class="jio-public-shell">
        <header class="jio-public-header"><div class="jio-public-branding"><div>
          <h1>satharai</h1><p>Satharai, Thiruvallur, Tamil Nadu</p>
        </div></div></header>
        <div class="geo-public-map-layout">
          <div class="geo-integrated-scene">
            <div class="geo-integrated-map" hidden>Google satellite map</div>
            <div class="geo-model-inspector" aria-label="Independent 3D close-up mode">
              <canvas class="geo-closeup-canvas"></canvas>
              <div class="geo-closeup-guide">1 finger: rotate · 2 fingers: move / zoom</div>
            </div>
            <nav class="geo-view-mode-actions">
              <button type="button" aria-pressed="true">Geo Map</button>
            </nav>
            <nav class="geo-map-quick-actions">
              <button type="button">−</button><button type="button">+</button>
              <button type="button">⛶</button>
            </nav>
          </div>
          <div class="geo-public-toolbar-slot"><nav class="geo-camera-toolbar geo-camera-toolbar--normal-row">
            <button>Overview</button><button>Front</button><button>Corner</button><button>Aerial</button>
          </nav></div>
        </div>
      </main></body></html>`);
    await page.addStyleTag({content:rootCss});
    await page.addStyleTag({content:fullscreenCss});
    await page.addStyleTag({content:publicCss});
    const result=await page.evaluate(()=>{
      const rect=(selector:string)=>{
        const r=document.querySelector(selector)!.getBoundingClientRect();
        return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};
      };
      return{
        header:rect(".jio-public-header"),
        scene:rect(".geo-integrated-scene"),
        closeup:rect(".geo-model-inspector"),
        mode:rect(".geo-view-mode-actions"),
        actions:rect(".geo-map-quick-actions"),
        cameraDock:rect(".geo-public-toolbar-slot"),
        canvas:rect(".geo-closeup-canvas"),
        originalMapDisplay:getComputedStyle(document.querySelector(".geo-integrated-map")!).display,
        cameraCount:document.querySelectorAll(".geo-camera-toolbar button").length,
        modeText:document.querySelector(".geo-view-mode-actions button")!.textContent?.trim(),
      };
    });
    const tag=screen.width+"px";
    expect(result.originalMapDisplay,tag+" no simultaneous Google render").toBe("none");
    expect(Math.abs(result.closeup.left-result.scene.left),tag+" closeup left flush").toBeLessThan(2);
    expect(Math.abs(result.closeup.top-result.scene.top),tag+" closeup top flush").toBeLessThan(2);
    expect(Math.abs(result.closeup.width-result.scene.width),tag+" closeup width").toBeLessThan(2);
    expect(Math.abs(result.closeup.height-result.scene.height),tag+" closeup height").toBeLessThan(2);
    expect(result.canvas.width,tag+" full-size 3D canvas").toBeGreaterThan(200);
    expect(result.mode.left,tag+" accessible mode button").toBeGreaterThanOrEqual(result.scene.left);
    expect(result.mode.right,tag+" mode does not overlap right zoom").toBeLessThan(result.actions.left);
    expect(result.cameraDock.top,tag+" camera dock below 3D").toBeGreaterThanOrEqual(result.scene.bottom-1);
    expect(result.cameraCount,tag+" original four camera views").toBe(4);
    expect(result.modeText).toBe("Geo Map");
  }
});
