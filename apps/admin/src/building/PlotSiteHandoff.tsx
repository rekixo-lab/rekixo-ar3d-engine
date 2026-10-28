import { useEffect, useState } from "react";
import { publicProjectPath } from "@rekixo/3d-engine-core";
import {
  loadDraft,
  publishRelease,
  releases,
  saveDraft,
  type CloudProjectSummary,
  type CloudReleaseSummary,
} from "../studio/cloud";
import { newProject, type Project } from "../studio/domain";

type CanonicalState = {
  schemaReady?: boolean;
  processing?: {
    sourcePackVersion: number | null;
    state: string | null;
    processingJobId: string | null;
    outputManifestSha256: string | null;
  };
  mappingReady?: boolean;
  reason?: string | null;
};

function mapperUrl(slug: string) {
  return `/3Dprojects/api/cloud/projects/${encodeURIComponent(slug)}/component-mapper`;
}

async function readCanonicalStatus(slug: string): Promise<CanonicalState> {
  const response = await fetch(mapperUrl(slug), {
    cache: "no-store",
    credentials: "same-origin",
  });
  const payload = (await response.json()) as CanonicalState & { error?: string };
  if (!response.ok || payload.schemaReady === false)
    throw Error(payload.error || `Canonical readiness unavailable (HTTP ${response.status}).`);
  return payload;
}

function plotDraft(project: CloudProjectSummary): Project {
  const draft = newProject(project.name);
  // Studio draft identity must match the existing project; never create another project.
  draft.id = project.id;
  draft.slug = project.slug;
  draft.location = project.location ?? "";
  draft.brief = "Site / plotting layout from a verified canonical model. Plot numbering and site location need independent review.";
  // The Studio schema currently requires one floor record. This is an internal
  // coordinate placeholder, NOT an assertion that the plot has a physical floor.
  draft.scene.floors[0].name = "Site Base";
  draft.scene.landscapePreset = "auto";
  return draft;
}

export default function PlotSiteHandoff({
  project, draft, draftRevision, releaseItems, onDraftReady, onReleaseReady,
}: {
  project: CloudProjectSummary;
  draft?: Project;
  draftRevision: number | null;
  releaseItems: CloudReleaseSummary[];
  onDraftReady: (draft: Project, revision: number) => void;
  onReleaseReady: (releases: CloudReleaseSummary[]) => void;
}) {
  const [canonical, setCanonical] = useState<CanonicalState>();
  const [canonicalError, setCanonicalError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [approved, setApproved] = useState(false);
  const slug = project.slug;
  const hasRelease = releaseItems.length > 0;
  const processingReady = canonical?.processing?.state === "succeeded" &&
    Boolean(canonical.processing.processingJobId && canonical.processing.outputManifestSha256);

  async function refreshCanonical() {
    const state = await readCanonicalStatus(slug);
    setCanonical(state);
    setCanonicalError("");
    return state;
  }

  useEffect(() => {
    setCanonical(undefined);
    setCanonicalError("");
    setMessage("");
    setError("");
    setApproved(false);
    void refreshCanonical().catch((reason: unknown) => {
      setCanonicalError(reason instanceof Error ? reason.message : "Canonical processing state could not be loaded.");
    });
  }, [slug]);

  async function initialize() {
    if (busy || draft || !processingReady || hasRelease) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      // Fail closed against any concurrent or corrupted draft. Never overwrite.
      try {
        const existing = await loadDraft(slug);
        throw Error(`Studio draft already exists (revision ${existing.revision}); reload before continuing.`);
      } catch (reason) {
        if (!(reason instanceof Error) || !/Cloud draft not found/i.test(reason.message))
          throw reason;
      }
      const initial = plotDraft(project);
      const result = await saveDraft(initial, null);
      onDraftReady(initial, result.revision);
      await refreshCanonical();
      setMessage("Site draft created. Canonical model is preserved. Review scale before publishing.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Site draft creation failed.");
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (busy || !processingReady || !draft || draftRevision === null || !approved || hasRelease) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const current = await readCanonicalStatus(slug);
      if (current.processing?.state !== "succeeded" ||
          !current.processing.processingJobId ||
          !current.processing.outputManifestSha256)
        throw Error("Canonical processing is no longer succeeded. Release blocked.");
      // No mutation unless the operator explicitly approves the actual site model.
      if (!window.confirm(
        "Publish the verified canonical 3D plot/site model as this project's FIRST public 3D release? " +
        "Confirm its dimensions, orientation and materials were checked. Geo placement will remain unpublished."
      )) return;
      await publishRelease(slug, draftRevision, true);
      const state = await releases(slug);
      onReleaseReady(state.releases);
      setApproved(false);
      setMessage("3D Site release is active. Open it and check the model before setting up Geo.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Canonical site release failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="plot-site-handoff engine-control-card" aria-label="Plot and site layout workflow">
      <header>
        <div>
          <p>LAND / PLOTTING SITE WORKFLOW</p>
          <h3>3D Plot Layout → Site Release → Geo Map</h3>
          <span>For layouts, roads and entrance gates. Floor/room mapping is not required to publish the verified 3D source.</span>
        </div>
        <span className={hasRelease ? "plot-site-handoff__state plot-site-handoff__state--ready" : "plot-site-handoff__state"}>
          {hasRelease ? "RELEASE EXISTS" : processingReady ? "MODEL READY" : "CHECK SOURCE"}
        </span>
      </header>
      {canonicalError ? <p className="plot-site-handoff__error" role="alert">{canonicalError}</p> : null}
      {error ? <p className="plot-site-handoff__error" role="alert">{error}</p> : null}
      {message ? <p className="plot-site-handoff__message" role="status">{message}</p> : null}
      <ol className="plot-site-handoff__steps">
        <li>
          <b>1 · Canonical 3D Model</b>
          <span>{processingReady
            ? `Verified Source Pack v${canonical?.processing?.sourcePackVersion ?? "?"} · Processing SUCCEEDED`
            : canonical ? canonical.reason || "A succeeded canonical model is required." : "Checking source…"}
          </span>
          <a href={`/3Dprojects/source-pack?project=${encodeURIComponent(slug)}`}>Open Source Pack</a>
        </li>
        <li>
          <b>2 · Project Draft</b>
          <span>{draft
            ? `Studio draft r${draftRevision ?? "?"} saved · No invented rooms or plot IDs`
            : "One-time setup; uses the existing project ID and verified canonical source."}</span>
          {!draft && !hasRelease
            ? <button type="button" onClick={() => void initialize()} disabled={busy || !processingReady}>
                {busy ? "Working…" : "Initialize Plot Site Draft"}
              </button>
            : <span className="plot-site-handoff__done">{draft ? "READY" : "Not required for existing release"}</span>}
        </li>
        <li>
          <b>3 · Review and Publish 3D Site</b>
          <span>Plot-specific node mapping is optional. Confirm site geometry, scale and gate orientation before publication.</span>
          {!hasRelease ? (
            <>
              <label className="plot-site-handoff__confirm">
                <input type="checkbox" checked={approved} disabled={!draft || busy || !processingReady}
                  onChange={(event) => setApproved(event.target.checked)} />
                I reviewed the actual GLB/site bounds, orientation and materials and approve creating the first public 3D release.
              </label>
              <button type="button" disabled={busy || !draft || draftRevision === null || !processingReady || !approved}
                onClick={() => void publish()}>
                {busy ? "Working…" : "Publish First 3D Site Release"}
              </button>
            </>
          ) : <a href={publicProjectPath(slug)} target="_blank" rel="noreferrer">Open 3D Site</a>}
        </li>
        <li>
          <b>4 · Place on Geo Satellite Map</b>
          <span>Geo requires an active 3D release and a verified real-world site location. It never auto-publishes.</span>
          {releaseItems.some((item) => item.active)
            ? <a href={`/3Dprojects/geo-mapper?project=${encodeURIComponent(slug)}`}>Open Geo Alignment</a>
            : <span className="plot-site-handoff__done">Unlocks after site release</span>}
        </li>
      </ol>
      {hasRelease && !releaseItems.some((item) => item.active) ?
        <p className="plot-site-handoff__error">An immutable release exists but is not active. Open Releases to activate it before Geo.</p> : null}
      {hasRelease ? <a className="plot-site-handoff__footer-link"
        href={`/3Dprojects/releases?project=${encodeURIComponent(slug)}`}>Open Release History</a> : null}
    </section>
  );
}
