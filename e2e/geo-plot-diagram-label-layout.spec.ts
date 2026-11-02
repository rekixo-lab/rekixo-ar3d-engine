import {test,expect} from "@playwright/test";
import {readFile} from "node:fs/promises";
import {publicGeoPlotDiagram} from "../shared/geo-plot-detail-diagram.js";

const drawerCss=await readFile(
  new URL("../apps/public/src/geo/geo-plot-details-drawer.css",import.meta.url),"utf8");

test("Plot 18 side labels stay in four balanced positions on narrow mobile layouts",async({page})=>{
  // Five edges with a very short/slanted Back edge reproduce the previously
  // right-shifted "Back" label. Test the production pure diagram and its CSS.
  const plot={
    id:"18",layout:"four" as const,
    corners:[[0,0],[18,0],[20,3],[20,50],[0,50]] as [number,number][],
    sides:{
      front:{edges:[3],length:21.67,unit:"ft"},
      back:{edges:[1],length:26.58,unit:"ft"},
      depthA:{edges:[2],length:48.25,unit:"ft"},
      depthB:{edges:[4,0],length:53.17,unit:"ft"},
    },
  };
  const diagram=publicGeoPlotDiagram(plot);
  expect(diagram).not.toBeNull();
  const sideNodes=diagram!.sides.map(side=>
    `<text data-side="`+side.role+`" x="`+side.labelX+`" y="`+side.labelY+`"
       text-anchor="middle" dominant-baseline="middle" class="geo-plot-drawer__side-label">
       <tspan x="`+side.labelX+`" dy="-0.45em">`+side.label+`</tspan>
       <tspan x="`+side.labelX+`" dy="1.3em" class="geo-plot-drawer__side-label-value">
         `+side.length.toFixed(2)+` `+side.unit+`</tspan>
     </text>`
  ).join("");
  for(const width of [360,393,430]){
    await page.setViewportSize({width,height:740});
    await page.setContent(`<!DOCTYPE html><html><head>
      <meta name="viewport" content="width=device-width,initial-scale=1"></head>
      <body style="margin:0;background:#071c27;color:white">
        <aside class="geo-plot-drawer is-open" data-plot-status="available"
          style="position:relative;transform:none;visibility:visible;width:calc(100% - 56px);height:600px">
          <div class="geo-plot-drawer__scroll">
            <section class="geo-plot-drawer__diagram-card">
              <div class="geo-plot-drawer__section-top">
                <span class="geo-plot-drawer__status geo-plot-drawer__status--available">Available</span>
              </div>
              <svg viewBox="0 0 320 210" class="geo-plot-drawer__svg">
                <polygon class="geo-plot-drawer__poly" points="`+
                diagram!.pointText+`"></polygon>`+sideNodes+`
              </svg>
            </section>
          </div>
        </aside>
      </body></html>`);
    await page.addStyleTag({content:drawerCss});
    const result=await page.evaluate(()=>{
      const svg=document.querySelector("svg")!;
      const bounds=(el:Element)=>{
        const r=el.getBoundingClientRect();
        return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,
          midX:(r.left+r.right)/2,midY:(r.top+r.bottom)/2};
      };
      const poly=bounds(svg.querySelector("polygon")!);
      const get=(role:string)=>bounds(svg.querySelector('[data-side="'+role+'"]')!);
      return {poly,front:get("front"),back:get("back"),
        depthA:get("depthA"),depthB:get("depthB"),
        statusCount:document.querySelectorAll(".geo-plot-drawer__status").length};
    });
    const label=width+"px";
    expect(result.statusCount,label+" one compact status badge").toBe(1);
    expect(result.back.bottom,label+" Back must be above shape").toBeLessThan(result.poly.top+4);
    expect(result.front.top,label+" Front must be below shape").toBeGreaterThan(result.poly.bottom-4);
    expect(result.depthB.right,label+" Depth B must be left of shape").toBeLessThan(result.poly.left+4);
    expect(result.depthA.left,label+" Depth A must be right of shape").toBeGreaterThan(result.poly.right-4);
    expect(Math.abs(result.back.midX-result.front.midX),
      label+" Front/Back must share one centerline").toBeLessThan(3);
    expect(Math.abs(result.depthA.midY-result.depthB.midY),
      label+" Depth A/B must share a centerline").toBeLessThan(3);
    const all=[result.front,result.back,result.depthA,result.depthB];
    for(let i=0;i<all.length;i++)for(let j=i+1;j<all.length;j++){
      const left=Math.max(all[i].left,all[j].left);
      const right=Math.min(all[i].right,all[j].right);
      const top=Math.max(all[i].top,all[j].top);
      const bottom=Math.min(all[i].bottom,all[j].bottom);
      expect(!(right-left>2&&bottom-top>2),
        label+" side measurement text must not overlap").toBe(true);
    }
  }
});
