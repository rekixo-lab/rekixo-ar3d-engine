import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");

test("Customer Geo loading, errors and default subtitle show AR 3D only",()=>{
 const geo=read("apps/public/src/geo/GeoPublicDemo.tsx");
 assert.equal((geo.match(/<p className="eyebrow">AR 3D<\/p>/g)||[]).length,2);
 assert.match(geo,/<h1>Loading integrated 3D Geo…<\/h1>/);
 assert.match(geo,/data\.project\.location \|\| "AR 3D"/);
 assert.doesNotMatch(geo,/>\s*REKIXO\s*AR3D\s*ENGINE\s*</i);
 assert.doesNotMatch(geo,/"Rekixo AR3D Engine"/i);
 // Technical Google Maps callbacks and model names must remain unchanged.
 assert.match(geo,/__rekixoPublicGeoMapsReady/);
});

test("Building startup and model loading are neutral AR 3D, not Rekixo",()=>{
 const main=read("apps/public/src/main.tsx");
 const viewer=read("apps/public/src/viewer/Viewer3D.tsx");
 const html=read("apps/public/index.html");
 assert.match(main,/function LoadingPage\(\)/);
 assert.match(main,/<p className="eyebrow">AR3D STUDIO<\/p>/);
 assert.match(main,/<h1>Preparing 3D project<\/h1>/);
 assert.match(viewer,/<span>Preparing 3D experience<\/span>/);
 assert.doesNotMatch(main,/>\s*REKIXO(?:\s|<)/i);
 assert.doesNotMatch(viewer,/>\s*REKIXO(?:\s|<)/i);
 assert.match(html,/<title>AR3D Studio 3D Project<\/title>/);
});

test("Customer Client Admin and showcase use AR 3D startup without owner branding",()=>{
 const main=read("apps/admin/src/main.tsx");
 const html=read("apps/admin/index.html");
 const portal=read("apps/admin/src/management/ProjectClientPortal.tsx");
 assert.match(html,/<title>AR 3D Projects<\/title>/);
 assert.match(main,/function RouteLoading\(\{ label, customer = false \}/);
 assert.match(main,/customer \? "AR 3D" : "REKIXO AR3D ENGINE"/);
 assert.match(main,/label="Opening secure client portal…" customer/);
 assert.match(main,/label="Loading published design…" customer/);
 assert.match(main,/const isCustomerRoute = /);
 assert.match(main,/if \(!isCustomerRoute\) document\.title = "Rekixo 3D Projects";/);
 assert.match(main,/<small>AR3D STUDIO<\/small><p className="eyebrow">CLIENT ADMIN<\/p>/);
 assert.doesNotMatch(portal,/>\s*REKIXO(?:\s|<)/i);
});

test("Published masterplan and showcase do not display Rekixo branding",()=>{
 const masterplan=read("apps/public/src/masterplan/MasterplanPublic.tsx");
 const showcase=read("apps/admin/src/studio/PublishedViewer.tsx");
 assert.match(masterplan,/<p>AR 3D · GEO MASTERPLAN<\/p>/);
 assert.match(showcase,/<small>AR 3D · PUBLISHED 3D DESIGN<\/small>/);
 assert.doesNotMatch(masterplan,/>\s*REKIXO\s*·/i);
 assert.doesNotMatch(showcase,/>\s*REKIXO\s*·/i);
});
