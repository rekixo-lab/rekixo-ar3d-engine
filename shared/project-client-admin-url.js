// Canonical owner-separated Engine Client Admin route. Public customer pages
// never point to the Engine Owner console or share its authentication cookie.
export const CLIENT_ADMIN_ORIGIN="https://admin.rekixo.com";
export function projectClientAdminPath(slug){
 const normalized=String(slug||"").trim().toLowerCase();
 if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized)||normalized.length>80)
  throw Error("Invalid project slug for Client Admin.");
 return "/3Dprojects/"+encodeURIComponent(normalized)+"/client-admin";
}
export function projectClientAdminUrl(slug){
 return CLIENT_ADMIN_ORIGIN+projectClientAdminPath(slug);
}
