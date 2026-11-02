import { useEffect, useMemo, useRef, useState } from "react";
import { publicGeoAreaUnits, publicGeoPlotDiagram, type PublicGeoPlotForDiagram } from "../../../../shared/geo-plot-detail-diagram.js";
import "./geo-plot-details-drawer.css";

export type GeoPlotDrawerPlot = PublicGeoPlotForDiagram & {
  id: string;
  planeY?: number;
  facing: string | null;
  road: string | null;
  notes: string;
  area: { value: number; unit: string } | null;
};
export type GeoPlotDrawerCommercial = {
  status: "available" | "booked" | "sold";
  pricePaise: number | null;
  currency: "INR";
};

type Props = {
  plot: GeoPlotDrawerPlot | null;
  publicationMode: "verified" | "preliminary" | undefined;
  commercial: GeoPlotDrawerCommercial | undefined;
  projectName: string;
  publicPhone?: string;
  publicWhatsappHref?: string;
  onClose: () => void;
};
const sideNames: Record<string,string> = {
  front: "Front", back: "Back", depthA: "Depth A", depthB: "Depth B",
};
function formatMeasurement(value:number,unit:string) {
  return new Intl.NumberFormat("en-IN",{maximumFractionDigits:2}).format(value) + " " + unit;
}
const prettyStatus = (status: GeoPlotDrawerCommercial["status"]) =>
  status === "available" ? "Available" : status === "booked" ? "Booked" : "Sold";

export function GeoPlotDetailsDrawer({
  plot, publicationMode, commercial, projectName, publicPhone, publicWhatsappHref, onClose,
}: Props) {
  const [previousPlot,setPreviousPlot] = useState<GeoPlotDrawerPlot | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  useEffect(()=>{
    if (plot) {
      setPreviousPlot(plot);
      closeButtonRef.current?.focus({preventScroll:true});
      return;
    }
    const timer = window.setTimeout(()=>setPreviousPlot(null),270);
    return ()=>window.clearTimeout(timer);
  },[plot]);
  useEffect(()=>{
    if (!plot) return;
    const onKeyDown = (event:KeyboardEvent) => {
      if(event.key==="Escape") {event.preventDefault();onClose();}
    };
    window.addEventListener("keydown",onKeyDown);
    return ()=>window.removeEventListener("keydown",onKeyDown);
  },[plot,onClose]);
  const shown = plot || previousPlot;
  const diagram = useMemo(()=>shown?publicGeoPlotDiagram(shown):null,[shown]);
  const areas = useMemo(()=>shown?publicGeoAreaUnits(shown.area):[],[shown]);
  const allRoles = shown?.layout==="three" || shown?.corners.length===3
    ? ["front","back","depthA"] : ["front","back","depthA","depthB"];
  const safePhone=(publicPhone||"").replace(/[^0-9+]/g,"");
  const callHref=/^\+?[0-9]{10,15}$/.test(safePhone)?"tel:"+safePhone:"";
  const whatsappHref=publicWhatsappHref&&shown
    ? publicWhatsappHref+"?text="+encodeURIComponent("Hello, I would like details about Plot "+shown.id+" in "+projectName+".")
    : "";
  const price=commercial?.pricePaise;
  const approvedPrice=typeof price==="number"&&Number.isSafeInteger(price)&&price>0
    ?new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:0})
      .format(price/100):"";
  return (
    <aside className={"geo-plot-drawer"+(plot?" is-open":"")}
      aria-hidden={!plot} inert={!plot} aria-label="Selected plot details"
      aria-live="off" data-testid="geo-plot-details-drawer">
      {shown && <>
        <div className="geo-plot-drawer__head">
          <div className="geo-plot-drawer__heading">
            <span className="geo-plot-drawer__eyebrow">PLOT DETAILS</span>
            <h2>{"Plot "+shown.id}</h2>
            <span className={"geo-plot-drawer__status geo-plot-drawer__status--"+(commercial?.status||"mapping")}>
              {commercial?prettyStatus(commercial.status):"Mapped plot"}
            </span>
          </div>
          <button ref={closeButtonRef} className="geo-plot-drawer__close"
            type="button" aria-label="Close plot details" onClick={onClose}>×</button>
        </div>
        <div className="geo-plot-drawer__scroll">
          <section className="geo-plot-drawer__diagram-card" aria-label="Plot boundary diagram">
            <div className="geo-plot-drawer__section-top">
              <b>Mapped Plot Shape</b>
              {diagram?<small>{diagram.vertexCount+" corners"}</small>:null}
            </div>
            {diagram ? <>
              <svg viewBox="0 0 320 220" className="geo-plot-drawer__svg"
                role="img" aria-label={"Shape of Plot "+shown.id+" based on published model polygon"}>
                <polygon points={diagram.pointText} className="geo-plot-drawer__poly"/>
                {diagram.sides.map(side=>side.segments.map((segment,i)=>
                  <line key={side.role+"-"+i} x1={segment.x1} y1={segment.y1}
                    x2={segment.x2} y2={segment.y2}
                    stroke={side.color} strokeWidth="3.5" strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"/>
                ))}
                <text x="160" y="109" textAnchor="middle" dominantBaseline="middle"
                  className="geo-plot-drawer__plot-label">{shown.id}</text>
                {diagram.sides.map(side=>side.labelX!==null&&side.labelY!==null
                  ?<text key={side.role} x={side.labelX} y={side.labelY}
                    textAnchor="middle" dominantBaseline="middle"
                    fill={side.color} className="geo-plot-drawer__side-label">{side.label}</text>
                  :null)}
              </svg>
              <div className="geo-plot-drawer__side-legend">
                {diagram.sides.map(side=>
                  <div key={side.role} className="geo-plot-drawer__side">
                    <span className="geo-plot-drawer__side-name">
                      <i style={{backgroundColor:side.color}} aria-hidden="true"/>
                      {side.label}{side.roadFacing?" · Road":""}
                    </span>
                    <b>{formatMeasurement(side.length,side.unit)}</b>
                  </div>
                )}
              </div>
            </> : <p className="geo-plot-drawer__muted">Plot outline is unavailable.</p>}
            <small className="geo-plot-drawer__shape-note">
              Shape follows the published 3D mapping; dimensions are shown only from approved sources.
            </small>
          </section>
          <section className="geo-plot-drawer__facts" aria-label="Plot measurements and status">
            <h3>Plot Measurements</h3>
            {areas.length ? areas.map(area=>
              <div className="geo-plot-drawer__fact" key={area.unit}>
                <span>{area.label}</span>
                <b>{formatMeasurement(area.value,area.unit)}</b>
              </div>
            ) : <div className="geo-plot-drawer__fact">
              <span>Verified plot area</span><b>Not published</b>
            </div>}
            {allRoles.map(role=>{
              const side=shown.sides[role];
              if(!side||!(side.length>0))return null;
              return <div className="geo-plot-drawer__fact" key={role}>
                <span>{sideNames[role]}</span>
                <b>{formatMeasurement(side.length,side.unit)}</b>
              </div>;
            })}
            {shown.facing?<div className="geo-plot-drawer__fact">
              <span>Facing</span><b>{shown.facing}</b>
            </div>:null}
            {shown.road?<div className="geo-plot-drawer__fact">
              <span>Road access</span><b>{shown.road}</b>
            </div>:null}
            {approvedPrice?<div className="geo-plot-drawer__fact">
              <span>Approved price</span><b>{approvedPrice}</b>
            </div>:null}
            {!commercial?<p className="geo-plot-drawer__muted">
              Commercial status and price are not independently approved for public display.
            </p>:null}
            {publicationMode==="preliminary"?<p className="geo-plot-drawer__review-note">
              Preliminary mapped boundary. Unreviewed measurements and directions are not displayed.
            </p>:null}
            {shown.notes?<p className="geo-plot-drawer__notes">{shown.notes}</p>:null}
          </section>
          {callHref||whatsappHref?<nav className="geo-plot-drawer__contact" aria-label="Published project contact actions">
            {whatsappHref?<a href={whatsappHref} target="_blank" rel="noopener noreferrer"
              className="geo-plot-drawer__whatsapp">WhatsApp</a>:null}
            {callHref?<a href={callHref} className="geo-plot-drawer__call">Call Now</a>:null}
          </nav>:null}
        </div>
      </>}
    </aside>
  );
}
