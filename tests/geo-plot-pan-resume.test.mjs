import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {geoPlotToolResumeAction,geoPlotPausedDrawingLabel} from "../shared/geo-plot-tool-resume.js";
const args=(n=1,overrides={})=>({
  plot:{id:"1",corners:Array.from({length:n},(_,i)=>[i,i+1])},
  originalId:null,shape:"four",requestedShape:"four",...overrides
});
test("Platform parity: Pan then same four-corner tool resumes existing corner 2 and 3",()=>{
  for(const n of [1,2,3]){
    assert.equal(geoPlotToolResumeAction(args(n)),"resume");
    const paused=geoPlotPausedDrawingLabel({...args(n),mode:"pan"});
    assert.equal(paused.nextCorner,n+1);
    assert.match(paused.text,new RegExp("Plot 1 paused.*"+n+"/4.*corner "+(n+1)));
  }
});
test("a completed four-corner boundary opens Edit without erasing existing corners",()=>{
  assert.equal(geoPlotToolResumeAction(args(4)),"edit");
  assert.equal(geoPlotPausedDrawingLabel({...args(4),mode:"pan"}),null);
});
test("irregular outline can resume after 1, 3, 6 and 79 corners",()=>{
  for(const n of [1,3,6,79]){
    const a=args(n,{shape:"irregular",requestedShape:"irregular"});
    assert.equal(geoPlotToolResumeAction(a),"resume");
    assert.equal(geoPlotPausedDrawingLabel({...a,mode:"pan"}).nextCorner,n+1);
  }
  assert.equal(geoPlotToolResumeAction(args(80,{shape:"irregular",requestedShape:"irregular"})),"edit");
});
test("different shape and editing a saved mapping never silently resume stale new-plot state",()=>{
  assert.equal(geoPlotToolResumeAction(args(2,{requestedShape:"irregular"})),"start");
  assert.equal(geoPlotToolResumeAction(args(4,{originalId:"1"})),"edit");
  assert.equal(geoPlotToolResumeAction(args(3,{originalId:"1",shape:"irregular",requestedShape:"irregular"})),"edit");
  assert.equal(geoPlotToolResumeAction(args(0)),"start");
  assert.equal(geoPlotToolResumeAction(args(2,{plot:null})),"start");
  assert.equal(geoPlotPausedDrawingLabel({...args(2),mode:"draw"}),null);
  assert.equal(geoPlotPausedDrawingLabel({...args(2),mode:"pan",originalId:"1"}),null);
});
test("actual Mapper UI wires the same resume behavior to Pan, D/I keys and shape buttons",()=>{
  const src=readFileSync(new URL("../apps/admin/src/geo/GeoPlotMapper.tsx",import.meta.url),"utf8");
  assert.match(src,/geoPlotToolResumeAction\(/);
  assert.match(src,/geoPlotPausedDrawingLabel\(/);
  assert.match(src,/resume or edit/i);
  assert.match(src,/Resume Drawing/);
  assert.match(src,/onClick=\{\(\)=>begin\("four"\)\}/);
  assert.match(src,/onClick=\{\(\)=>begin\("irregular"\)\}/);
  assert.match(src,/if\(k==="d"\)\{begin\("four"\);return;\}/);
  assert.match(src,/if\(k==="i"\)\{begin\("irregular"\);return;\}/);
});
