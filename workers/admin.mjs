import {
  activeReleaseState,
  experienceFromActiveReleaseState,
  geoModelDerivativeForActiveRelease,
  handleReleaseReadRequest,
} from "./release-runtime.mjs";
import { engineAdminReadAccess, handleCloudAdminRequest } from "./admin-cloud.mjs";
import { assertProjectAssetKey } from "./storage-boundary.mjs";
import { validProjectSlug } from "../shared/project-slug-policy.js";
const BASE_PATH = "/3Dprojects";
const BUCKET_NAME = "rekixo-3d-assets";
const PLATFORM_ENGINE_CONTRACT_VERSION = 1;

const SECURITY_HEADERS = {
  "Content-Security-Policy-Report-Only": "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: blob: https://*.googleapis.com https://*.gstatic.com; media-src 'self' blob:; font-src 'self' data: https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://maps.googleapis.com https://maps.gstatic.com; connect-src 'self' https://*.googleapis.com https://*.gstatic.com; worker-src 'self' blob:",
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

function parseJsonObject(value, label) {
  if (typeof value !== "string")
    throw Error(`${label} is missing.`);
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw Error(`${label} contains malformed JSON.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw Error(`${label} must be a JSON object.`);
  return parsed;
}

function boundedInteger(value, fallback, min, max) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max)
    return fallback;
  return number;
}

function addSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(key)) headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function toAssetRequest(request) {
  const url = new URL(request.url);
  if (url.pathname === BASE_PATH || url.pathname === `${BASE_PATH}/`) {
    url.pathname = "/";
  } else if (url.pathname.startsWith(`${BASE_PATH}/`)) {
    url.pathname = url.pathname.slice(BASE_PATH.length) || "/";
  }
  return new Request(url.toString(), request);
}

async function listProjects(env) {
  const result = await env.DB.prepare(
    `SELECT p.id, p.slug, p.name, p.location, p.status, p.cover_asset_key,
            COUNT(DISTINCT m.id) AS model_count,
            COUNT(DISTINCT s.id) AS scene_count,
            COUNT(DISTINCT CASE WHEN s.enabled = 1 THEN s.id END) AS enabled_scene_count
       FROM projects_3d p
       LEFT JOIN models_3d m ON m.project_id = p.id
       LEFT JOIN scenes_3d s ON s.project_id = p.id
      GROUP BY p.id, p.slug, p.name, p.location, p.status, p.cover_asset_key
      ORDER BY p.created_at ASC, p.slug ASC`,
  ).all();

  return (result.results ?? []).map((project) => ({
    id: project.id,
    slug: project.slug,
    name: project.name,
    location: project.location ?? undefined,
    status: project.status,
    coverAssetKey: project.cover_asset_key ?? undefined,
    modelCount: Number(project.model_count || 0),
    sceneCount: Number(project.scene_count || 0),
    enabledSceneCount: Number(project.enabled_scene_count || 0),
  }));
}

export async function getIntegrationProject(env, slug) {
  const project = await env.DB.prepare(
    `SELECT p.id, p.slug, p.name, p.location, p.status, p.cover_asset_key,
            COUNT(DISTINCT CASE WHEN s.enabled = 1 THEN s.id END) AS enabled_scene_count,
            MAX(CASE WHEN m.is_active = 1 THEN 1 ELSE 0 END) AS has_active_model
       FROM projects_3d p
       LEFT JOIN scenes_3d s ON s.project_id = p.id
       LEFT JOIN models_3d m ON m.project_id = p.id
      WHERE p.slug = ?
      GROUP BY p.id, p.slug, p.name, p.location, p.status, p.cover_asset_key
      LIMIT 1`,
  ).bind(slug).first();

  if (!project) return null;

  // New Studio/cloud projects can publish an immutable release without creating
  // a legacy models_3d row. Prefer the active immutable release when available,
  // while keeping the legacy model registry path intact for existing projects.
  let immutableModel;
  let immutableRelease;
  let geoModel;
  if (project.status === "published") {
    const releaseState = await activeReleaseState(env, slug);
    if (releaseState.state === "ok") {
      const experience = experienceFromActiveReleaseState(releaseState);
      immutableModel = experience?.model;
      immutableRelease = experience?.release;
      geoModel = await geoModelDerivativeForActiveRelease(env, releaseState);
    }
  }

  let activeModelAvailable = Boolean(
    immutableModel && immutableModel.available !== false,
  );
  if (!activeModelAvailable && project.has_active_model) {
    const model = await env.DB.prepare(
      `SELECT asset_key FROM models_3d
        WHERE project_id=? AND is_active=1
        ORDER BY version DESC LIMIT 1`,
    ).bind(project.id).first();
    if (model?.asset_key)
      activeModelAvailable = Boolean(await env.MODEL_ASSETS.head(model.asset_key));
  }

  return {
    contractVersion: PLATFORM_ENGINE_CONTRACT_VERSION,
    project: {
      id: project.id,
      slug: project.slug,
      name: project.name,
      location: project.location ?? undefined,
      status: project.status,
      coverAssetKey: project.cover_asset_key ?? undefined,
    },
    enabledSceneCount: Number(project.enabled_scene_count || 0),
    activeModelAvailable,
    ...(immutableModel ? { model: immutableModel } : {}),
    ...(geoModel ? { geoModel } : {}),
    ...(immutableRelease ? { release: immutableRelease } : {}),
  };
}

async function getProjectStatus(env, slug, url) {
  const project = await env.DB.prepare(
    `SELECT id, slug, name, location, status, cover_asset_key
       FROM projects_3d
      WHERE slug = ?
      LIMIT 1`,
  ).bind(slug).first();

  if (!project) return null;

  const modelLimit = boundedInteger(
    url.searchParams.get("modelLimit"),
    50,
    1,
    100,
  );
  const modelOffset = boundedInteger(
    url.searchParams.get("modelOffset"),
    0,
    0,
    1000000,
  );

  const [modelCountRow, modelResult, activeRow, sceneResult] = await Promise.all([
    env.DB.prepare(
      "SELECT COUNT(*) AS total FROM models_3d WHERE project_id=?",
    ).bind(project.id).first(),
    env.DB.prepare(
      `SELECT id, project_id, name, asset_key, source_filename, mime_type,
              byte_size, version, is_active
         FROM models_3d
        WHERE project_id = ?
        ORDER BY is_active DESC, version DESC, created_at DESC, id ASC
        LIMIT ? OFFSET ?`,
    ).bind(project.id, modelLimit, modelOffset).all(),
    env.DB.prepare(
      `SELECT id, project_id, name, asset_key, source_filename, mime_type,
              byte_size, version, is_active
         FROM models_3d
        WHERE project_id = ? AND is_active = 1
        ORDER BY version DESC, created_at DESC
        LIMIT 1`,
    ).bind(project.id).first(),
    env.DB.prepare(
      `SELECT id, project_id, name, type, model_id, camera_preset_id,
              settings_json, sort_order, enabled
         FROM scenes_3d
        WHERE project_id = ?
        ORDER BY sort_order ASC, id ASC`,
    ).bind(project.id).all(),
  ]);

  const pageRows = modelResult.results ?? [];
  const rowsToCheck = [];
  const seen = new Set();
  if (activeRow) {
    rowsToCheck.push(activeRow);
    seen.add(activeRow.id);
  }
  for (const row of pageRows) {
    if (!seen.has(row.id)) {
      rowsToCheck.push(row);
      seen.add(row.id);
    }
  }

  const availability = new Map();
  for (let index = 0; index < rowsToCheck.length; index += 20) {
    const chunk = rowsToCheck.slice(index, index + 20);
    await Promise.all(
      chunk.map(async (row) => {
        try {
          assertProjectAssetKey(project.slug, row.asset_key, "models");
          const object = await env.MODEL_ASSETS.head(row.asset_key);
          availability.set(row.id, object?.size ?? null);
        } catch (error) {
          availability.set(row.id, {
            corrupt:
              error instanceof Error
                ? error.message
                : "Invalid project model storage key.",
          });
        }
      }),
    );
  }

  function mapModel(row) {
    const stored = availability.get(row.id);
    const corruption =
      stored && typeof stored === "object" ? stored.corrupt : undefined;
    const available = typeof stored === "number";
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      version: Number(row.version || 1),
      byteSize: available ? stored : row.byte_size ?? undefined,
      sourceFilename: row.source_filename ?? undefined,
      mimeType: row.mime_type || "model/gltf-binary",
      available,
      url: available
        ? `https://ar3dstudio.in/3Dprojects/api/models/${encodeURIComponent(row.id)}/content`
        : undefined,
      active: Boolean(row.is_active),
      assetKey: row.asset_key,
      ...(corruption ? { corruption } : {}),
    };
  }

  const models = pageRows.map(mapModel);
  const mutableActiveModel = activeRow
    ? models.find((model) => model.id === activeRow.id) ?? mapModel(activeRow)
    : undefined;

  // Studio/cloud projects may publish an immutable release without ever
  // creating a legacy models_3d row. Admin status must reflect the same
  // published truth used by Platform/Public integration; otherwise a valid
  // release misleadingly appears as "Upload pending".
  let immutableExperience;
  if (project.status === "published") {
    const releaseState = await activeReleaseState(env, slug);
    if (releaseState.state === "ok")
      immutableExperience = experienceFromActiveReleaseState(releaseState);
  }
  const immutableModel =
    immutableExperience?.model?.available !== false
      ? immutableExperience?.model
      : undefined;
  const activeModel = immutableModel ?? mutableActiveModel;
  const immutableScenes = Array.isArray(immutableExperience?.scenes)
    ? immutableExperience.scenes
    : immutableExperience?.scene
      ? [immutableExperience.scene]
      : [];
  const mutableScenes = (sceneResult.results ?? []).map((row) => ({
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    type: row.type,
    modelId: row.model_id ?? undefined,
    cameraPresetId: row.camera_preset_id ?? undefined,
    sortOrder: Number(row.sort_order || 0),
    enabled: Boolean(row.enabled),
    settings: parseJsonObject(
      row.settings_json,
      `Scene ${row.id} settings_json`,
    ),
  }));
  const scenes = immutableScenes.length ? immutableScenes : mutableScenes;
  const total = Number(modelCountRow?.total || 0);

  return {
    project: {
      id: project.id,
      slug: project.slug,
      name: project.name,
      location: project.location ?? undefined,
      status: project.status,
      coverAssetKey: project.cover_asset_key ?? undefined,
    },
    scenes,
    models,
    activeModel,
    modelPage: {
      limit: modelLimit,
      offset: modelOffset,
      total,
      hasMore: modelOffset + models.length < total,
    },
    storage: {
      bucket: BUCKET_NAME,
      activeModelObjectAvailable: Boolean(activeModel?.available),
    },
    uploadContract: {
      recommendedKey: `projects/${project.slug}/models/exterior-v1.glb`,
      format: "GLB 2.0",
      versionedKeysRequired: true,
      maxRecommendedMobileBytes: 25000000,
    },
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const cloudResponse = await handleCloudAdminRequest(request, env, url);
    if (cloudResponse) return cloudResponse;

    const releaseResponse = await handleReleaseReadRequest(request, env, url);
    if (releaseResponse) return releaseResponse;

    if (url.pathname === `${BASE_PATH}/api/projects`) {
      if (request.method !== "GET") {
        return json({ error: "Method not allowed." }, { status: 405 });
      }
      const access = await engineAdminReadAccess(request, env);
      if (!access.ok)
        return json({ error: access.error }, { status: access.status });
      try {
        return json({ projects: await listProjects(env) });
      } catch (error) {
        return json(
          {
            error: "Engine project registry is corrupted.",
            diagnostic:
              error instanceof Error ? error.message : "Unknown registry error.",
          },
          { status: 500 },
        );
      }
    }

    if (url.pathname.startsWith(`${BASE_PATH}/api/integration/projects/`)) {
      if (request.method !== "GET") {
        return json({ error: "Method not allowed." }, { status: 405 });
      }
      const slug = decodeURIComponent(
        url.pathname.slice(`${BASE_PATH}/api/integration/projects/`.length),
      ).trim().toLowerCase();
      if (!validProjectSlug(slug)) {
        return json({ error: "Valid project slug is required." }, { status: 400 });
      }
      const integration = await getIntegrationProject(env, slug);
      if (!integration) return json({ error: "3D project not found." }, { status: 404 });
      return json(integration, {
        headers: { "x-rekixo-ar3d-contract": String(PLATFORM_ENGINE_CONTRACT_VERSION) },
      });
    }

    if (url.pathname === `${BASE_PATH}/api/status`) {
      if (request.method !== "GET") {
        return json({ error: "Method not allowed." }, { status: 405 });
      }

      const slug = (url.searchParams.get("slug") || "").trim().toLowerCase();
      if (!validProjectSlug(slug))
        return json({ error: "Valid project slug is required." }, { status: 400 });

      const access = await engineAdminReadAccess(request, env);
      if (!access.ok)
        return json({ error: access.error }, { status: access.status });
      try {
        const status = await getProjectStatus(env, slug, url);
        if (!status)
          return json({ error: "3D project not found." }, { status: 404 });
        return json(status);
      } catch (error) {
        return json(
          {
            error: "3D project status data is corrupted.",
            diagnostic:
              error instanceof Error ? error.message : "Unknown status error.",
          },
          { status: 500 },
        );
      }
    }

    // APIs must fail closed as JSON, not silently serve SPA HTML. The public
    // /api/projects/:slug/geo-placement endpoint is not an Admin API route.
    if (url.pathname.startsWith(`${BASE_PATH}/api/`))
      return json({error:"Unknown Engine Admin API route."},{status:404});
    return addSecurityHeaders(await env.ASSETS.fetch(toAssetRequest(request)));
  },
};
