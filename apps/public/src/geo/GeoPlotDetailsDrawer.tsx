import { useEffect, useMemo, useRef, useState } from "react";
import { publicGeoAreaUnits, publicGeoPlotDiagram, type PublicGeoPlotForDiagram } from "../../../../shared/geo-plot-detail-diagram.js";
import {geoPlotFacingEntries} from "../../../../shared/geo-plot-facing.js";
import GeoCompassRose from "./GeoCompassRose";
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
  commercial: GeoPlotDrawerCommercial | undefined;
  projectName: string;
  geoHeadingDeg: number;
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
  plot, commercial, projectName, geoHeadingDeg, publicPhone, publicWhatsappHref, onClose,
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
  // Display-only Platform parity: no published Booked/Sold status means Available.
  // Never write this fallback to the private commercial ledger.
  const displayStatus = commercial?.status==="booked"||commercial?.status==="sold"
    ?commercial.status:"available";
  const diagram = useMemo(()=>shown?publicGeoPlotDiagram(shown):null,[shown]);
  const facings=useMemo(()=>shown?geoPlotFacingEntries(shown,geoHeadingDeg):[],
    [shown,geoHeadingDeg]);
  const diagramBounds=useMemo(()=>{
    if(!diagram)return null;
    const coords=diagram.pointText.split(" ").map(pair=>pair.split(",").map(Number));
    const xx=coords.map(p=>p[0]),yy=coords.map(p=>p[1]);
    return {width:Math.max(...xx)-Math.min(...xx),height:Math.max(...yy)-Math.min(...yy)};
  },[diagram]);
  const thinShape=Boolean(diagramBounds&&diagramBounds.width<65&&diagramBounds.height>70);
  const wideShape=Boolean(diagramBounds&&diagramBounds.height<49);
  const facingFont=facings.length>2?8.1:9.3;
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
      data-plot-status={displayStatus}
      aria-hidden={!plot} inert={!plot} aria-label="Selected plot details"
      aria-live="off" data-testid="geo-plot-details-drawer">
      {shown && <>
        <div className="geo-plot-drawer__head">
          <div className="geo-plot-drawer__heading">
            <span className="geo-plot-drawer__eyebrow">PLOT DETAILS</span>
            <h2>{"Plot "+shown.id}</h2>
          </div>
          <button ref={closeButtonRef} className="geo-plot-drawer__close"
            type="button" aria-label="Close plot details" onClick={onClose}>×</button>
        </div>
        <div className="geo-plot-drawer__scroll">
          <section className="geo-plot-drawer__diagram-card" aria-label="Plot boundary diagram">
            <div className="geo-plot-drawer__section-top">
              <span className={"geo-plot-drawer__status geo-plot-drawer__status--"+displayStatus}>
                {prettyStatus(displayStatus)}
              </span>
              {facings.length>0&&(
                <div className="geo-plot-drawer__compass-preview"
                  role="img"
                  aria-label={"Geographic facing of Plot "+shown.id+": "+facings.map(face=>face.label).join(", ")}>
                  <GeoCompassRose facingDirections={facings.map(face=>face.direction)}/>
                  <span className="geo-plot-drawer__compass-caption">
                    <small>TRUE NORTH</small>
                    <strong>{facings.map(face=>face.label).join(" / ")}</strong>
                  </span>
                </div>
              )}
            </div>
            {diagram ? <>
              <svg viewBox="0 0 320 210" className="geo-plot-drawer__svg"
                role="img" aria-label={"Shape of Plot "+shown.id+" based on published model polygon"}>
                <defs>
                  <marker id="geo-facing-arrow-tip" markerWidth="5" markerHeight="5"
                    refX="4" refY="2.5" orient="auto" markerUnits="userSpaceOnUse">
                    <path d="M0 0 L5 2.5 L0 5 Z" className="geo-plot-drawer__facing-tip"/>
                  </marker>
                </defs>
                <polygon points={diagram.pointText} className="geo-plot-drawer__poly"/>
                {facings.map(face=>{
                  const side=diagram.sides.find(item=>item.role===face.role);
                  if(!side?.segments.length)return null;
                  const seg=side.segments.reduce((largest,current)=>
                    current.length>largest.length?current:largest);
                  const mx=(seg.x1+seg.x2)/2,my=(seg.y1+seg.y2)/2;
                  const coords=diagram.pointText.split(" ").map(pair=>pair.split(",").map(Number));
                  const signed=coords.reduce((total,pt,i)=>{
                    const next=coords[(i+1)%coords.length];
                    return total+pt[0]*next[1]-next[0]*pt[1];
                  },0);
                  if(Math.abs(signed)<1e-8||seg.length<1)return null;
                  const winding=Math.sign(signed),dx=(seg.x2-seg.x1)/seg.length,
                    dy=(seg.y2-seg.y1)/seg.length;
                  // Point the arrow outward on its own physical road edge.
                  // Its base and tip stay just inside that edge, even on concave plots.
                  const normalX=winding*dy,normalY=-winding*dx;
                  return <line key={"facing-arrow-"+face.role}
                    x1={mx-normalX*17} y1={my-normalY*17}
                    x2={mx-normalX*3} y2={my-normalY*3}
                    className="geo-plot-drawer__facing-arrow"
                    markerEnd="url(#geo-facing-arrow-tip)"
                    aria-hidden="true"/>;
                })}
                {diagram.sides.map(side=>side.segments.map((segment,i)=>
                  <line key={side.role+"-"+i} x1={segment.x1} y1={segment.y1}
                    x2={segment.x2} y2={segment.y2}
                    className="geo-plot-drawer__side-edge" vectorEffect="non-scaling-stroke"/>
                ))}
                <text x="160" y={facings.length?(thinShape?88:wideShape?101:88):109}
                  textAnchor="middle" dominantBaseline="middle"
                  className="geo-plot-drawer__plot-label">{shown.id}</text>
                {facings.length>0&&(
                  thinShape?
                    <g transform="translate(160 130) rotate(-90)" aria-label={"Facing "+facings.map(face=>face.label).join(", ")}>
                      {facings.map((face,i)=><text key={face.role}
                        x="0" y={(i-(facings.length-1)/2)*10}
                        fontSize={facingFont} textAnchor="middle"
                        className="geo-plot-drawer__facing-label">
                        {face.arrow+" "+face.label}
                      </text>)}
                    </g>
                    :wideShape?
                    <text x="160" y="115" textAnchor="middle" fontSize="8"
                      textLength={Math.min(diagramBounds?.width||150,170)-8}
                      lengthAdjust="spacingAndGlyphs"
                      className="geo-plot-drawer__facing-label">
                      {facings.map(face=>face.arrow+" "+face.label).join(" · ")}
                    </text>
                    :<g aria-label={"Facing "+facings.map(face=>face.label).join(", ")}>
                      {facings.map((face,i)=><text key={face.role}
                        x="160" y={106+i*11}
                        fontSize={facingFont} textAnchor="middle"
                        className="geo-plot-drawer__facing-label">
                        {face.arrow+" "+face.label}
                      </text>)}
                    </g>
                )}
                {diagram.sides.map(side=>side.labelX!==null&&side.labelY!==null
                  ?<text key={side.role} x={side.labelX} y={side.labelY}
                    textAnchor="middle" dominantBaseline="middle"
                    className="geo-plot-drawer__side-label">
                      <tspan x={side.labelX} dy="-0.45em">{side.label}</tspan>
                      <tspan x={side.labelX} dy="1.3em" className="geo-plot-drawer__side-label-value">
                        {formatMeasurement(side.length,side.unit)}
                      </tspan>
                    </text>
                  :null)}
              </svg>
            </> : <p className="geo-plot-drawer__muted">Plot outline is unavailable.</p>}
          </section>
          <section className="geo-plot-drawer__facts" aria-label="Plot measurements and status">
            <h3>Plot Measurements</h3>
            {areas.length ? areas.map(area=>
              <div className="geo-plot-drawer__fact" key={area.unit}>
                <span>{area.label}</span>
                <b>{formatMeasurement(area.value,area.unit)}</b>
              </div>
            ) : null}
            {allRoles.map(role=>{
              const side=shown.sides[role];
              if(!side||!(side.length>0))return null;
              return <div className="geo-plot-drawer__fact" key={role}>
                <span>{sideNames[role]}</span>
                <b>{formatMeasurement(side.length,side.unit)}</b>
              </div>;
            })}
            {facings.length?<div className="geo-plot-drawer__fact">
              <span>Facing</span><b>{facings.map(face=>face.arrow+" "+face.label).join(" · ")}</b>
            </div>:null}
            {shown.road?<div className="geo-plot-drawer__fact">
              <span>Road access</span><b>{shown.road}</b>
            </div>:null}
            {approvedPrice?<div className="geo-plot-drawer__fact">
              <span>Price</span><b>{approvedPrice}</b>
            </div>:null}
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
