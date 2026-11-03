import { useEffect, useState } from "react";
import { ADMIN_BASE_PATH } from "@rekixo/3d-contracts";
import {
  deleteAllProjects,
  deletionStatus,
  geoMapsSettings,
  projects,
  saveGeoMapsKey,
  type CloudDeletionJob,
} from "../studio/cloud";
import "./engine-advanced.css";

type StatusPayload = {
  project?: { slug?: string; status?: string };
  activeModel?: { available?: boolean; name?: string; byteSize?: number };
  storage?: { bucket?: string };
  scenes?: Array<{ enabled?: boolean }>;
  uploadContract?: { format?: string; recommendedKey?: string };
  error?: string;
};

type MapsIdPayload = {
  mapId: string | null;
  configured: boolean;
  error?: string;
};

const MAP_ID_CONFIG_URL = "/3Dprojects/api/geo-v2/maps-config";

function selectedProjectSlug() {
  return new URLSearchParams(window.location.search).get("project")?.trim().toLowerCase() || "";
}

function formatBytes(value?: number) {
  if (!value || value <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index ? 1 : 0)} ${units[index]}`;
}

async function loadMapId() {
  const response = await fetch(MAP_ID_CONFIG_URL, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const body = (await response.json()) as MapsIdPayload;
  if (!response.ok) throw new Error(body.error || `Map ID config failed (${response.status}).`);
  return body;
}

async function saveMapId(mapId: string) {
  const response = await fetch(MAP_ID_CONFIG_URL, {
    method: "PUT",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ mapId }),
  });
  const body = (await response.json()) as MapsIdPayload;
  if (!response.ok) throw new Error(body.error || `Map ID save failed (${response.status}).`);
  return body;
}

export default function EngineAdvanced() {
  const slug = selectedProjectSlug();
  const [status, setStatus] = useState<StatusPayload>();
  const [projectCount, setProjectCount] = useState(0);
  const [mapsKey, setMapsKey] = useState("");
  const [mapId, setMapId] = useState("");
  const [mapsConfigured, setMapsConfigured] = useState(false);
  const [mapIdConfigured, setMapIdConfigured] = useState(false);
  const [deletionJob, setDeletionJob] = useState<CloudDeletionJob | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setError("");
    const [projectResult, maps, mapIdState, deletion] = await Promise.all([
      projects("", "active", 100, 0),
      geoMapsSettings().catch(() => ({ apiKey: null })),
      loadMapId().catch(() => ({ mapId: null, configured: false })),
      deletionStatus().catch(() => ({ job: null })),
    ]);
    setProjectCount(projectResult.total);
    setMapsKey(maps.apiKey || "");
    setMapsConfigured(Boolean(maps.apiKey));
    setMapId(mapIdState.mapId || "");
    setMapIdConfigured(Boolean(mapIdState.configured && mapIdState.mapId));
    setDeletionJob(deletion.job);

    if (!slug) {
      setStatus(undefined);
      return;
    }
    const response = await fetch(`${ADMIN_BASE_PATH}/api/status?slug=${encodeURIComponent(slug)}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const body = (await response.json()) as StatusPayload;
    if (!response.ok) throw new Error(body.error || `Status API failed (${response.status}).`);
    setStatus(body);
  }

  useEffect(() => {
    void load().catch((reason) => setError(reason instanceof Error ? reason.message : "Advanced state load nahi hua."));
  }, [slug]);

  async function saveMapsProvider() {
    const key = mapsKey.trim();
    const vectorMapId = mapId.trim();
    if (!key) {
      setError("Google Maps browser key required hai.");
      return;
    }
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(vectorMapId)) {
      setError("Valid Google Maps JavaScript Vector Map ID required hai.");
      return;
    }
    setBusy("maps");
    setError("");
    setMessage("");
    try {
      const [savedKey, savedMapId] = await Promise.all([
        saveGeoMapsKey(key),
        saveMapId(vectorMapId),
      ]);
      setMapsKey(savedKey.apiKey);
      setMapsConfigured(true);
      setMapId(savedMapId.mapId || vectorMapId);
      setMapIdConfigured(Boolean(savedMapId.configured));
      setMessage("Google Maps browser key and production Vector Map ID saved. Geo authoring, verification and public runtime can use the same provider configuration.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Maps configuration save nahi hui.");
    } finally {
      setBusy("");
    }
  }

  async function deleteEverything() {
    if (deleteConfirm !== "DELETE ALL PROJECTS") {
      setError("Danger Zone confirm karne ke liye DELETE ALL PROJECTS exactly type karein.");
      return;
    }
    setBusy("delete");
    setError("");
    setMessage("");
    try {
      const result = await deleteAllProjects(deletionJob?.expectedProjectCount ?? projectCount, deleteConfirm);
      setMessage(`Permanent project cleanup complete. ${result.deletedProjects} project records and ${result.deletedR2Objects} project-owned objects removed.`);
      setDeleteConfirm("");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Permanent cleanup complete nahi hua.");
      const state = await deletionStatus().catch(() => ({ job: null }));
      setDeletionJob(state.job);
    } finally {
      setBusy("");
    }
  }

  const enabledScenes = status?.scenes?.filter((scene) => scene.enabled).length || 0;
  const mapsReady = mapsConfigured && mapIdConfigured;

  return (
    <div className="engine-advanced-page">
      {error ? <div className="engine-advanced-alert engine-advanced-alert--error">{error}</div> : null}
      {message ? <div className="engine-advanced-alert engine-advanced-alert--ok">{message}</div> : null}

      <section className="engine-advanced-grid">
        <article className="engine-advanced-panel engine-control-card">
          <header>
            <div>
              <p>DIAGNOSTICS</p>
              <h2>Selected project health</h2>
              <span>Operational signals only. Editing tools stay in their own workflow sections.</span>
            </div>
          </header>
          <dl className="engine-advanced-diagnostics">
            <div><dt>Project status</dt><dd>{status?.project?.status?.toUpperCase() || "—"}</dd></div>
            <div><dt>Model</dt><dd>{status?.activeModel?.available ? `Ready · ${status.activeModel.name || "GLB"}` : "Upload / processing needed"}</dd></div>
            <div><dt>Model size</dt><dd>{formatBytes(status?.activeModel?.byteSize)}</dd></div>
            <div><dt>Storage</dt><dd>{status?.storage?.bucket || "rekixo-3d-assets"}</dd></div>
            <div><dt>Configured modules</dt><dd>{enabledScenes}/6</dd></div>
            <div><dt>Web format</dt><dd>{status?.uploadContract?.format || "GLB 2.0"}</dd></div>
          </dl>
        </article>

        <article className="engine-advanced-panel engine-control-card">
          <header>
            <div>
              <p>MAP PROVIDER</p>
              <h2>Google Maps production configuration</h2>
              <span>Browser key and JavaScript Vector Map ID are kept out of normal placement. Both are required for production WebGL Geo verification and publish.</span>
            </div>
            <b className={mapsReady ? "engine-advanced-state engine-advanced-state--ready" : "engine-advanced-state"}>{mapsReady ? "READY" : "SETUP REQUIRED"}</b>
          </header>
          <div className="engine-advanced-map-fields">
            <label className="engine-advanced-key">
              <span>Browser API key</span>
              <input type="password" value={mapsKey} onChange={(event) => setMapsKey(event.target.value)} placeholder="Google Maps browser API key" />
              <small>{mapsConfigured ? "Saved" : "Required"}</small>
            </label>
            <label className="engine-advanced-key">
              <span>JavaScript Vector Map ID</span>
              <input value={mapId} onChange={(event) => setMapId(event.target.value)} placeholder="Production Google Maps Map ID" autoComplete="off" />
              <small>{mapIdConfigured ? "Saved · production vector map" : "Required before Geo verify/publish"}</small>
            </label>
          </div>
          <button className="engine-control-button engine-control-button--primary" type="button" disabled={busy === "maps"} onClick={() => void saveMapsProvider()}>
            {busy === "maps" ? "Saving…" : "Save Maps Configuration"}
          </button>
        </article>
      </section>

      <section className="engine-advanced-panel engine-control-card">
        <header>
          <div>
            <p>ENGINE INFORMATION</p>
            <h2>Technical project identity</h2>
            <span>Useful when diagnosing storage or release issues without cluttering Overview.</span>
          </div>
        </header>
        <dl className="engine-advanced-technical">
          <div><dt>Project slug</dt><dd>{slug || "No project selected"}</dd></div>
          <div><dt>Recommended model key</dt><dd>{status?.uploadContract?.recommendedKey || (slug ? `projects/${slug}/models/exterior-v1.glb` : "—")}</dd></div>
          <div><dt>Media prefix</dt><dd>{slug ? `projects/${slug}/media/` : "—"}</dd></div>
        </dl>
      </section>

      <section className="engine-advanced-danger engine-control-card">
        <header>
          <div>
            <p>DANGER ZONE</p>
            <h2>{deletionJob ? "Finish pending permanent cleanup" : "Delete all Engine projects"}</h2>
            <span>
              {deletionJob
                ? "A previous deletion job safely paused. Re-running resumes the same cleanup boundary."
                : "This is intentionally separated from normal project management. It archives/freezes first, cleans project-owned storage, then removes project records."}
            </span>
          </div>
          <b>{deletionJob ? "CLEANUP PENDING" : `${projectCount} PROJECT${projectCount === 1 ? "" : "S"}`}</b>
        </header>
        <label>
          <span>Type DELETE ALL PROJECTS to confirm</span>
          <input value={deleteConfirm} onChange={(event) => setDeleteConfirm(event.target.value)} placeholder="DELETE ALL PROJECTS" />
        </label>
        <button type="button" disabled={busy === "delete" || (!projectCount && !deletionJob)} onClick={() => void deleteEverything()}>
          {busy === "delete" ? "Deleting…" : deletionJob ? "Resume Permanent Cleanup" : "Delete All Projects Permanently"}
        </button>
      </section>
    </div>
  );
}
