// Published Geo customer-contact link helpers. Never infer WhatsApp from a
// phone number; WhatsApp receives ONLY an explicitly published WhatsApp field.
const digitsOf=value=>String(value??"").replace(/\D/g,"");
const safeText=value=>typeof value==="string"?value.trim():"";
export function geoCallHref(value){
  const raw=safeText(value);
  if(!raw||!/^\+?[0-9()\s-]+$/.test(raw))return "";
  let digits=digitsOf(raw);
  if(digits.startsWith("00")&&digits.length>=12){
    digits=digits.slice(2);
    return digits.length>=8&&digits.length<=15&&digits[0]!=="0"?"tel:+"+digits:"";
  }
  if(raw.startsWith("+"))
    return digits.length>=8&&digits.length<=15&&digits[0]!=="0"?"tel:+"+digits:"";
  // Explicit local Indian mobile: dial +91 on both desktop integrations
  // and mobile devices without requiring callers to enter a country prefix.
  if(digits.length===10&&/^[6-9]/.test(digits))return "tel:+91"+digits;
  return digits.length>=7&&digits.length<=15?"tel:"+digits:"";
}
export function geoWhatsAppHref(value){
  const raw=safeText(value);
  if(!raw||!/^\+?[0-9()\s-]+$/.test(raw))return "";
  let digits=digitsOf(raw);
  if(digits.startsWith("00"))digits=digits.slice(2);
  if(digits.length===10&&/^[6-9]/.test(digits))digits="91"+digits;
  return digits.length>=11&&digits.length<=15&&digits[0]!=="0"
    ?"https://wa.me/"+digits:"";
}
export function geoPlotWhatsAppHref(value,plotId,projectName){
  const base=geoWhatsAppHref(value);
  if(!base||!String(plotId??"").trim())return "";
  const message="Hello, I would like details about Plot "+String(plotId)+" in "+String(projectName||"the project")+".";
  return base+"?text="+encodeURIComponent(message);
}
