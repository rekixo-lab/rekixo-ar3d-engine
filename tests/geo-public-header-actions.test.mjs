import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const source=readFileSync(new URL("../apps/public/src/geo/GeoPublicDemo.tsx",import.meta.url),"utf8");
const css=readFileSync(new URL("../apps/public/src/geo/geo-public-demo.css",import.meta.url),"utf8");
const begin=source.indexOf('<header className="jio-public-header">');
const end=source.indexOf("</header>",begin);
const header=source.slice(begin,end);

test("Geo title and location remain on left, with exactly three icon-only actions at right",()=>{
  assert.ok(begin>=0&&end>begin);
  assert.match(header,/className="jio-public-branding"/);
  assert.match(header,/<h1>\{data\.project\.name\}<\/h1>/);
  assert.match(header,/<p>\{data\.project\.location/);
  assert.match(header,/className="jio-public-header-actions"/);
  const call=header.indexOf('href={callHref}');
  const whatsapp=header.indexOf('href={whatsappHref}');
  const admin=header.indexOf('href={adminHref}');
  assert.ok(call>0&&whatsapp>call&&admin>whatsapp,
    "Required visual order is Call, WhatsApp, Admin");
  assert.equal((header.match(/<a className="jio-public-header-action/g)||[]).length,3);
  assert.doesNotMatch(header,/>\s*(?:Call|WhatsApp|Admin Panel)\s*<\/a>/);
  assert.match(header,/aria-label="Call project contact"/);
  assert.match(header,/aria-label="Contact project team on WhatsApp"/);
  assert.match(header,/aria-label="Open project admin panel"/);
});

test("Admin is a four-square dashboard icon, not a settings gear",()=>{
  const start=source.indexOf('if(kind==="admin")');
  const end=source.indexOf('if(kind==="whatsapp")',start);
  const adminIcon=source.slice(start,end);
  assert.equal((adminIcon.match(/<rect /g)||[]).length,4);
  assert.doesNotMatch(adminIcon,/gear|settings|<path /i);
  assert.match(header,/<GeoHeaderIcon kind="admin" \/>/);
});

test("Header links use published contact data and project-specific protected Admin path",()=>{
  assert.match(source,/const publicPhone=data\.publicContacts\?\.phone/);
  assert.match(source,/const whatsappHref=geoWhatsAppHref\(/);
  assert.match(source,/data\.publicContacts\?\.whatsapp\|\|data\.publicContacts\?\.phone/);
  assert.match(source,/const adminHref="\/3Dprojects\?project="\+encodeURIComponent\(slug\)/);
  assert.match(header,/role="img" aria-label="Call unavailable"/);
  assert.match(header,/role="img" aria-label="WhatsApp unavailable"/);
  assert.match(header,/target="_blank" rel="noopener noreferrer"/);
  const contactStrip=source.slice(source.indexOf('className="jio-public-customer-contact"'),
    source.indexOf("</section>}",source.indexOf('className="jio-public-customer-contact"')));
  assert.doesNotMatch(contactStrip,/aria-label="Call project contact">Call<\/a>/);
  assert.doesNotMatch(contactStrip,/aria-label="Contact project team on WhatsApp">WhatsApp<\/a>/);
  // Other published address, Maps, website and email actions remain available.
  assert.match(contactStrip,/geoPublicMapHref/);
  assert.match(contactStrip,/phoneSecondary/);
});

test("Header icons fit every viewport without squeezing map or project title",()=>{
  assert.match(css,/\.jio-public-header-actions\s*\{[\s\S]*?margin-left:\s*auto/);
  assert.match(css,/\.jio-public-header-action\s*\{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;/);
  assert.match(css,/\.jio-public-branding h1,\s*\.jio-public-branding h1 \+ p\s*\{[\s\S]*?text-overflow:\s*ellipsis/);
  assert.match(css,/\.jio-public-header-action:focus-visible/);
  assert.match(css,/\.jio-public-header-action\.is-unavailable/);
});
