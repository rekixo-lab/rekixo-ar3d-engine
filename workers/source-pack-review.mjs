import { engineAdminReadAccess } from "./admin-cloud.mjs";
import { activeDeletionJob } from "./project-deletion.mjs";
import {
  SOURCE_CLASSIFIER_VERSION,
  chooseGeometryAuthoritySuggestion,
} from "./source-classification-policy.mjs";
import {
  canonicalSourcePackManifest,
  normalizeSourcePackReviewFiles,
  sourcePackReviewReadiness,
} from "./source-pack-review-policy.mjs";
import { validProjectSlug } from "../shared/project-slug-policy.js";

const BASE_PATH = "/3Dprojects";
const ROUTE_PREFIX = `${BASE_PATH}/api/cloud/projects/`;
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
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) headers.set(key, value);
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

async function schemaReady(env) {
  try {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS total
         FROM sqlite_master
        WHERE type='table'
          AND name IN (
            'source_files_3d',
            'source_packs_3d',
            'source_pack_files_3d',
            'source_classification_suggestions_3d',
            'project_operation_locks_3d'
          )`,
    ).first();
    return Number(row?.total || 0) === 5;
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

async function verifiedSources(env, projectId) {
  const rows = await env.DB.prepare(
    `SELECT id,filename,media_type,byte_size,sha256
       FROM source_files_3d
      WHERE project_id=? AND upload_state='verified'
      ORDER BY created_at ASC,id ASC`,
  ).bind(projectId).all();
  return rows.results || [];
}

async function classificationSuggestions(env, projectId) {
  const rows = await env.DB.prepare(
    `SELECT s.source_file_id,s.classifier_version,s.suggested_roles_json,s.suggested_capabilities_json,
            s.confidence,s.geometry_authority_score,s.rationale_code,
            f.filename,f.media_type,f.byte_size,f.sha256
       FROM source_classification_suggestions_3d s
       JOIN source_files_3d f
         ON f.id=s.source_file_id AND f.project_id=s.project_id
      WHERE s.project_id=? AND f.upload_state='verified'
      ORDER BY s.geometry_authority_score DESC,s.source_file_id ASC`,
  ).bind(projectId).all();
  return rows.results || [];
}

function suggestionResponse(row) {
  return {
    sourceFileId: row.source_file_id,
    filename: row.filename,
    mediaType: row.media_type,
    byteSize: Number(row.byte_size),
    sha256: row.sha256,
    classifierVersion: row.classifier_version,
    suggestedRoles: JSON.parse(row.suggested_roles_json),
    suggestedCapabilities: JSON.parse(row.suggested_capabilities_json),
    confidence: Number(row.confidence),
    geometryAuthorityScore: Number(row.geometry_authority_score),
    rationaleCode: row.rationale_code,
  };
}

function authoritySuggestion(items) {
  return chooseGeometryAuthoritySuggestion(
    items.map((item) => ({
      sourceFileId: item.sourceFileId,
      geometryAuthorityScore: item.geometryAuthorityScore,
    })),
  );
}

async function latestPack(env, projectId) {
  return env.DB.prepare(
    `SELECT *
       FROM source_packs_3d
      WHERE project_id=?
      ORDER BY version DESC
      LIMIT 1`,
  ).bind(projectId).first();
}

async function packById(env, projectId, packId) {
  return env.DB.prepare(
    `SELECT *
       FROM source_packs_3d
      WHERE project_id=? AND id=?
      LIMIT 1`,
  ).bind(projectId, packId).first();
}

async function packFiles(env, projectId, packId) {
  const rows = await env.DB.prepare(
    `SELECT pf.source_file_id,pf.roles_json,pf.capabilities_json,
            pf.classification_origin,pf.classification_confidence,pf.notes,pf.sort_order,
            f.filename,f.media_type,f.byte_size,f.sha256,f.upload_state
       FROM source_pack_files_3d pf
       JOIN source_files_3d f
         ON f.id=pf.source_file_id AND f.project_id=pf.project_id
      WHERE pf.project_id=? AND pf.source_pack_id=?
      ORDER BY pf.sort_order ASC,pf.source_file_id ASC`,
  ).bind(projectId, packId).all();
  return rows.results || [];
}

function packFileResponse(row) {
  return {
    sourceFileId: row.source_file_id,
    filename: row.filename,
    mediaType: row.media_type,
    byteSize: Number(row.byte_size),
    sha256: row.sha256,
    uploadState: row.upload_state,
    roles: JSON.parse(row.roles_json),
    capabilities: JSON.parse(row.capabilities_json),
    classificationOrigin: row.classification_origin,
    classificationConfidence: Number(row.classification_confidence),
    notes: row.notes ?? null,
    sortOrder: Number(row.sort_order),
  };
}

function sameCapabilities(left, right) {
  const normalizedLeft = [...new Set(left || [])].sort();
  const normalizedRight = [...new Set(right || [])].sort();
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index])
  );
}

async function packResponse(env, projectId, pack) {
  if (!pack) return null;
  const files = (await packFiles(env, projectId, pack.id)).map(packFileResponse);
  const verified = await verifiedSources(env, projectId);
  return {
    id: pack.id,
    projectId: pack.project_id,
    version: Number(pack.version),
    status: pack.status,
    geometryAuthorityFileId: pack.geometry_authority_file_id ?? null,
    operatorApproved: Number(pack.operator_approved) === 1,
    manifestSha256: pack.manifest_sha256 ?? null,
    createdBy: pack.created_by,
    approvedBy: pack.approved_by ?? null,
    createdAt: pack.created_at,
    updatedAt: pack.updated_at,
    files,
    readiness: sourcePackReviewReadiness({
      verifiedSourceIds: verified.map((item) => item.id),
      files,
    }),
  };
}

async function audit(env, actor, action, projectId, targetId, details = {}) {
  await env.DB.prepare(
    `INSERT INTO engine_admin_audit
      (id,actor_email,action,project_id,target_id,details_json,created_at)
      VALUES (?,?,?,?,?,?,?)`,
  ).bind(
    crypto.randomUUID(),
    actor.email,
    action,
    projectId,
    targetId,
    JSON.stringify(details),
    new Date().toISOString(),
  ).run();
}

async function startDraft(env, actor, project) {
  const current = await latestPack(env, project.id);
  if (current?.status === "draft") return packResponse(env, project.id, current);

  const sources = await verifiedSources(env, project.id);
  if (!sources.length) throw new Error("Verify at least one source file before starting review.");

  const suggestions = await classificationSuggestions(env, project.id);
  const suggestionById = new Map(suggestions.map((item) => [item.source_file_id, item]));
  const missing = sources.filter((source) => !suggestionById.has(source.id));
  const stale = sources.filter(
    (source) => suggestionById.get(source.id)?.classifier_version !== SOURCE_CLASSIFIER_VERSION,
  );
  if (missing.length || stale.length)
    throw new Error("Refresh automatic source classification before starting review.");

  const version = Number(current?.version || 0) + 1;
  const packId = `source_pack_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const statements = [
    env.DB.prepare(
      `INSERT INTO source_packs_3d
        (id,project_id,version,status,operator_approved,created_by,created_at,updated_at)
       SELECT ?,?,?,'draft',0,?,?,?
        WHERE (
          SELECT COUNT(*) FROM source_files_3d
           WHERE project_id=? AND upload_state='verified'
        )=?
          AND NOT EXISTS (
            SELECT 1 FROM source_packs_3d
             WHERE project_id=? AND status='draft'
          )`,
    ).bind(
      packId,
      project.id,
      version,
      actor.email,
      now,
      now,
      project.id,
      sources.length,
      project.id,
    ),
  ];

  sources.forEach((source, index) => {
    const suggestion = suggestionById.get(source.id);
    const roles = JSON.parse(suggestion.suggested_roles_json).filter(
      (role) => role !== "geometry-authority",
    );
    statements.push(
      env.DB.prepare(
        `INSERT INTO source_pack_files_3d
          (source_pack_id,project_id,source_file_id,roles_json,capabilities_json,
           classification_origin,classification_confidence,notes,sort_order,created_at,updated_at)
         SELECT ?,?,?,?,?,'automatic',?,NULL,?,?,?
          WHERE EXISTS (
            SELECT 1 FROM source_packs_3d
             WHERE id=? AND project_id=? AND status='draft'
          )`,
      ).bind(
        packId,
        project.id,
        source.id,
        JSON.stringify(roles),
        suggestion.suggested_capabilities_json,
        Number(suggestion.confidence),
        index,
        now,
        now,
        packId,
        project.id,
      ),
    );
  });

  const results = await env.DB.batch(statements);
  const created = Number(results?.[0]?.meta?.changes || 0) > 0;
  if (!created) {
    const concurrent = await latestPack(env, project.id);
    if (concurrent?.status === "draft") return packResponse(env, project.id, concurrent);
    throw new Error(
      "Verified source set changed while starting review. Refresh automatic source classification and retry.",
    );
  }

  await audit(env, actor, "source.pack_review_started", project.id, packId, {
    version,
    verifiedSourceCount: sources.length,
  });
  return packResponse(env, project.id, await packById(env, project.id, packId));
}

async function saveReview(env, actor, project, body) {
  const packId = typeof body.packId === "string" ? body.packId.trim() : "";
  const pack = await packById(env, project.id, packId);
  if (!pack) throw new Error("Source pack draft not found.");
  if (pack.status !== "draft") throw new Error("Only a draft source pack can be edited.");

  const files = normalizeSourcePackReviewFiles(body.files);
  const sources = await verifiedSources(env, project.id);
  const verifiedIds = new Set(sources.map((source) => source.id));
  const reviewedIds = new Set(files.map((item) => item.sourceFileId));
  const missing = [...verifiedIds].filter((id) => !reviewedIds.has(id));
  const stale = [...reviewedIds].filter((id) => !verifiedIds.has(id));
  if (missing.length || stale.length)
    throw new Error("Review must include every currently verified source file exactly once.");

  const storedFiles = (await packFiles(env, project.id, pack.id)).map(packFileResponse);
  const storedById = new Map(storedFiles.map((item) => [item.sourceFileId, item]));
  for (const item of files) {
    const stored = storedById.get(item.sourceFileId);
    if (!stored || !sameCapabilities(item.capabilities, stored.capabilities))
      throw new Error(
        "Source capabilities are engine-derived and cannot be changed during operator review.",
      );
  }

  const geometryAuthorityFileId = files.find((item) =>
    item.roles.includes("geometry-authority"),
  ).sourceFileId;
  const now = new Date().toISOString();
  const statements = [
    env.DB.prepare(
      `DELETE FROM source_pack_files_3d
        WHERE project_id=? AND source_pack_id=?`,
    ).bind(project.id, pack.id),
  ];

  files.forEach((item, index) => {
    statements.push(
      env.DB.prepare(
        `INSERT INTO source_pack_files_3d
          (source_pack_id,project_id,source_file_id,roles_json,capabilities_json,
           classification_origin,classification_confidence,notes,sort_order,created_at,updated_at)
         VALUES (?,?,?,?,?,'operator',1,?,?,?,?)`,
      ).bind(
        pack.id,
        project.id,
        item.sourceFileId,
        JSON.stringify(item.roles),
        JSON.stringify(item.capabilities),
        item.notes,
        index,
        now,
        now,
      ),
    );
  });
  statements.push(
    env.DB.prepare(
      `UPDATE source_packs_3d
          SET geometry_authority_file_id=?,operator_approved=0,
              manifest_json=NULL,manifest_sha256=NULL,approved_by=NULL,updated_at=?
        WHERE id=? AND project_id=? AND status='draft'`,
    ).bind(geometryAuthorityFileId, now, pack.id, project.id),
  );

  await env.DB.batch(statements);
  await audit(env, actor, "source.pack_review_saved", project.id, pack.id, {
    geometryAuthorityFileId,
    sourceCount: files.length,
  });
  return packResponse(env, project.id, await packById(env, project.id, pack.id));
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("");
}

async function sealPack(env, actor, project, body) {
  const packId = typeof body.packId === "string" ? body.packId.trim() : "";
  if (body.confirm !== "SEAL SOURCE PACK")
    throw new Error("Explicit source pack seal confirmation is required.");

  const pack = await packById(env, project.id, packId);
  if (!pack) throw new Error("Source pack draft not found.");
  if (pack.status !== "draft") throw new Error("Only a draft source pack can be sealed.");

  const sources = await verifiedSources(env, project.id);
  const files = (await packFiles(env, project.id, pack.id)).map(packFileResponse);
  const readiness = sourcePackReviewReadiness({
    verifiedSourceIds: sources.map((source) => source.id),
    files,
  });
  if (!readiness.ready || !readiness.geometryAuthorityFileId)
    throw new Error("Source pack is not ready to seal. Review every verified source and select exactly one geometry authority.");

  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const manifestFiles = files.map((file) => {
    const source = sourceById.get(file.sourceFileId);
    if (!source) throw new Error("Source pack contains a file that is no longer verified.");
    return {
      ...file,
      filename: source.filename,
      mediaType: source.media_type,
      byteSize: Number(source.byte_size),
      sha256: source.sha256,
    };
  });

  const manifestJson = canonicalSourcePackManifest({
    project,
    pack,
    geometryAuthorityFileId: readiness.geometryAuthorityFileId,
    files: manifestFiles,
  });
  const manifestSha256 = await sha256Hex(manifestJson);
  const now = new Date().toISOString();

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE source_packs_3d
          SET status='superseded',updated_at=?
        WHERE project_id=? AND status='ready' AND id<>?`,
    ).bind(now, project.id, pack.id),
    env.DB.prepare(
      `UPDATE source_packs_3d
          SET status='ready',operator_approved=1,
              geometry_authority_file_id=?,manifest_json=?,manifest_sha256=?,
              approved_by=?,updated_at=?
        WHERE project_id=? AND id=? AND status='draft'`,
    ).bind(
      readiness.geometryAuthorityFileId,
      manifestJson,
      manifestSha256,
      actor.email,
      now,
      project.id,
      pack.id,
    ),
  ]);

  await audit(env, actor, "source.pack_sealed", project.id, pack.id, {
    version: Number(pack.version),
    geometryAuthorityFileId: readiness.geometryAuthorityFileId,
    manifestSha256,
    sourceCount: files.length,
  });
  return packResponse(env, project.id, await packById(env, project.id, pack.id));
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
    return { error: "Invalid source pack review route encoding." };
  }
  if (parts.length !== 2 || parts[1] !== "source-pack-review") return null;
  const slug = String(parts[0] || "").trim().toLowerCase();
  if (!validProjectSlug(slug)) return { error: "Valid project slug is required." };
  return { slug };
}

async function readBody(request) {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    throw new Error("Valid JSON request body is required.");
  }
}

export async function handleSourcePackReviewRequest(
  request,
  env,
  url = new URL(request.url),
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
    return json({ error: "Source Pack V2 review schema is not installed." }, { status: 503 });

  const project = await projectBySlug(env, route.slug);
  if (!project) return json({ error: "Cloud project not found." }, { status: 404 });

  const suggestions = (await classificationSuggestions(env, project.id)).map(suggestionResponse);
  if (request.method === "GET") {
    return json({
      project: { id: project.id, slug: project.slug, name: project.name, status: project.status },
      authoritySuggestion: authoritySuggestion(suggestions),
      suggestions,
      latestPack: await packResponse(env, project.id, await latestPack(env, project.id)),
      operatorApprovalRequired: true,
      immutableAfterSeal: true,
    });
  }

  if (project.status === "archived")
    return json({ error: "Restore the project before editing its source pack." }, { status: 409 });
  const lockReason = await projectOperationLockReason(env, project.id, "source-write");
  if (lockReason)
    return json(
      { error: "Project source mutation is locked by an operational policy.", reason: lockReason },
      { status: 423 },
    );
  if (await activeDeletionJob(env))
    return json(
      { error: "Permanent project cleanup is in progress. Source mutations are frozen until it finishes." },
      { status: 409 },
    );

  try {
    const body = await readBody(request);
    let latestPackResult;
    if (body.action === "start-draft") latestPackResult = await startDraft(env, access.actor, project);
    else if (body.action === "save-review") latestPackResult = await saveReview(env, access.actor, project, body);
    else if (body.action === "seal") latestPackResult = await sealPack(env, access.actor, project, body);
    else return json({ error: "Unsupported source pack review action." }, { status: 400 });

    return json({
      project: { id: project.id, slug: project.slug, name: project.name, status: project.status },
      authoritySuggestion: authoritySuggestion(suggestions),
      suggestions,
      latestPack: latestPackResult,
      operatorApprovalRequired: latestPackResult?.status !== "ready",
      immutableAfterSeal: true,
    });
  } catch (reason) {
    return json(
      { error: reason instanceof Error ? reason.message : "Source pack review failed." },
      { status: 409 },
    );
  }
}
