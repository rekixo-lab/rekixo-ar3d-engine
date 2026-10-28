import { useEffect, useState } from "react";
import { ADMIN_BASE_PATH } from "@rekixo/3d-contracts";
import { analyseBrowserFbx, exportReviewedBrowserGlb, reviewedDimensions, type BrowserFbxAnalysis } from "./browserFbxConverter";
import "./source-original-uploader.css";

type SourceOriginal = {
  id: string;
  filename: string;
  byteSize: number;
  sha256: string;
  uploadState: string;
  failureReason?: string;
};

type UploadSession = {
  id: string;
  partSize: number;
  uploadedParts: Array<{ partNumber: number; byteSize: number }>;
};

function sourcePath(slug: string) {
  return `${ADMIN_BASE_PATH}/api/cloud/projects/${encodeURIComponent(slug)}/source-files`;
}

async function responseJson<T>(response: Response): Promise<T> {
  const data = (await response.json()) as T & { error?: string; reason?: string };
  if (!response.ok) throw Error(data.error || data.reason || `Source request failed (HTTP ${response.status}).`);
  return data;
}

async function sendJson<T>(url: string, method: string, body?: object): Promise<T> {
  return responseJson<T>(await fetch(url, {
    method,
    headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    credentials: "same-origin",
  }));
}

function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

async function fileIdentity(file: File) {
  // The stable source ID allows reselecting the same original after a network interruption.
  const sha256 = hex(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
  const nameHash = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(file.name)));
  return { sha256, id: `source_${sha256.slice(0, 48)}_${nameHash.slice(0, 16)}` };
}

async function completeOriginal(
  slug: string,
  file: File,
  onProgress: (message: string) => void,
) {
  const base = sourcePath(slug);
  onProgress(`SHA-256 checking: ${file.name}`);
  const { id, sha256 } = await fileIdentity(file);
  const registered = await sendJson<{ source: SourceOriginal }>(base, "POST", {
    id,
    filename: file.name,
    mediaType: file.type || "application/octet-stream",
    byteSize: file.size,
    sha256,
  });
  const filePath = `${base}/${encodeURIComponent(registered.source.id)}`;
  let state = registered.source.uploadState;
  if (state === "failed")
    throw Error(`${file.name}: integrity failed. Keep the original unchanged and contact the operator.`);

  if (state !== "uploaded" && state !== "verified") {
    const started = await sendJson<{
      session?: UploadSession;
      partCount?: number;
      uploaded?: boolean;
    }>(`${filePath}/uploads`, "POST");
    if (!started.uploaded) {
      if (!started.session || !started.partCount) throw Error("Upload session was not returned.");
      const { session, partCount } = started;
      const uploaded = new Set(session.uploadedParts.map((part) => part.partNumber));
      for (let partNumber = 1; partNumber <= partCount; partNumber++) {
        if (uploaded.has(partNumber)) continue;
        const start = (partNumber - 1) * session.partSize;
        const end = Math.min(start + session.partSize, file.size);
        onProgress(`Uploading ${file.name} · part ${partNumber}/${partCount}`);
        await responseJson(await fetch(
          `${filePath}/uploads/${encodeURIComponent(session.id)}/parts/${partNumber}`,
          { method: "PUT", body: file.slice(start, end), credentials: "same-origin" },
        ));
      }
      onProgress(`Finalizing ${file.name}`);
      await sendJson(`${filePath}/uploads/${encodeURIComponent(session.id)}/complete`, "POST");
    }
    state = "uploaded";
  }
  if (state !== "verified") {
    onProgress(`Server-side SHA-256 verification: ${file.name}`);
    await sendJson(`${filePath}/verify`, "POST");
  }
  onProgress(`Verified: ${file.name}`);
}

export default function SourceOriginalUploader({
  slug,
  locked,
  onVerified,
}: {
  slug: string;
  locked: boolean;
  onVerified: () => Promise<void>;
}) {
  const [sources, setSources] = useState<SourceOriginal[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [reviewFile, setReviewFile] = useState<File | null>(null);
  const [fbxAnalysis, setFbxAnalysis] = useState<BrowserFbxAnalysis | null>(null);
  const [metresPerUnit, setMetresPerUnit] = useState("");
  const [reviewConfirmed, setReviewConfirmed] = useState(false);

  async function refresh() {
    const data = await responseJson<{ sources: SourceOriginal[] }>(
      await fetch(sourcePath(slug), { credentials: "same-origin", cache: "no-store" }),
    );
    setSources(data.sources);
  }

  useEffect(() => {
    if (!slug) return;
    setError("");
    void refresh().catch((reason: unknown) =>
      setError(reason instanceof Error ? reason.message : "Source files could not be loaded."),
    );
  }, [slug]);

  async function uploadSelected(files: File[]) {
    if (!slug || locked || !files.length) return;
    setBusy(true);
    setError("");
    try {
      for (const file of files) {
        if (!file.size) throw Error(`${file.name}: empty files cannot be registered.`);
        await completeOriginal(slug, file, setProgress);
        await refresh();
      }
      setProgress("All selected originals verified. Updating source classification.");
      await sendJson(
        `${ADMIN_BASE_PATH}/api/cloud/projects/${encodeURIComponent(slug)}/source-classification`,
        "POST",
      );
      await onVerified();
      setProgress(`Verified ${files.length} selected file(s). Review the suggested source roles below.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Source upload failed.");
      setProgress("Select the same original files again to resume the upload safely.");
      await refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  async function inspectSelectedFbx(file: File | undefined) {
    setReviewFile(null);
    setFbxAnalysis(null);
    setReviewConfirmed(false);
    if (!file || !slug || locked || busy) return;
    setBusy(true);
    setError("");
    setProgress("Inspecting local FBX mesh and source units…");
    try {
      const inspected = await analyseBrowserFbx(file);
      setFbxAnalysis(inspected);
      setReviewFile(file);
      setMetresPerUnit(String(inspected.declaredMetresPerUnit));
      setProgress("Check the proposed metre dimensions against the approved survey layout.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "FBX geometry inspection failed.");
    } finally {
      setBusy(false);
    }
  }

  async function createReviewedGlb() {
    if (!slug || locked || busy || !reviewFile || !fbxAnalysis || !reviewConfirmed) return;
    setBusy(true);
    setError("");
    try {
      const scale = Number(metresPerUnit);
      reviewedDimensions(fbxAnalysis, scale);
      setProgress("Converting reviewed FBX to GLB locally (no Cloudflare Container)…");
      const converted = await exportReviewedBrowserGlb(reviewFile, fbxAnalysis, scale);
      await completeOriginal(slug, converted, setProgress);
      await refresh();
      await sendJson(
        `${ADMIN_BASE_PATH}/api/cloud/projects/${encodeURIComponent(slug)}/source-classification`,
        "POST",
      );
      await onVerified();
      setProgress(`${converted.name} verified. Start the NEXT Source Pack version and approve this GLB as geometry authority.`);
      setReviewFile(null);
      setFbxAnalysis(null);
      setReviewConfirmed(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Reviewed GLB conversion failed.");
    } finally {
      setBusy(false);
    }
  }

  let metresDimensions: [number, number, number] | null = null;
  if (fbxAnalysis) {
    try { metresDimensions = reviewedDimensions(fbxAnalysis, Number(metresPerUnit)); }
    catch { metresDimensions = null; }
  }

  return (
    <section className="source-originals" aria-label="Upload source originals">
      <div className="source-originals__header">
        <div>
          <p>01 · SOURCE INTAKE</p>
          <h2>Upload original source files</h2>
          <span>FBX / GLB model, DAE, DXF / DWG CAD, PDF and other references. Each file is verified before review.</span>
        </div>
        <label className={locked || busy ? "source-originals__pick source-originals__pick--disabled" : "source-originals__pick"}>
          {busy ? "Uploading…" : "Choose source files"}
          <input
            type="file"
            multiple
            accept=".fbx,.glb,.gltf,.dae,.dxf,.dwg,.pdf,.skp,.skb,.drs,.json,.jpg,.jpeg,.png,.webp,.tif,.tiff,.obj,.zip"
            disabled={locked || busy || !slug}
            onChange={(event) => {
              const selected = Array.from(event.target.files ?? []);
              event.target.value = "";
              void uploadSelected(selected);
            }}
          />
        </label>
      </div>
      {locked ? <p className="source-originals__note">Finish and seal the open review draft before verifying new originals.</p> : null}
      {progress ? <p className="source-originals__progress" role="status">{progress}</p> : null}
      {error ? <p className="source-originals__error" role="alert">{error}</p> : null}
      <ul className="source-originals__list">
        {sources.map((source) => (
          <li key={source.id}>
            <span title={source.filename}>{source.filename}</span>
            <small>{(source.byteSize / 1024 / 1024).toFixed(1)} MB</small>
            <b className={source.uploadState === "verified" ? "source-originals__verified" : ""}>
              {source.uploadState}
            </b>
          </li>
        ))}
      </ul>
      {!sources.length && !error ? <p className="source-originals__note">No originals registered for this project yet.</p> : null}
      <div className="source-originals__fallback">
        <h3>FBX processor unavailable? Convert to GLB in this browser</h3>
        <p className="source-originals__note">
          No Cloudflare Containers required. Select the same FBX again, verify real-world scale,
          and create a separate GLB. Your sealed FBX Source Pack and live releases stay untouched.
        </p>
        <label className="source-originals__pick source-originals__pick--secondary">
          Choose FBX for local conversion
          <input type="file" accept=".fbx" disabled={locked || busy || !slug}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              void inspectSelectedFbx(file);
            }} />
        </label>
        {fbxAnalysis && reviewFile ? (
          <div className="source-originals__scale">
            <p>Source: <strong>{reviewFile.name}</strong> · {fbxAnalysis.meshCount} meshes</p>
            <p>Raw bounds X/Y/Z: {fbxAnalysis.rawDimensions.map((n) => n.toFixed(2)).join(" × ")} units</p>
            <p>Declared FBX unit: {fbxAnalysis.declaredMetresPerUnit} m/source unit</p>
            <label>Reviewed metres per source unit
              <input type="number" min="0.000001" max="1000000" step="any"
                value={metresPerUnit}
                onChange={(event) => { setMetresPerUnit(event.target.value); setReviewConfirmed(false); }} />
            </label>
            <p>Result X/Y/Z: <strong>
              {metresDimensions ? metresDimensions.map((n) => n.toFixed(2)).join(" × ") + " metres" : "Invalid scale"}
            </strong></p>
            <label className="source-originals__confirmation">
              <input type="checkbox" checked={reviewConfirmed}
                onChange={(event) => setReviewConfirmed(event.target.checked)} />
              I checked these dimensions against the approved layout and accept the reviewed GLB as a separate source.
            </label>
            <button type="button" className="source-originals__convert"
              disabled={busy || locked || !reviewConfirmed || !metresDimensions}
              onClick={() => void createReviewedGlb()}>
              Generate & verify reviewed GLB
            </button>
          </div>
        ) : null}
      </div>

    </section>
  );
}
