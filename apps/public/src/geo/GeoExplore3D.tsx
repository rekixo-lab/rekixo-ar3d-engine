import { useState } from "react";
import { Viewer3D } from "../viewer/Viewer3D";

type GeoExploreView = "default" | "building" | "top" | "aerial";

const VIEWS: readonly { id:GeoExploreView; label:string }[] = [
  {id:"default",label:"Full Site"},
  {id:"building",label:"Close View"},
  {id:"top",label:"Top View"},
  {id:"aerial",label:"Aerial"},
];

/**
 * Customer-only standalone rendering: the immutable source GLB is loaded in
 * metre-local space, NOT scaled to the satellite footprint. Orbit, pan, zoom
 * and Reset are handled by the existing Three.js Viewer3D.
 *
 * This component is mounted instead of the Google WebGL scene, never beside
 * it, to avoid holding both large GLBs in GPU memory.
 */
export function GeoExplore3D({modelUrl,modelName}:{
  modelUrl:string;
  modelName:string;
}) {
  const [view,setView]=useState<GeoExploreView>("default");
  return (
    <section className="geo-explore-stage" aria-label="Independent 3D building and township viewer">
      <div className="geo-explore-view-tabs" role="group" aria-label="Explore 3D camera views">
        {VIEWS.map(item=><button key={item.id} type="button"
          aria-pressed={view===item.id}
          className={view===item.id?"is-active":""}
          onClick={()=>setView(item.id)}>{item.label}</button>)}
      </div>
      <Viewer3D
        modelUrl={modelUrl}
        modelLabel={modelName}
        presentationView={view}
        allowInteriorControls={false}
        allowWalkControls={false}
        compactUi={false}
      />
      <p className="geo-explore-hint">Drag to rotate · Scroll or pinch to zoom · Right-drag / two fingers to pan · Reset restores full view</p>
    </section>
  );
}
