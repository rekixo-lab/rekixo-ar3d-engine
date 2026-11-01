import {useEffect,useState} from "react";
export type GeoPriceQuote={
 plotId:string;pricingType:"rate"|"fixed";unit:"sqft"|"sqm"|"sqyd";
 rate:number|null;fixedPrice:number|null;pricePaise:number;currency:"INR";evidenceRef:string
};
type State={mappingReleaseId:string|null;revision:number;rows:GeoPriceQuote[];
 sourceRef?:string;notice?:string};
type Preflight={mappingReleaseId:string;revision:number;count:number;added:number;
 changed:number;retained:number;previewSha256:string;sourceRef:string;
 sample:Array<{plotId:string;pricePaise:number;pricingType:string}>};
type Props={endpoint:string;mappingReleaseId:string|null;
 canEdit?:boolean;onQuotes?:(rows:GeoPriceQuote[])=>void};
const api=async<T,>(endpoint:string,body?:unknown):Promise<T>=>{
 const result=await fetch(endpoint,{method:body?"POST":"GET",cache:"no-store",
   headers:{"Accept":"application/json",...(body?{"Content-Type":"application/json"}:{})},
   ...(body?{body:JSON.stringify(body)}:{})});
 const data=await result.json() as T&{error?:string};
 if(!result.ok)throw Error(data.error||"Pricing sheet request failed.");
 return data;
};
const display=paise=>(paise/100).toLocaleString("en-IN",{style:"currency",currency:"INR"});
export default function GeoBulkPricingPanel({endpoint,mappingReleaseId,canEdit=true,onQuotes}:Props){
 const [state,setState]=useState<State|null>(null);
 const [csv,setCsv]=useState("");
 const [filename,setFilename]=useState("");
 const [sourceRef,setSourceRef]=useState("");
 const [preview,setPreview]=useState<Preflight|null>(null);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const [busy,setBusy]=useState(false);
 const refresh=async()=>{
  const value=await api<State>(endpoint);
  if(value.mappingReleaseId!==mappingReleaseId)throw Error("Published Geo mapping release changed. Reload the page.");
  setState(value);onQuotes?.(value.rows);
 };
 useEffect(()=>{
  let live=true;
  setState(null);setError("");setPreview(null);setCsv("");setFilename("");
  if(!mappingReleaseId){onQuotes?.([]);return;}
  void api<State>(endpoint).then(s=>{
   if(!live)return;
   if(s.mappingReleaseId!==mappingReleaseId)throw Error("Pricing source mapping release changed.");
   setState(s);setSourceRef(s.sourceRef||"");onQuotes?.(s.rows);
  }).catch(e=>{if(live)setError(String(e));});
  return()=>{live=false;};
 },[endpoint,mappingReleaseId]);
 const choose=async(file?:File)=>{
  if(!file)return;
  setError("");setPreview(null);setNotice("");
  if(file.size>250000||file.size<=0)throw Error("Pricing CSV must be under 250 KB.");
  const text=await file.text();
  setCsv(text);setFilename(file.name);
 };
 const runPreview=async()=>{
  if(!mappingReleaseId||!state||!csv||!sourceRef.trim())return;
  setBusy(true);setError("");setPreview(null);setNotice("");
  try{
   const data=await api<{preflight:Preflight}>(endpoint,{action:"preflight",csv,
     sourceRef:sourceRef.trim()});
   if(data.preflight.mappingReleaseId!==mappingReleaseId||
      data.preflight.revision!==state.revision)
    throw Error("Pricing preflight is stale. Reload current mapping.");
   setPreview(data.preflight);
   setNotice("Preflight complete — no status, public approval or price has changed.");
  }catch(e){setError(e instanceof Error?e.message:String(e));}
  finally{setBusy(false);}
 };
 const importPrices=async()=>{
  if(!preview||!state||!mappingReleaseId||busy)return;
  if(!window.confirm("Save "+preview.count+" PRIVATE price quotes to Geo mapping "+
     mappingReleaseId.slice(0,16)+"?\n"+
     "No Sold/Booked status, existing approved price or buyer record is modified. "+
     "Review and approve each price separately before it appears on the customer site."))return;
  setBusy(true);setError("");setNotice("");
  try{
   const updated=await api<State>(endpoint,{action:"import",csv,
    sourceRef:sourceRef.trim(),expectedRevision:preview.revision,
    previewSha256:preview.previewSha256});
   if(updated.mappingReleaseId!==mappingReleaseId)throw Error("Geo mapping changed.");
   setState(updated);onQuotes?.(updated.rows);setPreview(null);setCsv("");setFilename("");
   setNotice(updated.rows.length+" pricing source quotes saved privately. "+
     "Select a plot, apply its quote and separately confirm commercial approval.");
  }catch(e){setError(e instanceof Error?e.message:String(e));}
  finally{setBusy(false);}
 };
 const template=()=>{
  const rows=["plot_id,from_id,to_id,pricing_type,unit,rate,fixed_price,currency",
   ",1,10,rate,sqyd,14300,,INR","11,,,fixed,,,2500000,INR"];
  const url=URL.createObjectURL(new Blob([rows.join("\n")+"\n"],{type:"text/csv"}));
  const link=document.createElement("a");link.href=url;link.download="ar3d-geo-pricing-template.csv";link.click();
  window.setTimeout(()=>URL.revokeObjectURL(url),1500);
 };
 return <details className="geo-plot-review-dashboard">
  <summary>Bulk Pricing CSV · Fixed / area-rate / Plot ID ranges</summary>
  <p className="geo-plot-hint">Platform-compatible CSV: plot_id, from_id, to_id, pricing_type,
    unit, rate, fixed_price, currency. Exact Plot ID overrides a range. All calculations
    use the verified area in the ACTIVE immutable 3D mapping release. Prices are private
    until individually reviewed with a known plot status and explicit public approval.</p>
  {error&&<p className="geo-plot-warning" role="alert">{error}</p>}
  {notice&&<p className="geo-plot-message" role="status">{notice}</p>}
  <p>{state?.rows.length||0} private price suggestions · Mapping:
    {" "}{mappingReleaseId?.slice(0,18)||"not published"} · Pricing revision {state?.revision||0}</p>
  <button type="button" onClick={template}>Download Pricing CSV Template</button>
  {canEdit&&<>
   <label>Reviewed price source/reference<input value={sourceRef} maxLength={250}
     onChange={e=>{setSourceRef(e.target.value);setPreview(null);}}
     placeholder="Approved rate register / signed price sheet revision"/></label>
   <label>Import Pricing CSV (private draft)
    <input type="file" accept=".csv,text/csv" disabled={!state||busy}
      onChange={e=>{const file=e.target.files?.[0];e.target.value="";
        void choose(file).catch(err=>setError(String(err)));}}/>
   </label>
   {filename&&<p>{filename} selected. Preview before import.</p>}
   <button type="button" disabled={!csv||!state||busy||sourceRef.trim().length<3}
     onClick={()=>void runPreview()}>Preview Price Sheet — no writes</button>
   {preview&&<div role="status" className="geo-plot-review-dashboard">
    <p>{preview.count} priced · {preview.added} new · {preview.changed} changed ·
     {preview.retained} retained from previous private sheet</p>
    {preview.sample.slice(0,8).map(p=><p key={p.plotId}>Plot {p.plotId}: {display(p.pricePaise)}
     {" · "}{p.pricingType}</p>)}
    <button disabled={busy||preview.mappingReleaseId!==mappingReleaseId}
      onClick={()=>void importPrices()}>Confirm Private Pricing Import</button>
   </div>}
  </>}
  <p className="geo-plot-hint">Importing a new source sheet does not overwrite previously
    approved public status/prices. Pricing changes require a separate audited commercial save.
    Source evidence stays private.</p>
 </details>;
}
