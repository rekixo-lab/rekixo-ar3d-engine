// Optional customer contact fields captured at project creation. An owner
// must explicitly approve publishing them; no private Client Admin login
// mobile numbers are used as public contact details.
const validContact=value=>typeof value==="string"&&value.length<=25&&
  (!value||(/^\+?[0-9() -]{7,25}$/.test(value)&&value.replace(/\D/g,"").length>=7&&
    value.replace(/\D/g,"").length<=15));
export function initialProjectContact(body){
  if(body===undefined)return null; // older callers create projects normally
  if(!body||typeof body!=="object"||Array.isArray(body))
    throw Error("Invalid new project customer contact details.");
  const keys=Object.keys(body);
  if(keys.some(k=>!["phonePrimary","whatsapp","publicContactsEnabled"].includes(k)))
    throw Error("Only public project Call and WhatsApp fields are allowed at creation.");
  if(typeof body.publicContactsEnabled!=="boolean")
    throw Error("Explicit public Geo contact approval is required.");
  const phonePrimary=typeof body.phonePrimary==="string"?body.phonePrimary.trim():null;
  const whatsapp=typeof body.whatsapp==="string"?body.whatsapp.trim():null;
  if(phonePrimary===null||whatsapp===null||
    !validContact(phonePrimary)||!validContact(whatsapp))
    throw Error("Invalid customer Call or WhatsApp number.");
  if(body.publicContactsEnabled && !phonePrimary && !whatsapp)
    throw Error("Add a customer contact number before enabling public Geo contact buttons.");
  return {phonePrimary,whatsapp,publicContactsEnabled:body.publicContactsEnabled};
}

export function projectContactInsert(env,projectId,ownerEmail,now,contact){
  return env.DB.prepare(`INSERT INTO project_profiles_3d
    (project_id,phone_primary,whatsapp,public_contacts_enabled,revision,updated_by,updated_at)
    VALUES(?,?,?,?,1,?,?)`).bind(projectId,contact.phonePrimary,contact.whatsapp,
      contact.publicContactsEnabled?1:0,ownerEmail,now);
}
