import { useEffect, useMemo, useState } from "react";
import { ADMIN_BASE_PATH } from "@rekixo/3d-contracts";
import ProcessingSpine from "./ProcessingSpine";
import SourceOriginalUploader from "./SourceOriginalUploader";
import "./source-pack-review.css";

type AuthoritySuggestion =
  | { status: "suggested"; sourceFileId: string; score: number; reason: string }
  | { status: "operator-review-required"; sourceFileId: null; reason: string };

type Suggestion = {
  sourceFileId: string;
  filename: string;
  mediaType: string;
  byteSize: number;
  sha256: string;
  suggestedRoles: string[];
  suggestedCapabilities: string[];
  confidence: number;
  geometryAuthorityScore: number;
  rationaleCode: string;
};

type ReviewFile = {
  sourceFileId: string;
  filename: string;
  mediaType: string;
  byteSize: number;
  sha256: string;
  uploadState: string;
  roles: string[];
  capabilities: string[];
  classificationOrigin: "automatic" | "operator";
  classificationConfidence: number;
  notes: string | null;
  sortOrder: number;
};

type SourcePack = {
  id: string;
  projectId: string;
  version: number;
  status: "draft" | "ready" | "superseded" | "failed";
  geometryAuthorityFileId: string | null;
  operatorApproved: boolean;
  manifestSha256: string | null;
  approvedBy: string | null;
  files: ReviewFile[];
  readiness: {
    ready: boolean;
    verifiedSourceCount: number;
    reviewedSourceCount: number;
    geometryAuthorityFileId: string | null;
    missingSourceIds: string[];
    staleSourceIds: string[];
  };
};

type ReviewPayload = {
  project: { id: string; slug: string; name: string; status: string };
  authoritySuggestion: AuthoritySuggestion;
  suggestions: Suggestion[];
  latestPack: SourcePack | null;
  operatorApprovalRequired: boolean;
  immutableAfterSeal: boolean;
  error?: string;
};

const optionalRoles = [
  ["material-recovery", "Material recovery"],
  ["evidence", "Evidence / dimensions"],
  ["content-reference", "Project content"],
  ["presentation-reference", "Visual reference"],
] as const;

function selectedProjectSlug() {
  return new URLSearchParams(window.location.search).get("project")?.trim().toLowerCase() || "";
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

function apiPath(slug: string) {
  return `${ADMIN_BASE_PATH}/api/cloud/projects/${encodeURIComponent(slug)}/source-pack-review`;
}

async function readPayload(response: Response) {
  const body = (await response.json()) as ReviewPayload;
  if (!response.ok) throw new Error(body.error || `Source Pack API failed (${response.status}).`);
  return body;
}

export default function SourcePackReview() {
  const slug = selectedProjectSlug();
  const [data, setData] = useState<ReviewPayload>();
  const [files, setFiles] = useState<ReviewFile[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [modelSelection, setModelSelection] = useState<string | null>(null);

  async function load() {
    if (!slug) {
      setError("Project select karke Source Pack Review open karein.");
      return;
    }
    setError("");
    const payload = await readPayload(
      await fetch(apiPath(slug), { headers: { Accept: "application/json" }, cache: "no-store" }),
    );
    setData(payload);
    setFiles(payload.latestPack?.files ?? []);
    setDirty(false);
    setModelSelection(null);
    return payload;
  }

  useEffect(() => {
    void load().catch((reason: unknown) =>
      setError(reason instanceof Error ? reason.message : "Source Pack Review load nahi hua."),
    );
  }, [slug]);

  async function post(body: Record<string, unknown>, label: string) {
    if (!slug) return;
    setBusy(label);
    setError("");
    setMessage("");
    try {
      const payload = await readPayload(
        await fetch(apiPath(slug), {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
      setData(payload);
      setFiles(payload.latestPack?.files ?? []);
      setDirty(false);
      setModelSelection(null);
      return payload;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Source Pack operation failed.");
      return undefined;
    } finally {
      setBusy("");
    }
  }

  async function refreshClassification() {
    if (!slug) return;
    setBusy("classify");
    setError("");
    setMessage("");
    try {
      const response = await fetch(
        `${ADMIN_BASE_PATH}/api/cloud/projects/${encodeURIComponent(slug)}/source-classification`,
        { method: "POST", headers: { Accept: "application/json" } },
      );
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error || `Classification failed (${response.status}).`);
      await load();
      setMessage("Automatic source analysis refreshed. Final authority abhi bhi operator approval maangta hai.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Automatic analysis refresh failed.");
    } finally {
      setBusy("");
    }
  }

  async function afterModelUpload(uploadedFiles: File[]) {
    const current = await load();
    if (!current) return;
    // Only a new verified GLB starts a review automatically. An FBX may need
    // local conversion first; opening a draft early would lock that tool.
    if (!uploadedFiles.some((file) => /\.glb$/i.test(file.name)) ||
        current.latestPack?.status === "draft") return;
    const next = await post({ action: "start-draft" }, "start");
    if (next) setMessage("New model uploaded. Confirm the selected checksum, then prepare it with one click.");
  }

  async function startDraft() {
    if (data?.latestPack?.status === "ready" &&
      !window.confirm("Create a new 3D model version? The current live Building, Geo site and mapped plots stay unchanged until you publish a reviewed replacement."))
      return;
    const result = await post({ action: "start-draft" }, "start");
    if (result) setMessage(`Source Pack v${result.latestPack?.version} review draft ready.`);
  }

  async function abandonDraft() {
    const pack = data?.latestPack;
    if (!pack || pack.status !== "draft" || busy) return;
    if (!window.confirm("Discard UNSEALED review? Verified originals and published Building/Geo remain safe. This unlocks GLB upload.")) return;
    const next = await post({ action: "abandon-draft", packId: pack.id, confirm: "DISCARD DRAFT" }, "abandon");
    if (next) setMessage("Review discarded. Original DAE remains verified; upload converted GLB now.");
  }

  function chooseAuthority(sourceFileId: string) {
    setFiles((current) =>
      current.map((file) => ({
        ...file,
        roles:
          file.sourceFileId === sourceFileId
            ? [...new Set([...file.roles.filter((role) => role !== "geometry-authority"), "geometry-authority"])]
            : file.roles.filter((role) => role !== "geometry-authority"),
      })),
    );
    setDirty(true);
  }

  function toggleRole(sourceFileId: string, role: string) {
    setFiles((current) =>
      current.map((file) => {
        if (file.sourceFileId !== sourceFileId) return file;
        const roles = file.roles.includes(role)
          ? file.roles.filter((item) => item !== role)
          : [...file.roles, role];
        return { ...file, roles };
      }),
    );
    setDirty(true);
  }

  function updateNotes(sourceFileId: string, notes: string) {
    setFiles((current) =>
      current.map((file) => (file.sourceFileId === sourceFileId ? { ...file, notes } : file)),
    );
    setDirty(true);
  }

  async function saveReview() {
    const pack = data?.latestPack;
    if (!pack || pack.status !== "draft") return;
    const result = await post(
      {
        action: "save-review",
        packId: pack.id,
        files: files.map((file) => ({
          sourceFileId: file.sourceFileId,
          roles: file.roles,
          capabilities: file.capabilities,
          notes: file.notes,
        })),
      },
      "save",
    );
    if (result) setMessage("Operator review saved. Seal karne se pehle geometry authority aur roles dobara check karein.");
  }

  async function sealPack() {
    const pack = data?.latestPack;
    if (!pack || pack.status !== "draft") return;
    if (dirty) {
      setError("Unsaved review changes hain. Source Pack seal karne se pehle Save Review karein.");
      return;
    }
    if (!window.confirm("Source Pack seal hone ke baad immutable ho jayega. Continue?")) return;
    const result = await post(
      { action: "seal", packId: pack.id, confirm: "SEAL SOURCE PACK" },
      "seal",
    );
    if (result) setMessage(`Source Pack v${result.latestPack?.version} sealed and immutable.`);
  }

  // The latest verified model by Source Pack sort order is suggested, not
  // silently approved. Same-name originals remain distinct by their SHA-256.
  const modelOptions = [...files]
    .filter((file) => file.uploadState === "verified" &&
      file.capabilities.includes("geometry") &&
      (/\.(glb|fbx)$/i.test(file.filename) || /gltf-binary|fbx/i.test(file.mediaType)))
    .sort((a, b) => b.sortOrder - a.sortOrder);
  const proposedModel = modelOptions.find((file) => file.sourceFileId === modelSelection) ??
    modelOptions.find((file) => file.roles.includes("geometry-authority")) ??
    modelOptions[0];

  async function prepareModel() {
    const pack = data?.latestPack;
    const candidate = proposedModel;
    if (!pack || pack.status !== "draft" || !candidate || busy) return;
    if (!window.confirm("Prepare the NEW 3D model?\\n\\nFile: " + candidate.filename +
      "\\nSHA-256: " + candidate.sha256 +
      "\\n\\nThis saves and seals a new Source Pack and queues private processing. " +
      "The current LIVE Building release, Geo mapping, Plot IDs and customer status will NOT change. Continue?"))
      return;
    setBusy("prepare");
    setError("");
    setMessage("");
    try {
      const request = async (body: Record<string, unknown>) => readPayload(
        await fetch(apiPath(slug), {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify(body),
          credentials: "same-origin",
        }),
      );
      const nextFiles = files.map((file) => ({
        sourceFileId: file.sourceFileId,
        roles: file.sourceFileId === candidate.sourceFileId
          ? [...new Set([...file.roles.filter((role) => role !== "geometry-authority"), "geometry-authority"])]
          : file.roles.filter((role) => role !== "geometry-authority"),
        capabilities: file.capabilities,
        notes: file.notes,
      }));
      const reviewed = await request({ action: "save-review", packId: pack.id, files: nextFiles });
      if (reviewed.latestPack?.id !== pack.id || !reviewed.latestPack.readiness.ready ||
          reviewed.latestPack.geometryAuthorityFileId !== candidate.sourceFileId)
        throw Error("The model review was not confirmed by the server. No new version was published.");
      const sealed = await request({ action: "seal", packId: pack.id, confirm: "SEAL SOURCE PACK" });
      if (sealed.latestPack?.id !== pack.id || sealed.latestPack.status !== "ready")
        throw Error("New source pack was not sealed. Check the review before processing.");
      setData(sealed);
      setFiles(sealed.latestPack.files);
      setDirty(false);
      setModelSelection(null);
      try {
        const queued = await fetch(
          `${ADMIN_BASE_PATH}/api/cloud/projects/${encodeURIComponent(slug)}/processing`, {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ action: "start", sourcePackId: pack.id }),
          credentials: "same-origin",
        });
        const result = await queued.json() as { error?: string };
        if (!queued.ok) throw Error(result.error || "Processing could not be queued.");
        setMessage("New 3D model prepared. Private processing has started. Check the result before publishing.");
      } catch (reason) {
        setMessage("New 3D model saved safely. Start Processing below to continue: " +
          (reason instanceof Error ? reason.message : String(reason)));
      }
    } catch (reason) {
      // Read authoritative state after a partial save or seal and retain the
      // original failure message instead of hiding it with a successful reload.
      try { await load(); } catch { /* The operator can refresh explicitly. */ }
      setError(reason instanceof Error ? reason.message : "Could not prepare the model.");
    } finally {
      setBusy("");
    }
  }

  const pack = data?.latestPack;
  const authorityId = useMemo(
    () => files.find((file) => file.roles.includes("geometry-authority"))?.sourceFileId ?? null,
    [files],
  );
  const suggestionById = useMemo(
    () => new Map((data?.suggestions ?? []).map((item) => [item.sourceFileId, item])),
    [data],
  );
  const suggestedAuthorityId =
    data?.authoritySuggestion.status === "suggested"
      ? data.authoritySuggestion.sourceFileId
      : null;
  const processingSignal = `${pack?.id ?? ""}:${pack?.status ?? ""}:${pack?.manifestSha256 ?? ""}`;
  const packReady = pack?.status === "ready";

  return (
    <main className="source-review source-review--simple">
      <header className="source-review__simple-head">
        <div>
          <h2>3D Model</h2>
          <span>{pack ? `Version ${pack.version} · ${pack.status === "ready" ? "Ready" : "Preparing"}` : "No model yet"}</span>
        </div>
        <button type="button" disabled={Boolean(busy) || !slug || dirty}
          onClick={() => void refreshClassification()} title="Reload verified files">
          Refresh
        </button>
      </header>

      {error && <p className="source-review__alert source-review__alert--error" role="alert">{error}</p>}
      {message && <p className="source-review__alert source-review__alert--ok" role="status">{message}</p>}

      <SourceOriginalUploader slug={slug} locked={pack?.status === "draft"} onVerified={afterModelUpload} />

      {!pack || pack.status !== "draft" ? (
        <section className="source-review__simple-card" id="source-step-review">
          <div>
            <h3>{packReady ? "Current model is ready" : "Start your 3D model"}</h3>
            <p>{packReady
              ? "Upload a new GLB/FBX above to replace the model safely. Your current live site will remain unchanged."
              : "Upload and verify a 3D file to get started."}</p>
          </div>
          {packReady ? (
            <details className="source-review__advanced">
              <summary>Already uploaded a replacement model?</summary>
              <p>Choose this only when the new GLB is already verified. Uploads are locked while the review draft is open.</p>
              <button type="button" disabled={Boolean(busy) || !data?.suggestions.length}
                onClick={() => void startDraft()}>
                Select Existing Model
              </button>
            </details>
          ) : (
            <button className="source-review__primary" type="button"
              disabled={Boolean(busy) || !data?.suggestions.length}
              onClick={() => void startDraft()}>
              {busy === "start" ? "Preparing…" : "Prepare 3D Model"}
            </button>
          )}
        </section>
      ) : (
        <section className="source-review__simple-card" id="source-step-review">
          <div>
            <h3>Choose new model</h3>
            <p>Latest verified file is suggested. Same filenames are identified by checksum.</p>
          </div>
          {!modelOptions.length && <p className="source-review__alert source-review__alert--error" role="status">
            No GLB/FBX model verified. DAE is evidence only; discard this unsealed review to unlock upload. Verified DAE stays saved.
          </p>}
          <div className="source-review__simple-actions">
            <button type="button" disabled={Boolean(busy)} onClick={() => void abandonDraft()}>Discard Unsealed Review & Unlock Upload</button>
            <span>Originals, releases and project are preserved.</span>
          </div>
          <label className="source-review__model-choice">
            Model file
            <select aria-label="Select verified 3D model" value={proposedModel?.sourceFileId ?? ""}
              disabled={Boolean(busy)}
              onChange={(event) => setModelSelection(event.target.value)}>
              {modelOptions.map((file) => (
                <option key={file.sourceFileId} value={file.sourceFileId}>
                  {file.filename} · {file.sha256.slice(0, 12)} · {formatBytes(file.byteSize)}
                </option>
              ))}
            </select>
          </label>
          {proposedModel && <p className="source-review__fingerprint">
            Selected model SHA-256: <code>{proposedModel.sha256}</code>
          </p>}
          <div className="source-review__simple-actions">
            <button className="source-review__primary" type="button"
              disabled={Boolean(busy) || !proposedModel}
              onClick={() => void prepareModel()}>
              {busy === "prepare" ? "Preparing model…" : "Use This Model & Prepare"}
            </button>
            <span>Only prepares a private version. Nothing goes live automatically.</span>
          </div>

          <details className="source-review__advanced">
            <summary>Advanced file roles & manual review</summary>
            <p>Change supporting roles only when the source evidence requires it.</p>
            {suggestedAuthorityId && !authorityId && <p>
              Engine suggestion: {suggestionById.get(suggestedAuthorityId)?.filename}
            </p>}
            <div className="source-review__advanced-files">
              {files.map((file) => (
                <article key={file.sourceFileId} className="source-review__advanced-file">
                  <label>
                    <input type="radio" name="geometry-authority" checked={file.sourceFileId === authorityId}
                      onChange={() => chooseAuthority(file.sourceFileId)}
                      disabled={!file.capabilities.includes("geometry") || Boolean(busy)} />
                    <strong>{file.filename}</strong>
                  </label>
                  <small>{file.sha256.slice(0, 16)}… · {formatBytes(file.byteSize)}</small>
                  <fieldset>
                    <legend>Supporting roles</legend>
                    {optionalRoles.map(([role, label]) => (
                      <label key={role}>
                        <input type="checkbox" checked={file.roles.includes(role)}
                          onChange={() => toggleRole(file.sourceFileId, role)}
                          disabled={Boolean(busy)} />{label}
                      </label>
                    ))}
                  </fieldset>
                  <label>Notes
                    <input value={file.notes ?? ""} onChange={(event) => updateNotes(file.sourceFileId, event.target.value)}
                      maxLength={1000} placeholder="Optional" disabled={Boolean(busy)}/>
                  </label>
                </article>
              ))}
            </div>
            <div className="source-review__simple-actions">
              <button type="button" onClick={() => void saveReview()}
                disabled={Boolean(busy) || !authorityId || !dirty}>Save Review</button>
              <button type="button" onClick={() => void sealPack()}
                disabled={Boolean(busy) || dirty || !pack.readiness.ready}>Seal Source Pack</button>
            </div>
          </details>
        </section>
      )}

      {packReady && <section id="source-step-processing" className="source-review__simple-processing">
        <ProcessingSpine slug={slug} sourcePackSignal={processingSignal} />
      </section>}

    </main>
  );
}
