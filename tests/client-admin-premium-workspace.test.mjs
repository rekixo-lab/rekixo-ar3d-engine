import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const portal=read("apps/admin/src/management/ProjectClientPortal.tsx");
const css=read("apps/admin/src/management/project-client-admin-premium.css");
const oldCss=read("apps/admin/src/management/project-client-admin.css");
const plot=read("apps/admin/src/management/ClientGeoPlotManagement.tsx");

test("all eight Client Admin pages use simple navigation without redundant header cards",()=>{
 for(const section of ["overview","plots","pricing","deals","contact","gallery","sales","notices"]){
   assert.match(portal,new RegExp(section+':\\{label:'));
 }
 assert.match(portal,/PANEL_META\[item\]\.label/);
 assert.match(portal,/PANEL_META\[item\]\.hint/);
 assert.ok(!portal.includes('className="engine-client-admin-page-heading"'));
 assert.ok(!portal.includes('className="engine-client-admin-head"'));
 assert.ok(portal.includes('engine-client-admin-sidebar-actions'));
 assert.ok(portal.includes('engine-client-admin-mobile-actions'));
 assert.ok(portal.includes('onClick={()=>void logout()}'));
 assert.ok(portal.includes('View customer site'));
 assert.match(portal,/aria-label="Client admin sections"/);
 assert.match(portal,/aria-current=\{panel===item\?"page":undefined\}/);
 assert.match(portal,/engine-client-admin-mobile-switch/);
 assert.match(portal,/aria-label="Choose Client Admin section"/);
 assert.match(portal,/onChange=\{e=>navigate\(e\.target\.value as Panel\)\}/);
 assert.match(portal,/availablePanels\.includes\(destination\)/);
});

test("responsive layout stays inside Client Admin and works at desktop tablet phone and small phone widths",()=>{
 assert.match(portal,/import "\.\/project-client-admin-premium\.css"/);
 assert.match(css,/\.engine-client-admin:not\(\.engine-client-admin-auth\)/);
 for(const width of [1180,850,600,370])
  assert.ok(css.includes("@media(max-width:"+width+"px)"),width+"px breakpoint is required");
 assert.match(css,/\.engine-client-admin-sidebar\{display:none\}/);
 assert.ok(css.includes(".engine-client-admin-sidebar-actions"));
 assert.ok(css.includes(".engine-client-admin-mobile-actions"));
 assert.match(css,/\.engine-client-admin-mobile-switch\{[\s\S]*display:flex/);
 assert.match(css,/\.client-geo-table-row>span:nth-child\(3\)::before\{content:"Owner \/ Buyer"\}/);
 assert.match(css,/\.client-geo-editor-grid\{grid-template-columns:minmax\(0,1fr\)/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
 assert.match(oldCss,/\.engine-client-admin-auth/);
});

test("contact edits expose save and discard state and warn before section change",()=>{
 assert.match(portal,/savedContactFields/);
 assert.match(portal,/const contactDirty=Boolean\(/);
 assert.match(portal,/panel==="contact"&&contactDirty/);
 assert.match(portal,/Unsaved contact changes/);
 assert.match(portal,/Save changes/);
 assert.match(portal,/Discard changes/);
 assert.match(portal,/contact\.revision<1\|\|!contactDirty/);
 assert.match(portal,/setSavedContactFields\(JSON\.stringify\(next\.fields\)\)/);
});

test("quick actions only link to authorized visible sections, not absent building plot pages",()=>{
 for(const page of ["plots","sales","pricing","gallery","contact"])
   assert.match(portal,new RegExp('availablePanels\\.includes\\("'+page+'"\\)'));
 assert.doesNotMatch(portal,/onClick=\{\(\)=>setPanel\("plots"\)\}/);
 assert.match(portal,/navigate\("plots"\)/);
 assert.match(portal,/kind!=="building"&&<section className="engine-client-admin-stats"/);
 assert.match(plot,/onCommercialChange/);
});
