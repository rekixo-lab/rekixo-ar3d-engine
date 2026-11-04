import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {geoCallHref,geoWhatsAppHref,geoPlotWhatsAppHref} from "../shared/geo-public-contact-links.js";
import {initialProjectContact} from "../workers/project-contact-on-create.mjs";
import {customerGeoContactsFromProfile} from "../workers/public-geo-contacts.mjs";

const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");

test("Indian local mobile, formatted E.164 and IDD numbers open real tel dialer links",()=>{
  assert.equal(geoCallHref("98765 43210"),"tel:+919876543210");
  assert.equal(geoCallHref("(98765) 43210"),"tel:+919876543210");
  assert.equal(geoCallHref("+91 98765-43210"),"tel:+919876543210");
  assert.equal(geoCallHref("0091 98765 43210"),"tel:+919876543210");
  assert.equal(geoCallHref("+1 (202) 555-0100"),"tel:+12025550100");
  assert.equal(geoCallHref("555-0123"),"tel:5550123");
  for(const value of ["","12345","javascript:alert(1)","+91a9876543210","++919876543210"])
    assert.equal(geoCallHref(value),"","no unsafe or malformed dialing URI");
});
test("WhatsApp deep link uses only the separately published WhatsApp number",()=>{
  assert.equal(geoWhatsAppHref("98765 43211"),"https://wa.me/919876543211");
  assert.equal(geoWhatsAppHref("+91 98765 43211"),"https://wa.me/919876543211");
  assert.equal(geoWhatsAppHref("0091-98765-43211"),"https://wa.me/919876543211");
  assert.equal(geoWhatsAppHref("+1 202 555 0100"),"https://wa.me/12025550100");
  const link=geoPlotWhatsAppHref("+91 98765 43211","36","Satharai");
  const url=new URL(link);
  assert.equal(url.hostname,"wa.me");
  assert.equal(url.pathname,"/919876543211");
  assert.match(url.searchParams.get("text"),/Plot 36 in Satharai/);
  for(const value of ["","1234567890","whatsapp://send?text=x","javascript:alert(1)"])
    assert.equal(geoWhatsAppHref(value),"");
  assert.equal(geoPlotWhatsAppHref("", "36","Satharai"),"");
});
test("existing profiles remain non-public until the owner explicitly approves sharing",()=>{
  const row={project_number:"SITE-3",owner_name:"Owner",builder_name:"Builder",contact_name:"Office",
    address:"Project address",phone_primary:"+91 98765 43210",phone_secondary:"",
    whatsapp:"+91 98765 43211",email:"",maps_url:"",website_url:"",
    public_contacts_enabled:0};
  assert.equal(customerGeoContactsFromProfile(row),null);
  const contacts=customerGeoContactsFromProfile({...row,public_contacts_enabled:1});
  assert.equal(geoCallHref(contacts.phone),"tel:+919876543210");
  assert.equal(geoWhatsAppHref(contacts.whatsapp),"https://wa.me/919876543211");
  assert.notEqual(contacts.phone,contacts.whatsapp);
});
test("new project number storage uses explicit consent and never accepts private directory fields",()=>{
  assert.equal(initialProjectContact(undefined),null);
  assert.deepEqual(initialProjectContact({phonePrimary:"98765 43210",whatsapp:"98765 43211",
    publicContactsEnabled:true}),{
    phonePrimary:"98765 43210",whatsapp:"98765 43211",publicContactsEnabled:true,
  });
  assert.equal(initialProjectContact({phonePrimary:"98765 43210",whatsapp:"",
    publicContactsEnabled:false}).publicContactsEnabled,false);
  assert.throws(()=>initialProjectContact({phonePrimary:"98765 43210",whatsapp:"",
    publicContactsEnabled:true,clientAdminPhone:"9999999999"}),/Only public project/);
  assert.throws(()=>initialProjectContact({phonePrimary:"",whatsapp:"",
    publicContactsEnabled:true}),/Add a customer contact/);
  assert.throws(()=>initialProjectContact({phonePrimary:"123",whatsapp:"",
    publicContactsEnabled:false}),/Invalid customer/);
  const api=read("workers/admin-cloud.mjs");
  assert.match(api,/initialProjectContact\(body\.customerContact\)/);
  assert.match(api,/projectContactInsert\(env,id,actor\.email,now,customerContact\)/);
  assert.match(read("workers/project-contact-on-create.mjs"),/INSERT INTO project_profiles_3d/);
  assert.match(read("workers/project-contact-on-create.mjs"),/public_contacts_enabled/);
  assert.match(api,/env\.DB\.batch\(\[/);
  const dashboard=read("apps/admin/src/dashboard/EngineDashboard.tsx");
  assert.match(dashboard,/Customer Call number/);
  assert.match(dashboard,/Customer WhatsApp number/);
  assert.match(dashboard,/publicContactsEnabled:createPublicContacts/);
  const profile=read("apps/admin/src/management/ProjectManagement.tsx");
  assert.match(profile,/Geo customer contact buttons:/);
  assert.match(profile,/publicContactsEnabled:e\.target\.checked/);
});
test("public UI does not infer WhatsApp from phone and uses actual anchor links",()=>{
  const viewer=read("apps/public/src/geo/GeoPublicDemo.tsx");
  const drawer=read("apps/public/src/geo/GeoPlotDetailsDrawer.tsx");
  assert.match(viewer,/const callHref=geoCallHref\(data\.publicContacts\?\.phone\)/);
  assert.match(viewer,/publicWhatsapp=\{data\.publicContacts\?\.whatsapp\}/);
  assert.match(drawer,/geoPlotWhatsAppHref\(publicWhatsapp,shown\.id,projectName\)/);
  assert.match(drawer,/href=\{whatsappHref\} target="_blank" rel="noopener noreferrer"/);
  assert.match(drawer,/href=\{callHref\}/);
  assert.match(viewer,/href=\{callHref\} aria-label="Call project contact"/);
  assert.doesNotMatch(viewer,/publicWhatsapp=\{data\.publicContacts\?\.phone\}/);
});
