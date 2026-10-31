import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("Engine overview preserves the Building workflow and keeps Geo optional for legacy projects", () => {
  const dashboard = read("apps/admin/src/dashboard/EngineDashboard.tsx");

  assert.match(dashboard, /ENGINE WORKFLOW/);
  assert.match(dashboard, /One clear path from source to live experience/);
  assert.match(dashboard, /projectHref\("source-pack", selectedProject\.slug\)/);
  assert.match(dashboard, /projectHref\("building", selectedProject\.slug\)/);
  assert.match(dashboard, /projectHref\("geo-mapper", selectedProject\.slug\)/);
  assert.match(dashboard, /projectHref\("releases", selectedProject\.slug\)/);
  assert.match(dashboard, /3D Building/);
  assert.match(dashboard, /3D Geo Experience/);
  assert.match(dashboard, /OPTIONAL/);
  assert.match(dashboard, /Create 3D Project/);
  assert.match(dashboard, /newProjectStartPath\(createKind\)/);
  assert.doesNotMatch(dashboard, /Create → Edit → Map → Live/);
});

test("Engine project context crosses the shared control-center routes and compatibility Studio redirect", () => {
  const dashboard = read("apps/admin/src/dashboard/EngineDashboard.tsx");
  const main = read("apps/admin/src/main.tsx");

  assert.match(dashboard, /function projectHref\(path: "source-pack" \| "building" \| "geo-mapper" \| "releases" \| "masterplan"/);
  assert.match(dashboard, /\/3Dprojects\/\$\{path\}\?project=\$\{encodeURIComponent\(slug\)\}/);
  assert.match(dashboard, /projectHref\("source-pack", selectedProject\.slug\)/);
  assert.match(dashboard, /projectHref\("geo-mapper", selectedProject\.slug\)/);
  assert.match(main, /function LegacyStudioRedirect\(\)/);
  assert.match(main, /window\.location\.replace\(`\/3Dprojects\/source-pack\$\{window\.location\.search\}`\)/);
  assert.match(main, /path === "\/3Dprojects\/building"/);
  assert.match(main, /path === "\/3Dprojects\/geo-mapper"/);
  assert.match(main, /<GeoWorkspace \/>/);
});

test("Engine overview creates isolated projects through the existing cloud contract", () => {
  const dashboard = read("apps/admin/src/dashboard/EngineDashboard.tsx");

  assert.match(dashboard, /const draft = newProject\(name\)/);
  assert.match(dashboard, /draft\.slug = projectSlug\(draft\)/);
  assert.match(dashboard, /await ensureProject\(draft, createKind\)/);
  assert.match(dashboard, /window\.location\.assign\(projectHref\(newProjectStartPath\(createKind\), result\.project\.slug\)\)/);
  assert.doesNotMatch(dashboard, /DELETE FROM|DROP TABLE|geo_placements_3d/);
});

test("Admin router keeps Overview, Source Pack, Building, Geo, Releases, Advanced, login and showcase routes", () => {
  const main = read("apps/admin/src/main.tsx");

  assert.match(main, /\/3Dprojects\/source-pack/);
  assert.match(main, /\/3Dprojects\/studio/);
  assert.match(main, /\/3Dprojects\/building/);
  assert.match(main, /\/3Dprojects\/geo-mapper/);
  assert.match(main, /\/3Dprojects\/releases/);
  assert.match(main, /\/3Dprojects\/advanced/);
  assert.match(main, /\/3Dprojects\/login/);
  assert.match(main, /\/3Dprojects\/showcase\//);
  assert.match(main, /<EngineDashboard \/>/);
  assert.match(main, /<SourcePackReview \/>/);
  assert.match(main, /<BuildingWorkspace \/>/);
  assert.match(main, /<GeoWorkspace \/>/);
});

test("Engine Admin keeps a consistent control-center identity while the proven Geo mapper retains its visual contract", () => {
  const shellCss = read("apps/admin/src/layout/engine-admin-shell.css");
  const geoCss = read("apps/admin/src/geo/geo-mapper.css");
  const shared = read("apps/admin/src/styles.css");

  assert.match(shellCss, /--engine-accent: #28ce82/);
  assert.match(shellCss, /--engine-warning: #efbd4a/);
  assert.match(shellCss, /box-shadow: inset 3px 0 var\(--engine-accent\)/);
  assert.match(geoCss, /--geo-gold: #f4b942/);
  assert.match(geoCss, /Golden 3D Jio Mapper identity/);
  assert.match(shared, /\.eyebrow \{\s*color: #f4b942/);
});

test("project creation starts the Source Pack workflow, preserves Building-first delivery and keeps Geo optional", () => {
  const dashboard = read("apps/admin/src/dashboard/EngineDashboard.tsx");

  assert.match(dashboard, /Choose one independent Engine project type/);
  assert.match(dashboard, /Finish Building workflow/);
  assert.match(dashboard, /immutable Building release publish karein/);
  assert.match(dashboard, /Customer ko map-based experience chahiye to Geo add karein; otherwise Building complete hai/);
  assert.match(dashboard, /Exact real-world Building placement\. Optional unless the customer needs map context/);
  assert.match(dashboard, /Create & Open Source Pack/);
});

test("new projects offer three isolated types without breaking Building-first legacy path",()=>{
  const dashboard=read("apps/admin/src/dashboard/EngineDashboard.tsx");
  const projectKinds=read("shared/engine-project-kinds.js");
  assert.match(dashboard,/createKind, setCreateKind/);
  assert.match(dashboard,/"building_geo"/);
  assert.match(dashboard,/"masterplan_geo"/);
  assert.match(dashboard,/selectedProject\.projectKind !== "masterplan_geo"/);
  assert.match(dashboard,/newProjectStartPath\(createKind\)/);
  assert.match(projectKinds,/return kind === "masterplan_geo" \? "masterplan" : "source-pack"/);
});
