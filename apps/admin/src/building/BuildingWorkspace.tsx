import { useEffect, useMemo, useState } from "react";
import { publicProjectPath } from "@rekixo/3d-engine-core";
import {
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

function selectedProjectSlug() {
  return new URLSearchParams(window.location.search).get("project")?.trim().toLowerCase() || "";
}

export default function BuildingWorkspace() {
  const slug = selectedProjectSlug();
  const [project, setProject] = useState<CloudProjectSummary>();
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
  }, [slug]);

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

  return (
    <div className="building-workspace">
      {error ? <div className="building-workspace__alert">{error}</div> : null}

      <section className="building-workspace__hero engine-control-card">
        <div>
          <p>BUILDING CONTROL CENTER</p>
          <h2>{project?.name || (loading ? "Loading Building workspace…" : "3D Building")}</h2>
          <span>
            {activeRelease
              ? `Active immutable Building release v${activeRelease.version}.`
              : "Source → review → immutable Building release workflow."}
          </span>
        </div>
        <div className="building-workspace__hero-status">
          <span className={buildingLive ? "building-workspace__badge building-workspace__badge--live" : "building-workspace__badge"}>
            {buildingLive ? "BUILDING LIVE" : activeRelease ? "RELEASE READY" : "IN PROGRESS"}
          </span>
          {buildingLive ? (
            <a className="engine-control-link" href={publicProjectPath(slug)} target="_blank" rel="noreferrer">Open Building Site</a>
          ) : null}
        </div>
      </section>

      {project && !loading ? (
        <PlotSiteHandoff
          key={project.id}
          project={project}
          draft={presentationDraft}
          draftRevision={draftRevision}
          releaseItems={releaseItems}
          onDraftReady={(next, revision) => {
            setPresentationDraft(next);
            setDraftRevision(revision);
          }}
          onReleaseReady={(items) => {
            setReleaseItems(items);
            setProject((current) => current ? { ...current, status: "published" } : current);
          }}
        />
      ) : null}

      <section className="building-workspace__environment engine-control-card">
        <div>
          <p>EXTERIOR ENVIRONMENT</p>
          <h3>Customer surroundings</h3>
          <span>
            Pick a context for the next Building release. Reviewed/source Building geometry stays authoritative; generated surroundings are additive.
          </span>
          {landscapeMessage ? <small className="building-workspace__environment-message">{landscapeMessage}</small> : null}
          {landscapeError ? <small className="building-workspace__environment-error">{landscapeError}</small> : null}
        </div>
        {presentationDraft ? (
          <label>
            Landscape preset
            <select
              aria-label="Customer landscape preset"
              value={presentationDraft.scene.landscapePreset ?? "auto"}
              disabled={savingLandscape || draftRevision === null}
              onChange={(event) => void changeLandscapePreset(event.target.value as BuildingEnvironmentLandscapePreset)}
            >
              <option value="auto">Auto / Suburban</option>
              <option value="urban">Urban / City</option>
              <option value="suburban">Suburban / Gardens</option>
              <option value="rural-farm">Rural Farm / Fields</option>
              <option value="hillside">Hillside / Natural</option>
            </select>
            <small>{savingLandscape ? "Saving…" : "Saved with optimistic draft revision checks."}</small>
          </label>
        ) : (
          <div className="building-workspace__environment-unavailable">
            {loading ? "Loading presentation draft…" : "Start the Source Pack / Building draft before selecting an environment."}
          </div>
        )}
      </section>

      <section className="building-workspace__flow" aria-label="Building workflow">
        <article className="engine-control-card">
          <div className="building-workspace__step">01</div>
          <div>
            <p>SOURCE & BUILD</p>
            <h3>Prepare canonical Building</h3>
            <span>Verified originals, geometry authority, scale review and durable processing stay together in Source Pack.</span>
          </div>
          <a href={`/3Dprojects/source-pack?project=${encodeURIComponent(slug)}`}>Open Source Pack</a>
        </article>

        <article className="engine-control-card">
          <div className="building-workspace__step">02</div>
          <div>
            <p>REVIEW</p>
            <h3>Review canonical components</h3>
            <span>Bind verified model nodes to floor, unit, room and semantic identities without changing source geometry.</span>
          </div>
          <a href={`/3Dprojects/component-mapper?project=${encodeURIComponent(slug)}`}>Open Component Review</a>
        </article>

        <article className="engine-control-card">
          <div className="building-workspace__step">03</div>
          <div>
            <p>PRESENTATION</p>
            <h3>Check customer-facing Building</h3>
            <span>Use the current immutable Building output as the customer-facing truth. Live site remains independent from optional Geo.</span>
          </div>
          {buildingLive ? (
            <a href={publicProjectPath(slug)} target="_blank" rel="noreferrer">Open Presentation</a>
          ) : (
            <a href={`/3Dprojects/source-pack?project=${encodeURIComponent(slug)}`}>Continue Building Setup</a>
          )}
        </article>

        <article className="engine-control-card">
          <div className="building-workspace__step">04</div>
          <div>
            <p>PUBLISH</p>
            <h3>Immutable Building release</h3>
            <span>Release activation, history and live identity are managed centrally so operators do not hunt across screens.</span>
          </div>
          <a href={`/3Dprojects/releases?project=${encodeURIComponent(slug)}`}>Open Building Releases</a>
        </article>
      </section>

      <section className="building-workspace__summary engine-control-card">
        <div>
          <p>CURRENT STATE</p>
          <h3>Building release summary</h3>
        </div>
        <dl>
          <div><dt>Project</dt><dd>{project?.status?.toUpperCase() || "—"}</dd></div>
          <div><dt>Active Building</dt><dd>{activeRelease ? `v${activeRelease.version}` : "Not published"}</dd></div>
          <div><dt>Release history</dt><dd>{releaseItems.length}</dd></div>
          <div><dt>Geo add-on</dt><dd>{hasGeo ? "Added" : "Optional / not added"}</dd></div>
        </dl>
      </section>
    </div>
  );
}
