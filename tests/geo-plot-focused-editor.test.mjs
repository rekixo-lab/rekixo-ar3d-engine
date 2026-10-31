import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {nextFreePlotId,adjacentPlot,hasPendingPlotEdits,isTextEditingTarget,
  boundedZoom,sideLabelAnchor} from "../shared/geo-plot-editor.js";

test("precision plot navigation is stable and sorted numerically",()=>{
  const plots=[{id:"10"},{id:"2"},{id:"7"}];
  assert.equal(nextFreePlotId(plots),"1");
  assert.equal(nextFreePlotId([{id:"1"},{id:"2"},{id:"4"}]),"3");
  assert.equal(adjacentPlot(plots,"2",1).id,"7");
  assert.equal(adjacentPlot(plots,"10",1).id,"2");
  assert.equal(adjacentPlot(plots,"2",-1).id,"10");
  assert.equal(adjacentPlot([], "2",1),null);
});
test("draft safety only prompts for genuinely unapplied polygon edits",()=>{
  const blank={id:"3",corners:[],area:{value:0,source:""},sides:{},
    planeSource:"",facingSource:"",road:"",notes:""};
  assert.equal(hasPendingPlotEdits(null,null),false);
  assert.equal(hasPendingPlotEdits(blank,null),false);
  assert.equal(hasPendingPlotEdits({...blank,corners:[[0,0],[5,0],[5,6]]},null),true);
  assert.equal(hasPendingPlotEdits({...blank,planeSource:"approved survey"},null),true);
  const saved={...blank,corners:[[0,0],[5,0],[5,6]]};
  assert.equal(hasPendingPlotEdits(structuredClone(saved),saved),false);
  assert.equal(hasPendingPlotEdits({...saved,area:{value:15,source:"approved"}},saved),true);
});
test("keyboard shortcuts exclude inputs and contenteditable targets",()=>{
  assert.equal(isTextEditingTarget(null),false);
  assert.equal(isTextEditingTarget({tagName:"INPUT"}),true);
  assert.equal(isTextEditingTarget({tagName:"textarea"}),true);
  assert.equal(isTextEditingTarget({tagName:"SELECT"}),true);
  assert.equal(isTextEditingTarget({tagName:"DIV",isContentEditable:true}),true);
  assert.equal(isTextEditingTarget({tagName:"svg",closest:()=>null}),false);
});
test("zoom is bounded and side labels respect weighted multi-edge frontage",()=>{
  assert.equal(boundedZoom(1,2),2);
  assert.equal(boundedZoom(30,3),32);
  assert.equal(boundedZoom(2,0.01),1);
  assert.equal(boundedZoom(NaN,2),1);
  assert.equal(boundedZoom(1,-1),1);
  const corners=[[0,0],[5,0],[10,0],[10,20],[0,20]];
  assert.deepEqual(sideLabelAnchor(corners,[0,1]),[5,0]);
  assert.deepEqual(sideLabelAnchor(corners,[2]),[10,10]);
  assert.equal(sideLabelAnchor(corners,[99]),null);
  assert.equal(sideLabelAnchor(corners,[]),null);
});
test("normal and fullscreen authoring use the same toolbar, inspector and publish gate",()=>{
  const editor=readFileSync(new URL("../apps/admin/src/geo/GeoPlotMapper.tsx",import.meta.url),"utf8");
  const css=readFileSync(new URL("../apps/admin/src/geo/geo-plot-mapper.css",import.meta.url),"utf8");
  assert.match(editor,/ref=\{editorRef\} data-fullscreen=/);
  assert.match(editor,/requestFullscreen\(/);
  assert.match(editor,/fullscreenchange/);
  assert.match(editor,/aria-label="Plot mapper controls"/);
  assert.match(editor,/Boundary complete/);
  assert.match(editor,/Apply & Draw Next/);
  assert.match(editor,/Save Mapping Draft/);
  assert.match(editor,/Verify All Plots/);
  assert.match(editor,/Publish Mapping/);
  assert.match(editor,/hasPendingPlotEdits/);
  assert.match(editor,/beforeunload/);
  assert.match(editor,/sideLabelAnchor/);
  assert.match(editor,/area:\{\.\.\.prev\.area,verified:false\}/);
  assert.match(editor,/controls\.minZoom=1;controls\.maxZoom=32/);
  assert.match(css,/\.geo-plot-editor-shell:fullscreen/);
  assert.match(css,/\.geo-plot-editor-shell:fullscreen \.geo-plot-workspace/);
  assert.match(css,/\.geo-plot-editor-shell:fullscreen \.geo-plot-dock/);
  assert.doesNotMatch(editor,/location\.assign\([^)]*ar3d-platform/);
});
