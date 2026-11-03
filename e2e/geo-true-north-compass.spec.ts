import {expect,test} from "@playwright/test";
import {readFile} from "node:fs/promises";

const compassHelper=await readFile(new URL("../shared/geo-map-compass.js",import.meta.url),"utf8");
const compassCss=await readFile(new URL("../apps/public/src/geo/geo-public-demo.css",import.meta.url),"utf8");
const drawerCss=await readFile(new URL("../apps/public/src/geo/geo-plot-details-drawer.css",import.meta.url),"utf8");

test("mobile true-north compass tracks every map heading and shares that heading with plot facing",async({page})=>{
  await page.setViewportSize({width:393,height:852});
  await page.setContent(`<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>${compassCss}\n${drawerCss}</style>
    <div id="scene" class="geo-integrated-scene" style="width:365px;height:590px;position:relative;--geo-map-north-rotation:0deg">
      <button id="map-compass" class="geo-map-compass" aria-label="Map compass. Tap to face north.">
        <svg class="geo-compass-rose" viewBox="0 0 72 72">
          <g id="map-dial" class="geo-compass-rose__dial">
            <path d="M36 21 42 38 36 35Z" class="geo-compass-rose__needle-north"/>
          </g>
        </svg>
        <span class="geo-map-compass__bearing">0°</span>
      </button>
      <aside id="drawer" class="geo-plot-drawer">
        <svg class="geo-compass-rose" viewBox="0 0 72 72">
          <g id="plot-dial" class="geo-compass-rose__dial">
            <circle class="geo-compass-rose__facing-mark" cx="68" cy="36" r="3.5"/>
          </g>
        </svg>
      </aside>
    </div></html>`);
  await page.addScriptTag({content:compassHelper.replace("export function ","function ") +
    "\nwindow.__geoMapNorthRotation=geoMapNorthRotation;"});

  const outcome=await page.evaluate(()=>{
    const scene=document.getElementById("scene")!;
    const compass=document.getElementById("map-compass")!;
    const drawer=document.getElementById("drawer")!;
    const mapDial=document.getElementById("map-dial")!;
    const plotDial=document.getElementById("plot-dial")!;
    const fn=(window as typeof window & {__geoMapNorthRotation:(x:number)=>number|null}).__geoMapNorthRotation;
    const rotation=(el:Element)=>{
      const matrix=new DOMMatrixReadOnly(getComputedStyle(el).transform);
      return (Math.atan2(matrix.b,matrix.a)*180/Math.PI+360)%360;
    };
    const bearings=[0,45,90,180,270,359,360,-90];
    const observed=bearings.map(heading=>{
      scene.style.setProperty("--geo-map-north-rotation",fn(heading)+"deg");
      return {heading,map:rotation(mapDial),plot:rotation(plotDial)};
    });
    const sceneRect=scene.getBoundingClientRect(),mapRect=compass.getBoundingClientRect();
    const before=getComputedStyle(compass).visibility;
    drawer.classList.add("is-open");
    const after=getComputedStyle(compass).visibility;
    return {observed,before,after,offsetX:mapRect.left-sceneRect.left,offsetY:mapRect.top-sceneRect.top};
  });
  for(const item of outcome.observed){
    const normalized=((item.heading%360)+360)%360;
    const expected=(360-normalized)%360;
    expect(item.map,"north needle must counterrotate relative to Google bearing").toBeCloseTo(expected,3);
    expect(item.plot,"plot-facing compass must use exactly the same world north").toBeCloseTo(expected,3);
  }
  expect(outcome.offsetX).toBeGreaterThan(0);
  expect(outcome.offsetX).toBeLessThan(22);
  expect(outcome.offsetY).toBeGreaterThan(0);
  expect(outcome.offsetY).toBeLessThan(22);
  expect(outcome.before).toBe("visible");
  expect(outcome.after,"plot details should hide the overlapping map compass").toBe("hidden");
});
