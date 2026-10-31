import test from "node:test";
import assert from "node:assert/strict";
import {projectKindAllowsCloudRoute,projectModuleVisible} from "../shared/engine-project-kinds.js";
import {readFileSync} from "node:fs";

test("direct Engine API routes obey independent project-type boundaries",()=>{
  const older=["draft","releases","experiences","geo-draft","geo-releases",
    "geo-placement","geo-plots","branding"];
  for(const route of older)
    assert.equal(projectKindAllowsCloudRoute("legacy",route),true,"legacy "+route);
  for(const route of older)
    assert.equal(projectKindAllowsCloudRoute("masterplan_geo",route),false,"masterplan "+route);
  for(const route of ["geo-draft","geo-releases","geo-placement","geo-plots"])
    assert.equal(projectKindAllowsCloudRoute("building",route),false,"building "+route);
  assert.equal(projectKindAllowsCloudRoute("building","releases"),true);
  assert.equal(projectKindAllowsCloudRoute("building_geo","geo-placement"),true);
  assert.equal(projectKindAllowsCloudRoute("building_geo","geo-plots"),false);
  for(const kind of ["legacy","building","building_geo","masterplan_geo"])
    for(const route of ["assets","manage"])
      assert.equal(projectKindAllowsCloudRoute(kind,route),true,kind+" "+route);
  assert.equal(projectModuleVisible("masterplan_geo","masterplan"),true);
  assert.equal(projectModuleVisible("masterplan_geo","building"),false);
});
test("Engine admin actually enforces the route gate, not just UI nav",()=>{
  const root=new URL("../",import.meta.url);
  const admin=readFileSync(new URL("workers/admin-cloud.mjs",root),"utf8");
  const legacyGeo=readFileSync(new URL("workers/geo-plot-mapping.mjs",root),"utf8");
  assert.match(admin,/projectKindAllowsCloudRoute\(project\.project_kind,parts\[1\]\)/);
  assert.match(legacyGeo,/ctx\.project\.project_kind\|\|"legacy"/);
});
