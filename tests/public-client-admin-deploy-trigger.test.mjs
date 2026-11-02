import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const workflow=readFileSync(new URL("../.github/workflows/deploy-cloudflare.yml",import.meta.url),"utf8");
const publicMain=readFileSync(new URL("../apps/public/src/main.tsx",import.meta.url),"utf8");
const matcher=workflow.split("\n").find(line=>line.includes('grep -Eq ')&&line.includes("apps/public/"))?.match(/grep -Eq '([^']+)'/);
if(!matcher)throw Error("Cloudflare public-runtime detection missing");
const shouldDeploy=new RegExp(matcher[1]);

test("Public deploy follows AR3D Client Admin JSX, CSS and imported Geo modules",()=>{
 for(const file of [
  "apps/admin/src/management/ProjectClientPortal.tsx",
  "apps/admin/src/management/project-client-admin.css",
  "apps/admin/src/management/project-management.css",
  "apps/admin/src/geo/GeoBulkPricingPanel.tsx",
  "apps/admin/src/geo/GeoDealRecordsPanel.tsx",
  "apps/public/src/main.tsx",
  "workers/project-client-portal.mjs",
  "workers/project-client-passwords.mjs",
  "workers/project-client-contact.mjs",
  "workers/project-client-masterplan-inventory.mjs",
  "shared/project-client-admin-url.js"
 ]){
  assert.match(file,shouldDeploy,file+" must deploy the customer-hosted Client Admin");
 }
 assert.doesNotMatch("apps/admin/src/management/ProjectManagement.tsx",shouldDeploy,
  "Owner-only Client Directory updates shouldn't force unnecessary Public deploys");
 assert.match(publicMain,/import\("\.\.\/\.\.\/admin\/src\/management\/ProjectClientPortal"\)/);
});
