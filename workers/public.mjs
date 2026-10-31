import {
  activeReleaseState,
  experienceFromActiveReleaseState,
  geoModelDerivativeForActiveRelease,
  handleReleaseReadRequest,
  serveReleaseAsset,
} from "./release-runtime.mjs";
import { assertProjectAssetKey } from "./storage-boundary.mjs";
import { publicGeoPlotMapping } from "./geo-plot-public.mjs";
import { publicMasterplanResponse } from "./masterplan-geo-public.mjs";
import { servePublicMasterplanShareCard } from "./masterplan-share-public.mjs";
import { serveR2Object } from "./http-range.mjs";
import { validProjectSlug } from "../shared/project-slug-policy.js";
import {
  activeGeoReleaseState,
  publicGeoExperienceFromState,
} from "./geo-release-runtime.mjs";
import {
  injectPublicBrandingMetadata,
  servePublicBrandingRoute,
} from "./project-branding.mjs";
const BASE_PATH = "/3Dprojects";
const MODEL_ROUTE_PREFIX = `${BASE_PATH}/api/models/`;
const PROJECT_ROUTE_PREFIX = `${BASE_PATH}/api/projects/`;

const SECURITY_HEADERS = {
  "Content-Security-Policy-Report-Only": "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; form-action 'self'; img-src 'self' data: blob: https://*.googleapis.com https://*.gstatic.com; media-src 'self' blob:; font-src 'self' data: https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://maps.googleapis.com https://maps.gstatic.com; connect-src 'self' https://*.googleapis.com https://*.gstatic.com; worker-src 'self' blob:",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

function json(value, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  for (const [key, item] of Object.entries(SECURITY_HEADERS)) {
    headers.set(key, item);
  }
  return new Response(JSON.stringify(value), { ...init, headers });
}

function serverError(error, diagnostic) {
  const requestId = crypto.randomUUID();
  console.error(`[rekixo-public:${requestId}] ${error}`, diagnostic);
  return json({ error, requestId }, { status: 500 });
}

function parseJsonValue(value, label) {
  if (typeof value !== "string")
    throw Error(`${label} is missing.`);
  try {
    return JSON.parse(value);
  } catch {
    throw Error(`${label} contains malformed JSON.`);
  }
}

function parseJsonObject(value, label) {
  const parsed = parseJsonValue(value, label);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw Error(`${label} must be a JSON object.`);
  return parsed;
}

function parseVector3(value, label) {
  const parsed = parseJsonValue(value, label);
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 3 ||
    parsed.some((item) => typeof item !== "number" || !Number.isFinite(item))
  )
    throw Error(`${label} must be a finite 3D vector.`);
  return parsed;
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

function mapScene(row) {
  return {
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
  };
}

async function getProjectExperience(env, slug) {
  const release = await activeReleaseState(env, slug);
  if (release.state === "ok") {
    const experience = experienceFromActiveReleaseState(release);
    const geoModel = await geoModelDerivativeForActiveRelease(env, release);
    return geoModel ? { ...experience, geoModel } : experience;
  }
  if (release.state === "corrupt")
    return {
      __releaseCorrupt: true,
      diagnostic: release.reason || "Active immutable release is invalid.",
    };
  if (release.state === "unpublished" || release.state === "project-missing")
    return null;

  const project = await env.DB.prepare(
    `SELECT id, slug, name, location, status, cover_asset_key
       FROM projects_3d
      WHERE slug = ? AND status = 'published'
      LIMIT 1`,
  )
    .bind(slug)
    .first();

  if (!project) return null;

  const [sceneResult, defaultCamera, model] = await Promise.all([
    env.DB.prepare(
      `SELECT id, project_id, name, type, model_id, camera_preset_id,
              settings_json, sort_order, enabled
         FROM scenes_3d
        WHERE project_id = ? AND enabled = 1
        ORDER BY sort_order ASC, id ASC`,
    )
      .bind(project.id)
      .all(),
    env.DB.prepare(
      `SELECT id, project_id, name, position_json, target_json, fov
         FROM camera_presets_3d
        WHERE project_id = ? AND is_default = 1
        LIMIT 1`,
    )
      .bind(project.id)
      .first(),
    env.DB.prepare(
      `SELECT id, project_id, name, asset_key, source_filename, mime_type,
              byte_size, version
         FROM models_3d
        WHERE project_id = ? AND is_active = 1
        ORDER BY version DESC
        LIMIT 1`,
    )
      .bind(project.id)
      .first(),
  ]);

  const scenes = (sceneResult.results ?? []).map(mapScene);
  const scene = scenes[0];
  let modelPayload;

  if (model) {
    assertProjectAssetKey(project.slug, model.asset_key, "models");
    const object = await env.MODEL_ASSETS.head(model.asset_key);
    const available = Boolean(object);
    modelPayload = {
      id: model.id,
      projectId: model.project_id,
      name: model.name,
      version: Number(model.version || 1),
      byteSize: object?.size ?? model.byte_size ?? undefined,
      sourceFilename: model.source_filename ?? undefined,
      mimeType: model.mime_type || "model/gltf-binary",
      available,
      url: available
        ? `${BASE_PATH}/api/models/${encodeURIComponent(model.id)}/content?v=${encodeURIComponent(String(model.version || 1))}`
        : undefined,
    };
  }

  return {
    project: {
      id: project.id,
      slug: project.slug,
      name: project.name,
      location: project.location ?? undefined,
      status: project.status,
      coverAssetKey: project.cover_asset_key ?? undefined,
    },
    scene,
    scenes,
    camera: defaultCamera
      ? {
          id: defaultCamera.id,
          projectId: defaultCamera.project_id,
          name: defaultCamera.name,
          position: parseVector3(
            defaultCamera.position_json,
            `Camera ${defaultCamera.id} position_json`,
          ),
          target: parseVector3(
            defaultCamera.target_json,
            `Camera ${defaultCamera.id} target_json`,
          ),
          fov: Number(defaultCamera.fov || 45),
        }
      : undefined,
    model: modelPayload,
    mediaBaseUrl: `${BASE_PATH}/api/projects/${encodeURIComponent(project.slug)}/media`,
  };
}

async function serveModel(env, modelId, request) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ error: "Method not allowed." }, { status: 405 });
  }

  const model = await env.DB.prepare(
    `SELECT m.asset_key, m.mime_type, m.version, m.byte_size,
              p.slug
       FROM models_3d m
       JOIN projects_3d p ON p.id = m.project_id
      WHERE m.id = ?
        AND m.is_active = 1
        AND p.status = 'published'
      LIMIT 1`,
  )
    .bind(modelId)
    .first();

  if (!model) {
    return json({ error: "Model not found." }, { status: 404 });
  }

  const release = await activeReleaseState(env, model.slug);
  if (release.state === "ok") {
    if (release.manifest.experience.model?.id !== modelId)
      return json({ error: "Model is not part of the active release." }, { status: 404 });
    return serveReleaseAsset(
      env,
      release.manifest.release.id,
      "models",
      modelId,
      request,
    );
  }
  if (release.state === "corrupt")
    return json(
      { error: "The active immutable release is corrupted." },
      { status: 500 },
    );

  try {
    assertProjectAssetKey(model.slug, model.asset_key, "models");
  } catch (error) {
    return serverError(
      "Model asset is unavailable.",
      error instanceof Error ? error.message : "Invalid model storage key.",
    );
  }

  const served = await serveR2Object(env.MODEL_ASSETS, model.asset_key, request, {
    mimeType: model.mime_type || "model/gltf-binary",
    cacheControl: "public, max-age=300, must-revalidate",
    expectedSize: model.byte_size ?? undefined,
  });
  if (served.corruption)
    return serverError("Model asset is unavailable.", served.corruption);
  if (served.missing)
    return json({ error: "Model asset is not available." }, { status: 404 });
  return served.response;
}

function mediaType(fileName) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".mp4")) return "video/mp4";
  return "application/octet-stream";
}

async function serveProjectMedia(env, slug, fileName, request) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ error: "Method not allowed." }, { status: 405 });
  }

  if (!/^[a-z0-9][a-z0-9._-]{0,140}$/i.test(fileName)) {
    return json({ error: "Invalid media name." }, { status: 400 });
  }

  const project = await env.DB.prepare(
    `SELECT id FROM projects_3d WHERE slug = ? AND status = 'published' LIMIT 1`,
  )
    .bind(slug)
    .first();
  if (!project) return json({ error: "Project not found." }, { status: 404 });

  const release = await activeReleaseState(env, slug);
  if (release.state === "ok") {
    if (!release.manifest.experience.mediaFiles.includes(fileName))
      return json({ error: "Media is not part of the active release." }, { status: 404 });
    return serveReleaseAsset(
      env,
      release.manifest.release.id,
      "media",
      fileName,
      request,
    );
  }
  if (release.state === "corrupt")
    return json(
      { error: "The active immutable release is corrupted." },
      { status: 500 },
    );

  const key = `projects/${slug}/media/${fileName}`;
  try {
    assertProjectAssetKey(slug, key, "media");
  } catch (error) {
    return serverError(
      "Media asset is unavailable.",
      error instanceof Error ? error.message : "Invalid media storage key.",
    );
  }
  const mimeType = mediaType(fileName);
  const served = await serveR2Object(env.MODEL_ASSETS, key, request, {
    mimeType,
    cacheControl: "public, max-age=300, must-revalidate",
    allowRange: mimeType === "video/mp4",
  });
  if (served.corruption)
    return serverError("Media asset is unavailable.", served.corruption);
  if (served.missing)
    return json({ error: "Media asset is not available." }, { status: 404 });
  return served.response;
}

async function publicGeo3DState(env, slug) {
  if (!validProjectSlug(slug)) return { state: "invalid-slug" };

  const geo = await activeGeoReleaseState(env, slug);
  if (geo.state !== "ok") return geo;

  const experience = await publicGeoExperienceFromState(env, geo);
  if (!experience)
    return {
      state: "corrupt",
      project: geo.project,
      reason: "Active Geo release has no renderable immutable Building model.",
    };

  const settings = await env.DB.prepare(
    `SELECT key,value FROM engine_settings_3d
      WHERE key IN ('google_maps_browser_key','google_maps_map_id')`,
  ).all();
  const settingsByKey = new Map(
    (settings.results || []).map((row) => [String(row.key), String(row.value || "").trim()]),
  );
  const mapsApiKey =
    settingsByKey.get("google_maps_browser_key") ||
    String(env.GOOGLE_MAPS_BROWSER_KEY || "").trim();
  const mapsMapId =
    settingsByKey.get("google_maps_map_id") ||
    String(env.GOOGLE_MAPS_MAP_ID || "").trim();

  // Plot mapping is independently published and integrity-checked; corrupt or stale
  // plot data never takes down the canonical Geo viewer.
  let plotMapping = null;
  try { plotMapping = await publicGeoPlotMapping(env, slug, experience.geoRelease.id); }
  catch (error) { console.error("Published Geo plot mapping unavailable", error); }
  return {
    state: "ok",
    payload: {
      ...experience,
      ...(plotMapping ? { plotMapping, model: experience.canonicalModel || experience.model } : {}),
      maps: {
        apiKey: mapsApiKey || null,
        mapId: mapsMapId || null,
        apiKeyConfigured: Boolean(mapsApiKey),
        mapIdConfigured: Boolean(mapsMapId),
        configured: Boolean(mapsApiKey && mapsMapId),
      },
    },
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const releaseResponse = await handleReleaseReadRequest(request, env, url);
    if (releaseResponse) return releaseResponse;

    if (
      url.pathname.startsWith(MODEL_ROUTE_PREFIX) &&
      url.pathname.endsWith("/content")
    ) {
      const modelId = decodeURIComponent(
        url.pathname
          .slice(MODEL_ROUTE_PREFIX.length, -"/content".length)
          .replace(/\/+$/, ""),
      );
      if (!modelId) return json({ error: "Model id is required." }, { status: 400 });
      return serveModel(env, modelId, request);
    }

    if (url.pathname.startsWith(PROJECT_ROUTE_PREFIX)) {
      const remainder = url.pathname.slice(PROJECT_ROUTE_PREFIX.length);
      const parts = remainder.split("/").filter(Boolean).map(decodeURIComponent);
      const slug = parts[0]?.trim();
      if (!slug) return json({ error: "Project slug is required." }, { status: 400 });

      if (parts[1]==="masterplan-share-card"&&parts.length===2)
        return addSecurityHeaders(await servePublicMasterplanShareCard(request,env,slug));

      if ((parts[1]==="masterplan"||parts[1]==="masterplan-image")&&parts.length===2)
        return addSecurityHeaders(await publicMasterplanResponse(request,env,slug,parts[1]));

      if (parts[1] === "branding") {
        return addSecurityHeaders(
          await servePublicBrandingRoute(request, env, slug, parts.slice(2), url),
        );
      }

      if (parts[1] === "media" && parts[2]) {
        return serveProjectMedia(env, slug, parts[2], request);
      }

      if (parts[1] === "geo-placement" && parts.length === 2) {
        if (request.method !== "GET")
          return json({ error: "Method not allowed." }, { status: 405 });
        const geo = await publicGeo3DState(env, slug);
        if (geo.state === "corrupt")
          return serverError(
            "Published 3D Geo Experience is unavailable.",
            geo.reason || "Active immutable Geo release is invalid.",
          );
        if (geo.state !== "ok")
          return json(
            { error: "Public 3D Geo Experience is not currently published." },
            { status: 404 },
          );
        return json(geo.payload, {
          headers: {
            "Cache-Control": "public,max-age=5,stale-while-revalidate=15",
          },
        });
      }

      if (parts.length > 1) {
        return json({ error: "Unknown project API route." }, { status: 404 });
      }
      if (request.method !== "GET") {
        return json({ error: "Method not allowed." }, { status: 405 });
      }

      let experience;
      try {
        experience = await getProjectExperience(env, slug);
      } catch (error) {
        return serverError(
          "Published 3D project data is unavailable.",
          error instanceof Error
            ? error.message
            : "Unknown project data corruption.",
        );
      }
      if (!experience) {
        return json(
          { error: "This 3D project is not currently published." },
          { status: 404 },
        );
      }
      if (experience.__releaseCorrupt) {
        return serverError(
          "Published 3D project data is unavailable.",
          experience.diagnostic,
        );
      }
      return json(experience);
    }

    const assetResponse = await env.ASSETS.fetch(toAssetRequest(request));
    const brandedResponse = await injectPublicBrandingMetadata(
      request,
      env,
      assetResponse,
      url,
    );
    return addSecurityHeaders(brandedResponse);
  },
};
