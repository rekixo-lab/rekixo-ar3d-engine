import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { publicProjectPath } from "@rekixo/3d-engine-core";
import {
  activateRelease,
  experiences,
  loadDraft,
  projects,
  releases,
  saveDraft,
  type CloudProjectSummary,
  type CloudReleaseSummary,
} from "../studio/cloud";
import type {
  BuildingEnvironmentLandscapePreset,
  Project,
} from "../studio/domain";
import PlotSiteHandoff from "./PlotSiteHandoff";
import "./building-workspace.css";

const SourcePackReview = lazy(() => import("../source-pack/SourcePackReview"));
const ComponentMapper = lazy(() => import("../source-pack/ComponentMapper"));
type BuildingTab = "source" | "components" | "presentation" | "publish";
const buildingTabs: ReadonlyArray<{id: BuildingTab; label: string}> = [
  { id: "source", label: "01 · Source & Processing" },
  { id: "components", label: "02 · Component Mapper" },
  { id: "presentation", label: "03 · Building Editor" },
  { id: "publish", label: "04 · Publish & History" },
];
function initialBuildingTab(): BuildingTab {
  const requested = new URLSearchParams(window.location.search).get("tab");
  return buildingTabs.find((item) => item.id === requested)?.id || "source";
}

function selectedProjectSlug() {
  return new URLSearchParams(window.location.search).get("project")?.trim().toLowerCase() || "";
}

export default function BuildingWorkspace() {
  const slug = selectedProjectSlug();
  const [project, setProject] = useState<CloudProjectSummary>();
  const [tab, setTab] = useState<BuildingTab>(initialBuildingTab);
  const [activating, setActivating] = useState<string|null>(null);
  const [historyMessage, setHistoryMessage] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [releaseItems, setReleaseItems] = useState<CloudReleaseSummary[]>([]);
  const [hasGeo, setHasGeo] = useState(false);
  const [presentationDraft, setPresentationDraft] = useState<Project>();
  const [draftRevision, setDraftRevision] = useState<number | null>(null);
  const [savingLandscape, setSavingLandscape] = useState(false);
  const [landscapeMessage, setLandscapeMessage] = useState("");
  const [landscapeError, setLandscapeError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!slug) {
      setLoading(false);
      setError("Project select karke Building workspace open karein.");
      return;
    }
    let live = true;
    setLoading(true);
    setError("");
    void Promise.all([
      projects("", "active", 100, 0),
      releases(slug),
      experiences(slug),
      loadDraft(slug).catch(() => undefined),
    ])
      .then(([projectResult, releaseResult, experienceResult, draftResult]) => {
        if (!live) return;
        setProject(projectResult.projects.find((item) => item.slug === slug));
        setReleaseItems(releaseResult.releases);
        setHasGeo(experienceResult.experiences.some((item) => item.type === "geo"));
        setPresentationDraft(draftResult?.draft);
        setDraftRevision(draftResult?.revision ?? null);
      })
      .catch((reason) => {
        if (live) setError(reason instanceof Error ? reason.message : "Building state load nahi hua.");
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [slug, tab]);

  const activeRelease = useMemo(() => releaseItems.find((item) => item.active), [releaseItems]);
  const buildingLive = Boolean(project?.status === "published" && activeRelease);

  async function changeLandscapePreset(value: BuildingEnvironmentLandscapePreset) {
    if (!presentationDraft || draftRevision === null || savingLandscape) return;
    const nextDraft: Project = {
      ...presentationDraft,
      updated: new Date().toISOString(),
      scene: {
        ...presentationDraft.scene,
        landscapePreset: value,
      },
    };
    setPresentationDraft(nextDraft);
    setSavingLandscape(true);
    setLandscapeError("");
    setLandscapeMessage("");
    try {
      const result = await saveDraft(nextDraft, draftRevision);
      setDraftRevision(result.revision);
      setLandscapeMessage("Saved to cloud draft. The choice applies to the next immutable Building release.");
    } catch (reason) {
      setLandscapeError(reason instanceof Error ? reason.message : "Landscape preset was not saved.");
      try {
        const fresh = await loadDraft(slug);
        setPresentationDraft(fresh.draft);
        setDraftRevision(fresh.revision);
      } catch {
        // Keep the visible error; a refresh can recover the saved draft state.
      }
    } finally {
      setSavingLandscape(false);
    }
  }

function selectTab(next: BuildingTab) {
    if (next === tab) return;
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState({}, "", url.pathname + url.search);
    setHistoryMessage("");
    setHistoryError("");
    setTab(next);
  }

  async function restoreBuildingRelease(id: string) {
    if (!slug || activating || !window.confirm("Activate this previously published Building version? The existing published history is retained.")) return;
    setActivating(id);
    setHistoryError("");
    setHistoryMessage("");
    try {
      await activateRelease(slug, id);
      const current = await releases(slug);
      setReleaseItems(current.releases);
      setHistoryMessage("Selected Building version is now active.");
    } catch (reason) {
      setHistoryError(reason instanceof Error ? reason.message : "Release activation failed.");
    } finally {
      setActivating(null);
    }
  }

  return (
    <div className="building-workspace">
      {error ? <div className="building-workspace__alert" role="alert">{error}</div> : null}
      <section className="building-workspace__hero engine-control-card">
        <div>
          <p>3D BUILDING EDITOR</p>
          <h2>{project?.name || (loading ? "Loading project…" : "3D Building")}</h2>
          <span>{activeRelease ? `Published v${activeRelease.version}` : "Draft"} · {draftRevision !== null ? `Draft r${draftRevision}` : "No draft yet"}</span>
        </div>
        <div className="building-workspace__hero-status">
          <span className={buildingLive ? "building-workspace__badge building-workspace__badge--live" : "building-workspace__badge"}>
            {buildingLive ? "LIVE" : "NOT PUBLISHED"}
          </span>
          {buildingLive && <a className="engine-control-link" href={publicProjectPath(slug)} target="_blank" rel="noreferrer">Open Building Website</a>}
        </div>
      </section>

      <nav className="building-workspace__tabs" aria-label="3D Building editor steps">
        {buildingTabs.map((item) => (
          <button type="button" key={item.id} className={tab === item.id ? "active" : ""}
            aria-pressed={tab === item.id} onClick={() => selectTab(item.id)}>
            {item.label}
          </button>
        ))}
      </nav>

      {tab === "source" && (
        <section className="building-workspace__panel building-workspace__panel--source" aria-label="Original sources and processing">
          <Suspense fallback={<p>Loading source editor…</p>}><SourcePackReview /></Suspense>
        </section>
      )}

      {tab === "components" && (
        <section className="building-workspace__panel building-workspace__panel--components" aria-label="Review and map canonical Building components">
          <Suspense fallback={<p>Loading component editor…</p>}><ComponentMapper /></Suspense>
        </section>
      )}

      {tab === "presentation" && (
        <section className="building-workspace__panel building-workspace__panel--presentation" aria-label="Building presentation editor">
          <section className="building-workspace__environment engine-control-card">
            <div>
              <p>BUILDING PRESENTATION</p>
              <h3>Customer surroundings</h3>
              <span>Choose the environment for the next Building version. Original source geometry stays unchanged.</span>
              {landscapeMessage && <small className="building-workspace__environment-message" role="status">{landscapeMessage}</small>}
              {landscapeError && <small className="building-workspace__environment-error" role="alert">{landscapeError}</small>}
            </div>
            {presentationDraft ? (
              <label>Landscape preset
                <select aria-label="Customer landscape preset" value={presentationDraft.scene.landscapePreset ?? "auto"}
                  disabled={savingLandscape || draftRevision === null}
                  onChange={(event) => void changeLandscapePreset(event.target.value as BuildingEnvironmentLandscapePreset)}>
                  <option value="auto">Auto / Suburban</option>
                  <option value="urban">Urban / City</option>
                  <option value="suburban">Suburban / Gardens</option>
                  <option value="rural-farm">Rural Farm / Fields</option>
                  <option value="hillside">Hillside / Natural</option>
                </select>
                <small>Changes save to the draft, not the live site. Open Publish & History to publish updates.</small>
              </label>
            ) : (
              <div className="building-workspace__environment-unavailable">
                {loading ? "Loading draft…" : "First complete Source & Processing, then initialize the Building draft in Publish & History."}
              </div>
            )}
          </section>
          {activeRelease && <section className="engine-control-card building-workspace__preview">
            <h3>Current Building Website</h3>
            <p>View the active published 3D model and check the result on desktop and mobile before sharing.</p>
            <a href={publicProjectPath(slug)} target="_blank" rel="noreferrer">Open Live Preview</a>
          </section>}
        </section>
      )}

      {tab === "publish" && (
        <section className="building-workspace__panel building-workspace__panel--publish" aria-label="Publish Building and restore versions">
          {project && !loading ? (
            <PlotSiteHandoff key={project.id} project={project} draft={presentationDraft}
              draftRevision={draftRevision} releaseItems={releaseItems}
              onDraftReady={(next, revision) => {setPresentationDraft(next);setDraftRevision(revision);}}
              onReleaseReady={(items) => {
                setReleaseItems(items);
                setProject((current) => current ? { ...current, status: "published" } : current);
              }} />
          ) : <p>{loading ? "Checking Building publication…" : "Select a project to publish."}</p>}

          <section className="building-workspace__versions engine-control-card">
            <h3>Building version history</h3>
            <p>Previous versions are preserved. Only the selected active version appears on the Building customer site.</p>
            {historyError && <p role="alert" className="building-workspace__alert">{historyError}</p>}
            {historyMessage && <p role="status" className="building-workspace__ok">{historyMessage}</p>}
            {releaseItems.map((item) => (
              <article key={item.id} className="building-workspace__version">
                <div><strong>Building v{item.version}</strong><small>{item.active ? "LIVE" : "Previously published"} · {item.createdAt.slice(0,10)}</small></div>
                {item.active
                  ? <span>Active</span>
                  : <button type="button" disabled={Boolean(activating)}
                      onClick={() => void restoreBuildingRelease(item.id)}>{activating === item.id ? "Activating…" : "Restore Version"}</button>}
              </article>
            ))}
            {!releaseItems.length && <p>No Building versions have been published.</p>}
            {hasGeo && <p>Geo site versions are controlled separately in the 3D Building Geo Editor.</p>}
          </section>
        </section>
      )}
    </div>
  );
}
