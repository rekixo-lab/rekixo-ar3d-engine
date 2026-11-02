import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const worker = read("workers/project-branding.mjs");
const builder = read("apps/admin/src/branding/ProjectShareBuilder.tsx");
const cloud = read("apps/admin/src/studio/cloud.ts");
const geo = read("apps/public/src/geo/GeoPublicDemo.tsx");
const css = read("apps/public/src/geo/geo-public-demo.css");
const adminCss = read("apps/admin/src/branding/project-share-builder.css");

test("Update Geo Site publishes uploaded logo and social poster in one authenticated request", () => {
  assert.match(builder, /Update Geo Site/);
  assert.match(builder, /publishGeoSiteBranding\(slug,\s*\{/);
  assert.match(builder, /expectedLogoDraftVersion: state\.logo\.draftVersion/);
  assert.match(builder, /expectedGeoCardVersion: state\.experiences\.geo\.draftCardVersion/);
  assert.match(builder, /expectedBuildingCardVersion: state\.experiences\.building\.draftCardVersion/);
  assert.match(cloud, /action: "publish-geo-site"/);
  assert.match(worker, /if \(action === "publish-geo-site"\) return publishGeoSite/);
  assert.match(worker, /if \(!\(await sameOrigin\(request\)\)\)/);
  assert.match(worker, /experienceReadiness\(env, project, slug, "geo"\)/);
  assert.match(builder, /Share Geo on WhatsApp/);
  assert.match(builder, /https:\/\/wa\.me\/\?text=/);
  assert.match(adminCss, /\.engine-branding-hero__actions/);
});

test("Geo site publish preflights storage and atomically versions its own share metadata", () => {
  const begin = worker.indexOf("async function publishGeoSite(");
  const end = worker.indexOf("async function adminBrandingAsset(", begin);
  assert.ok(begin >= 0 && end > begin);
  const action = worker.slice(begin, end);
  assert.match(action, /branding\?\.draftVersion \|\| branding\?\.publishedVersion/);
  assert.match(action, /fromDraft\(geo, "geo-draft"\)/);
  assert.match(action, /fromPublished\(geoPublished, "geo-published"\)/);
  assert.match(action, /fromDraft\(building, "building-draft"\)/);
  assert.match(action, /fromPublished\(buildingPublished, "building-published"\)/);
  assert.match(action, /key\.startsWith\(prefix\)/);
  assert.match(action, /env\.MODEL_ASSETS\.head\(key\)/);
  assert.match(action, /env\.DB\.batch\(\[/);
  assert.match(action, /INSERT INTO project_branding_share_versions_3d/);
  assert.match(action, /'geo'/);
  assert.match(action, /published_logo_version=excluded\.published_logo_version/);
  assert.match(action, /published_version=excluded\.published_version/);
  assert.match(action, /branding\.geo_site_updated/);
  assert.match(action, /\/geo\?share=/);
  assert.doesNotMatch(action, /DELETE FROM|DROP TABLE|MODEL_ASSETS\.delete/);
});

test("Geo customer page displays published logo at the left of title and subtitle", () => {
  const headerStart = geo.indexOf('<div className="jio-public-branding">');
  const headerEnd = geo.indexOf("</header>", headerStart);
  assert.ok(headerStart >= 0 && headerEnd > headerStart);
  const header = geo.slice(headerStart, headerEnd);
  assert.match(header, /branding\?\.logoUrl/);
  assert.ok(header.indexOf("jio-public-project-logo") < header.indexOf("<h1>"));
  assert.match(header, /<GeoHeaderSubtitle text=\{data\.project\.location/);
  assert.match(css, /jio-public-project-logo\s*\{[\s\S]*width:\s*42px/);
  assert.match(css, /jio-public-project-logo \{ width: 34px; height: 34px; \}/);
});

test("Crawler page has versioned public Geo image metadata for WhatsApp", () => {
  assert.match(worker, /property="og:image"/);
  assert.match(worker, /property="og:image:secure_url"/);
  assert.match(worker, /property="og:image:type"/);
  assert.match(worker, /name="twitter:image"/);
  assert.match(worker, /property="og:title"/);
  assert.match(worker, /property="og:description"/);
  assert.match(worker, /property="og:url"/);
  assert.match(worker, /share-card\?experience=\$\{experience\}&v=/);
  assert.match(worker, /headers\.delete\("ETag"\)/);
});
