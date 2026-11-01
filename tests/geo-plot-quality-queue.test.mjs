import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {geoPlotReviewQueue,geoPlotReviewFieldAction} from "../shared/geo-plot-quality-queue.js";

test("36 stored polygons with road blockers and 8 reviews each become 36 actionable quality cards",()=>{
  const plots=Array.from({length:36},(_,index)=>({id:String(index+1)}));
  const issues=plots.flatMap(plot=>[
    {plotId:plot.id,severity:"blocker",field:"frontRoad",reason:"Front must be road-facing"},
    ...["area","facing","plane","frontVerified","backVerified","depthAVerified","depthBVerified","areaVariance"]
      .map(field=>({plotId:plot.id,severity:"review",field,reason:"Source review needed"}))
  ]);
  const copy=structuredClone(issues);
  const queue=geoPlotReviewQueue(plots,issues);
  assert.equal(queue.affected,36);
  assert.equal(queue.blockedPlots,36);
  assert.equal(queue.reviewPlots,36);
  assert.equal(queue.queue.length,36);
  assert.deepEqual(queue.queue.map(p=>p.id),plots.map(p=>p.id));
  assert.deepEqual(queue.queue.map(p=>[p.blockers,p.reviews]),plots.map(()=>[1,8]));
  assert.match(queue.queue[0].nextAction,/FRONT.*road|road.*FRONT/i);
  assert.deepEqual(issues,copy,"report only, never mutate real sources or approvals");
});
test("prioritizes true blockers before reviews and separately displays project and cross-plot issues",()=>{
  const q=geoPlotReviewQueue([{id:"10"},{id:"2"},{id:"1"}],[
    {plotId:"1",severity:"review",field:"plane",reason:"Verify"},
    {plotId:"2",severity:"blocker",field:"frontRoad",reason:"Road"},
    {plotId:"10",severity:"review",field:"areaVariance",reason:"Area mismatch"},
    {plotId:"2 / 10",severity:"blocker",field:"overlap",reason:"Overlap"},
    {plotId:"project",severity:"blocker",field:"alignment",reason:"Stale"}
  ]);
  assert.deepEqual(q.queue.map(p=>p.id),["2","1","10"]);
  assert.equal(q.general.length,2);
  assert.equal(q.blockedPlots,1);
});
test("guides source review but never asserts plot measurements or verified flags",()=>{
  assert.match(geoPlotReviewFieldAction("frontRoad"),/Road side/);
  assert.match(geoPlotReviewFieldAction("areaVariance"),/scale/);
  assert.match(geoPlotReviewFieldAction("plane"),/elevation/);
  assert.match(geoPlotReviewFieldAction("frontVerified"),/Source verified/);
  assert.match(geoPlotReviewFieldAction("inventory"),/CSV/);
  const helper=readFileSync(new URL("../shared/geo-plot-quality-queue.js",import.meta.url),"utf8");
  assert.doesNotMatch(helper,/fetch\(|window\.|localStorage|\.run\(|INSERT INTO|UPDATE |DELETE FROM/);
});
test("Engine exposes grouped review queue, direct Plot Editor navigation, and private Confirm gate",()=>{
  const ui=readFileSync(new URL("../apps/admin/src/geo/GeoPlotMapper.tsx",import.meta.url),"utf8");
  assert.match(ui,/geoPlotReviewQueue\(plots,actionableQualityIssues\)/);
  assert.match(ui,/Review Plot \{item.id\} in Editor/);
  assert.match(ui,/openPlotQualityReview\(item.id\)/);
  assert.match(ui,/setInspectorTab\("plot"\)/);
  assert.match(ui,/Confirm Plot/);
  assert.match(ui,/No blanket approval is applied/);
});
