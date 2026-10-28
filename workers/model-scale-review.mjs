import { engineAdminReadAccess } from "./admin-cloud.mjs";
import { activeDeletionJob } from "./project-deletion.mjs";
import { validProjectSlug } from "../shared/project-slug-policy.js";

const BASE_PATH = "/3Dprojects";
const ROUTE_PREFIX = `${BASE_PATH}/api/cloud/projects/`;
const MAX_JSON_BYTES = 8 * 1024;
const DEFAULT_MIN_BUILDING_DIMENSION_M = 2;
const DEFAULT_MAX_BUILDING_DIMENSION_M = 2000;
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
    return { error: "Invalid model scale review route encoding." };
  }
  if (parts.length !== 2 || parts[1] !== "model-scale-review") return null;
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
          AND name IN ('model_scale_reviews_3d','processing_jobs_3d','source_packs_3d')`,
    ).first();
    return Number(row?.total || 0) === 3;
  } catch {
    return false;
  }
}

async function projectBySlug(env, slug) {
  return env.DB.prepare(
    `SELECT id,slug,name,status
       FROM projects_3d
      WHERE slug=? LIMIT 1`,
  ).bind(slug).first();
}

async function projectOperationLockReason(env, projectId) {
  const row = await env.DB.prepare(
    `SELECT reason
       FROM project_operation_locks_3d
      WHERE project_id=? AND operation='processing-write'
      LIMIT 1`,
  ).bind(projectId).first();
  return row ? String(row.reason || "Project processing is locked.") : null;
}

function parseDiagnostic(raw) {
  try {
    const value = JSON.parse(String(raw || "{}"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function finiteTriplet(value) {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((item) => Number.isFinite(Number(item)) && Number(item) >= 0)
  );
}

function reviewedBounds(diagnostic, metresPerSourceUnit) {
  const rawDimensions = diagnostic?.rawDimensions;
  if (!finiteTriplet(rawDimensions))
    throw Object.assign(
      Error("Scale review diagnostic does not contain valid source-space bounds."),
      { status: 409 },
    );

  const dimensionsM = rawDimensions.map((value) => Number(value) * metresPerSourceUnit);
  const largestDimensionM = Math.max(...dimensionsM);
  const diagnosticMin = Number(diagnostic?.minLargestDimensionM);
  const diagnosticMax = Number(diagnostic?.maxLargestDimensionM);
  const minLargestDimensionM =
    Number.isFinite(diagnosticMin) && diagnosticMin > 0
      ? diagnosticMin
      : DEFAULT_MIN_BUILDING_DIMENSION_M;
  const maxLargestDimensionM =
    Number.isFinite(diagnosticMax) && diagnosticMax > minLargestDimensionM
      ? diagnosticMax
      : DEFAULT_MAX_BUILDING_DIMENSION_M;

  if (
    !Number.isFinite(largestDimensionM) ||
    largestDimensionM < minLargestDimensionM ||
    largestDimensionM > maxLargestDimensionM
  )
    throw Object.assign(
      Error(
        `Reviewed scale still produces implausible Building bounds. Largest dimension must remain between ${minLargestDimensionM} m and ${maxLargestDimensionM} m.`,
      ),
      { status: 400 },
    );

  return { dimensionsM, largestDimensionM, minLargestDimensionM, maxLargestDimensionM };
}

function reviewResponse(row) {
  if (!row) return null;
  return {
    id: row.id,
    processingJobId: row.processing_job_id,
    sourcePackId: row.source_pack_id,
    sourceFileId: row.source_file_id,
    sourceSha256: row.source_sha256,
    status: row.status,
    diagnostic: parseDiagnostic(row.diagnostic_json),
    metresPerSourceUnit:
      row.metres_per_source_unit === null || row.metres_per_source_unit === undefined
        ? null
        : Number(row.metres_per_source_unit),
    decisionNote: row.decision_note ?? null,
    approvedBy: row.approved_by ?? null,
    approvedAt: row.approved_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function latestReview(env, projectId) {
  return env.DB.prepare(
    `SELECT review.*
       FROM model_scale_reviews_3d review
       JOIN source_packs_3d pack
         ON pack.id=review.source_pack_id
        AND pack.project_id=review.project_id
       JOIN processing_jobs_3d job
         ON job.id=review.processing_job_id
        AND job.project_id=review.project_id
      WHERE review.project_id=?
        AND pack.status IN ('ready','superseded')
        AND pack.operator_approved=1
        AND job.failure_code='FBX_SCALE_REVIEW_REQUIRED'
      ORDER BY pack.version DESC,review.created_at DESC,review.id DESC
      LIMIT 1`,
  ).bind(projectId).first();
}

async function reviewForApproval(env, projectId, reviewId) {
  return env.DB.prepare(
    `SELECT review.*
       FROM model_scale_reviews_3d review
       JOIN processing_jobs_3d job
         ON job.id=review.processing_job_id
        AND job.project_id=review.project_id
       JOIN source_packs_3d pack
         ON pack.id=review.source_pack_id
        AND pack.project_id=review.project_id
      WHERE review.project_id=?
        AND review.id=?
        AND review.status='pending'
        AND job.state='failed'
        AND job.failure_code='FBX_SCALE_REVIEW_REQUIRED'
        AND pack.status IN ('ready','superseded')
        AND pack.operator_approved=1
        AND NOT EXISTS (
          SELECT 1 FROM model_scale_reviews_3d newer
           WHERE newer.project_id=review.project_id
             AND newer.source_pack_id=review.source_pack_id
             AND newer.source_file_id=review.source_file_id
             AND newer.source_sha256=review.source_sha256
             AND (
               newer.created_at>review.created_at
               OR (newer.created_at=review.created_at AND newer.id>review.id)
             )
        )
      LIMIT 1`,
  ).bind(projectId, reviewId).first();
}

async function readSmallJson(request) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > MAX_JSON_BYTES)
    throw Object.assign(Error("Scale review request exceeds 8 KB."), { status: 413 });
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_JSON_BYTES)
    throw Object.assign(Error("Scale review request exceeds 8 KB."), { status: 413 });
  try {
    const body = JSON.parse(raw || "{}");
    return body && typeof body === "object" && !Array.isArray(body) ? body : {};
  } catch {
    throw Object.assign(Error("Valid JSON request body is required."), { status: 400 });
  }
}

async function responseState(env, project) {
  return {
    contractVersion: 1,
    schemaReady: true,
    project: {
      id: project.id,
      slug: project.slug,
      name: project.name,
      status: project.status,
    },
    review: reviewResponse(await latestReview(env, project.id)),
  };
}

export async function handleModelScaleReviewRequest(request, env, url = new URL(request.url)) {
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
        error: "Model scale review schema is not installed.",
      },
      { status: 503 },
    );

  const project = await projectBySlug(env, route.slug);
  if (!project) return json({ error: "Cloud project not found." }, { status: 404 });
  if (request.method === "GET") return json(await responseState(env, project));

  if (project.status === "archived")
    return json({ error: "Restore the project before approving model scale." }, { status: 409 });
  const lockReason = await projectOperationLockReason(env, project.id);
  if (lockReason)
    return json(
      { error: "Project processing is locked by an operational policy.", reason: lockReason },
      { status: 423 },
    );
  if (await activeDeletionJob(env))
    return json(
      { error: "Permanent project cleanup is in progress. Scale review is frozen until it finishes." },
      { status: 409 },
    );

  try {
    const body = await readSmallJson(request);
    if (body.action !== "approve")
      return json({ error: "Unsupported scale review action." }, { status: 400 });
    const reviewId = String(body.reviewId || "").trim();
    if (!validToken(reviewId))
      return json({ error: "Valid scale review ID is required." }, { status: 400 });
    const metresPerSourceUnit = Number(body.metresPerSourceUnit);
    if (
      !Number.isFinite(metresPerSourceUnit) ||
      metresPerSourceUnit < 0.000001 ||
      metresPerSourceUnit > 1000000
    )
      return json(
        { error: "Scale must be between 0.000001 and 1000000 metres per source unit." },
        { status: 400 },
      );
    const decisionNote = String(body.note || "").trim();
    if (decisionNote.length < 12 || decisionNote.length > 1000)
      return json(
        { error: "Approval note must be between 12 and 1000 characters." },
        { status: 400 },
      );

    const review = await reviewForApproval(env, project.id, reviewId);
    if (!review)
      return json(
        { error: "Scale review is stale, already approved, or no longer belongs to the latest unresolved attempt." },
        { status: 409 },
      );

    const diagnostic = parseDiagnostic(review.diagnostic_json);
    const bounds = reviewedBounds(diagnostic, metresPerSourceUnit);
    const now = new Date().toISOString();
    const auditDetails = JSON.stringify({
      sourcePackId: review.source_pack_id,
      sourceFileId: review.source_file_id,
      sourceSha256: review.source_sha256,
      failedProcessingJobId: review.processing_job_id,
      metresPerSourceUnit,
      resultingDimensionsM: bounds.dimensionsM,
      decisionNote,
    });
    const results = await env.DB.batch([
      env.DB.prepare(
        `UPDATE model_scale_reviews_3d
            SET status='approved',metres_per_source_unit=?,decision_note=?,
                approved_by=?,approved_at=?,updated_at=?
          WHERE id=? AND project_id=? AND status='pending'`,
      ).bind(
        metresPerSourceUnit,
        decisionNote,
        access.actor.email,
        now,
        now,
        review.id,
        project.id,
      ),
      env.DB.prepare(
        `INSERT INTO engine_admin_audit
          (id,actor_email,action,project_id,target_id,details_json,created_at)
         SELECT ?,?,'processing.scale_review_approved',?,?,?,?
          WHERE EXISTS (
            SELECT 1 FROM model_scale_reviews_3d
             WHERE id=? AND project_id=? AND status='approved' AND approved_at=?
          )`,
      ).bind(
        crypto.randomUUID(),
        access.actor.email,
        project.id,
        review.id,
        auditDetails,
        now,
        review.id,
        project.id,
        now,
      ),
    ]);
    if (Number(results?.[0]?.meta?.changes || 0) <= 0)
      return json({ error: "Scale review changed before approval. Refresh and retry." }, { status: 409 });

    return json(await responseState(env, project));
  } catch (reason) {
    return json(
      { error: reason instanceof Error ? reason.message : "Scale review failed." },
      { status: Number(reason?.status || 409) },
    );
  }
}
