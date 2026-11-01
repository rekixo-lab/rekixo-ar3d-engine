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

test("Platform-format 36-plot BOM CSV imports as source inventory with exact feet-inch conversion and preserved irregular notes",()=>{
  const headings=["Plot No","Sqft","Sqm","Sqyd","Dimensions","Road Access",
    "Front","Back","Depth","Depth 2","Dimension Unit",
    "Front Edge","Back Edge","Depth Edge","Depth 2 Edge",
    "Front Label","Back Label","Depth Label","Depth 2 Label","Side Dimensions","Notes"];
  const cell=v=>'"'+String(v??"").replace(/"/g,'""')+'"';
  const records=Array.from({length:36},(_,i)=>{
    const plotNo=String(i+1),irregular=i===7;
    const front=irregular?"20'-0\"":"23'-5\"";
    const back=irregular?"33'-8\"":"23'-3\"";
    const depth=irregular?"":"38'-0\"";
    const depth2=irregular?"43'-11\"":"37'-3\"";
    return [plotNo,"878","81.59","",irregular?"Irregular boundary with local body setback":
      "Four-side plot (CAD measured)","30 FEET WIDE ROAD",front,back,depth,depth2,"ft",
      "","","","",front,back,depth,depth2,
      irregular?"Front (WEST) 20'-0\" | LOCAL BODY recess horizontal 26'-3\" | "+
        "LOCAL BODY recess vertical 12'-1\" | North side has no continuous depth segment":
        "Front (WEST) 23'-5\" | Back (EAST) 23'-3\"",
      "Source: vector CAD PDF p.1 area statement and annotated plan; "+
      (irregular?"Irregular plot: map polygon edges manually. ":"")+
      "Verify plot geometry during manual mapping."];
  });
  const csv="\uFEFF"+[headings,...records].map(row=>row.map(cell).join(",")).join("\r\n");
  const original=normalizeGeoInventoryRows(parseGeoInventoryCsv(csv));
  assert.equal(original.length,36);
  assert.deepEqual(original.map(r=>r.id),Array.from({length:36},(_,i)=>String(i+1)));
  assert.equal(original[0].areaUnit,"sqm");
  assert.equal(original[0].area,81.59);
  assert.equal(original[0].front,23.416667);
  assert.equal(original[0].back,23.25);
  assert.equal(original[0].depthA,38);
  assert.equal(original[0].depthB,37.25);
  assert.equal(original[0].lengthUnit,"ft");
  assert.equal(original[0].areaSource,"vector CAD PDF p.1 area statement and annotated plan");
  assert.equal(original[0].measurementSource,original[0].areaSource);
  assert.match(original[0].sideDimensions,/Front \(WEST\)/);
  assert.equal(original[7].depthA,0,"Missing Plot 8 depth is never invented");
  assert.equal(original[7].depthB,43.916667);
  assert.match(original[7].sideDimensions,/LOCAL BODY recess/);
  assert.match(original[7].notes,/map polygon edges manually/);
  assert.deepEqual(normalizeGeoInventoryRows(original),original,
    "Server revalidation must not lose conversion precision or source details");
});
test("Platform feet-inch parser rejects missing source, impossible inches and contrary area units",()=>{
  const row={plotId:"1",sqft:"1000",sqm:"92.9",front:"23'-5\"",back:"20'-0\"",
    depthA:"30'-0\"",depthB:"30'-0\"",lengthUnit:"ft",
    notes:"Source: signed CAD PDF p.1; verify mapping"};
  assert.throws(()=>normalizeGeoInventoryRows([{...row,front:"23'-12\""}]),
    /inches must be less than 12/);
  assert.throws(()=>normalizeGeoInventoryRows([{...row,lengthUnit:"m"}]),/requires ft unit/);
  assert.throws(()=>normalizeGeoInventoryRows([{...row,notes:"No signed source"}]),
    /source.reference required|source required/);
  assert.throws(()=>normalizeGeoInventoryRows([{...row,sqm:"50"}]),/contradictory/);
});
test("Mapper routes Platform CSV to source inventory preflight before attempting polygon-only measurement import",()=>{
  const source=readFileSync(new URL("../apps/admin/src/geo/GeoPlotMapper.tsx",import.meta.url),"utf8");
  assert.match(source,/parseGeoInventoryCsv\(raw\)/);
  assert.match(source,/normalizeGeoInventoryRows/);
  assert.match(source,/keys.includes\("plotno"\)/);
  assert.match(source,/await importSourceInventory\(raw,file.name\)/);
  assert.match(source,/action:"preflight"/);
  assert.match(source,/action:"import"/);
  assert.match(source,/setInventoryImportNonce/);
  assert.match(source,/will NOT invent any 3D polygon/);
});
