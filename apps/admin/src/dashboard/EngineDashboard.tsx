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

function projectHref(path: "source-pack" | "building" | "geo-mapper" | "releases", slug: string) {
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
  const [experienceItems, setExperienceItems] = useState<EngineExperienceSummary[]>([]);
  const [sourcePack, setSourcePack] = useState<SourcePackState["latestPack"]>(null);
  const [sourcePackError, setSourcePackError] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createLocation, setCreateLocation] = useState("");
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
      setExperienceItems([]);
      setSourcePack(null);
      return;
    }

    let live = true;
    setDetailLoading(true);
    setError("");
    setSourcePackError("");
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
    ])
      .then(([building, experienceResult, geo, source]) => {
        if (!live) return;
        setBuildingReleases(building.releases);
        setExperienceItems(experienceResult.experiences);
        setGeoState(geo);
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
    return {
      label: "Everything is live",
      help: "Building aur Geo dono active immutable releases par hain.",
      href: projectHref("releases", selectedProject.slug),
      action: "link" as const,
    };
  }, [selectedProject, sourceReady, activeBuilding, geoExperience, activeGeo, sourcePackError]);

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
      const result = await ensureProject(draft);
      window.location.assign(projectHref("source-pack", result.project.slug));
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
                  <small>{project.location || project.slug}</small>
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
              <span>Create a project to start the Source → Building → Geo workflow.</span>
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
                  <span>{selectedProject.location || selectedProject.slug}</span>
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

              <section className="engine-overview-status-grid" aria-label="Project readiness">
                <article className="engine-control-card">
                  <div className="engine-overview-card-head">
                    <span>SOURCE PACK</span>
                    <i className={statusTone(sourceReady ? "ready" : sourcePackError || sourcePack ? "warning" : "idle")}>{sourceReady ? "READY" : sourcePackError ? "API ERROR" : sourcePack ? sourcePack.status.toUpperCase() : "NOT STARTED"}</i>
                  </div>
                  <h3>{sourcePackError ? "Source Pack unavailable" : sourcePack ? `Source Pack v${sourcePack.version}` : "Verified originals"}</h3>
                  <p>Files, geometry authority, scale, component review and durable processing.</p>
                  <a href={projectHref("source-pack", selectedProject.slug)}>Open Source Pack</a>
                </article>

                <article className="engine-control-card">
                  <div className="engine-overview-card-head">
                    <span>BUILDING</span>
                    <i className={statusTone(buildingLive ? "live" : activeBuilding ? "ready" : "warning")}>{buildingLive ? "LIVE" : activeBuilding ? "RELEASE READY" : "IN PROGRESS"}</i>
                  </div>
                  <h3>{activeBuilding ? `Building v${activeBuilding.version}` : "3D Building"}</h3>
                  <p>Build, review, presentation and immutable Building publish workflow.</p>
                  <a href={projectHref("building", selectedProject.slug)}>Open Building</a>
                </article>

                <article className="engine-control-card">
                  <div className="engine-overview-card-head">
                    <span>GEO</span>
                    <i className={statusTone(geoLive ? "live" : geoExperience ? "warning" : "idle")}>{geoLive ? "LIVE" : geoExperience ? "SETUP" : "OPTIONAL"}</i>
                  </div>
                  <h3>{activeGeo ? `Geo v${activeGeo.version}` : "3D Geo Experience"}</h3>
                  <p>Exact real-world Building placement. Optional unless the customer needs map context.</p>
                  <a href={projectHref("geo-mapper", selectedProject.slug)}>Open Geo</a>
                </article>

                <article className="engine-control-card">
                  <div className="engine-overview-card-head">
                    <span>LATEST RELEASE</span>
                    <i className={statusTone(activeBuilding || activeGeo ? "ready" : "idle")}>{activeGeo ? "GEO" : activeBuilding ? "BUILDING" : "NONE"}</i>
                  </div>
                  <h3>{activeGeo ? `Geo v${activeGeo.version}` : activeBuilding ? `Building v${activeBuilding.version}` : "No immutable release"}</h3>
                  <p>Building and Geo release history, activation and live status in one place.</p>
                  <a href={projectHref("releases", selectedProject.slug)}>Open Releases</a>
                </article>
              </section>

              <section className="engine-overview-flow engine-control-card">
                <div>
                  <p>ENGINE WORKFLOW</p>
                  <h3>One clear path from source to live experience</h3>
                </div>
                <div className="engine-overview-flow__steps">
                  <a href={projectHref("source-pack", selectedProject.slug)}><span>01</span><b>Source</b><small>Verify inputs</small></a>
                  <a href={projectHref("building", selectedProject.slug)}><span>02</span><b>Building</b><small>Build and publish</small></a>
                  <a href={projectHref("geo-mapper", selectedProject.slug)}><span>03</span><b>Geo</b><small>Optional real-world placement</small></a>
                  <a href={projectHref("releases", selectedProject.slug)}><span>04</span><b>Release</b><small>Activate and go live</small></a>
                </div>
              </section>
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
                <span>Project create hote hi Source Pack workflow open hoga.</span>
              </div>
              <button type="button" onClick={() => setShowCreate(false)} aria-label="Close">×</button>
            </div>
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
                {createBusy ? "Creating…" : "Create & Open Source Pack"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
