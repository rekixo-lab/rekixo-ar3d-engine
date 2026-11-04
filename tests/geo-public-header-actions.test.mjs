import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const source=readFileSync(new URL("../apps/public/src/geo/GeoPublicDemo.tsx",import.meta.url),"utf8");
const css=readFileSync(new URL("../apps/public/src/geo/geo-public-demo.css",import.meta.url),"utf8");
const begin=source.indexOf('<header className="jio-public-header">');
const end=source.indexOf("</header>",begin);
const header=source.slice(begin,end);

test("Geo header has only compact Call then Admin icons, alongside the project title",()=>{
  assert.ok(begin>=0&&end>begin);
  assert.match(header,/className="jio-public-branding"/);
  assert.match(header,/<h1>\{data\.project\.name\}<\/h1>/);
  assert.match(header,/<GeoHeaderSubtitle text=\{data\.project\.location/);
  const call=header.indexOf('href={callHref}');
  const admin=header.indexOf('href={adminHref}');
  assert.ok(call>0&&admin>call,"Call should precede Admin");
  assert.equal((header.match(/<a className="jio-public-header-action/g)||[]).length,2);
  assert.doesNotMatch(header,/WhatsApp|whatsapp|kind="whatsapp"|href=\{whatsappHref\}/);
  assert.doesNotMatch(header,/>\s*(?:Call|Admin Panel)\s*<\/a>/);
  assert.match(header,/aria-label="Call project contact"/);
  assert.match(header,/aria-label="Open project admin panel"/);
});

test("Admin remains a four-square dashboard icon, never a gear",()=>{
  const start=source.indexOf('if(kind==="admin")');
  const end=source.indexOf('return (',start+150);
  const icon=source.slice(start,end);
  assert.equal((icon.match(/<rect /g)||[]).length,4);
  assert.doesNotMatch(icon,/gear|settings|<path /i);
  assert.match(header,/<GeoHeaderIcon kind="admin" \/>/);
});

test("Call uses only published Geo phone, Admin uses authenticated project route",()=>{
  assert.match(source,/const callHref=geoCallHref\(data\.publicContacts\?\.phone\)/);
  assert.match(source,/geoCallHref\(data\.publicContacts\.phoneSecondary\)/);
  assert.match(source,/const adminHref=projectClientAdminUrl\(slug\)/);
  assert.match(header,/role="img" aria-label="Call unavailable"/);
  assert.doesNotMatch(header,/href=\{whatsappHref\}/);
  const contactStrip=source.slice(source.indexOf('className="jio-public-customer-contact"'),
    source.indexOf("</section>}",source.indexOf('className="jio-public-customer-contact"')));
  assert.doesNotMatch(contactStrip,/aria-label="Call project contact">Call<\/a>/);
  assert.match(contactStrip,/geoPublicMapHref/);
  assert.match(contactStrip,/phoneSecondary/);
});

test("Compact visual face retains touch target and padded header at all widths",()=>{
  assert.match(css,/\.jio-public-header-actions\s*\{[\s\S]*?margin-left:\s*auto/);
  assert.match(css,/\.jio-public-header-action\s*\{[\s\S]*?width:\s*40px;[\s\S]*?height:\s*40px;/);
  assert.match(css,/\.jio-public-header-action::before\s*\{[\s\S]*?inset:\s*3px/);
  assert.match(css,/\.jio-public-header-action svg\s*\{[\s\S]*?width:\s*18px/);
  assert.match(css,/\.jio-public-header-action:focus-visible/);
  assert.match(css,/\.jio-public-header-action\.is-unavailable/);
  assert.match(css,/padding:\s*6px 9px/);
  assert.match(css,/padding:\s*4px 6px/);
});

test("Clipped mobile subtitle pans through its measured hidden text with reduced-motion fallback",()=>{
  assert.match(source,/function GeoHeaderSubtitle/);
  assert.match(source,/content\.scrollWidth-viewport\.clientWidth/);
  assert.match(source,/new ResizeObserver\(measure\)/);
  assert.match(source,/observer\?\.disconnect\(\)/);
  assert.match(source,/className="geo-header-subtitle-text"/);
  assert.match(css,/@keyframes geo-header-subtitle-pan/);
  assert.match(css,/translateX\(var\(--geo-subtitle-shift/);
  assert.match(css,/\.geo-header-subtitle\.is-overflowing \.geo-header-subtitle-text/);
  assert.match(css,/prefers-reduced-motion:\s*reduce/);
});
