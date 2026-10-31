import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {parseGeoInventoryCsv,normalizeGeoInventoryRows,geoInventoryDiff,
  nextUnmappedInventory} from "../shared/geo-plot-inventory.js";
import {handleGeoPlotInventory} from "../workers/geo-plot-inventory.mjs";
const rows=()=>normalizeGeoInventoryRows(parseGeoInventoryCsv(
  "Plot No,Sqft,Sqm,Area Source,Front,Back,Depth A,Depth B,Dimension Unit,Source,Road,Facing,Facing Source,Notes\n"+
  "1,1076.39,100,Sanctioned 2026 page 5,10,10,10,10,m,Survey page 5,East Road,east,Survey N,Corner\n"+
  "2,0,,,11,11,12,12,ft,Survey page 6,Main road,north,Survey N,\n"+
  "3,1500,,Approved plan,,,,,,,,,,\n"
));
test("Platform-like canonical CSV builds independent inventory before any polygons exist",()=>{
  const inventory=rows();
  assert.equal(inventory.length,3);
  assert.equal(inventory[0].id,"1");
  assert.equal(inventory[0].areaUnit,"sqm");
  assert.equal(inventory[0].area,100);
  assert.equal(inventory[0].front,10);
  assert.equal(inventory[1].area,0);
  assert.equal(inventory[1].measurementSource,"Survey page 6");
  assert.equal(inventory[2].areaUnit,"sqft");
  assert.equal(inventory[2].front,0);
  assert.deepEqual(normalizeGeoInventoryRows(inventory),inventory,
    "server must validate and preserve canonical rows from browser without inventing values");
});
test("preflight rejects duplicate IDs, contrary units and unsourced numbers",()=>{
  assert.throws(()=>normalizeGeoInventoryRows(parseGeoInventoryCsv(
    "plotId,area,areaUnit,areaSource\nA-1,120,sqft,approved\na-1,130,sqft,approved\n")),/Duplicate/);
  assert.throws(()=>normalizeGeoInventoryRows(parseGeoInventoryCsv(
    "Plot No,Sqft,Sqm,Area Source\n1,5000,100,Survey\n")),/contradictory/);
  assert.throws(()=>normalizeGeoInventoryRows([{plotId:"1",front:"15",lengthUnit:"ft"}]),
    /unit and source/);
  assert.throws(()=>normalizeGeoInventoryRows([{plotId:"1",area:"170",areaUnit:"sqm"}]),
    /area source/);
  assert.throws(()=>normalizeGeoInventoryRows([{plotId:"=HYPERLINK(1)"}]),/Plot ID/);
  assert.throws(()=>parseGeoInventoryCsv("plotId,area\n1,\"broken\n"),/unclosed/);
  assert.throws(()=>parseGeoInventoryCsv("plotId,area,AREA\n1,5,5\n"),/duplicated/);
});
test("safe re-import preserves old inventory by default and counts published mapped IDs",()=>{
  const original=rows(),incoming=[...original,{...original[2],id:"D1",notes:"New inventory plot"}];
  const plan=geoInventoryDiff(original,incoming,["1","D1"]);
  assert.deepEqual(plan.added,["D1"]);
  assert.deepEqual(plan.missing,[]);
  assert.equal(plan.mapped,2);
  assert.equal(plan.unmapped,2);
  const partial=geoInventoryDiff(original,incoming.filter(p=>p.id!=="1"),["1"]);
  assert.deepEqual(partial.missing,["1"]);
  assert.deepEqual(partial.mappedMissing,["1"]);
  assert.equal(nextUnmappedInventory(incoming,["1","D1"],"1")?.id,"2");
  assert.equal(nextUnmappedInventory(original,["1","2","3"]),null);
});
function dbFixture(){
  const state={inventory:null,log:[],geoDraft:JSON.stringify([{id:"1",corners:[[0,0],[1,0],[1,1]]}]),
    activePublished:JSON.stringify([{id:"1",corners:[[0,0],[1,0],[1,1]]}])};
  const db={
    prepare(sql){
      return {bind(...args){return {
        async first(){
          if(sql.includes("FROM geo_plot_inventory_3d"))return state.inventory;
          if(sql.includes("FROM geo_plot_mapping_drafts_3d"))return {plots_json:state.geoDraft};
          if(sql.includes("FROM geo_plot_mapping_active_3d"))return {plots_json:state.activePublished};
          throw Error("Unexpected read "+sql);
        },
        async run(){
          if(sql.includes("INSERT INTO geo_plot_inventory_3d")){
            if(state.inventory)return {meta:{changes:0}};
            state.inventory={revision:1,rows_json:args[1],updated_by:args[2],updated_at:args[3]};
            return {meta:{changes:1}};
          }
          if(sql.includes("UPDATE geo_plot_inventory_3d")){
            if(!state.inventory||state.inventory.revision!==args[4])return {meta:{changes:0}};
            state.inventory={revision:state.inventory.revision+1,
              rows_json:args[0],updated_by:args[1],updated_at:args[2]};
            return {meta:{changes:1}};
          }
          if(sql.includes("INSERT INTO engine_admin_audit")){
            if(!state.inventory||state.inventory.revision!==args[8]||
               state.inventory.rows_json!==args[9]||state.inventory.updated_at!==args[10])
              return {meta:{changes:0}};
            state.log.push(args);return {meta:{changes:1}};
          }
          throw Error("Unexpected write "+sql);
        }
      }}};
    },
    async batch(statements){return Promise.all(statements.map(x=>x.run()));}
  };
  return {db,state};
}
const ctx={project:{id:"project-satharai",slug:"satharai",status:"published"}};
const actor={email:"owner@example.invalid"};
const request=(action,body)=>new Request("https://admin.rekixo.com/3Dprojects/api/cloud/projects/satharai/geo-plots/inventory",
  {method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({action,...body})});
test("preflight is no-write and import never edits published mapping or model",async()=>{
  const {db,state}=dbFixture(),env={DB:db};
  const input=rows();
  const pre=await handleGeoPlotInventory(request("preflight",{expectedRevision:0,rows:input}),env,ctx,actor);
  assert.equal(pre.status,200);
  assert.equal((await pre.json()).preview.mapped,1);
  assert.equal(state.inventory,null);assert.equal(state.log.length,0);
  const done=await handleGeoPlotInventory(request("import",{expectedRevision:0,rows:input}),env,ctx,actor);
  assert.equal(done.status,200);
  assert.equal((await done.json()).inventory.revision,1);
  assert.equal(state.log.length,1);
  assert.equal(JSON.parse(state.geoDraft)[0].id,"1");
  assert.equal(JSON.parse(state.activePublished)[0].id,"1");
  const stale=await handleGeoPlotInventory(request("import",{expectedRevision:0,rows:input}),env,ctx,actor);
  assert.equal(stale.status,409);
  const wrong=await handleGeoPlotInventory(request("import",{expectedRevision:1,rows:input.slice(1)}),env,ctx,actor);
  assert.equal(wrong.status,409);
  assert.equal(state.inventory.revision,1);
});
test("API and mapper route remain authenticated and mapping release independent",()=>{
  const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
  const api=read("workers/geo-plot-mapping.mjs");
  const editor=read("apps/admin/src/geo/GeoPlotMapper.tsx");
  const panel=read("apps/admin/src/geo/GeoPlotInventoryPanel.tsx");
  const migration=read("database/migrations/0043_geo_plot_inventory_v1.sql");
  assert.match(api,/engineAdminReadAccess/);
  assert.match(api,/source\|inventory/);
  assert.match(api,/sameOrigin\(request\)/);
  assert.match(panel,/preflight/);
  assert.match(panel,/Confirm Inventory Import/);
  assert.match(panel,/reference/);
  assert.match(editor,/nextUnmappedInventory/);
  assert.match(editor,/sidesWithInventory/);
  assert.match(migration,/REFERENCES projects_3d\(id\) ON DELETE CASCADE/);
  assert.doesNotMatch(migration,/ALTER TABLE geo_plot_mapping_releases_3d/);
});
