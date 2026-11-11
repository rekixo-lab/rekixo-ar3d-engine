import { useEffect, useMemo, useRef, useState } from "react";
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
import ProjectHandoffCheck from "./ProjectHandoffCheck";
import "./engine-dashboard.css";

type MasterplanOverviewState = {
  draft: {revision:number; verifiedRevision:number|null; imageAssetId:string|null;
    controlPoints:unknown[]; plots:Array<{id:string}>};
  activeRelease:{id:string;version:number;draftRevision:number}|null;
};

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
  const [projectTotal,setProjectTotal] = useState(0);
  const [projectNextOffset,setProjectNextOffset] = useState(0);
  const [projectHasMore,setProjectHasMore] = useState(false);
  const [projectPageBusy,setProjectPageBusy] = useState(false);
  const searchRequestId=useRef(0);
  const [buildingReleases, setBuildingReleases] = useState<CloudReleaseSummary[]>([]);
  const [geoState, setGeoState] = useState<CloudGeoReleaseState>();
  const [masterplanState,setMasterplanState] = useState<MasterplanOverviewState|null>(null);
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
  const [createCallNumber,setCreateCallNumber] = useState("");
  const [createWhatsappNumber,setCreateWhatsappNumber] = useState("");
  const [createPublicContacts,setCreatePublicContacts] = useState(false);
  const [createKind, setCreateKind] = useState<EngineProjectKind>("building");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState("");

  async function loadProjects(query="") {
    const requestId=++searchRequestId.current;
    setLoading(true);
    setError("");
    try {
      const result=await projects(query,"active",100,0);
      const current=selectedSlug||requestedProjectSlug();
      let items=result.projects;
      if(current&&!items.some(item=>item.slug===current)){
        const focused=await projects(current,"active",20,0);
        const match=focused.projects.find(item=>item.slug===current);
        if(match)items=[match,...items];
      }
      if(requestId!==searchRequestId.current)return;
      setProjectItems(items);
      setProjectTotal(result.total);
      setProjectNextOffset(result.nextOffset);
      setProjectHasMore(result.hasMore);
      const next=items.find(item=>item.slug===current)?.slug||items[0]?.slug||"";
      setSelectedSlug(next);
      if(!requestedProjectSlug()&&next){
        const url=new URL(window.location.href);
        url.searchParams.set("project",next);
        window.history.replaceState({},"",url);
      }
    }catch(reason){
      if(requestId===searchRequestId.current)
        setError(reason instanceof Error?reason.message:"Engine projects load nahi hue.");
    }finally{if(requestId===searchRequestId.current)setLoading(false);}
  }

  async function loadMoreProjects(){
    if(projectPageBusy||!projectHasMore)return;
    const requestId=searchRequestId.current;
    setProjectPageBusy(true);
    try{
      const result=await projects(search,"active",100,projectNextOffset);
      if(requestId!==searchRequestId.current)return;
      setProjectItems(current=>{
        const known=new Set(current.map(item=>item.slug));
        return [...current,...result.projects.filter(item=>!known.has(item.slug))];
      });
      setProjectNextOffset(result.nextOffset);
      setProjectHasMore(result.hasMore);
    }catch(reason){if(requestId===searchRequestId.current)
      setError(reason instanceof Error?reason.message:"More projects could not load.");
    }finally{setProjectPageBusy(false);}
  }

  useEffect(()=>{
    const timer=window.setTimeout(()=>{void loadProjects(search.trim());},search.trim()?250:0);
    return ()=>window.clearTimeout(timer);
  },[search]);

  useEffect(() => {
    if (!selectedSlug) {
      setBuildingReleases([]);
      setGeoState(undefined);
      setMasterplanState(null);
      setGeoPlotState(null);
      setExperienceItems([]);
      setSourcePack(null);
      return;
    }

    const selectedEntry=projectItems.find(project=>project.slug===selectedSlug);
    // Do not fire Building/Geo APIs until project kind is known from the registry.
    if(!selectedEntry){setDetailLoading(false);return;}
    let live = true;
    setDetailLoading(true);
    setError("");
    setSourcePackError("");
    setBuildingReleases([]);setExperienceItems([]);setGeoState(undefined);
    setGeoPlotState(null);
    setSourcePack(null);setMasterplanState(null);
    const selectedKind=selectedEntry.projectKind;
    if(selectedKind==="masterplan_geo"){
      void fetch(`${ADMIN_BASE_PATH}/api/cloud/projects/${encodeURIComponent(selectedSlug)}/masterplan-geo`,
        {headers:{Accept:"application/json"},cache:"no-store"})
        .then(async response=>{
          const payload=await response.json() as MasterplanOverviewState & {error?:string};
          if(!response.ok)throw Error(payload.error||"Masterplan state unavailable.");
          return payload;
        }).then(payload=>{
          if(!live)return;
          setBuildingReleases([]);setExperienceItems([]);setGeoState(undefined);
          setSourcePack(null);setMasterplanState(payload);
        }).catch(error=>{
          if(live)setError(error instanceof Error?error.message:"Masterplan state unavailable.");
        }).finally(()=>{if(live)setDetailLoading(false);});
      return ()=>{live=false;};
    }
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
  }, [selectedSlug, projectItems]);

  const selectedProject = useMemo(
    () => projectItems.find((project) => project.slug === selectedSlug),
    [projectItems, selectedSlug],
  );

  const visibleProjects = projectItems.filter(project=>
    !search.trim() || [project.name,project.slug,project.location].some(value=>
      String(value||"").toLowerCase().includes(search.trim().toLowerCase())));

  const activeBuilding = buildingReleases.find((release) => release.active);
  const activeGeo = geoState?.activeRelease || null;
  const geoExperience = experienceItems.find((item) => item.type === "geo");
  const sourceReady = sourcePack?.status === "ready" || Boolean(activeBuilding);
  const buildingLive = Boolean(activeBuilding && selectedProject?.status === "published");
  const geoLive = Boolean(activeGeo && selectedProject?.status === "published");

  const nextAction = useMemo(() => {
    if (selectedProject?.projectKind === "masterplan_geo") {
      const draft=masterplanState?.draft;
      const active=masterplanState?.activeRelease;
      const next=(!draft?.imageAssetId)
        ? {label:"Upload Original Masterplan",help:"Choose the approved source image before mapping.",tab:"source"}
        : (!draft.plots.length||draft.controlPoints.length<3)
          ? {label:"Complete GPS & Plot Mapping",help:`${draft.plots.length} plots mapped · ${draft.controlPoints.length} GPS controls. Finish source-backed entries.`,tab:"plots"}
          : draft.verifiedRevision!==draft.revision
            ? {label:"Verify Masterplan Draft",help:`${draft.plots.length} mapped plots. Review measurements, GPS and source evidence before publishing.`,tab:"plots"}
            : active?.draftRevision!==draft.revision
              ? {label:"Publish Verified Masterplan",help:"The current draft is verified and ready for its own immutable release.",tab:"plots"}
              : {label:"Masterplan Published",help:`Live v${active?.version ?? '?'} · ${draft.plots.length} mapped plots. Review customer handoff before sharing.`,tab:"plots"};
      return {label:next.label,help:next.help,
        href:projectHref(next.tab==="source"?"masterplan":"masterplan-plots",selectedProject.slug),
        action:"link" as const};
    }
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
  }, [selectedProject, masterplanState, sourceReady, activeBuilding, geoExperience, activeGeo, geoPlotState, sourcePackError]);

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
      const result = await ensureProject(draft, createKind,{
        phonePrimary:createCallNumber.trim(),whatsapp:createWhatsappNumber.trim(),
        publicContactsEnabled:createPublicContacts,
      });
      // All Geo contacts are persisted in the Engine project profile; public
      // sharing is separately authorized by this explicit owner checkbox.
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
              <h2>{projectTotal} project{projectTotal === 1 ? "" : "s"}</h2>
            </div>
            <button className="engine-overview-add" type="button" onClick={() => setShowCreate(true)}>+</button>
          </div>

          <label className="engine-overview-search">
            <span>Search project</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name / slug / location" />
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
          {projectHasMore && <button className="engine-control-button" type="button"
            disabled={projectPageBusy||loading} onClick={()=>void loadMoreProjects()}>
            {projectPageBusy?"Loading…":"Load More Projects"}
          </button>}

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
                  {selectedProject.projectKind==="masterplan_geo" && masterplanState?.activeRelease ? (
                    <a href={`/3Dprojects/${encodeURIComponent(selectedProject.slug)}/masterplan`} target="_blank" rel="noreferrer">Open Masterplan Live</a>
                  ) : null}
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
                  <span>{detailLoading ? "Checking current project draft and publication." : nextAction.help}</span>
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
              <ProjectHandoffCheck key={selectedProject.slug} slug={selectedProject.slug}
                kind={selectedProject.projectKind||"legacy"} buildingLive={buildingLive}
                geoLive={geoLive} geoMapped={Boolean(geoPlotState?.activeMapping?.current)} />

            </>
          )}
        </div>
      </section>

      {showCreate ? (
        <div className="engine-overview-modal-backdrop" role="presentation">
          <section className="engine-overview-modal" role="dialog" aria-modal="true"
            aria-labelledby="engine-create-project-title" aria-describedby="engine-create-project-description">
            <header className="engine-overview-modal__head">
              <div>
                <p>NEW ENGINE PROJECT</p>
                <h2 id="engine-create-project-title">Create 3D Project</h2>
                <span id="engine-create-project-description">Select a project type, then enter the basic details.</span>
              </div>
              <button type="button" disabled={createBusy} onClick={() => setShowCreate(false)} aria-label="Close create project dialog">×</button>
            </header>
            <div className="engine-overview-modal__body">
              <fieldset className="engine-overview-kind-choices">
                <legend>What are you building?</legend>
                {(["building", "building_geo", "masterplan_geo"] as const).map((kind) => (
                  <label key={kind} className={createKind === kind ? "engine-overview-kind active" : "engine-overview-kind"}>
                    <span className="engine-overview-kind__icon" aria-hidden="true">
                      {kind === "building" ? "▤" : kind === "building_geo" ? "⌖" : "▦"}
                    </span>
                    <span className="engine-overview-kind__copy">
                      <b>{PROJECT_KIND_LABELS[kind]}</b>
                      <small>{kind === "building" ? "3D customer website, floors, units and walkthrough" :
                        kind === "building_geo" ? "3D Building on Google Maps with optional plot mapping" :
                        "Layout image, Geo calibration and plot management"}</small>
                    </span>
                    <input className="engine-overview-kind__radio" type="radio" name="engine-project-kind"
                      value={kind} checked={createKind === kind} onChange={() => setCreateKind(kind)} />
                  </label>
                ))}
              </fieldset>
              <div className="engine-overview-create-fields">
                <label>
                  <span>Project name <em aria-hidden="true">*</em></span>
                  <input value={createName} onChange={(event) => setCreateName(event.target.value)}
                    autoFocus required placeholder="e.g. Shreem Palace Demo" />
                </label>
                <label>
                  <span>Location</span>
                  <input value={createLocation} onChange={(event) => setCreateLocation(event.target.value)}
                    placeholder="City / site" />
                </label>
                <label>
                  <span>Customer Call number <small>(optional)</small></span>
                  <input type="tel" value={createCallNumber} maxLength={25} autoComplete="tel"
                    onChange={(event) => setCreateCallNumber(event.target.value)}
                    placeholder="+91 98765 43210" />
                </label>
                <label>
                  <span>Customer WhatsApp number <small>(optional)</small></span>
                  <input type="tel" value={createWhatsappNumber} maxLength={25} autoComplete="off"
                    onChange={(event) => setCreateWhatsappNumber(event.target.value)}
                    placeholder="+91 98765 43210" />
                </label>
              </div>
              <label className="engine-overview-create-public-contact">
                <input type="checkbox" checked={createPublicContacts}
                  onChange={(event) => setCreatePublicContacts(event.target.checked)} />
                <span>Show these numbers on the public Geo site's Call and WhatsApp buttons</span>
              </label>
              <p className="engine-overview-create-privacy">Public sharing is optional and OFF by default. Private Client Admin numbers are never used.</p>
              {createError ? <div className="engine-overview-create-error" role="alert">{createError}</div> : null}
            </div>
            <footer className="engine-overview-modal__actions">
              <span className="engine-overview-modal__selection">Selected: <strong>{PROJECT_KIND_LABELS[createKind]}</strong></span>
              <div className="engine-overview-modal__buttons">
                <button className="engine-control-button" type="button" disabled={createBusy} onClick={() => setShowCreate(false)}>Cancel</button>
                <button className="engine-control-button engine-control-button--primary" type="button"
                  disabled={createBusy} onClick={() => void createProject()}>
                  {createBusy ? "Creating…" : "Create Project"}
                </button>
              </div>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}
