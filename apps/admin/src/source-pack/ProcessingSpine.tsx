import { useEffect, useMemo, useState } from "react";
import { ADMIN_BASE_PATH } from "@rekixo/3d-contracts";
import ModelScaleReview from "./ModelScaleReview";
import "./processing-spine.css";

type ProcessingJobV1 = {
  id: string;
  projectId: string;
  sourcePackId: string;
  sourcePackVersion: number;
  sourcePackManifestSha256: string;
  processorVersion: string;
  attempt: number;
  state: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  artifactPrefix: string;
  requestedBy: string;
  requestedAt: string;
  startedAt: string | null;
  heartbeatAt: string | null;
  finishedAt: string | null;
  failureCode: string | null;
  failureReason: string | null;
  outputManifestSha256: string | null;
  createdAt: string;
  updatedAt: string;
};

type ProcessingArtifactV1 = {
  id: string;
  processingJobId: string;
  projectId: string;
  kind: string;
  logicalId: string;
  state: "staged" | "ready" | "failed";
  r2Key: string;
  mimeType: string;
  byteSize: number | null;
  sha256: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
};

type CanonicalOutputHandoffV1 = {
  processingJobId: string;
  sourcePackId: string;
  sourcePackManifestSha256: string;
  processorVersion: string;
  outputManifestSha256: string;
  model: ProcessingArtifactV1;
  manifest: ProcessingArtifactV1;
  nodeCatalog?: ProcessingArtifactV1;
};

type ProcessingSpineResponseV1 = {
  contractVersion: 1;
  schemaReady: true;
  project: { id: string; slug: string; name: string; status: string };
  processorVersion: string;
  sourcePack: {
    id: string;
    projectId: string;
    version: number;
    status: "ready" | "superseded";
    geometryAuthorityFileId: string;
    manifestSha256: string;
    approvedBy: string;
    createdAt: string;
    updatedAt: string;
  } | null;
  currentJob: ProcessingJobV1 | null;
  currentArtifacts: ProcessingArtifactV1[];
  canonicalOutput: CanonicalOutputHandoffV1 | null;
  jobs: ProcessingJobV1[];
  requestedJob?: ProcessingJobV1;
  created?: boolean;
};

type ProcessingPayload = ProcessingSpineResponseV1 & { error?: string };
type ProcessingUnavailable = {
  contractVersion?: number;
  schemaReady?: false;
  processorVersion?: string;
  error?: string;
};

function processingPath(slug: string) {
  return `${ADMIN_BASE_PATH}/api/cloud/projects/${encodeURIComponent(slug)}/processing`;
}

function stateLabel(state: ProcessingJobV1["state"]) {
  if (state === "queued") return "QUEUED";
  if (state === "running") return "RUNNING";
  if (state === "succeeded") return "SUCCEEDED";
  if (state === "failed") return "FAILED";
  return "CANCELLED";
}

function stateHelp(job: ProcessingJobV1 | null) {
  if (!job)
    return "Start creates one durable attempt pinned to the exact sealed Source Pack SHA and processor version.";
  if (job.state === "queued")
    return "Durable job queued. Browser close/refresh or repeated Start will not create a second active attempt.";
  if (job.state === "running")
    return "Processor owns this attempt. Input identity and artifact storage boundary are immutable.";
  if (job.state === "succeeded")
    return "Processing output is immutable. Canonical handoff is exposed only when its model and manifest identities agree.";
  if (job.state === "failed")
    return job.failureReason || "Attempt failed without mutating the sealed Source Pack. Retry creates a new attempt.";
  return "Attempt was cancelled. Retry creates a new attempt without overwriting history.";
}

function formatBytes(value: number | null) {
  if (value === null || !Number.isFinite(value) || value < 0) return "size unavailable";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function shortSha(value: string | null | undefined) {
  return value ? `${value.slice(0, 16)}…` : "SHA unavailable";
}

export default function ProcessingSpine({
  slug,
  sourcePackSignal,
}: {
  slug: string;
  sourcePackSignal: string;
}) {
  const [data, setData] = useState<ProcessingPayload>();
  const [schemaPending, setSchemaPending] = useState(false);
  const [scaleReviewApproved, setScaleReviewApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    setScaleReviewApproved(false);
  }, [slug, sourcePackSignal]);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    let timer: number | undefined;

    async function load() {
      try {
        const response = await fetch(processingPath(slug), {
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
        const body = (await response.json()) as ProcessingPayload | ProcessingUnavailable;
        if (cancelled) return;
        if (response.status === 503 && body.schemaReady === false) {
          setSchemaPending(true);
          setData(undefined);
          setError("");
          return;
        }
        if (!response.ok)
          throw new Error(body.error || `Processing API failed (${response.status}).`);
        const payload = body as ProcessingPayload;
        setSchemaPending(false);
        setData(payload);
        setError("");
        if (["queued", "running"].includes(payload.currentJob?.state ?? ""))
          timer = window.setTimeout(() => void load(), 4000);
      } catch (reason) {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : "Processing status load nahi hua.");
      }
    }

    void load();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [slug, sourcePackSignal]);

  const job = data?.currentJob ?? null;
  const canonicalOutput = data?.canonicalOutput ?? null;
  const retryableTerminal = job?.state === "failed" || job?.state === "cancelled";
  const retryNeedsScaleApproval =
    job?.state === "failed" && job.failureCode === "FBX_SCALE_REVIEW_REQUIRED";
  const canRetry = Boolean(
    retryableTerminal && (!retryNeedsScaleApproval || scaleReviewApproved),
  );
  const canStart = Boolean(data?.sourcePack && (!job || canRetry));
  const actionLabel = retryableTerminal ? "Retry Processing" : "Start Processing";
  const sha = data?.sourcePack?.manifestSha256;
  const statusClass = job ? ` processing-spine--${job.state}` : "";
  const attemptText = useMemo(
    () => (job ? `Attempt ${job.attempt}` : "No attempt yet"),
    [job],
  );

  async function start() {
    if (!data?.sourcePack || !canStart) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(processingPath(slug), {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          action: retryableTerminal ? "retry" : "start",
          sourcePackId: data.sourcePack.id,
        }),
      });
      const body = (await response.json()) as ProcessingPayload;
      if (!response.ok)
        throw new Error(body.error || `Processing start failed (${response.status}).`);
      setData(body);
      setScaleReviewApproved(false);
      setMessage(
        body.created
          ? `Processing attempt ${body.requestedJob?.attempt ?? body.currentJob?.attempt ?? ""} durably queued.`
          : "Existing active processing attempt reused; duplicate job create nahi hua.",
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Processing start nahi hua.");
    } finally {
      setBusy(false);
    }
  }

  if (schemaPending) {
    return (
      <section className="processing-spine processing-spine--pending">
        <div>
          <p>02 · DURABLE PROCESSING</p>
          <h2>Processing foundation migration pending</h2>
          <span>Source Pack safe hai. Processing schema install hone tak koi derived work start nahi hoga.</span>
        </div>
      </section>
    );
  }

  if (!data?.sourcePack) return null;

  return (
    <>
      <section className={`processing-spine processing-spine--compact${statusClass}`} aria-label="Automatic processing status">
        <div className="processing-spine__compact-head">
          <div>
            <h3>{canonicalOutput?.nodeCatalog
              ? "Model prepared"
              : job?.state === "failed" ? "Model needs attention"
                : job?.state === "running" || job?.state === "queued" ? "Preparing model…"
                  : "Prepare 3D model"}</h3>
            <p>{canonicalOutput?.nodeCatalog
              ? "Model validated and ready for component review."
              : job?.state === "failed" ? (job.failureReason || "Check model source and retry.")
                : job?.state === "running" || job?.state === "queued"
                  ? "Processing is in progress; the current live site is unchanged."
                  : "Prepare a private 3D model before publishing."}</p>
          </div>
          <span className="processing-spine__compact-state">
            {job ? stateLabel(job.state) : "READY"}
          </span>
        </div>

        {error && <div className="processing-spine__alert processing-spine__alert--error" role="alert">{error}</div>}
        {message && <div className="processing-spine__alert processing-spine__alert--ok" role="status">{message}</div>}

        <div className="processing-spine__compact-actions">
          {canonicalOutput?.nodeCatalog && <a className="processing-spine__mapper-link"
            href={`/3Dprojects/component-mapper?project=${encodeURIComponent(slug)}`}>
            Review Components
          </a>}
          {canStart && <button type="button" onClick={() => void start()} disabled={busy}>
            {busy ? "Preparing…" : actionLabel}
          </button>}
        </div>

        <details className="processing-spine__technical">
          <summary>Processing details</summary>
          <p>{stateHelp(job)}</p>
          <p>Source Pack v{data.sourcePack.version} · {data.processorVersion} · {attemptText}</p>
          {sha && <p>Source SHA: {shortSha(sha)}</p>}
          {canonicalOutput && <p>Validated model: {formatBytes(canonicalOutput.model.byteSize)} · SHA {shortSha(canonicalOutput.model.sha256)}</p>}
          <p>Source bytes, Building release and Geo release are not mutated by this action.</p>
        </details>
      </section>
      {retryNeedsScaleApproval && <ModelScaleReview slug={slug} onApprovalChange={setScaleReviewApproved} />}
    </>
  );
}
