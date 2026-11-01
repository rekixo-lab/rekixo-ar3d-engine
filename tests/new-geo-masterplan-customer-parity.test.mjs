import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {geoPlotMappingProjectKind} from "../shared/geo-plot-project-policy.js";
import {projectModuleVisible,projectKindAllowsCloudRoute,newProjectStartPath} from "../shared/engine-project-kinds.js";
import {customerGeoContactsFromProfile} from "../workers/public-geo-contacts.mjs";
import {parseGeoPriceSheetCsv,expandGeoPriceSheet} from "../shared/geo-plot-pricing-sheet.js";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
test("new Building+Geo projects gain plot authoring on server and navigation, unlike 2D-only",()=>{
 assert.equal(geoPlotMappingProjectKind("building_geo"),true);
 assert.equal(geoPlotMappingProjectKind("legacy"),true);
 for(const kind of ["masterplan_geo","building"]){
  assert.equal(geoPlotMappingProjectKind(kind),false);
  assert.equal(projectModuleVisible(kind,"geo-plots"),false);
 }
 assert.equal(projectModuleVisible("building_geo","geo-plots"),true);
 assert.equal(projectKindAllowsCloudRoute("building_geo","geo-plots"),true);
 assert.equal(projectKindAllowsCloudRoute("masterplan_geo","geo-plots"),false);
 assert.equal(projectKindAllowsCloudRoute("building","geo-plots"),false);
 assert.equal(newProjectStartPath("building_geo"),"source-pack");
 const api=read("workers/geo-plot-mapping.mjs");
 const portal=read("workers/project-client-portal.mjs");
 assert.match(api,/geoPlotMappingProjectKind\(ctx\.project\.project_kind/);
 assert.match(api,/if \(!ctx\.active\)/);
 assert.match(portal,/p\.project_kind IN \('legacy','building_geo'\)/);
});
test("public contacts opt-in only, private buyer and client directory remain private",()=>{
 const row={project_number:"PR-77",owner_name:"Owner Name",builder_name:"Demo Builder",
  contact_name:"Office",address:"Demo Plot Site",phone_primary:"+91 9876543210",
  phone_secondary:"",whatsapp:"+91 9876543210",email:"office@example.com",
  maps_url:"https://maps.app.goo.gl/test",website_url:"https://example.com",
  public_contacts_enabled:0,buyer_phone:"secret",price_paise:9999,private_notes:"secret"};
 assert.equal(customerGeoContactsFromProfile(row),null);
 const safe=customerGeoContactsFromProfile({...row,public_contacts_enabled:1});
 assert.equal(safe.projectNumber,"PR-77");
 assert.equal(safe.ownerName,"Owner Name");
 assert.equal(safe.mapsUrl,"https://maps.app.goo.gl/test");
 assert.equal(safe.phone,"+91 9876543210");
 for(const hidden of ["buyer_phone","price_paise","private_notes","public_contacts_enabled"])
  assert.equal(Object.hasOwn(safe,hidden),false);
 assert.equal(customerGeoContactsFromProfile({...row,public_contacts_enabled:1,
  maps_url:"https://google.com.evil.test/malware",website_url:"javascript:alert(1)"}).mapsUrl,"");
 const pub=read("workers/public-geo-contacts.mjs");
 assert.match(pub,/pr\.status='published' AND p\.public_contacts_enabled=1/);
 assert.doesNotMatch(pub,/project_client_directory_3d|masterplan_sales/);
 assert.match(read("apps/public/src/geo/GeoPublicDemo.tsx"),/geoPublicMapHref/);
});
test("contact migration defaults public visibility OFF and adds owner/project number",()=>{
 const db=new DatabaseSync(":memory:");
 try{
  db.exec("CREATE TABLE project_profiles_3d(project_id TEXT PRIMARY KEY);"+
    "INSERT INTO project_profiles_3d(project_id) VALUES('demo');");
  db.exec(read("database/migrations/0048_geo_customer_project_contact_parity.sql"));
  const row=db.prepare("SELECT * FROM project_profiles_3d WHERE project_id='demo'").get();
  assert.equal(row.public_contacts_enabled,0);
  assert.equal(row.project_number,"");assert.equal(row.owner_name,"");
  assert.throws(()=>db.prepare(
   "UPDATE project_profiles_3d SET public_contacts_enabled=3 WHERE project_id='demo'").run());
  db.prepare("UPDATE project_profiles_3d SET project_number='DOC-1',owner_name='Reviewed Owner',"+
    "public_contacts_enabled=1 WHERE project_id='demo'").run();
  assert.equal(db.prepare("SELECT public_contacts_enabled AS enabled FROM project_profiles_3d").get().enabled,1);
 }finally{db.close();}
});
const mapped=[1,2,3].map(id=>({id:String(id),area:{value:100,unit:"sqm",verified:true}}));
test("Platform Pricing CSV fixed price overrides rate range and verified area is used",()=>{
 const input="\uFEFFplot_id,from_id,to_id,pricing_type,unit,rate,fixed_price,currency\n"+
  ",1,3,rate,sqm,2500,,INR\n"+"2,,,fixed,,,1500000,INR\n";
 const expanded=expandGeoPriceSheet(parseGeoPriceSheetCsv(input),mapped);
 assert.deepEqual(expanded.map(p=>p.plotId),["1","2","3"]);
 assert.equal(expanded[0].pricePaise,25000000);
 assert.equal(expanded[1].pricePaise,150000000);
 assert.equal(expanded[2].pricePaise,25000000);
 assert.equal(Object.hasOwn(expanded[0],"status"),false);
 assert.equal(Object.hasOwn(expanded[0],"publicApproved"),false);
});
test("Pricing safety: unknown IDs, conflicting ranges, units and unverified area fail",()=>{
 const header="plot_id,from_id,to_id,pricing_type,unit,rate,fixed_price,currency\n";
 const text=rows=>header+rows.join("\n");
 assert.throws(()=>expandGeoPriceSheet(parseGeoPriceSheetCsv(text([
   "4,,,fixed,,,500000,INR"])),mapped),/not in verified mapping/);
 assert.throws(()=>expandGeoPriceSheet(parseGeoPriceSheetCsv(text([
   ",1,3,rate,sqyd,1000,,INR",",2,3,rate,sqyd,1400,,INR"])),mapped),/Conflicting pricing ranges/);
 assert.throws(()=>parseGeoPriceSheetCsv(text(["1,,,rate,acre,1000,,INR"])),/Unsupported pricing unit/);
 assert.throws(()=>parseGeoPriceSheetCsv(text(["1,,,fixed,,,20000,USD"])),/Only INR/);
 assert.throws(()=>parseGeoPriceSheetCsv(text(["1,,,fixed,,,1.123,INR"])),/at most two/);
 assert.throws(()=>parseGeoPriceSheetCsv(text(["1,,,fixed,,,0,INR"])),/positive/);
 assert.throws(()=>expandGeoPriceSheet(parseGeoPriceSheetCsv(text([
   "1,,,rate,sqft,1500,,INR"])),[{id:"1",area:{value:100,unit:"sqm",verified:false}}]),
   /verified sourced area/);
 assert.throws(()=>parseGeoPriceSheetCsv('plot_id,fixed_price\n"1,23000'),/unterminated/);
});
test("Pricing table rejects cross-project source mapping and deletes only dependent private sheet",()=>{
 const db=new DatabaseSync(":memory:");
 try{
  db.exec("PRAGMA foreign_keys=ON;"+
   "CREATE TABLE projects_3d(id TEXT PRIMARY KEY);"+
   "CREATE TABLE geo_plot_mapping_releases_3d("+
   "id TEXT PRIMARY KEY,project_id TEXT REFERENCES projects_3d(id) ON DELETE CASCADE);");
  db.exec(read("database/migrations/0049_geo_pricing_sheet_drafts.sql"));
  db.exec("INSERT INTO projects_3d VALUES('p1'); INSERT INTO projects_3d VALUES('p2');"+
   "INSERT INTO geo_plot_mapping_releases_3d VALUES('r1','p1');");
  const sql="INSERT INTO geo_plot_pricing_sheets_3d "+
   "(project_id,mapping_release_id,revision,quotes_json,sha256,source_ref,updated_by,updated_at) "+
   "VALUES(?,?,1,'[]',?,?,'owner','now')";
  assert.throws(()=>db.prepare(sql).run("p2","r1","f".repeat(64),"Original rate source"),
    /Pricing belongs|FOREIGN KEY/);
  db.prepare(sql).run("p1","r1","f".repeat(64),"Original rate source");
  assert.throws(()=>db.prepare(
    "UPDATE geo_plot_pricing_sheets_3d SET project_id='p2' WHERE project_id='p1'").run(),
    /Pricing cannot change/);
  db.prepare("DELETE FROM geo_plot_mapping_releases_3d WHERE id='r1'").run();
  assert.equal(db.prepare("SELECT count(*) as n FROM geo_plot_pricing_sheets_3d").get().n,0);
 }finally{db.close();}
});
test("Owner and scoped client need pricing preflight, release CAS and separate status approval",()=>{
 const api=read("workers/geo-plot-pricing.mjs");
 const portal=read("workers/project-client-portal.mjs");
 const admin=read("workers/geo-plot-mapping.mjs");
 const panel=read("apps/admin/src/geo/GeoBulkPricingPanel.tsx");
 assert.match(api,/activeMap\(env,ctx\)/);
 assert.match(api,/expectedRevision/);
 assert.match(api,/previewSha256/);
 assert.match(api,/action==="preflight"/);
 assert.match(api,/private:true/);
 assert.doesNotMatch(api,/UPDATE geo_plot_commercial_3d|DELETE FROM geo_plot_commercial_3d/);
 assert.match(admin,/handleGeoPlotPricingSheet/);
 assert.match(portal,/handleGeoPlotPricingSheet/);
 assert.match(portal,/section==="pricing"/);
 assert.match(panel,/Preview Price Sheet — no writes/);
 assert.match(panel,/Confirm Private Pricing Import/);
 assert.match(read("apps/admin/src/geo/GeoPlotCommercialPanel.tsx"),/Use reviewed CSV price/);
});
