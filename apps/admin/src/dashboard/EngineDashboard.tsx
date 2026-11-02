import { useEffect, useMemo, useState } from "react";
import { ADMIN_BASE_PATH, type EngineExperienceSummary } from "@rekixo/3d-contracts";
import { geoPublicProjectPath, publicProjectPath } from "@rekixo/3d-engine-core";
import {
  ensureProject,
  experiences,
  geoReleases,
  projects,
  releases,
  type CloudGeoReleaseState,
  type CloudProjectSummary,
  type CloudReleaseSummary,
} from "../studio/cloud";
import { newProject, projectSlug } from "../studio/domain";
import { PROJECT_KIND_LABELS, newProjectStartPath, type EngineProjectKind } from "../../../../shared/engine-project-kinds.js";
import "./engine-dashboard.css";

type SourcePackState = {
  latestPack?: {
    version: number;
    status: "draft" | "ready" | "superseded" | "failed";
    readiness?: { ready?: boolean };
  } | null;
};

function requestedProjectSlug() {
  return new URLSearchParams(window.location.search).get("project")?.trim().toLowerCase() || "";
}

function projectHref(path: "source-pack" | "building" | "geo-mapper" | "releases" | "masterplan" | "masterplan-plots", slug: string) {
  return `/3Dprojects/${path}?project=${encodeURIComponent(slug)}`;
}

function statusTone(value: "ready" | "warning" | "idle" | "live") {
  return `engine-overview-status engine-overview-status--${value}`;
}

export default function EngineDashboard() {
  const [projectItems, setProjectItems] = useState<CloudProjectSummary[]>([]);
  const [selectedSlug, setSelectedSlug] = useState(requestedProjectSlug());
  const [search, setSearch] = useState("");
  const [buildingReleases, setBuildingReleases] = useState<CloudReleaseSummary[]>([]);
  const [geoState, setGeoState] = useState<CloudGeoReleaseState>();
  const [geoPlotState,setGeoPlotState] = useState<{
    activeMapping?:{id:string;current:boolean}|null;
    draft?:{plots?:Array<{id:string}>}|null;
  }|null>(null);
  const [experienceItems, setExperienceItems] = useState<EngineExperienceSummary[]>([]);
  const [sourcePack, setSourcePack] = useState<SourcePackState["latestPack"]>(null);
  const [sourcePackError, setSourcePackError] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createLocation, setCreateLocation] = useState("");
  const [createKind, setCreateKind] = useState<EngineProjectKind>("building");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState("");

  async function loadProjects() {
    setLoading(true);
    setError("");
    try {
      const result = await projects("", "active", 100, 0);
      setProjectItems(result.projects);
      const requested = requestedProjectSlug();
      const next = result.projects.find((item) => item.slug === requested)?.slug || result.projects[0]?.slug || "";
      setSelectedSlug(next);
      if (!requested && next) {
        const url = new URL(window.location.href);
        url.searchParams.set("project", next);
        window.history.replaceState({}, "", url);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Engine projects load nahi hue.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProjects();
  }, []);

  useEffect(() => {
    if (!selectedSlug) {
      setBuildingReleases([]);
      setGeoState(undefined);
      setGeoPlotState(null);
      setExperienceItems([]);
      setSourcePack(null);
      return;
    }

    let live = true;
    setDetailLoading(true);
    setError("");
    setSourcePackError("");
    setGeoPlotState(null);
    const geoPlotRequest=fetch(
      `${ADMIN_BASE_PATH}/api/cloud/projects/${encodeURIComponent(selectedSlug)}/geo-plots`,
      {headers:{Accept:"application/json"},cache:"no-store"}
    ).then(async res=>res.ok?await res.json() as {
      activeMapping?:{id:string;current:boolean}|null;
      draft?:{plots?:Array<{id:string}>}|null;
    }:null).catch(()=>null);
    const sourcePackRequest = fetch(
      `${ADMIN_BASE_PATH}/api/cloud/projects/${encodeURIComponent(selectedSlug)}/source-pack-review`,
      { headers: { Accept: "application/json" }, cache: "no-store" },
    )
      .then(async (response) => {
        const payload = (await response.json()) as SourcePackState & { error?: string };
        if (!response.ok) throw Error(payload.error || `Source Pack API returned HTTP ${response.status}.`);
        return payload;
      })
      .catch((reason: unknown) => {
        if (live) setSourcePackError(reason instanceof Error ? reason.message : "Source Pack API unavailable.");
        return { latestPack: null } as SourcePackState;
      });

    void Promise.all([
      releases(selectedSlug),
      experiences(selectedSlug),
      geoReleases(selectedSlug).catch(() => ({
        schemaReady: true,
        experienceId: null,
        draftRevision: null,
        previewVerified: false,
        previewVerification: null,
        activeRelease: null,
        releases: [],
      } as CloudGeoReleaseState)),
      sourcePackRequest,
      geoPlotRequest,
    ])
      .then(([building, experienceResult, geo, source, plotState]) => {
        if (!live) return;
        setBuildingReleases(building.releases);
        setExperienceItems(experienceResult.experiences);
        setGeoState(geo);
        setGeoPlotState(plotState);
        setSourcePack(source.latestPack || null);
      })
      .catch((reason) => {
        if (live) setError(reason instanceof Error ? reason.message : "Project state load nahi hua.");
      })
      .finally(() => {
        if (live) setDetailLoading(false);
      });

    return () => {
      live = false;
    };
  }, [selectedSlug]);

  const selectedProject = useMemo(
    () => projectItems.find((project) => project.slug === selectedSlug),
    [projectItems, selectedSlug],
  );

  const visibleProjects = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return projectItems;
    return projectItems.filter((project) =>
      [project.name, project.slug, project.location]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    );
  }, [projectItems, search]);

  const activeBuilding = buildingReleases.find((release) => release.active);
  const activeGeo = geoState?.activeRelease || null;
  const geoExperience = experienceItems.find((item) => item.type === "geo");
  const sourceReady = sourcePack?.status === "ready" || Boolean(activeBuilding);
  const buildingLive = Boolean(activeBuilding && selectedProject?.status === "published");
  const geoLive = Boolean(activeGeo && selectedProject?.status === "published");

  const nextAction = useMemo(() => {
    if (selectedProject?.projectKind === "masterplan_geo") return {
      label: "Prepare Geo Masterplan",
      help: "Upload the approved masterplan image, verify geographic control points, then map polygon plots independently of Building.",
      href: projectHref("masterplan", selectedProject.slug),
      action: "link" as const,
    };
    if (!selectedProject) {
      return {
        label: "Create your first Engine project",
        help: "Project name and location se start karein.",
        href: "",
        action: "create" as const,
      };
    }
    if (sourcePackError) {
      return { label: "Source Pack API unavailable", help: sourcePackError, href: projectHref("source-pack", selectedProject.slug), action: "link" as const };
    }
    if (!sourceReady) {
      return {
        label: "Review Source Pack",
        help: "Verified originals aur geometry authority approve karke processing unlock karein.",
        href: projectHref("source-pack", selectedProject.slug),
        action: "link" as const,
      };
    }
    if (!activeBuilding) {
      return {
        label: "Finish Building workflow",
        help: "Build/review complete karke immutable Building release publish karein.",
        href: projectHref("building", selectedProject.slug),
        action: "link" as const,
      };
    }
    if (selectedProject.projectKind === "building") return {
      label:"Building customer website workflow",
      help:"Building is reviewed. Manage the customer site, profile, assets and share presentation.",
      href:projectHref("building",selectedProject.slug),
      action:"link" as const,
    };
    if (!geoExperience) {
      return {
        label: "Building is ready",
        help: "Customer ko map-based experience chahiye to Geo add karein; otherwise Building complete hai.",
        href: projectHref("building", selectedProject.slug),
        action: "link" as const,
      };
    }
    if (!activeGeo) {
      return {
        label: "Finish Geo placement",
        help: "Real-world placement verify karke immutable Geo release publish karein.",
        href: projectHref("geo-mapper", selectedProject.slug),
        action: "link" as const,
      };
    }
    if(selectedProject.projectKind==="building_geo"&&!geoPlotState?.activeMapping?.current)
      return {
        label:"Map source-backed 3D plots",
        help:"Geo is ready. Import authoritative Plot Data CSV, draw all verified 3D polygons, save, verify and publish mapping.",
        href:`/3Dprojects/geo-plots?project=${encodeURIComponent(selectedProject.slug)}`,
        action:"link" as const,
      };
    if (selectedProject.projectKind === "building_geo") return {
      label: "Geo published · field acceptance required",
      help: "Source-backed mapping is published, not field-certified. Before customer handoff, check ten surveyed plots, real Android/iPhone, WhatsApp card, and isolated restore; obtain owner signoff.",
      href: `/3Dprojects/geo-plots?project=${encodeURIComponent(selectedProject.slug)}`,
      action: "link" as const,
    };
    return {
      label: "Everything is live",
      help: "Building aur Geo dono active immutable releases par hain.",
      href: projectHref("releases", selectedProject.slug),
      action: "link" as const,
    };
  }, [selectedProject, sourceReady, activeBuilding, geoExperience, activeGeo, geoPlotState, sourcePackError]);

  function selectProject(slug: string) {
    setSelectedSlug(slug);
    const url = new URL(window.location.href);
    url.searchParams.set("project", slug);
    window.history.replaceState({}, "", url);
  }

  async function createProject() {
    const name = createName.trim();
    if (!name) {
      setCreateError("Project name required hai.");
      return;
    }
    setCreateBusy(true);
    setCreateError("");
    try {
      const draft = newProject(name);
      draft.location = createLocation.trim();
      draft.slug = projectSlug(draft);
      const result = await ensureProject(draft, createKind);
      // New Building-backed Geo plot projects first collect the approved
      // project number, owner, address and contact consent in Profile.
      // Source/Building/Geo/Plots remain independent verifiable stages.
      if(createKind==="building_geo")
        window.location.assign(`/3Dprojects/profile?project=${encodeURIComponent(result.project.slug)}`);
      else
        window.location.assign(projectHref(newProjectStartPath(createKind), result.project.slug));
    } catch (reason) {
      setCreateError(reason instanceof Error ? reason.message : "Project create nahi ho saka.");
    } finally {
      setCreateBusy(false);
    }
  }

  return (
    <div className="engine-overview">
      {error ? (
        <div className="engine-overview-alert">
          <strong>Engine data unavailable</strong>
          <span>{error}</span>
        </div>
      ) : null}

      <section className="engine-overview-layout">
        <aside className="engine-overview-projects engine-control-card">
          <div className="engine-overview-projects__head">
            <div>
              <p>YOUR PROJECTS</p>
              <h2>{projectItems.length} project{projectItems.length === 1 ? "" : "s"}</h2>
            </div>
            <button className="engine-overview-add" type="button" onClick={() => setShowCreate(true)}>+</button>
          </div>

          <label className="engine-overview-search">
            <span>Search project</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name / location" />
          </label>

          <div className="engine-overview-project-list">
            {visibleProjects.map((project) => (
              <button
                key={project.id}
                type="button"
                className={project.slug === selectedSlug ? "engine-overview-project engine-overview-project--active" : "engine-overview-project"}
                onClick={() => selectProject(project.slug)}
              >
                <span className="engine-overview-project__dot" data-status={project.status} />
                <span>
                  <b>{project.name}</b>
                  <small>{project.location || project.slug} · {PROJECT_KIND_LABELS[project.projectKind || "legacy"]}</small>
                </span>
                <em>{project.status === "published" ? "LIVE" : "DRAFT"}</em>
              </button>
            ))}
            {!visibleProjects.length && !loading ? (
              <div className="engine-overview-empty-list">No matching project</div>
            ) : null}
          </div>

          <button className="engine-control-button engine-control-button--primary engine-overview-create-wide" type="button" onClick={() => setShowCreate(true)}>
            + Create New Project
          </button>
        </aside>

        <div className="engine-overview-workspace">
          {!selectedProject ? (
            <section className="engine-overview-empty engine-control-card">
              <span className="engine-overview-empty__mark">R</span>
              <p>CLEAN ENGINE</p>
              <h2>No project selected</h2>
              <span>Choose Building Website, Building on Geo Map or Geo Masterplan. Each project gets its own workspace.</span>
              <button className="engine-control-button engine-control-button--primary" type="button" onClick={() => setShowCreate(true)}>
                + Create First Project
              </button>
            </section>
          ) : (
            <>
              <section className="engine-overview-hero engine-control-card">
                <div>
                  <p>PROJECT WORKSPACE</p>
                  <div className="engine-overview-title-row">
                    <h2>{selectedProject.name}</h2>
                    <span className={statusTone(selectedProject.status === "published" ? "live" : "idle")}>
                      {selectedProject.status.toUpperCase()}
                    </span>
                  </div>
                  <span>{selectedProject.location || selectedProject.slug} · {PROJECT_KIND_LABELS[selectedProject.projectKind || "legacy"]}</span>
                </div>
                <div className="engine-overview-live-actions">
                  {buildingLive ? (
                    <a href={publicProjectPath(selectedProject.slug)} target="_blank" rel="noreferrer">Open Building Live</a>
                  ) : null}
                  {geoLive ? (
                    <a href={geoPublicProjectPath(selectedProject.slug)} target="_blank" rel="noreferrer">Open Geo Live</a>
                  ) : null}
                </div>
              </section>

              <section className="engine-next-action engine-control-card">
                <div className="engine-next-action__index">NEXT</div>
                <div>
                  <p>RECOMMENDED ACTION</p>
                  <h3>{detailLoading ? "Checking project state…" : nextAction.label}</h3>
                  <span>{detailLoading ? "Current source, releases and experiences are loading." : nextAction.help}</span>
                </div>
                {nextAction.action === "create" ? (
                  <button className="engine-control-button engine-control-button--primary" type="button" onClick={() => setShowCreate(true)}>Create Project</button>
                ) : (
                  <a className="engine-control-link engine-control-link--primary" href={nextAction.href}>Open</a>
                )}
              </section>

              {selectedProject.projectKind === "masterplan_geo" ? (
                <section className="engine-overview-status-grid" aria-label="Masterplan project editor">
                  <article className="engine-control-card">
                    <div className="engine-overview-card-head"><span>MASTERPLAN PLOT MAPPER</span><i>ONE WORKSPACE</i></div>
                    <h3>Source, GPS & Plot Mapping</h3>
                    <p>Upload the original image, calibrate GPS, map plots and measurements, then verify and publish updates in one editor.</p>
                    <a href={projectHref("masterplan-plots",selectedProject.slug)}>Open Masterplan Editor</a>
                  </article>
                </section>
              ) : (<section className="engine-overview-status-grid" aria-label="Project readiness">

                <article className="engine-control-card">
                  <div className="engine-overview-card-head">
                    <span>BUILDING</span>
                    <i className={statusTone(buildingLive ? "live" : activeBuilding ? "ready" : "warning")}>{buildingLive ? "LIVE" : activeBuilding ? "RELEASE READY" : "IN PROGRESS"}</i>
                  </div>
                  <h3>{activeBuilding ? `Building v${activeBuilding.version}` : "3D Building"}</h3>
                  <p>Build, review, presentation and immutable Building publish workflow.</p>
                  <a href={projectHref("building", selectedProject.slug)}>Open Building</a>
                </article>

                {selectedProject.projectKind !== "building" && (
                <article className="engine-control-card">
                  <div className="engine-overview-card-head">
                    <span>GEO</span>
                    <i className={statusTone(geoLive ? "live" : geoExperience ? "warning" : "idle")}>{geoLive ? "LIVE" : geoExperience ? "SETUP" : "OPTIONAL"}</i>
                  </div>
                  <h3>{activeGeo ? `Geo v${activeGeo.version}` : "3D Geo Experience"}</h3>
                  <p>Exact real-world Building placement. Optional unless the customer needs map context.</p>
                  <a href={projectHref("geo-mapper", selectedProject.slug)}>Open Geo</a>
                </article>
                )}

                {(selectedProject.projectKind==="building_geo"||selectedProject.projectKind==="legacy")&&
                <article className="engine-control-card">
                  <div className="engine-overview-card-head"><span>3D GEO PLOT MAPPING</span>
                    <i className={statusTone(geoPlotState?.activeMapping?.current?"live":
                      activeGeo?"warning":"idle")}>
                      {geoPlotState?.activeMapping?.current?"PUBLISHED":activeGeo?"NEEDS MAPPING":"WAITING FOR GEO"}
                    </i></div>
                  <h3>{geoPlotState?.draft?.plots?.length||0} 3D plot boundaries drafted</h3>
                  <p>Import verified CSV inventory, map each real 3D polygon, independently verify and publish.</p>
                  <a href={`/3Dprojects/geo-plots?project=${encodeURIComponent(selectedProject.slug)}`}>Open Geo Plot Mapper</a>
                </article>}
              </section>)}


            </>
          )}
        </div>
      </section>

      {showCreate ? (
        <div className="engine-overview-modal-backdrop" role="presentation">
          <section className="engine-overview-modal" role="dialog" aria-modal="true" aria-labelledby="engine-create-project-title">
            <div className="engine-overview-modal__head">
              <div>
                <p>NEW ENGINE PROJECT</p>
                <h2 id="engine-create-project-title">Create 3D Project</h2>
                <span>Choose one independent Engine project type. The right tools will appear automatically.</span>
              </div>
              <button type="button" onClick={() => setShowCreate(false)} aria-label="Close">×</button>
            </div>
            <fieldset className="engine-overview-kind-choices">
              <legend>What are you building?</legend>
              {(["building","building_geo","masterplan_geo"] as const).map(kind=>(
                <label key={kind} className={createKind===kind?"engine-overview-kind active":"engine-overview-kind"}>
                  <input type="radio" name="engine-project-kind" value={kind} checked={createKind===kind}
                    onChange={()=>setCreateKind(kind)} />
                  <span><b>{PROJECT_KIND_LABELS[kind]}</b>
                    <small>{kind==="building"?"Customer website, floors, units and walkthrough":
                      kind==="building_geo"?"Upload a complete 3D masterplan GLB, align it to Geo, then CSV-map every plot":
                      "An approved layout image with Geo calibration, polygons and plots"}</small>
                  </span>
                </label>
              ))}
            </fieldset>
            <label>
              <span>Project name</span>
              <input value={createName} onChange={(event) => setCreateName(event.target.value)} autoFocus placeholder="Example Residence" />
            </label>
            <label>
              <span>Location</span>
              <input value={createLocation} onChange={(event) => setCreateLocation(event.target.value)} placeholder="City / site" />
            </label>
            {createError ? <div className="engine-overview-create-error">{createError}</div> : null}
            <div className="engine-overview-modal__actions">
              <button className="engine-control-button" type="button" disabled={createBusy} onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="engine-control-button engine-control-button--primary" type="button" disabled={createBusy} onClick={() => void createProject()}>
                {createBusy ? "Creating…" : "Create "+PROJECT_KIND_LABELS[createKind]}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
