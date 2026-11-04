import { useState } from "react";
import { applyCosmeticGeoReplacement, inspectCosmeticGeoReplacement } from "../studio/cloud";
import "./geo-easy-replace.css";

/** Only one operator action, but never an unreviewed live mutation. */
export default function GeoEasyReplace({
  slug, onApplied,
}: {
  slug: string;
  onApplied?: () => Promise<void> | void;
}) {
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  async function replace(){
    if(!slug||busy)return;
    setBusy(true);setMessage("");setError("");
    try{
      const inspection=await inspectCosmeticGeoReplacement(slug);
      if(inspection.alreadyCurrent){
        setMessage("Geo already uses your current Building model.");
        return;
      }
      if(!inspection.eligible||!inspection.token)
        throw Error("Geometry proof unavailable. The current live Geo was not changed.");
      const approved=window.confirm(
        "SAFE AUTO GEO REPLACE\n\n"+
        "Building: v"+inspection.fromBuildingVersion+" → v"+inspection.toBuildingVersion+
        "\n"+inspection.plotCount+" mapped plots stay exactly in place."+
        "\n"+(inspection.commercialCount||0)+" status/price records stay intact."+
        "\n\n"+(inspection.proof || "The server verified equivalent visible site geometry.")+" "+
        "Only visual colors/materials may differ. Building Geo alignment will stay unchanged. "+
        "Geo and Plot Mapping publish together with no intermediate blank map. "+
        "Old versions remain available.\n\nUpdate Geo now?"
      );
      if(!approved){setMessage("Cancelled. Current live Geo and plots are unchanged.");return;}
      const result=await applyCosmeticGeoReplacement(slug,inspection.token);
      if(result.alreadyCurrent){
        setMessage("Geo already uses the current Building model.");
      }else if(result.updated){
        setMessage("Geo v"+result.geoReleaseVersion+" updated successfully. "+
          result.plotCount+" plots and their status records were preserved. "+
          "Please open the live Geo site and visually recheck the colors.");
      }else throw Error("Could not confirm Geo publication. Reload and check live status.");
      await onApplied?.();
    }catch(reason){
      setError((reason instanceof Error?reason.message:String(reason))+
        " Your existing live Geo and plot data were not intentionally overwritten.");
    }finally{setBusy(false);}
  }
  return <section className="geo-easy-replace" aria-label="Easy Geo model replacement">
    <div className="geo-easy-replace__content">
      <strong>Replace Geo Model</strong>
      <span>Changed only colors/materials? Automatically verify and keep all plotted boundaries and statuses.</span>
    </div>
    <button type="button" disabled={busy||!slug} onClick={()=>void replace()}>
      {busy?"Checking models…":"Auto Update Geo"}
    </button>
    {message&&<p role="status" className="geo-easy-replace__success">{message}</p>}
    {error&&<p role="alert" className="geo-easy-replace__error">{error}</p>}
  </section>;
}
