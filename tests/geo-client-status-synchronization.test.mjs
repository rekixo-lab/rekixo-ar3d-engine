import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");

test("client admin publishes status and buyer details atomically, with server-generated audit",()=>{
 const client=read("apps/admin/src/management/ClientGeoPlotManagement.tsx");
 const portal=read("workers/project-client-portal.mjs");
 const service=read("workers/project-client-geo-plot-publish.mjs");
 const legacy=read("workers/geo-plot-commercial.mjs");
 assert.match(client,/path\+"\/plot-publish"/);
 assert.match(client,/Save & Publish Status/);
 assert.match(client,/response\.confirmation\.published/);
 assert.match(client,/onCommercialChange\(response\.commercial\)/);
 assert.match(client,/setBaseline\(snapshot\(form,status\)\)/);
 assert.match(client,/client-geo-publish-success/);
 assert.match(client,/client-geo-toast/);
 assert.match(client,/savedStatus\(r\)===filter/);
 assert.doesNotMatch(client,/Source \/ signed evidence reference|Private Notes|Save booking details/);
 assert.match(portal,/clientGeoPlotPublish\(request,env,context,actor/);
 assert.match(portal,/allowApprove:canProjectClient\(s\.role,"commercial\.approve"\)/);
 assert.match(portal,/request\.method!=="GET"&&!sameOrigin\(request\)/);
 assert.match(service,/actor\.role!=="client_admin"\|\|!allowApprove/);
 assert.match(service,/env\.DB\.batch\(\[/);
 assert.match(service,/geo_client_plot_detail_events_3d/);
 assert.match(service,/geo_plot_commercial_events_3d/);
 assert.match(service,/engine_admin_audit/);
 assert.match(service,/client-admin-operation:/);
 assert.match(legacy,/public_approved=1/);
});

test("public Geo status sync never reloads the GLB or exposes unapproved commercial records",()=>{
  const viewer=read("apps/public/src/geo/GeoPublicDemo.tsx");
  const publicApi=read("workers/public.mjs");
  const projection=read("workers/geo-plot-public.mjs");
  const commercial=read("workers/geo-plot-commercial.mjs");
  assert.match(viewer,/\/geo-status/);
  assert.match(viewer,/setInterval\(\(\)=>void refresh\(\),15000\)/);
  assert.match(viewer,/document\.addEventListener\("visibilitychange",onVisibility\)/);
  assert.match(viewer,/window\.addEventListener\("focus",onFocus\)/);
  assert.match(viewer,/statusSummaryRef\.current\.statusById/);
  assert.match(viewer,/liveStatus=\{liveStatus\}/);
  assert.match(viewer,/\}, \[data\]\)/,"3D rendering must continue to depend only on immutable project payload");
  assert.match(publicApi,/parts\[1\] === "geo-status"/);
  assert.match(publicApi,/publicGeoPlotStatusSnapshot\(env, slug\)/);
  assert.match(projection,/publicGeoCommercialForRelease/);
  assert.match(projection,/publicGeoPlotMapping\(env,slug,active\.geoReleaseId\)/);
  assert.match(commercial,/public_approved=1/);
});
