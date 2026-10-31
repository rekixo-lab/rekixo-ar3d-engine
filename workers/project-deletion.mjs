import { projectAssetPrefix } from "./storage-boundary.mjs";
import { validProjectSlug } from "../shared/project-slug-policy.js";

const LOCKED_PRODUCTION_PROJECT_SLUGS = new Set(["jyoti-paradise"]);

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

function validProjectId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,120}$/.test(value);
}

function lockedProductionProjects(projects) {
  return projects.filter((project) =>
    LOCKED_PRODUCTION_PROJECT_SLUGS.has(String(project?.slug || "")),
  );
}

function lockedDeletionResponse(projects) {
  const slugs = lockedProductionProjects(projects).map((project) => project.slug);
  return json(
    {
      error:
        "Permanent bulk deletion is blocked because the request contains a locked production project.",
      lockedProjects: slugs,
      retryable: false,
    },
    { status: 423 },
  );
}

function assertProjectDeletionAllowed(slug) {
  if (LOCKED_PRODUCTION_PROJECT_SLUGS.has(String(slug || "")))
    throw Error(`Locked production project cannot be deleted: ${slug}`);
}

async function deletionJobsSchemaReady(env) {
  try {
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM sqlite_master WHERE type='table' AND name='engine_deletion_jobs_3d'",
    ).first();
    return Number(row?.total || 0) === 1;
  } catch {
    return false;
  }
}

function deletionJobProjects(row) {
  let projects;
  try {
    projects = JSON.parse(String(row?.projects_json || "[]"));
  } catch {
    throw Error("Deletion job project snapshot is corrupted.");
  }
  if (
    !Array.isArray(projects) ||
    projects.some(
      (project) =>
        !project ||
        typeof project !== "object" ||
        !validProjectId(project.id) ||
        !validProjectSlug(project.slug),
    )
  )
    throw Error("Deletion job project snapshot is invalid.");
  return projects.map((project) => ({
    id: project.id,
    slug: project.slug,
    name: String(project.name || project.slug).slice(0, 200),
    status: String(project.status || "archived").slice(0, 40),
  }));
}

export function deletionJobResponse(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    expectedProjectCount: Number(row.expected_project_count || 0),
    deletedProjects: Number(row.deleted_projects || 0),
    deletedR2Objects: Number(row.deleted_r2_objects || 0),
    lastError: row.last_error || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function activeDeletionJob(env) {
  if (!(await deletionJobsSchemaReady(env))) return null;
  return env.DB.prepare(
    `SELECT id,kind,status,actor_email,expected_project_count,projects_json,
            deleted_projects,deleted_r2_objects,last_error,created_at,updated_at,completed_at
       FROM engine_deletion_jobs_3d
      WHERE kind='all-projects' AND status<>'completed'
      ORDER BY created_at DESC
      LIMIT 1`,
  ).first();
}

export async function deletionStatus(request, env) {
  if (request.method !== "GET")
    return json({ error: "Method not allowed." }, { status: 405 });
  if (!(await deletionJobsSchemaReady(env)))
    return json(
      { error: "Project deletion job schema is not installed." },
      { status: 503 },
    );
  return json({ job: deletionJobResponse(await activeDeletionJob(env)) });
}

async function deleteProjectOwnedObjects(env, slug, onDeleted) {
  assertProjectDeletionAllowed(slug);
  const prefix = projectAssetPrefix(slug);
  let cursor;
  let deleted = 0;

  do {
    const page = await env.MODEL_ASSETS.list({
      prefix,
      ...(cursor ? { cursor } : {}),
      limit: 1000,
    });
    const keys = (page.objects || []).map((item) => item.key);
    if (keys.length) {
      await env.MODEL_ASSETS.delete(keys);
      deleted += keys.length;
      if (onDeleted) await onDeleted(keys.length);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  return deleted;
}

async function deleteProjectRecords(env, project) {
  assertProjectDeletionAllowed(project.slug);
  // Engine-only plot mappings must be removed before their Geo and Building
  // source releases during explicit permanent project cleanup. Older database
  // instances may not have the additive mapping schema yet.
  const mappingSchema = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='geo_plot_mapping_releases_3d' LIMIT 1"
  ).first();
  const inventorySchema = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='geo_plot_inventory_3d' LIMIT 1"
  ).first();
  const masterplanSchema=await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='masterplan_geo_releases_3d' LIMIT 1"
  ).first();
  const ledgerSchema=await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='masterplan_sales_3d' LIMIT 1"
  ).first();
  const shareSchema=await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='masterplan_share_releases_3d' LIMIT 1"
  ).first();
  await env.DB.batch([
    ...(shareSchema ? [
      env.DB.prepare("DELETE FROM masterplan_share_active_3d WHERE project_id=?").bind(project.id),
      env.DB.prepare("DELETE FROM masterplan_share_releases_3d WHERE project_id=?").bind(project.id),
      env.DB.prepare("DELETE FROM masterplan_share_drafts_3d WHERE project_id=?").bind(project.id),
    ] : []),
    ...(ledgerSchema ? [
      env.DB.prepare("DELETE FROM masterplan_sale_payments_3d WHERE project_id=? AND kind='reversal'").bind(project.id),
      env.DB.prepare("DELETE FROM masterplan_sale_payments_3d WHERE project_id=?").bind(project.id),
      env.DB.prepare("DELETE FROM masterplan_sales_3d WHERE project_id=?").bind(project.id),
    ] : []),
    ...(masterplanSchema ? [
      env.DB.prepare("DELETE FROM masterplan_geo_active_3d WHERE project_id=?").bind(project.id),
      env.DB.prepare("DELETE FROM masterplan_geo_releases_3d WHERE project_id=?").bind(project.id),
      env.DB.prepare("DELETE FROM masterplan_geo_drafts_3d WHERE project_id=?").bind(project.id),
    ] : []),
    ...(inventorySchema ? [
      env.DB.prepare("DELETE FROM geo_plot_inventory_3d WHERE project_id=?").bind(project.id),
    ] : []),
    ...(mappingSchema ? [
      env.DB.prepare("DELETE FROM geo_plot_mapping_active_3d WHERE project_id=?").bind(project.id),
      env.DB.prepare("DELETE FROM geo_plot_mapping_releases_3d WHERE project_id=?").bind(project.id),
      env.DB.prepare("DELETE FROM geo_plot_mapping_drafts_3d WHERE project_id=?").bind(project.id),
    ] : []),
    env.DB.prepare(
      "DELETE FROM engine_admin_audit WHERE project_id=?",
    ).bind(project.id),
    env.DB.prepare(
      "DELETE FROM geo_experience_active_releases_3d WHERE project_id=?",
    ).bind(project.id),
    env.DB.prepare(
      "DELETE FROM geo_release_activations_3d WHERE project_id=?",
    ).bind(project.id),
    env.DB.prepare(
      "DELETE FROM geo_releases_3d WHERE project_id=?",
    ).bind(project.id),
    env.DB.prepare(
      "DELETE FROM geo_draft_verifications_3d WHERE project_id=?",
    ).bind(project.id),
    env.DB.prepare(
      "DELETE FROM geo_placements_3d WHERE project_id=?",
    ).bind(project.id),
    env.DB.prepare(
      "DELETE FROM geo_experience_drafts_3d WHERE project_id=?",
    ).bind(project.id),
    env.DB.prepare(
      "DELETE FROM experiences_3d WHERE project_id=?",
    ).bind(project.id),
    env.DB.prepare(
      "DELETE FROM release_activations_3d WHERE project_id=?",
    ).bind(project.id),
    env.DB.prepare(
      "DELETE FROM release_assets_3d WHERE project_id=?",
    ).bind(project.id),
    env.DB.prepare(
      "DELETE FROM releases_3d WHERE project_id=?",
    ).bind(project.id),
    env.DB.prepare(
      "DELETE FROM studio_assets_3d WHERE project_id=?",
    ).bind(project.id),
    env.DB.prepare(
      "DELETE FROM studio_drafts_3d WHERE project_id=?",
    ).bind(project.id),
    env.DB.prepare(
      "DELETE FROM publish_versions_3d WHERE project_id=?",
    ).bind(project.id),
    env.DB.prepare(
      "DELETE FROM scenes_3d WHERE project_id=?",
    ).bind(project.id),
    env.DB.prepare(
      "DELETE FROM camera_presets_3d WHERE project_id=?",
    ).bind(project.id),
    env.DB.prepare(
      "DELETE FROM models_3d WHERE project_id=?",
    ).bind(project.id),
    env.DB.prepare(
      "UPDATE projects_3d SET active_release_id=NULL WHERE id=?",
    ).bind(project.id),
    env.DB.prepare(
      "DELETE FROM projects_3d WHERE id=?",
    ).bind(project.id),
  ]);
}

async function setDeletionJobState(
  env,
  jobId,
  status,
  deletedProjects,
  deletedR2Objects,
  lastError = null,
  completedAt = null,
) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE engine_deletion_jobs_3d
        SET status=?,
            deleted_projects=?,
            deleted_r2_objects=?,
            last_error=?,
            updated_at=?,
            completed_at=?
      WHERE id=?`,
  )
    .bind(
      status,
      deletedProjects,
      deletedR2Objects,
      lastError,
      now,
      completedAt,
      jobId,
    )
    .run();
}

async function runDeletionJob(env, actor, row) {
  const projects = deletionJobProjects(row);
  if (lockedProductionProjects(projects).length)
    return lockedDeletionResponse(projects);

  let deletedR2Objects = Number(row.deleted_r2_objects || 0);
  let deletedProjects = Number(row.deleted_projects || 0);
  let status = String(row.status || "running");

  if (status === "running" || status === "cleanup_pending") {
    try {
      for (const project of projects)
        await deleteProjectOwnedObjects(
          env,
          project.slug,
          async (removed) => {
            deletedR2Objects += removed;
            await setDeletionJobState(
              env,
              row.id,
              "running",
              deletedProjects,
              deletedR2Objects,
            );
          },
        );
      status = "db_cleanup_pending";
      await setDeletionJobState(
        env,
        row.id,
        status,
        deletedProjects,
        deletedR2Objects,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown R2 cleanup failure.";
      await setDeletionJobState(
        env,
        row.id,
        "cleanup_pending",
        deletedProjects,
        deletedR2Objects,
        message.slice(0, 500),
      );
      return json(
        {
          error:
            "Project records are safely archived, but storage cleanup is incomplete. Retry permanent deletion to resume.",
          retryable: true,
          job: {
            ...deletionJobResponse(row),
            status: "cleanup_pending",
            deletedProjects,
            deletedR2Objects,
            lastError: message.slice(0, 500),
          },
        },
        { status: 503 },
      );
    }
  }

  if (status === "db_cleanup_pending") {
    try {
      for (const project of projects)
        await deleteProjectRecords(env, project);
      deletedProjects = projects.length;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown database cleanup failure.";
      await setDeletionJobState(
        env,
        row.id,
        "db_cleanup_pending",
        deletedProjects,
        deletedR2Objects,
        message.slice(0, 500),
      );
      return json(
        {
          error:
            "Storage cleanup finished, but database cleanup is incomplete. Retry permanent deletion to resume.",
          retryable: true,
          job: {
            ...deletionJobResponse(row),
            status: "db_cleanup_pending",
            deletedProjects,
            deletedR2Objects,
            lastError: message.slice(0, 500),
          },
        },
        { status: 503 },
      );
    }
  }

  const remaining = await env.DB.prepare(
    "SELECT COUNT(*) AS total FROM projects_3d",
  ).first();
  if (Number(remaining?.total || 0) !== 0) {
    const message = "Project cleanup did not reach an empty registry.";
    await setDeletionJobState(
      env,
      row.id,
      "db_cleanup_pending",
      deletedProjects,
      deletedR2Objects,
      message,
    );
    return json(
      {
        error: message,
        retryable: true,
        job: {
          ...deletionJobResponse(row),
          status: "db_cleanup_pending",
          deletedProjects,
          deletedR2Objects,
          lastError: message,
        },
      },
      { status: 500 },
    );
  }

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE engine_deletion_jobs_3d
          SET status='completed',
              deleted_projects=?,
              deleted_r2_objects=?,
              last_error=NULL,
              updated_at=?,
              completed_at=?
        WHERE id=?`,
    ).bind(deletedProjects, deletedR2Objects, now, now, row.id),
    env.DB.prepare(
      `INSERT INTO engine_admin_audit
        (id,actor_email,action,project_id,target_id,details_json,created_at)
        VALUES (?,?,?,?,?,?,?)`,
    ).bind(
      crypto.randomUUID(),
      actor.email,
      "projects.all_deleted",
      null,
      row.id,
      JSON.stringify({
        jobId: row.id,
        projectCount: projects.length,
        deletedR2Objects,
        slugs: projects.map((project) => project.slug),
      }),
      now,
    ),
  ]);

  return json({
    ok: true,
    jobId: row.id,
    status: "completed",
    deletedProjects,
    deletedR2Objects,
    remainingProjects: 0,
  });
}

async function startDeletionJob(env, actor, projectRows) {
  const now = new Date().toISOString();
  const jobId = crypto.randomUUID();
  const snapshot = projectRows.map((project) => ({
    id: project.id,
    slug: project.slug,
    name: project.name,
    status: project.status,
  }));
  const statements = [
    env.DB.prepare(
      `INSERT INTO engine_deletion_jobs_3d
        (id,kind,status,actor_email,expected_project_count,projects_json,
         deleted_projects,deleted_r2_objects,last_error,created_at,updated_at)
       VALUES (?,'all-projects','running',?,?,?,0,0,NULL,?,?)`,
    ).bind(
      jobId,
      actor.email,
      snapshot.length,
      JSON.stringify(snapshot),
      now,
      now,
    ),
  ];

  for (const project of projectRows) {
    statements.push(
      env.DB.prepare(
        "UPDATE projects_3d SET status='archived',updated_at=? WHERE id=?",
      ).bind(now, project.id),
      env.DB.prepare(
        "UPDATE experiences_3d SET lifecycle='archived',updated_at=? WHERE project_id=?",
      ).bind(now, project.id),
    );
  }

  statements.push(
    env.DB.prepare(
      `INSERT INTO engine_admin_audit
        (id,actor_email,action,project_id,target_id,details_json,created_at)
        VALUES (?,?,?,?,?,?,?)`,
    ).bind(
      crypto.randomUUID(),
      actor.email,
      "projects.delete_started",
      null,
      jobId,
      JSON.stringify({
        jobId,
        projectCount: snapshot.length,
        slugs: snapshot.map((project) => project.slug),
      }),
      now,
    ),
  );

  await env.DB.batch(statements);
  return env.DB.prepare(
    `SELECT id,kind,status,actor_email,expected_project_count,projects_json,
            deleted_projects,deleted_r2_objects,last_error,created_at,updated_at,completed_at
       FROM engine_deletion_jobs_3d
      WHERE id=?
      LIMIT 1`,
  ).bind(jobId).first();
}

export async function hardDeleteAllProjects(request, env, actor) {
  if (request.method !== "DELETE")
    return json({ error: "Method not allowed." }, { status: 405 });
  if (!sameOrigin(request))
    return json({ error: "Invalid request origin." }, { status: 403 });
  if (!(await deletionJobsSchemaReady(env)))
    return json(
      { error: "Project deletion job schema is not installed." },
      { status: 503 },
    );

  const body = await request.json().catch(() => ({}));
  if (String(body.confirm || "") !== "DELETE ALL PROJECTS")
    return json(
      { error: "Type DELETE ALL PROJECTS to confirm permanent deletion." },
      { status: 400 },
    );

  const existingJob = await activeDeletionJob(env);
  if (existingJob) return runDeletionJob(env, actor, existingJob);

  const rows = await env.DB.prepare(
    `SELECT id,slug,name,status
       FROM projects_3d
      ORDER BY created_at ASC,slug ASC`,
  ).all();
  const projectRows = rows.results || [];

  if (lockedProductionProjects(projectRows).length)
    return lockedDeletionResponse(projectRows);

  const expectedProjectCount = Number(body.expectedProjectCount);
  if (
    !Number.isInteger(expectedProjectCount) ||
    expectedProjectCount < 0 ||
    expectedProjectCount !== projectRows.length
  )
    return json(
      {
        error:
          "Project list changed. Refresh before permanent deletion.",
        actualProjectCount: projectRows.length,
      },
      { status: 409 },
    );

  if (projectRows.length === 0)
    return json({
      ok: true,
      status: "completed",
      deletedProjects: 0,
      deletedR2Objects: 0,
      remainingProjects: 0,
    });

  let job;
  try {
    job = await startDeletionJob(env, actor, projectRows);
  } catch (error) {
    const concurrent = await activeDeletionJob(env);
    if (concurrent) return runDeletionJob(env, actor, concurrent);
    throw error;
  }
  if (!job)
    return json(
      { error: "Permanent project cleanup job could not be created." },
      { status: 500 },
    );
  return runDeletionJob(env, actor, job);
}
