import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { planGeoCommercialContinuity } from "../shared/geo-plot-commercial-continuity.js";

const mapper=readFileSync(new URL("../workers/geo-plot-mapping.mjs",import.meta.url),"utf8");
const plot=(id,x=0)=>({id,layout:"four",corners:[[x,0],[x+5,0],[x+5,5],[x,5]],planeY:0});
const original=[plot("1"),plot("2",5),plot("3",10)];
const row=(id,public_approved=1)=>({plot_id:id,public_approved,status:"sold",price_paise:100000,evidence_ref:"Signed sales record",revision:2});

function sqlFromWorker(table) {
  const marker="env.DB.prepare(`INSERT INTO "+table;
  const start=mapper.indexOf(marker);
  assert.ok(start>=0,"worker must contain atomic "+table+" continuity insert");
  const sqlStart=start+"env.DB.prepare(`".length;
  const end=mapper.indexOf("`).bind(",sqlStart);
  assert.ok(end>sqlStart,"SQL must terminate before parameter binding");
  return mapper.slice(sqlStart,end);
}
function setupDb() {
  const db=new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE geo_plot_mapping_active_3d(project_id TEXT, experience_id TEXT,mapping_release_id TEXT);
    CREATE TABLE geo_plot_commercial_3d(
      project_id TEXT,mapping_release_id TEXT,plot_id TEXT,status TEXT,price_paise INTEGER,
      currency TEXT,evidence_ref TEXT,public_approved INTEGER,revision INTEGER,updated_by TEXT,updated_at TEXT,
      PRIMARY KEY(project_id,mapping_release_id,plot_id));
    CREATE TABLE geo_plot_commercial_events_3d(
      id TEXT PRIMARY KEY,project_id TEXT,mapping_release_id TEXT,plot_id TEXT,revision INTEGER,
      event_json TEXT,actor_email TEXT,created_at TEXT);
    INSERT INTO geo_plot_mapping_active_3d VALUES ('project','experience','old-release');
    INSERT INTO geo_plot_commercial_3d VALUES
      ('project','old-release','1','sold',100000,'INR','Signed sales record',1,2,'owner','2026-11-01'),
      ('project','old-release','2','available',200000,'INR','Approved price sheet',1,3,'owner','2026-11-01'),
      ('project','old-release','3','booked',300000,'INR','Signed booking file',1,5,'owner','2026-11-01');
  `);
  return db;
}
function runTransfer(db, plan, proposed) {
  const time="2026-11-04T00:00:00Z";
  db.prepare(sqlFromWorker("geo_plot_commercial_3d")).run(
    "new-release",JSON.stringify(plan.approvedPlotIds),"engine-owner",time,
    JSON.stringify(proposed),"project","old-release","experience","old-release"
  );
  db.prepare(sqlFromWorker("geo_plot_commercial_events_3d")).run(
    "old-release","engine-owner",time,"project","new-release"
  );
  return db.prepare("SELECT * FROM geo_plot_commercial_3d WHERE mapping_release_id='new-release' ORDER BY plot_id").all();
}

test("source change carries status and price privately, never reuses public approval",()=>{
  const proposed=[plot("1",1),plot("2",6)];
  const sourceRows=[row("1"),row("2"),row("3")];
  const before=structuredClone({original,proposed,sourceRows});
  const plan=planGeoCommercialContinuity(original,proposed,sourceRows,false);
  assert.deepEqual([plan.sourceRows,plan.carriedRows,plan.reviewRows,plan.missingRows],[3,2,2,1]);
  assert.deepEqual(plan.approvedPlotIds,[]);
  assert.deepEqual(plan.missingPlotIds,["3"]);
  const db=setupDb();
  try {
    const rows=runTransfer(db,plan,proposed);
    assert.equal(rows.length,2);
    assert.deepEqual(rows.map(r=>[r.plot_id,r.status,r.price_paise,r.public_approved]),
      [["1","sold",100000,0],["2","available",200000,0]]);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM geo_plot_commercial_3d WHERE mapping_release_id='old-release'").get().n,3);
    const events=db.prepare("SELECT event_json FROM geo_plot_commercial_events_3d").all();
    assert.equal(events.length,2);
    assert.ok(events.every(r=>JSON.parse(r.event_json).previousMappingReleaseId==="old-release"));
  } finally {db.close();}
  assert.deepEqual({original,proposed,sourceRows},before);
});

test("same source with unchanged polygon retains approved statuses; changed polygon is pending",()=>{
  const proposed=[plot("1"),plot("2",6),plot("3",10)];
  const plan=planGeoCommercialContinuity(original,proposed,[row("1"),row("2"),row("3")],true);
  assert.deepEqual(plan.approvedPlotIds,["1","3"]);
  assert.deepEqual(plan.reviewPlotIds,["2"]);
  const db=setupDb();
  try {
    const out=runTransfer(db,plan,proposed);
    assert.deepEqual(out.map(r=>r.public_approved),[1,0,1]);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM geo_plot_commercial_events_3d").get().n,3);
  } finally {db.close();}
});

test("canonical identity prevents status leak to removed/reused IDs and duplicate IDs",()=>{
  const planned=planGeoCommercialContinuity(original,[plot("1")],[row("1"),row("9")],false);
  assert.deepEqual(planned.approvedPlotIds,[]);
  assert.equal(planned.missingRows,1);
  assert.throws(()=>planGeoCommercialContinuity(original,[plot("A"),plot("a")],[],false),/Duplicate/);
  assert.throws(()=>planGeoCommercialContinuity(original,[plot("1")],[row("1"),row("1")],true),/Duplicate/);
});

test("release publication transfers status and audit atomically before switching public mapping",()=>{
  assert.match(mapper,/const commercialSha=await digest/);
  assert.match(mapper,/activeReleaseId,activeSha256:live\?\.sha256\|\|null,commercialSha/);
  const release=mapper.indexOf("env.DB.prepare(`INSERT INTO geo_plot_mapping_releases_3d");
  const transfer=mapper.indexOf("...transferStatements");
  const activated=mapper.indexOf("env.DB.prepare(`INSERT INTO geo_plot_mapping_active_3d");
  assert.ok(release>=0&&release<transfer&&transfer<activated);
  assert.match(mapper,/reviewRows:continuity.reviewRows/);
  assert.doesNotMatch(mapper,/INSERT INTO geo_client_sales_3d|INSERT INTO geo_client_receipts_3d/);
});
