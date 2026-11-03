// The public Worker must be attached to the custom hostname in Cloudflare first.
const builtin=["ar3dstudio.in","localhost","127.0.0.1"];
const reply=(error,status=404)=>Response.json({error},{status,headers:{"Cache-Control":"no-store"}});
export async function optionalCustomerDomain(req,env,url){
 const host=url.hostname.toLowerCase();
 if(builtin.includes(host)||host.endsWith(".workers.dev")||host.endsWith(".test")||
    host.endsWith(".local")||host.endsWith(".localhost"))return null;
 let entry;
 try{entry=await env.DB.prepare(`SELECT d.*,p.slug,p.project_kind AS kind,
 p.status AS projectStatus,p.id AS projectId
 FROM engine_project_domains_3d d JOIN projects_3d p ON p.id=d.project_id
 WHERE d.hostname=?`).bind(host).first();}
 catch{return reply("Customer domain registry unavailable.",503);}
 if(!entry)return reply("Unknown customer hostname.");
 const proof=url.pathname.match(/^\/3Dprojects\/api\/domain-proof\/([a-f0-9]{64})$/);
 if(proof&&req.method==="GET")
  return entry.status!=="disabled"&&entry.challenge===proof[1]?
   Response.json({type:"ar3d-domain-proof",hostname:host,projectId:entry.projectId,challenge:entry.challenge}):
   reply("Invalid domain proof.");
 if(entry.status!=="active"||entry.projectStatus==="archived")return reply("Customer domain is not active.");
 const slug=encodeURIComponent(entry.slug);
 if(url.pathname==="/"){
  const suffix=entry.kind==="masterplan_geo"?"/masterplan":entry.kind==="building_geo"?"/geo":"";
  return Response.redirect("https://"+host+"/3Dprojects/"+slug+suffix,302);
 }
 if(url.pathname==="/3Dprojects/api/domain-context"&&req.method==="GET")
  return Response.json({projectSlug:entry.slug,projectKind:entry.kind});
 // Keep /admin in the browser address bar. The SPA loads its project scope above.
 if(url.pathname==="/admin"||url.pathname==="/admin/")return null;
 const scoped=url.pathname.match(/^\/3Dprojects\/api\/(?:projects|client-portal\/projects)\/([^/]+)/);
 if(scoped&&scoped[1]!==slug)return reply("Wrong project for this domain.");
 const page=url.pathname.match(/^\/3Dprojects\/([^/]+)/);
 if(page&&page[1]!=="api"&&page[1]!=="assets"&&page[1]!==slug)return reply("Wrong project for this domain.");
 return null;
}
