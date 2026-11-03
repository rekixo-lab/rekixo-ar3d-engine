import {useState} from "react";
import {getProjectBranding} from "../studio/cloud";
import {projectClientAdminUrl} from "../../../../shared/project-client-admin-url.js";
import "./project-handoff-check.css";

type Check={label:string;state:"ok"|"review"|"manual";detail:string;href?:string};
type Props={slug:string;kind:string;buildingLive:boolean;geoLive:boolean;geoMapped:boolean};
type MP={draft:{revision:number;verifiedRevision:number|null;imageAssetId:string|null;
  controlPoints:Array<{verified:boolean;source:string}>;
  plots:Array<{id:string;area?:{value:number;verified:boolean;source:string};
    facingVerified?:boolean;facingSource?:string;sides?:Record<string,{length:number;verified:boolean;source:string}>;road?:string}>};
  activeRelease:{id:string;version:number;draftRevision:number}|null};
type MPShare={active:{cardAssetId:string;version:number}|null;shareUrl:string};
type Manage={clients:Array<{proposedRole:string;grantActive?:boolean;credentialLoginId?:string|null}>};
async function json<T>(url:string):Promise<T>{
  const response=await fetch(url,{cache:"no-store",headers:{Accept:"application/json"}});
  const data=await response.json() as T&{error?:string};
  if(!response.ok)throw Error(data.error||"Handoff check endpoint unavailable.");
  return data;
}
export default function ProjectHandoffCheck({slug,kind,buildingLive,geoLive,geoMapped}:Props){
  const [busy,setBusy]=useState(false);
  const [checks,setChecks]=useState<Check[]|null>(null);
  const [checkedAt,setCheckedAt]=useState("");
  const [error,setError]=useState("");
  async function run(){
    if(!slug)return;setBusy(true);setError("");setChecks(null);
    const results:Check[]=[];
    const origin="/3Dprojects/api/cloud/projects/"+encodeURIComponent(slug);
    const masterplan=kind==="masterplan_geo";
    const publicUrl="/3Dprojects/"+encodeURIComponent(slug)+(masterplan?"/masterplan":kind==="building"?"":geoLive?"/geo":"");
    if(masterplan){
      try{
        const m=await json<MP>(origin+"/masterplan-geo");
        const live=Boolean(m.activeRelease);
        results.push({label:"Live Masterplan",state:live?"ok":"review",
          detail:live?"Published v"+m.activeRelease!.version:"Mapping not published",href:live?publicUrl:undefined});
        const draftIsLive=Boolean(live&&m.activeRelease!.draftRevision===m.draft.revision);
        const issueCount=m.draft.plots.reduce((total,p)=>{
          const sides=Object.values(p.sides||{});
          return total+Number(!p.area?.value||!p.area.verified||!p.area.source)+
            Number(!p.facingVerified||!p.facingSource)+
            sides.filter(side=>!side.length||!side.verified||!side.source).length;
        },0)+m.draft.controlPoints.filter(p=>!p.verified||!p.source).length;
        results.push({label:"Mapping & measurements",
          state:draftIsLive&&issueCount===0&&m.draft.controlPoints.length>=3?"ok":"review",
          detail:draftIsLive
            ? m.draft.plots.length+" plots in current release · "+issueCount+" review issues"
            : "Current draft differs from live mapping; inspect the active immutable release separately."});
      }catch(e){results.push({label:"Masterplan mapping",state:"review",
        detail:e instanceof Error?e.message:"Mapping unavailable"});}
      try{
        const share=await json<MPShare>(origin+"/masterplan-share");
        results.push({label:"WhatsApp share image",state:share.active?.cardAssetId?"ok":"review",
          detail:share.active?"Published preview v"+share.active.version:"No published Masterplan poster",
          href:share.active?share.shareUrl:undefined});
      }catch(e){results.push({label:"WhatsApp share image",state:"review",
        detail:e instanceof Error?e.message:"Share unavailable"});}
    }else{
      results.push({label:"3D Building website",state:buildingLive?"ok":"review",
        detail:buildingLive?"Active immutable Building release":"Building has no active verified release",
        href:buildingLive?"/3Dprojects/"+encodeURIComponent(slug):undefined});
      if(kind==="building_geo"||geoLive){
        results.push({label:"Geo website",state:geoLive?"ok":"review",
          detail:geoLive?"Active immutable Geo release":"Geo release missing",
          href:geoLive?"/3Dprojects/"+encodeURIComponent(slug)+"/geo":undefined});
        results.push({label:"Geo Plot Mapping",state:geoMapped?"ok":"review",
          detail:geoMapped?"Mapping release current":"Mapping not current or not published"});
      }
      try{
        const branding=await getProjectBranding(slug);
        const experience=kind==="building"?"building":geoLive?"geo":"building";
        results.push({label:"Published project logo",state:branding.logo.publishedLogoUrl?"ok":"review",
          detail:branding.logo.publishedLogoUrl?"Published logo available":"No published customer logo"});
        results.push({label:"WhatsApp share image",state:branding.experiences[experience].shareReady?"ok":"review",
          detail:branding.experiences[experience].shareReady?"Share metadata and poster published":"Share preview incomplete",
          href:branding.experiences[experience].shareReady?branding.experiences[experience].shareUrl:undefined});
      }catch(e){results.push({label:"Logo / Share metadata",state:"review",
        detail:e instanceof Error?e.message:"Branding data unavailable"});}
    }
    try{
      const manage=await json<Manage>(origin+"/manage");
      const clientAdmins=manage.clients.filter(c=>c.proposedRole==="client_admin"&&
        (c.grantActive||c.credentialLoginId)).length;
      results.push({label:"Project Client Admin",state:clientAdmins?"ok":"review",
        detail:clientAdmins?clientAdmins+" provisioned Client Admin account(s); login still needs a manual test":
          "No provisioned Client Admin account",href:projectClientAdminUrl(slug)});
    }catch(e){results.push({label:"Project Client Admin",state:"review",
      detail:e instanceof Error?e.message:"Client Admin data unavailable",href:projectClientAdminUrl(slug)});}
    results.push({label:"Live browser & mobile verification",state:"manual",
      detail:"Open customer site, inspect plots and test desktop, Android and iPhone; not verified by this dashboard."});
    results.push({label:"Backup / restore proof",state:"manual",
      detail:"Confirm current D1 and R2 bytes were archived and an isolated restore was tested. A review JSON alone is not a backup."});
    if(kind==="building_geo"||geoLive)
      results.push({label:"Geo field acceptance",state:"manual",
        detail:"Independently verify survey controls, mobile touch and source-backed plotted corners before handoff."});
    setChecks(results);setCheckedAt(new Date().toLocaleString());setBusy(false);
  }
  const ok=checks?.filter(c=>c.state==="ok").length||0;
  const review=checks?.filter(c=>c.state==="review").length||0;
  const manual=checks?.filter(c=>c.state==="manual").length||0;
  return <section className="engine-handoff engine-control-card" aria-label="Customer handoff check">
    <div className="engine-handoff__head">
      <div><p>CUSTOMER HANDOFF</p><h3>Delivery readiness</h3>
        <small>Read-only checks · no publish or approval action</small></div>
      <button type="button" disabled={busy} onClick={()=>void run()}>
        {busy?"Checking…":checks?"Recheck Handoff":"Check Handoff"}
      </button>
    </div>
    {error&&<p role="alert">{error}</p>}
    {checks&&<>
      <p className="engine-handoff__summary">{ok} ready · {review} need attention · {manual} manual checks · {checkedAt}</p>
      <div className="engine-handoff__items">
        {checks.map((item,index)=><article key={item.label+"-"+index}>
          <strong><span className={"engine-handoff__dot engine-handoff__dot--"+item.state} />
            {item.label}</strong>
          <small>{item.detail}</small>
          {item.href&&<a href={item.href} target="_blank" rel="noreferrer">Open</a>}
        </article>)}
      </div>
      <p className="engine-handoff__notice">This checklist does not certify survey accuracy, social crawler delivery, customer login or cloud backup by itself.</p>
    </>}
  </section>;
}
