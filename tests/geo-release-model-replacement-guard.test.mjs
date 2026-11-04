import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { planGeoMappingTransition } from "../workers/geo-release-mapping-safety.mjs";

const project={id:"project-1",slug:"satharai-test"};
const oldPlots=JSON.stringify([{id:"1",corners:[[0,0],[2,0],[2,2],[0,2]]}]);
const sha=(s)=>createHash("sha256").update(s).digest("hex");
function setup(){
  const db=new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE geo_plot_mapping_active_3d(project_id TEXT,experience_id TEXT,mapping_release_id TEXT);
    CREATE TABLE geo_plot_mapping_releases_3d(
      id TEXT,project_id TEXT,experience_id TEXT,geo_release_id TEXT,
      building_release_id TEXT,plots_json TEXT,sha256 TEXT,version INTEGER);
    INSERT INTO geo_plot_mapping_active_3d VALUES('project-1','experience-1','old-map');
  `);
  return {db,env:{DB:{prepare:(sql)=>({bind:(...values)=>({
    first:async()=>db.prepare(sql).get(...values)
  })})}}};
}
test("Geo model replacement fails closed before hiding an active public plot map",async()=>{
  const {db,env}=setup();
  try{
    await assert.rejects(
      planGeoMappingTransition(env,project,"experience-1","geo-new","building-new"),
      /temporarily hide published Plot Mapping/);
    const accepted=await planGeoMappingTransition(env,project,"experience-1",
      "geo-new","building-new","ALLOW GEO MAPPING GAP satharai-test");
    assert.equal(accepted.currentMappingId,"old-map");
    assert.equal(accepted.matchingMappingId,null);
  }finally{db.close();}
});
test("rollback to a matching historical Geo release restores verified exact mapping identity",async()=>{
  const {db,env}=setup();
  try{
    db.prepare(`INSERT INTO geo_plot_mapping_releases_3d VALUES(?,?,?,?,?,?,?,?)`).run(
      "old-mapping-version","project-1","experience-1","geo-original","building-original",
      oldPlots,sha(oldPlots),2);
    const result=await planGeoMappingTransition(env,project,
      "experience-1","geo-original","building-original");
    assert.deepEqual(result,{currentMappingId:"old-map",matchingMappingId:"old-mapping-version"});
    db.exec("UPDATE geo_plot_mapping_releases_3d SET sha256='bad' WHERE id='old-mapping-version'");
    await assert.rejects(
      planGeoMappingTransition(env,project,"experience-1","geo-original","building-original"),
      /integrity mismatch/);
  }finally{db.close();}
});
test("missing live Plot Mapping does not block fresh Geo publication",async()=>{
  const {db,env}=setup();
  try{
    db.exec("DELETE FROM geo_plot_mapping_active_3d");
    const plan=await planGeoMappingTransition(env,project,"experience-1","geo-new","building-new");
    assert.deepEqual(plan,{currentMappingId:null,matchingMappingId:null});
  }finally{db.close();}
});
test("release mutation paths and UI both require mapping-gap guard; exact old mapping restores in same batch",()=>{
  const publish=readFileSync(new URL("../workers/geo-release-publish.mjs",import.meta.url),"utf8");
  const activate=readFileSync(new URL("../workers/geo-release-activate.mjs",import.meta.url),"utf8");
  const client=readFileSync(new URL("../apps/admin/src/geo/GeoMapper3DV2.tsx",import.meta.url),"utf8");
  const admin=readFileSync(new URL("../workers/admin-cloud.mjs",import.meta.url),"utf8");
  assert.match(publish,/planGeoMappingTransition/);
  assert.match(activate,/planGeoMappingTransition/);
  assert.match(activate,/\.\.\.restoreMapping/);
  assert.match(client,/ALLOW GEO MAPPING GAP /);
  assert.match(client,/guardGeoMappingGap/);
  assert.match(admin,/mappingGapConfirmation/);
});
