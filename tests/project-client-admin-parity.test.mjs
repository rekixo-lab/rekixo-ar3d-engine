import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {projectClientAdminPath,projectClientAdminUrl} from "../shared/project-client-admin-url.js";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");

test("Personal Client Admin uses isolated canonical project-scoped path",()=>{
 assert.equal(projectClientAdminPath("satharai-50a45356"),"/3Dprojects/satharai-50a45356/client-admin");
 assert.equal(projectClientAdminUrl("satharai-50a45356"),
  "https://ar3dstudio.in/3Dprojects/satharai-50a45356/client-admin");
 assert.throws(()=>projectClientAdminUrl("../logout"),/Invalid project/);
 const routes=read("apps/admin/src/main.tsx");
 assert.match(routes,/projectClientAdmin=path.match/);
 assert.match(routes,/ClientAdminRedirect slug=\{projectClientAdmin\[1\]\}/);
 assert.ok(routes.indexOf("projectClientAdmin=path.match")<
  routes.indexOf('path === "/3Dprojects/login"'));
 const owner=read("apps/admin/src/layout/EngineAdminShell.tsx");
 assert.doesNotMatch(routes.slice(routes.indexOf("projectClientAdmin=path.match"),
  routes.indexOf('path === "/3Dprojects/client-portal"')),/<EngineAdminShell/);
 assert.match(owner,/session\(\)/);
 assert.match(routes,/window.location.replace\(projectClientAdminUrl\(slug\)\+window.location.hash\)/);
});
test("Owner creates invites, customer Geo and masterplan link to Client Admin rather than owner",()=>{
 const access=read("workers/project-client-access.mjs");
 const owner=read("apps/admin/src/management/ProjectManagement.tsx");
 const geo=read("apps/public/src/geo/GeoPublicDemo.tsx");
 const image=read("apps/public/src/masterplan/MasterplanPublic.tsx");
 assert.match(access,/projectClientAdminUrl\(project.slug\)/);
 assert.match(owner,/grant-client-access/);
 assert.match(owner,/revoke-client-access/);
 assert.match(owner,/projectClientAdminUrl\(slug\)/);
 assert.match(geo,/const adminHref=projectClientAdminUrl\(slug\)/);
 assert.match(image,/projectClientAdminUrl\(data.project.slug\)/);
 assert.doesNotMatch(geo,/const adminHref="\/3Dprojects\?project="/);
});
test("Session cannot be shared across projects and retains least privilege",()=>{
 const portal=read("workers/project-client-portal.mjs");
 const ui=read("apps/admin/src/management/ProjectClientPortal.tsx");
 const roles=read("shared/project-client-roles.js");
 assert.match(portal,/!requestedSlug\|\|found.slug===requestedSlug/);
 assert.match(portal,/invitation.projectSlug!==projectSlug/);
 assert.match(portal,/p.status<>'archived'/);
 assert.match(portal,/canProjectClient\(s.role,"project.read"\)/);
 assert.match(roles,/client_admin:/);
 assert.doesNotMatch(roles,/owner\.all|mapping\.write|sales\.payments/);
 assert.match(ui,/const sessionPath="\/session"/);
 assert.match(ui,/scopedSlug&&s.user.projectSlug!==scopedSlug/);
 assert.match(ui,/masterplan-inventory/);
 assert.match(ui,/GeoBulkPricingPanel/);
 assert.match(ui,/GeoDealRecordsPanel/);
 assert.match(ui,/saveContact/);
 assert.match(ui,/Contact & Location/);
 assert.match(ui,/Builder Admin/);
 assert.match(ui,/Back to Project/);
 assert.match(ui,/BuilderAdminBrand/);
 assert.match(ui,/Change Temporary Password/);
 assert.doesNotMatch(ui,/<header className="engine-client-admin-head">/);
 assert.doesNotMatch(ui,/className="engine-client-admin-page-heading"/);
 assert.match(ui,/engine-client-admin-sidebar-actions/);
 assert.match(ui,/engine-client-admin-mobile-actions/);
 assert.match(ui,/BuilderAdminBrand projectName=\{projectLabel\}/);
 assert.match(ui,/engine-client-admin-auth/);
 assert.match(ui,/engine-client-admin-reveal/);
 assert.doesNotMatch(ui,/REKIXO · PERSONAL CLIENT ADMIN/i);
 assert.match(portal,/clientProjectContact\(request,env,s\)/);
 assert.doesNotMatch(portal,/handleMasterplanSalesAdmin|engineAdminReadAccess/);
});
test("Image Masterplan client inventory is private, checksum verified and read-only",()=>{
 const portal=read("workers/project-client-portal.mjs");
 const inv=read("workers/project-client-masterplan-inventory.mjs");
 assert.match(portal,/section==="masterplan-inventory"/);
 assert.match(portal,/request.method!=="GET"/);
 assert.match(inv,/sha256\(release.mappingJson\)/);
 assert.match(inv,/WHERE project_id=\?/);
 assert.match(inv,/state IN \('booked','confirmed'\)/);
 assert.doesNotMatch(inv,/buyer_name|buyer_phone|agreement_paise|received_paise|CREATE|UPDATE|DELETE/i);
});
