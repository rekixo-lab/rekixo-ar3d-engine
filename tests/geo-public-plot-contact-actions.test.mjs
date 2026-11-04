import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const drawer=read("apps/public/src/geo/GeoPlotDetailsDrawer.tsx");
const css=read("apps/public/src/geo/geo-plot-details-drawer.css");
const publicGeo=read("apps/public/src/geo/GeoPublicDemo.tsx");
const contacts=read("workers/public-geo-contacts.mjs");

test("Geo plot shows two action buttons directly after published plot detail facts",()=>{
  const facts=drawer.indexOf('<section className="geo-plot-drawer__facts"');
  const actions=drawer.indexOf('<nav className="geo-plot-drawer__contact"');
  assert.ok(facts>0&&actions>facts,"actions remain below plot measurements and status");
  const fragment=drawer.slice(actions,drawer.indexOf("</nav>",actions));
  assert.match(fragment,/GeoPlotContactIcon kind="whatsapp"/);
  assert.match(fragment,/GeoPlotContactIcon kind="call"/);
  assert.match(fragment,/<span>WhatsApp<\/span>/);
  assert.match(fragment,/<span>Call Now<\/span>/);
  assert.equal((fragment.match(/GeoPlotContactIcon kind="whatsapp"/g)||[]).length,2,
    "enabled and disabled states must retain the WhatsApp action face");
  assert.equal((fragment.match(/GeoPlotContactIcon kind="call"/g)||[]).length,2,
    "enabled and disabled states must retain the Call Now action face");
  assert.match(drawer,/function GeoPlotContactIcon/);
  assert.match(drawer,/<svg viewBox="0 0 24 24" fill="none"/);
});

test("Contact actions only use opted-in published contact numbers, never private data",()=>{
  assert.match(publicGeo,/publicPhone=\{data\.publicContacts\?\.phone\}/);
  assert.match(publicGeo,/publicWhatsapp=\{data\.publicContacts\?\.whatsapp\}/);
  assert.match(contacts,/if\(!row\|\|row\.public_contacts_enabled!==1\)return null/);
  assert.match(contacts,/WHERE pr\.slug=\? AND pr\.status='published' AND p\.public_contacts_enabled=1/);
  assert.match(drawer,/const callHref=geoCallHref\(publicPhone\)/);
  assert.match(drawer,/geoPlotWhatsAppHref\(publicWhatsapp,shown\.id,projectName\)/);
  assert.match(drawer,/geoPlotWhatsAppHref/);
  assert.match(read("shared/geo-public-contact-links.js"),/encodeURIComponent\(message\)/);
  assert.match(drawer,/href=\{whatsappHref\} target="_blank" rel="noopener noreferrer"/);
  assert.match(drawer,/href=\{callHref\}/);
  assert.match(drawer,/title="WhatsApp number not published"/);
  assert.match(drawer,/title="Call number not published"/);
  assert.equal((drawer.match(/aria-disabled="true"/g)||[]).length,2);
});

test("Plot contact row is compact equal-width, responsive and keyboard accessible",()=>{
  assert.match(css,/\.geo-plot-drawer__contact\{[\s\S]*?grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css,/\.geo-plot-drawer__contact-action\{[\s\S]*?min-height:49px/);
  assert.match(css,/\.geo-plot-drawer__contact-action svg\{width:18px;height:18px/);
  assert.match(css,/\.geo-plot-drawer__whatsapp\{background:#0bb762/);
  assert.match(css,/\.geo-plot-drawer__call\{background:#253765/);
  assert.match(css,/\.geo-plot-drawer__contact-action:is\(a\):focus-visible/);
  assert.match(css,/@media\(max-width:640px\)[\s\S]*?\.geo-plot-drawer__contact-action\{min-height:46px/);
  assert.match(css,/\.geo-plot-drawer__contact-action\.is-unavailable\{/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)[\s\S]*?\.geo-plot-drawer__contact-action\{transition:none\}/);
});

test("Plot diagram, click selection and drawer controls are not changed by contact actions",()=>{
  assert.match(drawer,/publicGeoPlotDiagram\(shown\)/);
  assert.match(drawer,/geoPlotFacingEntries\(shown,geoHeadingDeg\)/);
  assert.match(drawer,/data-plot-status=\{displayStatus\}/);
  assert.match(drawer,/aria-hidden=\{!plot\} inert=\{!plot\}/);
  assert.match(publicGeo,/setSelectedPlot\(plotIds\.get\(id\)\|\|null\)/);
  assert.match(publicGeo,/onClose=\{\(\)=>setSelectedPlot\(null\)\}/);
  assert.match(css,/\.geo-plot-drawer__scroll \{[\s\S]*?overflow-y:auto/);
});
