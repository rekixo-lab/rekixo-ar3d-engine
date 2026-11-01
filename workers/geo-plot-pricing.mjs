import {activeMap} from "./geo-plot-commercial.mjs";
import {parseGeoPriceSheetCsv,expandGeoPriceSheet} from "../shared/geo-plot-pricing-sheet.js";
const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
const digest=async txt=>Array.from(new Uint8Array(await crypto.subtle.digest(
 "SHA-256",new TextEncoder().encode(txt)))).map(b=>b.toString(16).padStart(2,"0")).join("");
const validSource=s=>typeof s==="string"&&s.trim().length>=3&&s.trim().length<=250&&
 !/[\x00-\x1f\x7f]/.test(s);
async function sheetState(env,ctx,source){
 if(!source)return {mappingReleaseId:null,revision:0,rows:[],notice:"Publish the verified Geo mapping before uploading pricing."};
 const row=await env.DB.prepare(`SELECT revision,quotes_json,sha256,source_ref AS sourceRef,
  updated_at AS updatedAt
  FROM geo_plot_pricing_sheets_3d WHERE project_id=? AND mapping_release_id=?`)
  .bind(ctx.project.id,source.releaseId).first();
 if(row&&await digest(row.quotes_json)!==row.sha256)
  throw Error("Private pricing sheet SHA-256 integrity check failed.");
 return {mappingReleaseId:source.releaseId,revision:Number(row?.revision||0),
   rows:row?JSON.parse(row.quotes_json):[],sourceRef:row?.sourceRef||"",
   updatedAt:row?.updatedAt||null,
   notice:"Bulk prices are private review suggestions only. Status and public approval never change on import."};
}
export async function handleGeoPlotPricingSheet(request,env,ctx,actor){
 if(!["GET","POST"].includes(request.method))return json({error:"Method not allowed."},405);
 try{
  const source=await activeMap(env,ctx);
  if(request.method==="GET")return json(await sheetState(env,ctx,source));
  if(ctx.project.status==="archived")return json({error:"Archived project is read-only."},409);
  if(!source)throw Error("A verified published Geo Plot mapping is required for pricing.");
  const raw=await request.text();
  if(raw.length>260000)throw Error("Pricing import request exceeds 260 KB.");
  const body=JSON.parse(raw);
  if(!body||!["preflight","import"].includes(body.action))
   throw Error("Select pricing preflight or explicit import.");
  if(!validSource(body.sourceRef))throw Error("Approved pricing sheet/source reference (3–250 characters) required.");
  const rules=parseGeoPriceSheetCsv(body.csv);
  const expanded=expandGeoPriceSheet(rules,source.plots);
  const previous=await sheetState(env,ctx,source);
  const next=new Map(previous.rows.map(row=>[row.plotId.toLowerCase(),row]));
  let added=0,changed=0;
  for(const price of expanded){
    const row={...price,evidenceRef:body.sourceRef.trim()};
    const prior=next.get(price.plotId.toLowerCase());
    if(!prior)added++;
    else if(JSON.stringify(prior)!==JSON.stringify(row))changed++;
    next.set(row.plotId.toLowerCase(),row);
  }
  const rows=[...next.values()].sort((a,b)=>a.plotId.localeCompare(b.plotId,undefined,{numeric:true}));
  if(rows.length>2500)throw Error("Pricing sheet exceeds 2,500 Geo plots.");
  const text=JSON.stringify(rows),sha256=await digest(text);
  if(text.length>1000000)throw Error("Pricing source expansion exceeds 1 MB.");
  const preflight={mappingReleaseId:source.releaseId,revision:previous.revision,
    count:expanded.length,added,changed,retained:rows.length-expanded.length,
    sample:expanded.slice(0,30).map(x=>({plotId:x.plotId,pricePaise:x.pricePaise,pricingType:x.pricingType})),
    previewSha256:sha256,sourceRef:body.sourceRef.trim()};
  if(body.action==="preflight")return json({preflight});
  if(!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision!==previous.revision||
     body.previewSha256!==sha256)
    return json({error:"Price-sheet review is stale. Run preflight again before importing."},409);
  if(!added&&!changed)return json({...previous,notice:"All imported price quotes already match the current private source sheet."});
  const now=new Date().toISOString(),nextRev=previous.revision+1;
  const guard=`EXISTS (SELECT 1 FROM geo_plot_mapping_active_3d a
    JOIN geo_plot_mapping_releases_3d r ON r.id=a.mapping_release_id
      AND r.project_id=a.project_id AND r.experience_id=a.experience_id
    WHERE a.project_id=? AND a.experience_id=? AND a.mapping_release_id=?
      AND r.geo_release_id=? AND r.building_release_id=?)`;
  const args=[ctx.project.id,ctx.active.experience_id,source.releaseId,
   ctx.active.geo_release_id,ctx.active.source_building_release_id];
  const write=previous.revision===0?
    env.DB.prepare(`INSERT INTO geo_plot_pricing_sheets_3d
      (project_id,mapping_release_id,revision,quotes_json,sha256,source_ref,updated_by,updated_at)
      SELECT ?,?,?,?,?,?,?,? WHERE ${guard}
      AND NOT EXISTS(SELECT 1 FROM geo_plot_pricing_sheets_3d
        WHERE project_id=? AND mapping_release_id=?)`)
      .bind(ctx.project.id,source.releaseId,nextRev,text,sha256,body.sourceRef.trim(),actor.email,now,
        ...args,ctx.project.id,source.releaseId)
    :env.DB.prepare(`UPDATE geo_plot_pricing_sheets_3d
      SET revision=revision+1,quotes_json=?,sha256=?,source_ref=?,updated_by=?,updated_at=?
      WHERE project_id=? AND mapping_release_id=? AND revision=? AND ${guard}`)
      .bind(text,sha256,body.sourceRef.trim(),actor.email,now,
        ctx.project.id,source.releaseId,previous.revision,...args);
  const results=await env.DB.batch([
    write,
    env.DB.prepare(`INSERT INTO engine_admin_audit
      (id,actor_email,action,project_id,target_id,details_json,created_at)
      SELECT ?,?,?,?,?,?,? WHERE EXISTS(
      SELECT 1 FROM geo_plot_pricing_sheets_3d
      WHERE project_id=? AND mapping_release_id=? AND revision=? AND sha256=?)`)
     .bind(crypto.randomUUID(),actor.email,"geo.private_pricing_sheet_imported",ctx.project.id,source.releaseId,
       JSON.stringify({added,changed,private:true,revision:nextRev,sourceRef:body.sourceRef.trim()}),
       now,ctx.project.id,source.releaseId,nextRev,sha256)
  ]);
  if(results[0]?.meta?.changes!==1||results[1]?.meta?.changes!==1)
    throw Error("Pricing sheet changed concurrently or Geo source was replaced. Reload.");
  return json(await sheetState(env,ctx,source));
 }catch(error){return json({error:error instanceof Error?error.message:"Pricing import failed."},409);}
}
