import { engineAdminReadAccess } from "./admin-cloud.mjs";
import { activeDeletionJob } from "./project-deletion.mjs";
import { validProjectSlug } from "../shared/project-slug-policy.js";
import {
  SOURCE_CLASSIFIER_VERSION,
  classifySourceMetadata,
  chooseGeometryAuthoritySuggestion,
} from "./source-classification-policy.mjs";

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

async function schemaReady(env) {
  try {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS total
         FROM sqlite_master
        WHERE type='table'
          AND name IN (
            'source_files_3d',
            'source_classification_suggestions_3d',
            'project_operation_locks_3d'
          )`,
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
    `SELECT id,filename,media_type,byte_size,sha256,upload_state
       FROM source_files_3d
      WHERE project_id=? AND upload_state='verified'
      ORDER BY created_at ASC,id ASC`,
  ).bind(projectId).all();
  return rows.results || [];
}

async function storedSuggestions(env, projectId) {
  const rows = await env.DB.prepare(
    `SELECT s.source_file_id,s.classifier_version,s.suggested_roles_json,
            s.suggested_capabilities_json,s.confidence,s.geometry_authority_score,
            s.rationale_code,s.created_at,s.updated_at,
            f.filename,f.media_type,f.byte_size,f.sha256
       FROM source_classification_suggestions_3d s
       JOIN source_files_3d f ON f.id=s.source_file_id AND f.project_id=s.project_id
      WHERE s.project_id=?
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function authorityFromSuggestions(suggestions) {
  return chooseGeometryAuthoritySuggestion(
    suggestions.map((item) => ({
      sourceFileId: item.sourceFileId,
      geometryAuthorityScore: item.geometryAuthorityScore,
    })),
  );
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

async function refreshSuggestions(env, actor, project) {
  const sources = await verifiedSources(env, project.id);
  const now = new Date().toISOString();

  if (sources.length) {
    const statements = sources.map((source) => {
      const classification = classifySourceMetadata({
        filename: source.filename,
        mediaType: source.media_type,
      });
      return env.DB.prepare(
        `INSERT INTO source_classification_suggestions_3d
          (source_file_id,project_id,classifier_version,suggested_roles_json,
           suggested_capabilities_json,confidence,geometry_authority_score,
           rationale_code,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(source_file_id) DO UPDATE SET
           project_id=excluded.project_id,
           classifier_version=excluded.classifier_version,
           suggested_roles_json=excluded.suggested_roles_json,
           suggested_capabilities_json=excluded.suggested_capabilities_json,
           confidence=excluded.confidence,
           geometry_authority_score=excluded.geometry_authority_score,
           rationale_code=excluded.rationale_code,
           updated_at=excluded.updated_at`,
      ).bind(
        source.id,
        project.id,
        classification.classifierVersion,
        JSON.stringify(classification.roles),
        JSON.stringify(classification.capabilities),
        classification.confidence,
        classification.geometryAuthorityScore,
        classification.rationaleCode,
        now,
        now,
      );
    });
    await env.DB.batch(statements);
  }

  const rows = await storedSuggestions(env, project.id);
  const suggestions = rows.map(suggestionResponse);
  const authoritySuggestion = authorityFromSuggestions(suggestions);

  await audit(
    env,
    actor,
    "source.classification_refreshed",
    project.id,
    project.id,
    {
      classifierVersion: SOURCE_CLASSIFIER_VERSION,
      verifiedSourceCount: sources.length,
      suggestionCount: suggestions.length,
      authoritySuggestion,
    },
  );

  return { suggestions, authoritySuggestion };
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
    return { error: "Invalid source classification route encoding." };
  }
  if (parts.length !== 2 || parts[1] !== "source-classification") return null;
  const slug = String(parts[0] || "").trim().toLowerCase();
  if (!validProjectSlug(slug)) return { error: "Valid project slug is required." };
  return { slug };
}

export async function handleSourceClassificationRequest(
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
    return json({ error: "Source classification schema is not installed." }, { status: 503 });

  const project = await projectBySlug(env, route.slug);
  if (!project) return json({ error: "Cloud project not found." }, { status: 404 });

  if (request.method === "GET") {
    const suggestions = (await storedSuggestions(env, project.id)).map(suggestionResponse);
    return json({
      classifierVersion: SOURCE_CLASSIFIER_VERSION,
      suggestions,
      authoritySuggestion: authorityFromSuggestions(suggestions),
      advisoryOnly: true,
    });
  }

  if (project.status === "archived")
    return json({ error: "Restore the project before classifying source files." }, { status: 409 });

  const lockReason = await projectOperationLockReason(env, project.id, "source-write");
  if (lockReason)
    return json(
      {
        error: "Project source mutation is locked by an operational policy.",
        reason: lockReason,
      },
      { status: 423 },
    );

  if (await activeDeletionJob(env))
    return json(
      { error: "Permanent project cleanup is in progress. Source mutations are frozen until it finishes." },
      { status: 409 },
    );

  const result = await refreshSuggestions(env, access.actor, project);
  return json({
    classifierVersion: SOURCE_CLASSIFIER_VERSION,
    ...result,
    advisoryOnly: true,
    operatorApprovalRequired: true,
  });
}
