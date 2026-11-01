// Public whitelist for opted-in customer contact data.
// Never project private client directory, commercial evidence, or buyer/payment records.
const safe=v=>typeof v==="string"?v.trim():"";
export function customerGeoContactsFromProfile(row){
  if(!row||row.public_contacts_enabled!==1)return null;
  const fields={
    projectNumber:safe(row.project_number),ownerName:safe(row.owner_name),
    builderName:safe(row.builder_name),contactName:safe(row.contact_name),
    address:safe(row.address),phone:safe(row.phone_primary),
    phoneSecondary:safe(row.phone_secondary),whatsapp:safe(row.whatsapp),
    email:safe(row.email),websiteUrl:safe(row.website_url),mapsUrl:safe(row.maps_url)
  };
  for(const key of ["websiteUrl","mapsUrl"]){
    const value=fields[key];if(!value)continue;
    try{
      const url=new URL(value);
      if(url.protocol!=="https:"||url.username||url.password)fields[key]="";
      if(key==="mapsUrl"&&!(url.hostname==="goo.gl"||
        url.hostname.endsWith(".goo.gl")||
        /(^|\\.)google\\.(?:com|[a-z]{2}|co\\.[a-z]{2}|com\\.[a-z]{2})$/.test(url.hostname)))fields[key]="";
    }catch{fields[key]="";}
  }
  return fields;
}
export async function loadPublicGeoCustomerContacts(env,slug){
  const row=await env.DB.prepare(`SELECT p.project_number,p.owner_name,
    p.builder_name,p.contact_name,p.address,p.phone_primary,p.phone_secondary,
    p.whatsapp,p.email,p.website_url,p.maps_url,p.public_contacts_enabled
    FROM project_profiles_3d p JOIN projects_3d pr ON pr.id=p.project_id
    WHERE pr.slug=? AND pr.status='published' AND p.public_contacts_enabled=1 LIMIT 1`)
   .bind(slug).first();
  return customerGeoContactsFromProfile(row);
}
