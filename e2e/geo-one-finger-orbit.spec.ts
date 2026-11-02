import {expect,test} from "@playwright/test";
import {readFile} from "node:fs/promises";

// Run the production orbit controller in Chromium without a Maps API key.
const controllerSource=await readFile(new URL("../shared/geo-touch-orbit.js",import.meta.url),"utf8");

test("mobile one-finger drag is orbit, real tap stays tappable, two fingers reach native map",async({page})=>{
  await page.setViewportSize({width:393,height:852});
  await page.setContent(`<!doctype html><html><head>
    <meta name="viewport" content="width=device-width,initial-scale=1"></head>
    <body><div id="geo" style="touch-action:none;width:100%;height:550px">
      <div id="tiles" style="width:100%;height:470px"></div>
      <button id="control">Zoom</button>
    </div></body></html>`);
  await page.addScriptTag({content:
    controllerSource.replaceAll("export function ","function ")+
    "\nwindow.__geoOrbitFactory=createGeoOneFingerOrbit;"});
  const outcome=await page.evaluate(async()=>{
    const scene=document.getElementById("geo")!;
    const tile=document.getElementById("tiles")!;
    const button=document.getElementById("control")!;
    let heading=90,redraws=0,nativeMoves=0,buttonClicks=0;
    const orbit=(window as typeof window & {__geoOrbitFactory:(args:unknown)=>any})
      .__geoOrbitFactory({
        getHeading:()=>heading,
        setHeading:(value:number)=>{heading=value;},
        onRotate:()=>{redraws++;},
        shouldIgnoreTarget:(target:EventTarget|null)=>Boolean((target as Element|null)?.closest?.("button")),
      });
    scene.addEventListener("touchstart",orbit.onTouchStart,true);
    scene.addEventListener("touchmove",orbit.onTouchMove,{capture:true,passive:false});
    scene.addEventListener("touchend",orbit.onTouchEnd,true);
    tile.addEventListener("touchmove",()=>{nativeMoves++;});
    button.addEventListener("click",()=>{buttonClicks++;});
    const finger=(identifier:number,x:number)=>({identifier,clientX:x,clientY:200});
    const dispatch=(type:string,touches:Array<ReturnType<typeof finger>>,target=tile)=>{
      const e=new Event(type,{bubbles:true,cancelable:true});
      Object.defineProperty(e,"touches",{value:touches});
      target.dispatchEvent(e);
      return e.defaultPrevented;
    };
    dispatch("touchstart",[finger(1,120)]);
    const noMovement=dispatch("touchmove",[finger(1,122)]);
    const rotated=dispatch("touchmove",[finger(1,180)]);
    // Heading is eased on requestAnimationFrame, not jumped per touch event.
    // Run enough real browser frames to settle without a Maps API dependency.
    await new Promise<void>(resolve=>{
      let frames=0;
      const advance=()=>{
        frames++;
        if(frames>=18)resolve();
        else requestAnimationFrame(advance);
      };
      requestAnimationFrame(advance);
    });
    const afterOrbit=heading;
    const suppressed=orbit.suppressClick();
    dispatch("touchend",[]);
    dispatch("touchstart",[finger(1,210)]);
    const tapAllowed=!orbit.suppressClick();
    dispatch("touchend",[]);
    dispatch("touchstart",[finger(1,190)]);
    dispatch("touchstart",[finger(1,190),finger(2,230)]);
    const pinchBlocked=dispatch("touchmove",[finger(1,182),finger(2,247)]);
    dispatch("touchend",[finger(1,182)]);
    const oneFingerAfterPinchBlocked=dispatch("touchmove",[finger(1,150)]);
    dispatch("touchend",[]);
    dispatch("touchstart",[finger(1,100)],button);
    dispatch("touchmove",[finger(1,155)],button);
    dispatch("touchend",[],button);
    button.click();
    return {noMovement,rotated,afterOrbit,redraws,suppressed,tapAllowed,
      pinchBlocked,oneFingerAfterPinchBlocked,nativeMoves,buttonClicks,heading};
  });
  expect(outcome.noMovement,"minor finger drift should not pan").toBe(true);
  expect(outcome.rotated,"one-finger swipe should be consumed by orbit").toBe(true);
  expect(outcome.afterOrbit).toBeCloseTo(90-60*.46,4);
  expect(outcome.redraws,"orbit should render over multiple smooth animation frames").toBeGreaterThan(1);
  expect(outcome.redraws,"one RAF camera write per frame").toBeLessThanOrEqual(20);
  expect(outcome.suppressed,"rotation must prevent synthetic plot clicks").toBe(true);
  expect(outcome.tapAllowed,"a subsequent genuine tap remains clickable").toBe(true);
  expect(outcome.pinchBlocked,"two-finger native gesture should not be prevented").toBe(false);
  expect(outcome.oneFingerAfterPinchBlocked,"remaining pinch finger is not captured").toBe(false);
  expect(outcome.nativeMoves,"Google's map layer receives two-finger moves").toBe(2);
  expect(outcome.buttonClicks,"camera/zoom buttons work as before").toBe(1);
  expect(outcome.heading).toBeCloseTo(outcome.afterOrbit,4);
});
