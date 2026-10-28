import { useEffect, useRef, useState } from "react";
import GeoMapper3DV2 from "./GeoMapper3DV2";
import "./geo-control-center.css";

type GeoStage = "source" | "place" | "align" | "fine" | "publish";

function projectSlug() {
  return new URLSearchParams(window.location.search).get("project")?.trim().toLowerCase() || "";
}

function classifyGeoSections(root: HTMLElement) {
  const cards = Array.from(root.querySelectorAll<HTMLElement>(".geo3d-form-card"));
  for (const card of cards) {
    const heading = card.querySelector("h3")?.textContent?.trim().toLowerCase() || "";
    let section = "";
    if (heading.includes("immutable building release")) section = "source";
    else if (heading.includes("wgs84 + local enu")) section = "fine";
    else if (heading.includes("create explicit model anchor")) section = "anchor";
    else if (heading.includes("publication gate")) section = "publish";
    else if (heading.includes("browser key")) section = "provider";
    if (section) card.dataset.geoSection = section;
  }

  const anchorCard = root.querySelector<HTMLElement>('[data-geo-section="anchor"]');
  const modelAnchorSelect = root.querySelector<HTMLSelectElement>('[data-geo-model-anchor]');
  if (anchorCard) {
    const realAnchorCount = modelAnchorSelect
      ? Array.from(modelAnchorSelect.options).filter((option) => option.value).length
      : 0;
    anchorCard.dataset.geoRequired = realAnchorCount > 0 ? "false" : "true";
  }
}

export default function GeoWorkspace() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const classify = () => classifyGeoSections(root);
    classify();
    const observer = new MutationObserver(classify);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  function scrollToStage(stage: GeoStage) {
    const root = rootRef.current;
    if (!root) return;
    const selector = stage === "source"
      ? '[data-geo-section="source"]'
      : stage === "place" || stage === "align"
        ? ".geo-v2-integrated-card"
        : stage === "fine"
          ? '[data-geo-section="fine"]'
          : '[data-geo-section="publish"]';
    root.querySelector<HTMLElement>(selector)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const slug = projectSlug();

  return (
    <div ref={rootRef} className={advanced ? "geo-control-center geo-control-center--advanced" : "geo-control-center"}>
      <nav className="geo-control-flow" aria-label="Geo authoring workflow">
        <button type="button" onClick={() => scrollToStage("source")}><span>01</span><b>Source</b><small>Building release</small></button>
        <button type="button" onClick={() => scrollToStage("place")}><span>02</span><b>Place</b><small>WGS84 on map</small></button>
        <button type="button" onClick={() => scrollToStage("align")}><span>03</span><b>Align</b><small>Guided rigid fit</small></button>
        <button type="button" onClick={() => scrollToStage("fine")}><span>04</span><b>Fine Tune</b><small>ENU / heading / height</small></button>
        <button type="button" onClick={() => scrollToStage("publish")}><span>05</span><b>Publish</b><small>Save, verify, release</small></button>
        <button className="geo-control-flow__advanced" type="button" onClick={() => setAdvanced((value) => !value)}>
          <span>ADV</span><b>{advanced ? "Hide Advanced" : "Advanced"}</b><small>Anchor / technical settings</small>
        </button>
      </nav>

      <div className="geo-control-guide engine-control-card">
        <div>
          <p>NORMAL WORKFLOW</p>
          <strong>Source → Place → Align → Fine Tune → Publish</strong>
          <span>Technical provider settings are moved to Advanced. Model-anchor creation appears automatically when a project has no usable anchor.</span>
        </div>
        <a href={`/3Dprojects/advanced${slug ? `?project=${encodeURIComponent(slug)}` : ""}`}>Engine Advanced</a>
      </div>

      <GeoMapper3DV2 />
    </div>
  );
}
