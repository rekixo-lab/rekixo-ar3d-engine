import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
test("Dashboard dispatches Masterplan to its isolated state API before general Building APIs",()=>{
  const d=read("apps/admin/src/dashboard/EngineDashboard.tsx");
  assert.match(d,/if\(!selectedEntry\)\{setDetailLoading\(false\);return;\}/);
  assert.match(d,/if\(selectedKind==="masterplan_geo"\)/);
  assert.match(d,/masterplan-geo/);
  assert.match(d,/Masterplan Published/);
  assert.match(d,/Live v/);
});
test("Engine project discovery searches on the server and pages past 100 without altering selected project",()=>{
  const d=read("apps/admin/src/dashboard/EngineDashboard.tsx");
  const shell=read("apps/admin/src/layout/EngineAdminShell.tsx");
  const worker=read("workers/admin-cloud.mjs");
  assert.match(d,/loadMoreProjects/);
  assert.match(d,/projects\(query,"active",100,0\)/);
  assert.match(shell,/loadMoreShellProjects/);
  assert.match(shell,/projects\(projectSearch\.trim\(\),"active",100,0\)/);
  assert.match(worker,/COALESCE\(p\.location/);
});
test("Masterplan source and CSV changes stay review-only until explicit draft save and verification",()=>{
  const w=read("apps/admin/src/masterplan/MasterplanWorkspace.tsx");
  assert.match(w,/reviewMasterplanCsv<Plot>/);
  assert.match(w,/Apply CSV to Draft Only/);
  assert.match(w,/Missing Data Checker/);
  assert.match(w,/invalidateMasterplanSourceProof\(draft\)/);
  assert.match(w,/Keep Geometry as Unverified Draft/);
  assert.match(w,/if\(dirty\|\|hasPendingPlot\(\)\)throw Error/);
  assert.match(w,/setDraftHistory/);
  assert.match(w,/unpackMasterplanRecovery<LocalSnapshot>/);
  assert.match(w,/beforeunload/);
  assert.match(w,/aria-pressed=\{advanced\}/);
  assert.match(w,/action==="verify"/);
  assert.match(w,/action==="publish"/);
});
test("Handoff and backup views do not claim physical checks or restore certification",()=>{
  const d=read("apps/admin/src/dashboard/EngineDashboard.tsx");
  const h=read("apps/admin/src/dashboard/ProjectHandoffCheck.tsx");
  const a=read("apps/admin/src/advanced/EngineAdvanced.tsx");
  assert.match(d,/<ProjectHandoffCheck/);
  assert.match(h,/manual/);
  assert.match(h,/projectClientAdminUrl\(slug\)/);
  assert.match(h,/does not certify survey accuracy/);
  assert.match(a,/MANUAL REVIEW/);
  assert.match(a,/projectResult\.total/);
  assert.match(a,/projects\("", "all", 100, 0\)/);
});
