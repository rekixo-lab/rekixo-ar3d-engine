import { engineAdminReadAccess } from "./admin-cloud.mjs";
import { validateCatalogIdentity, validateStoredBindingTargets } from "./reviewed-component-bindings.mjs";
import { validProjectSlug } from "../shared/project-slug-policy.js";

const BASE_PATH = "/3Dprojects";
const ROUTE_PREFIX = `${BASE_PATH}/api/cloud/projects/`;
const PROCESSOR_VERSION = "canonical-building-v1";
const MAX_CATALOG_BYTES = 16 * 1024 * 1024;
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 80;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

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
    return { error: "Invalid component mapper route encoding." };
  }
  if (parts.length !== 2 || parts[1] !== "component-mapper") return null;
  const slug = String(parts[0] || "").trim().toLowerCase();
  if (!validProjectSlug(slug)) return { error: "Valid project slug is required." };
  return { slug };
}

async function processingSchemaReady(env) {
  try {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS total
         FROM sqlite_master
        WHERE type='table'
          AND name IN ('studio_drafts_3d','source_packs_3d','processing_jobs_3d','processing_artifacts_3d')`,
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

async function draftState(env, project) {
  const row = await env.DB.prepare(
    `SELECT revision,draft_json,updated_at
       FROM studio_drafts_3d
      WHERE project_id=?
      LIMIT 1`,
  ).bind(project.id).first();
  if (!row) return null;
  let draft;
  try {
    draft = JSON.parse(row.draft_json);
  } catch {
    throw Object.assign(Error("Cloud draft is corrupted and requires recovery."), { status: 500 });
  }
  const floors = Array.isArray(draft?.scene?.floors)
    ? draft.scene.floors.map((floor) => ({
        id: String(floor.id),
        name: String(floor.name || floor.id),
        elevation: Number(floor.elevation || 0),
      }))
    : [];
  const rooms = Array.isArray(draft?.scene?.rooms)
    ? draft.scene.rooms.map((room) => ({
        id: String(room.id),
        name: String(room.name || room.id),
        floorId: String(room.floorId || ""),
        unit: String(room.unit || ""),
      }))
    : [];
  const block = draft?.scene?.reviewedComponentBindings ?? null;
  if (block) {
    try {
      validateStoredBindingTargets(draft, block);
    } catch {
      throw Object.assign(
        Error("Reviewed component bindings are inconsistent with the current Studio draft and require recovery."),
        { status: 409 },
      );
    }
  }
  return {
    row,
    draft,
    revision: Number(row.revision),
    updatedAt: row.updated_at,
    floors,
    rooms,
    block,
  };
}

async function latestSealedPack(env, projectId) {
  return env.DB.prepare(
    `SELECT id,version,manifest_sha256,status
       FROM source_packs_3d
      WHERE project_id=?
        AND status IN ('ready','superseded')
        AND operator_approved=1
        AND manifest_sha256 IS NOT NULL
      ORDER BY version DESC
      LIMIT 1`,
  ).bind(projectId).first();
}

async function latestJobForPack(env, projectId, packId) {
  return env.DB.prepare(
    `SELECT id,project_id,source_pack_id,source_pack_version,
            source_pack_manifest_sha256,processor_version,attempt,state,
            output_manifest_sha256,updated_at
       FROM processing_jobs_3d
      WHERE project_id=? AND source_pack_id=? AND processor_version=?
      ORDER BY attempt DESC
      LIMIT 1`,
  ).bind(projectId, packId, PROCESSOR_VERSION).first();
}

async function readyArtifacts(env, projectId, jobId) {
  const rows = await env.DB.prepare(
    `SELECT id,processing_job_id,project_id,kind,logical_id,state,r2_key,mime_type,
            byte_size,sha256,updated_at
       FROM processing_artifacts_3d
      WHERE project_id=? AND processing_job_id=? AND state='ready'
      ORDER BY kind ASC,logical_id ASC,id ASC`,
  ).bind(projectId, jobId).all();
  return rows.results || [];
}

function exactArtifact(artifacts, kind, logicalId) {
  const matches = artifacts.filter(
    (item) => item.kind === kind && item.logical_id === logicalId,
  );
  return matches.length === 1 ? matches[0] : null;
}

function processingSummary(pack, job) {
  return {
    sourcePackId: pack?.id ?? null,
    sourcePackVersion: pack ? Number(pack.version) : null,
    sourcePackManifestSha256: pack?.manifest_sha256 ?? null,
    processingJobId: job?.id ?? null,
    processorVersion: job?.processor_version ?? PROCESSOR_VERSION,
    attempt: job ? Number(job.attempt) : null,
    state: job?.state ?? null,
    outputManifestSha256: job?.output_manifest_sha256 ?? null,
  };
}

async function sha256Hex(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (item) => item.toString(16).padStart(2, "0")).join("");
}

async function loadVerifiedCatalog(env, project, pack, job, artifacts) {
  if (!job || job.state !== "succeeded" || !job.output_manifest_sha256) return null;
  const model = exactArtifact(artifacts, "canonical-model", "building-model");
  const manifest = exactArtifact(
    artifacts,
    "canonical-model-manifest",
    "canonical-model-manifest-v1",
  );
  const catalogArtifact = exactArtifact(artifacts, "node-catalog", "node-catalog-v1");
  if (!model || !manifest || !catalogArtifact) return null;
  if (
    !model.sha256 ||
    !manifest.sha256 ||
    !catalogArtifact.sha256 ||
    manifest.sha256 !== job.output_manifest_sha256
  )
    return null;

  const object = await env.MODEL_ASSETS.get(catalogArtifact.r2_key);
  if (!object) throw Object.assign(Error("Verified node catalog bytes are missing from storage."), { status: 409 });
  if (Number(object.size || 0) > MAX_CATALOG_BYTES)
    throw Object.assign(Error("Node catalog exceeds the mapper safety limit."), { status: 413 });
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (bytes.byteLength > MAX_CATALOG_BYTES)
    throw Object.assign(Error("Node catalog exceeds the mapper safety limit."), { status: 413 });
  const actualSha = await sha256Hex(bytes);
  if (actualSha !== String(catalogArtifact.sha256).toLowerCase())
    throw Object.assign(Error("Node catalog checksum verification failed."), { status: 409 });

  let catalog;
  try {
    catalog = JSON.parse(decoder.decode(bytes));
  } catch {
    throw Object.assign(Error("Node catalog JSON is invalid."), { status: 409 });
  }
  const identity = { job, model, catalogArtifact };
  try {
    validateCatalogIdentity(catalog, project, identity);
  } catch (reason) {
    throw Object.assign(
      Error(reason instanceof Error ? reason.message : "Node catalog identity is invalid."),
      { status: 409 },
    );
  }
  if (
    catalog.sourcePack.id !== pack.id ||
    Number(catalog.sourcePack.version) !== Number(pack.version) ||
    String(catalog.sourcePack.manifestSha256).toLowerCase() !==
      String(pack.manifest_sha256).toLowerCase()
  )
    throw Object.assign(Error("Node catalog is stale for the current sealed Source Pack."), { status: 409 });

  return { catalog, model, manifest, catalogArtifact };
}

function pageNodes(catalog, url) {
  const query = String(url.searchParams.get("q") || "").trim().toLowerCase().slice(0, 160);
  const requestedLimit = Number.parseInt(url.searchParams.get("limit") || "", 10);
  const limit = Number.isInteger(requestedLimit)
    ? Math.min(MAX_LIMIT, Math.max(1, requestedLimit))
    : DEFAULT_LIMIT;
  const requestedOffset = Number.parseInt(url.searchParams.get("offset") || "0", 10);
  const offset = Number.isInteger(requestedOffset)
    ? Math.min(1_000_000, Math.max(0, requestedOffset))
    : 0;

  const selectable = catalog.nodes.filter((node) => node?.selectable === true);
  const filtered = query
    ? selectable.filter((node) => {
        const name = String(node.name || "").toLowerCase();
        const id = String(node.id || "").toLowerCase();
        return name.includes(query) || id.includes(query);
      })
    : selectable;
  const slice = filtered.slice(offset, offset + limit).map((node) => ({
    id: node.id,
    index: Number(node.index),
    name: node.name,
    parentId: node.parentId,
    childIds: Array.isArray(node.childIds) ? node.childIds : [],
    meshIndex: node.meshIndex,
    primitiveCount: Number(node.primitiveCount || 0),
    materialIndices: Array.isArray(node.materialIndices) ? node.materialIndices : [],
  }));
  return {
    query,
    offset,
    limit,
    total: filtered.length,
    totalSelectable: selectable.length,
    hasMore: offset + slice.length < filtered.length,
    nodes: slice,
  };
}

function bindingStatus(block, job, catalogArtifact, model) {
  if (!block) return "none";
  if (
    block.processingJobId === job?.id &&
    block.nodeCatalogArtifactId === catalogArtifact?.id &&
    String(block.nodeCatalogSha256 || "").toLowerCase() ===
      String(catalogArtifact?.sha256 || "").toLowerCase() &&
    block.canonicalModelArtifactId === model?.id &&
    String(block.canonicalModelSha256 || "").toLowerCase() ===
      String(model?.sha256 || "").toLowerCase()
  )
    return "current";
  return "stale";
}

export async function handleComponentMapperDataRequest(
  request,
  env,
  url = new URL(request.url),
) {
  const route = parseRoute(url);
  if (!route) return null;
  if (route.error) return json({ error: route.error }, { status: 400 });
  if (request.method !== "GET")
    return json({ error: "Method not allowed." }, { status: 405 });

  const access = await engineAdminReadAccess(request, env);
  if (!access.ok) return json({ error: access.error }, { status: access.status });
  // Authenticated GET is read-only; browsers do not normally send an Origin header.
  if (!(await processingSchemaReady(env)))
    return json(
      { contractVersion: 1, schemaReady: false, error: "Component mapper schema dependencies are not installed." },
      { status: 503 },
    );

  const project = await projectBySlug(env, route.slug);
  if (!project) return json({ error: "Cloud project not found." }, { status: 404 });

  try {
    const draft = await draftState(env, project);
    const pack = await latestSealedPack(env, project.id);
    const job = pack ? await latestJobForPack(env, project.id, pack.id) : null;
    const artifacts = job ? await readyArtifacts(env, project.id, job.id) : [];
    const verified = pack && job
      ? await loadVerifiedCatalog(env, project, pack, job, artifacts)
      : null;

    const base = {
      contractVersion: 1,
      schemaReady: true,
      project: {
        id: project.id,
        slug: project.slug,
        name: project.name,
        status: project.status,
      },
      draft: draft
        ? {
            revision: draft.revision,
            updatedAt: draft.updatedAt,
            floors: draft.floors,
            rooms: draft.rooms,
          }
        : null,
      processing: processingSummary(pack, job),
      reviewedComponentBindings: draft?.block ?? null,
    };

    if (!draft)
      return json({ ...base, mappingReady: false, reason: "Create and save the Studio cloud draft before component mapping." });
    if (!pack)
      return json({ ...base, mappingReady: false, reason: "Seal a Source Pack before component mapping." });
    if (!job || job.state !== "succeeded")
      return json({ ...base, mappingReady: false, reason: "Canonical processing must succeed before component mapping." });
    if (!verified)
      return json({ ...base, mappingReady: false, reason: "A verified node-catalog-v1 artifact is required before component mapping." });

    const page = pageNodes(verified.catalog, url);
    return json({
      ...base,
      mappingReady: true,
      reason: null,
      bindingStatus: bindingStatus(
        draft.block,
        job,
        verified.catalogArtifact,
        verified.model,
      ),
      canonical: {
        modelArtifactId: verified.model.id,
        modelSha256: verified.model.sha256,
        manifestArtifactId: verified.manifest.id,
        manifestSha256: verified.manifest.sha256,
        nodeCatalogArtifactId: verified.catalogArtifact.id,
        nodeCatalogSha256: verified.catalogArtifact.sha256,
        statistics: verified.catalog.statistics,
      },
      catalogPage: page,
    });
  } catch (reason) {
    return json(
      { error: reason instanceof Error ? reason.message : "Component mapper data load failed." },
      { status: Number(reason?.status || 409) },
    );
  }
}
