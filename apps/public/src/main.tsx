import React, { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  type Public3DExperience,
  type Scene3D,
  type Scene3DType,
} from "@rekixo/3d-contracts";
import { projectSlugFromPathname } from "@rekixo/3d-engine-core";
import { loadPublicExperience, type ClientExperience } from "./api";
import { loadPublicBranding, type PublicProjectBranding } from "./branding";
import "./styles.css";
import { clientViewerCapabilities } from "./clientPresentation";

const GeoPublicDemo = lazy(() => import("./geo/GeoPublicDemo"));
const MasterplanPublic = lazy(() => import("./masterplan/MasterplanPublic"));
const loadViewer3D = () => import("./viewer/Viewer3D");
const Viewer3D = lazy(() => loadViewer3D().then((module) => ({ default: module.Viewer3D })));

type UnitFact = { series: string; type: string; areaSqFt: number };
type NearbyFact = { name: string; distance: string };

type LocationSettings = {
  status?: string;
  title?: string;
  subtitle?: string;
  projectLabel?: string;
  mapQuery?: string;
  nearby?: NearbyFact[];
  note?: string;
};

type ProjectSettings = {
  status?: string;
  headline?: string;
  brochurePrice?: string;
  exteriorRenderKey?: string;
  brochureCoverKey?: string;
  modelNote?: string;
  presentation?: {
    style?: string;
    primaryNavigation?: string;
    modes?: string[];
    walkthroughRole?: string;
  };
};

type FloorSettings = {
  status?: string;
  title?: string;
  mediaKey?: string;
  floors?: number[];
  floorLevels?: Array<{
    floor: number;
    elevationM: number;
    topElevationM?: number;
  }>;
  units?: UnitFact[];
  verifiedSpaces?: string[];
  drawingNotes?: string[];
  sourceConflicts?: Array<{
    id: string;
    title: string;
    detail: string;
    status: "unresolved" | "resolved";
  }>;
  dimensionPolicy?: {
    priority?: string[];
    note?: string;
  };
};

type AmenitySettings = {
  status?: string;
  amenities?: string[];
  nearby?: NearbyFact[];
};

type PendingSettings = {
  status?: string;
  reason?: string;
};

function sceneOf(experience: Public3DExperience, type: Scene3DType) {
  return experience.scenes?.find((scene) => scene.type === type);
}

function settingsOf<T>(scene?: Scene3D) {
  return (scene?.settings ?? {}) as T;
}

function floorIdsOf(settings: FloorSettings) {
  const explicit = settings.floorLevels?.map((item) => item.floor) ?? [];
  const values = explicit.length ? explicit : [0, ...(settings.floors ?? [])];
  return Array.from(
    new Set(values.filter((item) => Number.isFinite(item))),
  ).sort((a, b) => a - b);
}

function configuredFloorIdsOf(settings: FloorSettings) {
  const explicit = settings.floorLevels?.map((item) => item.floor) ?? [];
  const values = explicit.length
    ? explicit
    : settings.floors?.length
      ? [0, ...settings.floors]
      : [];
  return Array.from(
    new Set(values.filter((item) => Number.isFinite(item))),
  ).sort((a, b) => a - b);
}

function floorLabel(floor: number) {
  if (floor === 0) return "G";
  if (floor < 0) return `B${Math.abs(floor)}`;
  return `F${floor}`;
}

function mediaUrl(experience: Public3DExperience, key?: string) {
  if (!key || !experience.mediaBaseUrl) return undefined;
  const fileName = key.split("/").pop();
  return fileName ? `${experience.mediaBaseUrl}/${encodeURIComponent(fileName)}` : undefined;
}

function MediaImage({ src, alt, className }: { src?: string; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;
  return <img className={className} src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />;
}

function LoadingPage() {
  return (
    <main className="loading-page">
      <div className="brand-mark" aria-hidden="true">AR</div>
      <p className="eyebrow">AR3D STUDIO</p>
      <h1>Preparing 3D project</h1>
      <div className="loading-line" />
    </main>
  );
}

function NotFound({ message }: { message?: string }) {
  return (
    <main className="not-found">
      <p className="eyebrow">AR3D STUDIO</p>
      <h1>3D project unavailable</h1>
      <p>{message ?? "The requested project is not currently published."}</p>
    </main>
  );
}

function ProjectNavigation({ experience, walkFloor }: { experience: ClientExperience; walkFloor?: number }) {
  const { model, camera, project } = experience;
  const floorSettings = settingsOf<FloorSettings>(sceneOf(experience, "typical-floor"));
  const capabilities = clientViewerCapabilities(experience);
  const floorReady = capabilities.floors;
  const availableFloors = configuredFloorIdsOf(floorSettings);

  return (
    <section className="viewer-section">
      <Viewer3D
        modelUrl={model?.available ? model.url : undefined}
        cameraPreset={camera}
        modelLabel={model?.name}
        initialWalk={walkFloor !== undefined}
        initialWalkFloor={walkFloor ?? null}
        availableFloors={availableFloors}
        floorGeometry={floorSettings.floorLevels ?? []}
        walkthrough={experience.walkthrough}
        clientPresentation
        projectLocation={project.location}
        sourcePresentation={experience.sourcePresentation}
        buildingPresentation={experience.buildingPresentation}
        allowInteriorControls={floorReady}
        allowWalkControls={capabilities.walk}
        showClientFloorControls
      />
    </section>
  );
}

function unitNumberForFloor(series: string, floor: number) {
  const match = series.match(/^(\d{3})\s+to\s+(\d{3})$/i);
  if (!match) return series;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const candidate = floor * 100 + (start % 100);
  return candidate >= start && candidate <= end ? String(candidate) : null;
}

function TypicalFloor({ experience, onEnterFloor }: { experience: Public3DExperience; onEnterFloor: (floor: number) => void }) {
  const scene = sceneOf(experience, "typical-floor");
  const settings = settingsOf<FloorSettings>(scene);
  const floorPlan = mediaUrl(experience, settings.mediaKey);
  const units = settings.units ?? [];
  const floors = settings.floors ?? [];
  const [floor, setFloor] = useState(floors[0] ?? 1);
  const [selectedUnit, setSelectedUnit] = useState<string>();
  const visibleUnits = units
    .map((unit) => ({ ...unit, number: unitNumberForFloor(unit.series, floor) }))
    .filter((unit) => unit.number);

  return (
    <section className="content-module">
      <div className="module-copy">
        <p className="eyebrow">FLOOR EXPLORER</p>
        <h2>{settings.title ?? "Typical Floor"}</h2>
        <p>Select a floor to view unit numbers supported by this project's configured source data.</p>
      </div>
      <div className="floor-selector" aria-label="Select floor">
        {floors.map((item) => (
          <button
            type="button"
            key={item}
            className={floor === item ? "floor-button floor-button--active" : "floor-button"}
            onClick={() => {
              setFloor(item);
              setSelectedUnit(undefined);
            }}
          >
            Floor {item}
          </button>
        ))}
      </div>
      <div className="floor-layout">
        <MediaImage src={floorPlan} alt={`${experience.project.name} floor plan`} className="floor-plan-image" />
        <div className="unit-grid">
          {visibleUnits.map((unit) => (
            <button
              type="button"
              className={selectedUnit === unit.number ? "unit-card unit-card--selected" : "unit-card"}
              key={unit.series}
              onClick={() => setSelectedUnit(unit.number ?? undefined)}
            >
              <span>FLAT</span>
              <strong>{unit.number}</strong>
              <p>{unit.type}</p>
              <b>{unit.areaSqFt.toLocaleString("en-IN")} Sq. Ft.</b>
              <small>Series {unit.series}</small>
            </button>
          ))}
          {!visibleUnits.length && (
            <div className="media-placeholder">
              <strong>No configured unit for this floor</strong>
              <span>The viewer does not invent unit numbers that are absent from the project's source data.</span>
            </div>
          )}
        </div>
      </div>
      {selectedUnit && (
        <div className="unit-selection-panel" role="status">
          <span>SELECTED UNIT</span>
          <strong>Flat {selectedUnit} · Floor {floor}</strong>
          <p>
            This unit identity and area come from configured project data. Exact 3D room/mesh
            highlighting is intentionally not guessed until a semantic unit boundary is verified
            from the architectural source model.
          </p>
          <button type="button" className="unit-enter-button" onClick={() => onEnterFloor(floor)}>
            Enter Floor {floor} in 3D Walk
          </button>
        </div>
      )}
    </section>
  );
}

function LocationMap({ experience }: { experience: Public3DExperience }) {
  const settings = settingsOf<LocationSettings>(sceneOf(experience, "wing-distance"));
  const nearby = settings.nearby ?? [];
  const query = settings.mapQuery || [experience.project.name, experience.project.location].filter(Boolean).join(" ");
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;

  return (
    <section className="content-module location-module">
      <div className="module-copy">
        <p className="eyebrow">LOCATION CONTEXT</p>
        <h2>{settings.title ?? "Project Location"}</h2>
        <p>{settings.subtitle ?? "Brochure-based connectivity overview for the project."}</p>
      </div>

      <div className="location-board">
        <div className="location-center">
          <span>PROJECT</span>
          <strong>{settings.projectLabel ?? experience.project.name}</strong>
          <small>{experience.project.location}</small>
        </div>
        <div className="location-spokes">
          {nearby.map((item, index) => (
            <article key={item.name} style={{ "--slot": index } as React.CSSProperties}>
              <strong>{item.name}</strong>
              <span>{item.distance}</span>
            </article>
          ))}
        </div>
      </div>

      <div className="location-actions">
        <a href={mapsUrl} target="_blank" rel="noopener noreferrer">Open location search in Maps</a>
        <span>{settings.note ?? "Distances shown are taken from the supplied brochure; the diagram is a connectivity overview, not a surveyed map."}</span>
      </div>
    </section>
  );
}

function ModelModule({
  experience,
  type,
  title,
  interactionMode,
}: {
  experience: Public3DExperience;
  type: Scene3DType;
  title: string;
  interactionMode?: "section" | "detail";
}) {
  const scene = sceneOf(experience, type);
  const settings = settingsOf<PendingSettings>(scene);
  const floorSettings = settingsOf<FloorSettings>(sceneOf(experience, "typical-floor"));
  const availableFloors = floorIdsOf(floorSettings);
  return (
    <section className="viewer-section">
      <div className="module-copy model-module-copy">
        <p className="eyebrow">INTERACTIVE 3D</p>
        <h2>{title}</h2>
        <p>{settings.reason ?? "Use the model controls to inspect this project view."}</p>
      </div>
      <Viewer3D
        modelUrl={experience.model?.available ? experience.model.url : undefined}
        cameraPreset={experience.camera}
        modelLabel={experience.model?.name}
        interactionMode={interactionMode}
        availableFloors={availableFloors}
        floorGeometry={floorSettings.floorLevels ?? []}
        walkthrough={experience.walkthrough}
        buildingPresentation={experience.buildingPresentation}
      />
    </section>
  );
}

function Amenities({ experience }: { experience: Public3DExperience }) {
  const settings = settingsOf<AmenitySettings>(sceneOf(experience, "amenity"));
  return (
    <section className="content-module">
      <div className="module-copy">
        <p className="eyebrow">PROJECT INFORMATION</p>
        <h2>Amenities & nearby locations</h2>
        <p>Only amenities and nearby locations configured for this project are shown.</p>
      </div>
      <div className="amenity-columns">
        <div>
          <h3>Amenities</h3>
          <div className="chip-grid">
            {(settings.amenities ?? []).map((item) => <span key={item}>{item}</span>)}
          </div>
        </div>
        <div>
          <h3>Nearby</h3>
          <div className="nearby-list">
            {(settings.nearby ?? []).map((item) => (
              <div key={item.name}><strong>{item.name}</strong><span>{item.distance}</span></div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

type TwinMode = "project" | "building" | "floors" | "units" | "interior" | "walk" | "terrace" | "amenities" | "balcony" | "context";

const twinModes: Array<{ id: TwinMode; label: string; short: string }> = [
  { id: "project", label: "Project Navigation", short: "Project" },
  { id: "building", label: "Building Explorer", short: "Building" },
  { id: "floors", label: "Floor Explorer", short: "Floors" },
  { id: "units", label: "Unit Explorer", short: "Units" },
  { id: "interior", label: "Typical Floor Interior", short: "Interior" },
  { id: "walk", label: "Room Walkthrough", short: "Walk" },
  { id: "terrace", label: "Roof Inspection", short: "Roof" },
  { id: "amenities", label: "Amenities", short: "Amenities" },
  { id: "balcony", label: "Balcony View", short: "Balcony" },
  { id: "context", label: "Distance & Context", short: "Context" },
];

function PremiumDigitalTwin({
  experience,
  branding,
}: {
  experience: Public3DExperience;
  branding?: PublicProjectBranding | null;
}) {
  const projectSettings = settingsOf<ProjectSettings>(sceneOf(experience, "project-navigation"));
  const floorSettings = settingsOf<FloorSettings>(sceneOf(experience, "typical-floor"));
  const amenitySettings = settingsOf<AmenitySettings>(sceneOf(experience, "amenity"));
  const locationSettings = settingsOf<LocationSettings>(sceneOf(experience, "wing-distance"));
  const [mode, setMode] = useState<TwinMode>("project");
  const [floor, setFloor] = useState<number | null>(null);
  const [unit, setUnit] = useState<string>();
  const [selectedFeature, setSelectedFeature] = useState<{ id: string; label: string; category: string; description: string }>();
  const units = floorSettings.units ?? [];
  const availableFloors = floorIdsOf(floorSettings);
  const residentialFloors =
    floorSettings.floors?.length ? floorSettings.floors : availableFloors;
  const firstResidentialFloor = residentialFloors[0] ?? availableFloors[0] ?? null;
  const verifiedSpaces = floorSettings.verifiedSpaces ?? [];
  const visibleUnits = floor === null
    ? []
    : units
        .map((item) => ({ ...item, number: unitNumberForFloor(item.series, floor) }))
        .filter((item) => item.number);

  const presentationView =
    mode === "project" || mode === "context" || mode === "amenities"
      ? (mode === "context" ? "context" : "aerial")
      : mode === "building"
        ? "building"
        : mode === "balcony"
          ? "balcony"
          : "top";

  const experienceMode =
    mode === "interior" || mode === "walk"
      ? "interior"
      : mode === "terrace"
        ? "terrace"
        : "site";

  const viewerFloor =
    mode === "units" ? floor ?? firstResidentialFloor : mode === "floors" ? floor : null;
  const exploded = mode === "floors" && floor === null;
  const nearby = locationSettings.nearby ?? amenitySettings.nearby ?? [];

  return (
    <main className={(mode === "interior" || mode === "walk") ? "twin-shell twin-shell--interior" : "twin-shell"}>
      <section className="twin-stage">
        <Viewer3D
          modelUrl={experience.model?.available ? experience.model.url : undefined}
          cameraPreset={experience.camera}
          modelLabel={experience.model?.name}
          presentationView={presentationView}
          initialFloor={viewerFloor}
          initialExploded={exploded}
          experienceMode={experienceMode}
          initialWalk={mode === "walk"}
          initialWalkFloor={floor ?? firstResidentialFloor}
          visualPreset="reference-render"
          onFeatureSelect={setSelectedFeature}
          availableFloors={availableFloors}
          floorGeometry={floorSettings.floorLevels ?? []}
          walkthrough={experience.walkthrough}
          buildingPresentation={experience.buildingPresentation}
          compactUi
        />

        <header className="twin-topbar">
          <div className="twin-brand">
            {branding?.logoUrl ? <img className="twin-project-logo" src={branding.logoUrl} alt="" /> : <span>AR</span>}
            <div>
              <small>{branding?.logoUrl ? "PROJECT DIGITAL TWIN" : "AR3D DIGITAL TWIN"}</small>
              <strong>{experience.project.name}</strong>
            </div>
          </div>
          <div className="twin-top-meta">
            <span>{experience.project.location}</span>
            <b>{projectSettings.brochurePrice ?? "Interactive 3D"}</b>
          </div>
        </header>

        <nav className="twin-rail" aria-label="Digital twin project navigation">
          {twinModes.map((item, index) => (
            <button
              type="button"
              className={mode === item.id ? "twin-rail-item twin-rail-item--active" : "twin-rail-item"}
              key={item.id}
              onClick={() => {
                setSelectedFeature(undefined);
                setMode(item.id);
                if (item.id === "floors") {
                  setFloor(null);
                  setUnit(undefined);
                }
                if (item.id === "units" && floor === null)
                  setFloor(firstResidentialFloor);
              }}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{item.short}</strong>
            </button>
          ))}
        </nav>

        <div className="twin-title-card">
          <span>{twinModes.find((item) => item.id === mode)?.label}</span>
          <h1>{experience.project.name}</h1>
          <p>
            {mode === "project" && "Explore the complete project from an aerial interactive view."}
            {mode === "building" && "Inspect the building facade from a premium architectural camera."}
            {mode === "floors" && "Separate the building stack or focus a single verified floor."}
            {mode === "units" && "Select configured units on a floor without inventing geometry."}
            {mode === "interior" && "Inspect the configured interior scene. Tap a room to enter; reconstructed or unverified details remain explicitly non-authoritative."}
            {mode === "walk" && "Enter the configured interior at eye level. Drag or touch to look around and use keyboard or on-screen controls to move."}
            {mode === "terrace" && "Inspect the configured roof or terrace presentation without inferring unverified amenities."}
            {mode === "amenities" && "Review only the amenities configured for this project."}
            {mode === "balcony" && "Inspect the facade and balcony side from a dedicated viewing angle."}
            {mode === "context" && "Review configured connectivity and nearby destinations around the project."}
          </p>
        </div>

        {(mode === "floors" || mode === "units") && (
          <div className="twin-floor-strip" aria-label="Floor selection">
            {mode === "floors" && (
              <button
                type="button"
                className={floor === null ? "active" : ""}
                onClick={() => {
                  setFloor(null);
                  setUnit(undefined);
                }}
              >
                ALL
              </button>
            )}
            {availableFloors.map((item) => (
              <button
                type="button"
                key={item}
                className={floor === item ? "active" : ""}
                onClick={() => {
                  setFloor(item);
                  setUnit(undefined);
                }}
              >
                {floorLabel(item)}
              </button>
            ))}
          </div>
        )}

        {mode === "interior" && (
          <aside className="twin-info-panel twin-info-panel--right">
            <span className="twin-kicker">PROJECT INTERIOR</span>
            <h2>{floorSettings.title ?? "Residential units"}</h2>
            <p>
              This interior presentation uses the room and unit evidence configured for this
              project. Select a unit series to inspect its source-backed identity and area.
            </p>
            <div className="twin-unit-list">
              {units.map((item) => (
                <button
                  type="button"
                  key={item.series}
                  onClick={() =>
                    setSelectedFeature({
                      id: item.series,
                      label: `Flat ${item.series}`,
                      category: item.type,
                      description: `${item.areaSqFt.toLocaleString("en-IN")} sq.ft. configured unit series.`,
                    })
                  }
                >
                  <span>Flat {item.series}</span>
                  <strong>{item.type}</strong>
                  <b>{item.areaSqFt.toLocaleString("en-IN")} sq.ft.</b>
                </button>
              ))}
            </div>
          </aside>
        )}

        {mode === "walk" && (
          <aside className="twin-info-panel twin-info-panel--right twin-walk-panel">
            <span className="twin-kicker">ROOM WALKTHROUGH</span>
            <h2>Touch + Desktop Navigation</h2>
            <p>
              Drag on the 3D view to look around. On desktop use WASD or arrow keys; on phone/tablet
              use the on-screen arrows. When a reviewed room graph is published, movement stays inside
              mapped room boundaries and crosses only approved shared doors. Unreviewed openings never
              become navigation links.
            </p>
            <div className="twin-chip-list">
              {verifiedSpaces.map((space) => (
                <span key={space}>{space}</span>
              ))}
            </div>
          </aside>
        )}

        {mode === "units" && (
          <aside className="twin-info-panel twin-info-panel--right">
            <span className="twin-kicker">UNIT EXPLORER</span>
            <h2>
              {floor === 0
                ? "Ground Level"
                : floor === null
                  ? "Select a floor"
                  : `Floor ${floor}`}
            </h2>
            <div className="twin-unit-list">
              {visibleUnits.map((item) => (
                <button
                  type="button"
                  key={item.series}
                  className={unit === item.number ? "active" : ""}
                  onClick={() => setUnit(item.number ?? undefined)}
                >
                  <span>Flat {item.number}</span>
                  <strong>{item.type}</strong>
                  <b>{item.areaSqFt.toLocaleString("en-IN")} sq.ft.</b>
                </button>
              ))}
              {!visibleUnits.length && (
                <p>No configured residential unit is mapped to this level.</p>
              )}
            </div>
            {unit && (
              <div className="twin-selection">
                <small>SELECTED</small>
                <strong>Flat {unit}</strong>
                <span>3D unit mesh highlight will activate only after its source boundary is verified.</span>
              </div>
            )}
            {(floorSettings.verifiedSpaces?.length ?? 0) > 0 && (
              <div className="twin-source-program">
                <small>ARCHITECTURAL DRAWING VERIFIED</small>
                <div>
                  {floorSettings.verifiedSpaces?.map((space) => <span key={space}>{space}</span>)}
                </div>
                <p>
                  These room/common-space labels are present in configured architectural evidence.
                  They are not assigned to a specific unit until the exact geometry boundary is verified.
                </p>
              </div>
            )}
            {(floorSettings.sourceConflicts?.length ?? 0) > 0 && (
              <div className="twin-source-conflicts" role="note">
                <small>SOURCE REVIEW REQUIRED</small>
                {floorSettings.sourceConflicts
                  ?.filter((conflict) => conflict.status === "unresolved")
                  .map((conflict) => (
                    <div key={conflict.id}>
                      <strong>{conflict.title}</strong>
                      <p>{conflict.detail}</p>
                    </div>
                  ))}
                {floorSettings.dimensionPolicy?.note && (
                  <p className="twin-source-policy">
                    {floorSettings.dimensionPolicy.note}
                  </p>
                )}
              </div>
            )}
          </aside>
        )}

        {mode === "amenities" && (
          <aside className="twin-info-panel twin-info-panel--right">
            <span className="twin-kicker">AMENITIES</span>
            <h2>Project Features</h2>
            <div className="twin-chip-list">
              {(amenitySettings.amenities ?? []).map((item) => <span key={item}>{item}</span>)}
            </div>
          </aside>
        )}

        {mode === "context" && (
          <aside className="twin-info-panel twin-info-panel--right">
            <span className="twin-kicker">CONNECTIVITY</span>
            <h2>{locationSettings.title ?? "Nearby destinations"}</h2>
            <div className="twin-nearby-list">
              {nearby.map((item) => (
                <div key={item.name}>
                  <strong>{item.name}</strong>
                  <span>{item.distance}</span>
                </div>
              ))}
            </div>
            <p className="twin-source-note">
              {locationSettings.note ??
                "Distances and context are shown from configured project data; they are not inferred by the viewer."}
            </p>
          </aside>
        )}

        {mode === "balcony" && (
          <aside className="twin-info-panel twin-info-panel--right">
            <span className="twin-kicker">BALCONY VIEW</span>
            <h2>Facade-side inspection</h2>
            <p>
              This camera uses the verified exterior model. A true apartment-specific outward view
              will be bound only when the balcony/unit orientation is verified from source geometry.
            </p>
          </aside>
        )}

        {selectedFeature && (
          <aside className="twin-feature-card" role="status">
            <button type="button" aria-label="Close selected feature" onClick={() => setSelectedFeature(undefined)}>×</button>
            <span>{selectedFeature.category}</span>
            <strong>{selectedFeature.label}</strong>
            <p>{selectedFeature.description}</p>
          </aside>
        )}

        <div className="twin-bottom-bar">
          <div>
            <span>MODEL</span>
            <strong>{experience.model?.available ? experience.model.name : "3D asset pending"}</strong>
          </div>
          <div>
            <span>VIEW</span>
            <strong>{twinModes.find((item) => item.id === mode)?.label}</strong>
          </div>
          <div>
            <span>CONTROL</span>
            <strong>{mode === "walk" ? "Drag / Touch · WASD / Arrows" : "Drag · Zoom · Pan"}</strong>
          </div>
        </div>
      </section>
    </main>
  );
}

function App() {
  const slug = useMemo(() => projectSlugFromPathname(window.location.pathname), []);
  const [experience, setExperience] = useState<ClientExperience>();
  const [branding, setBranding] = useState<PublicProjectBranding | null>(null);
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);

  // Preload only on Building routes, alongside the project API request.
  // The Geo route stays free of Building-viewer-only JavaScript.
  useEffect(() => {
    void loadViewer3D().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!slug) return;
    const controller = new AbortController();
    setBranding(null);
    void loadPublicBranding(slug, "building", controller.signal).then(setBranding);
    setError(undefined);
    void loadPublicExperience(slug, controller.signal)
      .then(setExperience)
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "Could not load the 3D project.");
      });
    return () => controller.abort();
  }, [slug, attempt]);

  if (!slug) return <NotFound />;
  if (error) {
    return (
      <main className="not-found">
        <p className="eyebrow">AR3D STUDIO</p>
        <h1>3D experience could not start</h1>
        <p>{error}</p>
        <button type="button" onClick={() => setAttempt((value) => value + 1)}>Try again</button>
      </main>
    );
  }
  if (!experience) return <LoadingPage />;
  const presentation = settingsOf<ProjectSettings>(sceneOf(experience, "project-navigation")).presentation;
  if (presentation?.style === "premium-real-estate-digital-twin") {
    return <PremiumDigitalTwin experience={experience} branding={branding} />;
  }


  return (
    <main className="experience client-showcase client-showcase--viewer-only">
      <header className="project-header project-header--viewer-only">
        <a className="brand" href="https://ar3dstudio.in" aria-label={branding?.logoUrl ? experience.project.name : "AR3D Studio home"}>
          {branding?.logoUrl ? <img className="brand-project-logo" src={branding.logoUrl} alt="" /> : <span>AR</span>}
          <div>
            <strong>{branding?.logoUrl ? experience.project.name : "AR3D STUDIO"}</strong>
            <small>{experience.project.location || (branding?.logoUrl ? "Interactive 3D Experience" : "Interactive Real Estate")}</small>
          </div>
        </a>
      </header>

      <div className="module-stage">
        <ProjectNavigation experience={experience} />
      </div>

    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root mount node");
const geoRoute = /^\/3Dprojects\/[^/]+\/geo\/?$/.test(window.location.pathname);
const masterplanRoute = /^\/3Dprojects\/[^/]+\/masterplan\/?$/.test(window.location.pathname);
createRoot(root).render(
  <React.StrictMode>
    <Suspense fallback={<LoadingPage />}>
      {masterplanRoute ? <MasterplanPublic /> : geoRoute ? <GeoPublicDemo /> : <App />}
    </Suspense>
  </React.StrictMode>,
);
