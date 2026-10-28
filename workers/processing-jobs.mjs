import { engineAdminReadAccess } from "./admin-cloud.mjs";
import { activeDeletionJob } from "./project-deletion.mjs";
import { scheduleCanonicalProcessingJob } from "./canonical-glb-processor.mjs";
import { validProjectSlug } from "../shared/project-slug-policy.js";

export const AUTOMATIC_PROCESSOR_VERSION = "canonical-building-v1";

const BASE_PATH = "/3Dprojects";
const ROUTE_PREFIX = `${BASE_PATH}/api/cloud/projects/`;
const MAX_JSON_BYTES = 8 * 1024;
const SECURITY_HEADERS = {
  "Referrer-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

function json(value, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  for (const [key, item] of Object.entries(SECURITY_HEADERS)) headers.set(key, item);
  return new Response(JSON.stringify(value), { ...init, headers });
}

function sameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function validToken(value, max = 200) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    /^[A-Za-z0-9_.-]+$/.test(value)
  );
}

function parseRoute(url) {
  if (!url.pathname.startsWith(ROUTE_PREFIX)) return null;
  let parts;
  try {
    parts = url.pathname
      .slice(ROUTE_PREFIX.length)
      .split("/")
      .filter(Boolean)
      .map((part) => decodeURIComponent(part));
  } catch {
    return { error: "Invalid processing route encoding." };
  }
  if (parts.length !== 2 || parts[1] !== "processing") return null;
  const slug = String(parts[0] || "").trim().toLowerCase();
  if (!validProjectSlug(slug)) return { error: "Valid project slug is required." };
  return { slug };
}

async function schemaReady(env) {
  try {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS total
         FROM sqlite_master
        WHERE type='table'
          AND name IN (
            'source_packs_3d',
            'processing_jobs_3d',
            'processing_artifacts_3d',
            'project_operation_locks_3d'
          )`,
    ).first();
    return Number(row?.total || 0) === 4;
  } catch {
    return false;
  }
}

async function projectBySlug(env, slug) {
  return env.DB.prepare(
    `SELECT id,slug,name,status
       FROM projects_3d
      WHERE slug=?
      LIMIT 1`,
  ).bind(slug).first();
}

async function projectOperationLockReason(env, projectId, operation) {
  const row = await env.DB.prepare(
    `SELECT reason
       FROM project_operation_locks_3d
      WHERE project_id=? AND operation=?
      LIMIT 1`,
  ).bind(projectId, operation).first();
  return row ? String(row.reason || "Project operation is locked.") : null;
}

async function latestSealedPack(env, projectId) {
  return env.DB.prepare(
    `SELECT id,project_id,version,status,geometry_authority_file_id,
            manifest_sha256,approved_by,created_at,updated_at
       FROM source_packs_3d
      WHERE project_id=?
        AND status IN ('ready','superseded')
        AND operator_approved=1
        AND manifest_sha256 IS NOT NULL
      ORDER BY version DESC
      LIMIT 1`,
  ).bind(projectId).first();
}

async function sealedPackById(env, projectId, packId) {
  return env.DB.prepare(
    `SELECT id,project_id,version,status,geometry_authority_file_id,
            manifest_sha256,approved_by,created_at,updated_at
       FROM source_packs_3d
      WHERE project_id=? AND id=?
        AND status IN ('ready','superseded')
        AND operator_approved=1
        AND manifest_sha256 IS NOT NULL
      LIMIT 1`,
  ).bind(projectId, packId).first();
}

function packResponse(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    version: Number(row.version),
    status: row.status,
    geometryAuthorityFileId: row.geometry_authority_file_id,
    manifestSha256: row.manifest_sha256,
    approvedBy: row.approved_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function jobResponse(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    sourcePackId: row.source_pack_id,
    sourcePackVersion: Number(row.source_pack_version),
    sourcePackManifestSha256: row.source_pack_manifest_sha256,
    processorVersion: row.processor_version,
    attempt: Number(row.attempt),
    state: row.state,
    artifactPrefix: row.artifact_prefix,
    requestedBy: row.requested_by,
    requestedAt: row.requested_at,
    startedAt: row.started_at ?? null,
    heartbeatAt: row.heartbeat_at ?? null,
    finishedAt: row.finished_at ?? null,
    failureCode: row.failure_code ?? null,
    failureReason: row.failure_reason ?? null,
    outputManifestSha256: row.output_manifest_sha256 ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function artifactResponse(row) {
  if (!row) return null;
  return {
    id: row.id,
    processingJobId: row.processing_job_id,
    projectId: row.project_id,
    kind: row.kind,
    logicalId: row.logical_id,
    state: row.state,
    r2Key: row.r2_key,
    mimeType: row.mime_type,
    byteSize: row.byte_size === null || row.byte_size === undefined ? null : Number(row.byte_size),
    sha256: row.sha256 ?? null,
    failureReason: row.failure_reason ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function canonicalOutputHandoff(job, artifacts) {
  if (!job || job.state !== "succeeded" || !job.output_manifest_sha256) return null;
  const ready = Array.isArray(artifacts)
    ? artifacts.filter(
        (item) =>
          item &&
          item.processing_job_id === job.id &&
          item.project_id === job.project_id &&
          item.state === "ready",
      )
    : [];
  const models = ready.filter(
    (item) => item.kind === "canonical-model" && item.logical_id === "building-model",
  );
  const manifests = ready.filter(
    (item) =>
      item.kind === "canonical-model-manifest" &&
      item.logical_id === "canonical-model-manifest-v1",
  );
  const nodeCatalogs = ready.filter(
    (item) => item.kind === "node-catalog" && item.logical_id === "node-catalog-v1",
  );
  if (models.length !== 1 || manifests.length !== 1 || nodeCatalogs.length > 1) return null;
  const model = artifactResponse(models[0]);
  const manifest = artifactResponse(manifests[0]);
  const nodeCatalog = nodeCatalogs.length === 1 ? artifactResponse(nodeCatalogs[0]) : null;
  if (
    !model?.sha256 ||
    !manifest?.sha256 ||
    manifest.sha256 !== job.output_manifest_sha256 ||
    model.byteSize === null ||
    manifest.byteSize === null ||
    (nodeCatalog && (!nodeCatalog.sha256 || nodeCatalog.byteSize === null))
  )
    return null;
  return {
    processingJobId: job.id,
    sourcePackId: job.source_pack_id,
    sourcePackManifestSha256: job.source_pack_manifest_sha256,
    processorVersion: job.processor_version,
    outputManifestSha256: job.output_manifest_sha256,
    model,
    manifest,
    ...(nodeCatalog ? { nodeCatalog } : {}),
  };
}

async function jobsForPack(env, projectId, packId) {
  const rows = await env.DB.prepare(
    `SELECT *
       FROM processing_jobs_3d
      WHERE project_id=? AND source_pack_id=? AND processor_version=?
      ORDER BY attempt DESC
      LIMIT 20`,
  ).bind(projectId, packId, AUTOMATIC_PROCESSOR_VERSION).all();
  return rows.results || [];
}

async function artifactsForJob(env, projectId, jobId) {
  if (!jobId) return [];
  const rows = await env.DB.prepare(
    `SELECT id,processing_job_id,project_id,kind,logical_id,state,r2_key,mime_type,
            byte_size,sha256,failure_reason,created_at,updated_at
       FROM processing_artifacts_3d
      WHERE project_id=? AND processing_job_id=?
      ORDER BY kind ASC,logical_id ASC,id ASC`,
  ).bind(projectId, jobId).all();
  return rows.results || [];
}

async function liveJob(env, projectId, packId) {
  return env.DB.prepare(
    `SELECT *
       FROM processing_jobs_3d
      WHERE project_id=? AND source_pack_id=? AND processor_version=?
        AND state IN ('queued','running','succeeded')
      ORDER BY attempt DESC
      LIMIT 1`,
  ).bind(projectId, packId, AUTOMATIC_PROCESSOR_VERSION).first();
}

async function latestJob(env, projectId, packId) {
  return env.DB.prepare(
    `SELECT *
       FROM processing_jobs_3d
      WHERE project_id=? AND source_pack_id=? AND processor_version=?
      ORDER BY attempt DESC
      LIMIT 1`,
  ).bind(projectId, packId, AUTOMATIC_PROCESSOR_VERSION).first();
}

async function nextAttempt(env, projectId, packId) {
  const row = await env.DB.prepare(
    `SELECT COALESCE(MAX(attempt),0)+1 AS attempt
       FROM processing_jobs_3d
      WHERE project_id=? AND source_pack_id=? AND processor_version=?`,
  ).bind(projectId, packId, AUTOMATIC_PROCESSOR_VERSION).first();
  return Math.max(1, Number(row?.attempt || 1));
}

function artifactPrefix(projectSlug, sourcePackId, attempt) {
  return `projects/${projectSlug}/processing/${sourcePackId}/${AUTOMATIC_PROCESSOR_VERSION}/attempt-${attempt}/`;
}

async function readSmallJson(request) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > MAX_JSON_BYTES)
    throw Object.assign(Error("Processing request exceeds 8 KB."), { status: 413 });
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_JSON_BYTES)
    throw Object.assign(Error("Processing request exceeds 8 KB."), { status: 413 });
  try {
    const body = JSON.parse(raw || "{}");
    return body && typeof body === "object" && !Array.isArray(body) ? body : {};
  } catch {
    throw Object.assign(Error("Valid JSON request body is required."), { status: 400 });
  }
}

async function responseState(env, project) {
  const sourcePack = await latestSealedPack(env, project.id);
  const jobs = sourcePack ? await jobsForPack(env, project.id, sourcePack.id) : [];
  const currentJob = jobs[0] || null;
  const currentArtifacts = currentJob
    ? await artifactsForJob(env, project.id, currentJob.id)
    : [];
  return {
    contractVersion: 1,
    schemaReady: true,
    project: {
      id: project.id,
      slug: project.slug,
      name: project.name,
      status: project.status,
    },
    processorVersion: AUTOMATIC_PROCESSOR_VERSION,
    sourcePack: packResponse(sourcePack),
    currentJob: jobResponse(currentJob),
    currentArtifacts: currentArtifacts.map(artifactResponse),
    canonicalOutput: canonicalOutputHandoff(currentJob, currentArtifacts),
    jobs: jobs.map(jobResponse),
  };
}

async function enqueue(env, actor, project, pack, action) {
  const existingLive = await liveJob(env, project.id, pack.id);
  if (existingLive) return { job: existingLive, created: false };

  const previous = await latestJob(env, project.id, pack.id);
  if (action === "retry" && !previous)
    throw Object.assign(Error("No previous processing attempt exists to retry."), { status: 409 });
  if (
    action === "retry" &&
    previous &&
    !["failed", "cancelled"].includes(previous.state)
  )
    throw Object.assign(Error("Only a failed or cancelled processing attempt can be retried."), { status: 409 });

  const attempt = await nextAttempt(env, project.id, pack.id);
  const jobId = `processing_job_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const prefix = artifactPrefix(project.slug, pack.id, attempt);
  const auditId = crypto.randomUUID();
  const details = JSON.stringify({
    sourcePackId: pack.id,
    sourcePackVersion: Number(pack.version),
    sourcePackManifestSha256: pack.manifest_sha256,
    processorVersion: AUTOMATIC_PROCESSOR_VERSION,
    attempt,
    artifactPrefix: prefix,
  });

  try {
    const results = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO processing_jobs_3d
          (id,project_id,source_pack_id,source_pack_version,
           source_pack_manifest_sha256,processor_version,attempt,state,
           artifact_prefix,requested_by,requested_at,created_at,updated_at)
         SELECT ?,?,?,?,?,?,?,'queued',?,?,?,?,?
          WHERE EXISTS (
            SELECT 1 FROM source_packs_3d p
             WHERE p.id=? AND p.project_id=?
               AND p.version=?
               AND p.status IN ('ready','superseded')
               AND p.operator_approved=1
               AND p.manifest_sha256=?
          )
            AND NOT EXISTS (
              SELECT 1 FROM processing_jobs_3d j
               WHERE j.source_pack_id=?
                 AND j.processor_version=?
                 AND j.state IN ('queued','running','succeeded')
            )`,
      ).bind(
        jobId,
        project.id,
        pack.id,
        Number(pack.version),
        pack.manifest_sha256,
        AUTOMATIC_PROCESSOR_VERSION,
        attempt,
        prefix,
        actor.email,
        now,
        now,
        now,
        pack.id,
        project.id,
        Number(pack.version),
        pack.manifest_sha256,
        pack.id,
        AUTOMATIC_PROCESSOR_VERSION,
      ),
      env.DB.prepare(
        `INSERT INTO engine_admin_audit
          (id,actor_email,action,project_id,target_id,details_json,created_at)
         SELECT ?,?,'processing.job_queued',?,?,?,?
          WHERE EXISTS (
            SELECT 1 FROM processing_jobs_3d
             WHERE id=? AND project_id=? AND requested_at=?
          )`,
      ).bind(
        auditId,
        actor.email,
        project.id,
        jobId,
        details,
        now,
        jobId,
        project.id,
        now,
      ),
    ]);

    const created = Number(results?.[0]?.meta?.changes || 0) > 0;
    if (created) {
      const job = await latestJob(env, project.id, pack.id);
      if (!job || job.id !== jobId)
        throw Object.assign(Error("Processing job was queued but could not be reloaded."), { status: 500 });
      return { job, created: true };
    }
  } catch (reason) {
    const concurrent = await liveJob(env, project.id, pack.id);
    if (concurrent) return { job: concurrent, created: false };
    throw reason;
  }

  const concurrent = await liveJob(env, project.id, pack.id);
  if (concurrent) return { job: concurrent, created: false };
  throw Object.assign(
    Error("Source Pack changed or another processing attempt won the queue race. Refresh and retry."),
    { status: 409 },
  );
}

export async function handleProcessingRequest(
  request,
  env,
  url = new URL(request.url),
  ctx,
) {
  const route = parseRoute(url);
  if (!route) return null;
  if (route.error) return json({ error: route.error }, { status: 400 });
  if (request.method !== "GET" && request.method !== "POST")
    return json({ error: "Method not allowed." }, { status: 405 });

  const access = await engineAdminReadAccess(request, env);
  if (!access.ok) return json({ error: access.error }, { status: access.status });
  if (request.method !== "GET" && !sameOrigin(request)) return json({ error: "Invalid request origin." }, { status: 403 });
  if (!(await schemaReady(env)))
    return json(
      {
        contractVersion: 1,
        schemaReady: false,
        processorVersion: AUTOMATIC_PROCESSOR_VERSION,
        error: "V2 processing foundation schema is not installed.",
      },
      { status: 503 },
    );

  const project = await projectBySlug(env, route.slug);
  if (!project) return json({ error: "Cloud project not found." }, { status: 404 });
  if (request.method === "GET") {
    const state = await responseState(env, project);
    scheduleCanonicalProcessingJob(env, ctx, state.currentJob?.id);
    return json(state);
  }

  if (project.status === "archived")
    return json({ error: "Restore the project before starting processing." }, { status: 409 });
  const lockReason = await projectOperationLockReason(env, project.id, "processing-write");
  if (lockReason)
    return json(
      { error: "Project processing is locked by an operational policy.", reason: lockReason },
      { status: 423 },
    );
  if (await activeDeletionJob(env))
    return json(
      { error: "Permanent project cleanup is in progress. Processing is frozen until it finishes." },
      { status: 409 },
    );

  try {
    const body = await readSmallJson(request);
    const action = body.action === "retry" ? "retry" : body.action === "start" ? "start" : "";
    if (!action)
      return json({ error: "Unsupported processing action." }, { status: 400 });
    const packId = String(body.sourcePackId || "").trim();
    if (!validToken(packId))
      return json({ error: "Valid sealed Source Pack id is required." }, { status: 400 });

    const pack = await sealedPackById(env, project.id, packId);
    if (!pack)
      return json(
        { error: "Processing requires an immutable operator-approved Source Pack." },
        { status: 409 },
      );

    const queued = await enqueue(env, access.actor, project, pack, action);
    scheduleCanonicalProcessingJob(env, ctx, queued.job.id);
    const state = await responseState(env, project);
    return json({
      ...state,
      requestedJob: jobResponse(queued.job),
      created: queued.created,
    });
  } catch (reason) {
    return json(
      { error: reason instanceof Error ? reason.message : "Processing request failed." },
      { status: Number(reason?.status || 409) },
    );
  }
}
