import { publicMasterplanShareSnapshot } from "./masterplan-share-public.mjs";
import {
  activeReleaseState,
} from "./release-runtime.mjs";
import {
  activeGeoReleaseState,
} from "./geo-release-runtime.mjs";
import { serveR2Object } from "./http-range.mjs";

const BASE_PATH = "/3Dprojects";
const CLOUD_PATH = `${BASE_PATH}/api/cloud`;
const PUBLIC_API_PATH = `${BASE_PATH}/api/projects`;
const MAX_LOGO_BYTES = 512 * 1024;
const MAX_FAVICON_BYTES = 128 * 1024;
const MAX_SOURCE_CARD_BYTES = 8 * 1024 * 1024;
const MAX_PUBLIC_CARD_BYTES = 550 * 1024;
const EXPERIENCE_TYPES = new Set(["building", "geo"]);
const VERSION_TOKEN = /^[A-Za-z0-9_-]{16,80}$/;

function json(value, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "same-origin");
  return new Response(JSON.stringify(value), { ...init, headers });
}

function versionToken() {
  return crypto.randomUUID().replace(/-/g, "");
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

function validExperience(value) {
  return EXPERIENCE_TYPES.has(String(value || ""));
}

function validVersion(value) {
  return typeof value === "string" && VERSION_TOKEN.test(value);
}

function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function publicBaseUrl(origin, slug) {
  return `${origin}${BASE_PATH}/api/projects/${encodeURIComponent(slug)}/branding`;
}

async function brandingSchemaReady(env) {
  try {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS total
         FROM sqlite_master
        WHERE type='table'
          AND name IN (
            'project_branding_3d',
            'project_branding_logo_versions_3d',
            'project_branding_shares_3d',
            'project_branding_share_versions_3d'
          )`,
    ).first();
    return Number(row?.total || 0) === 4;
  } catch {
    return false;
  }
}

async function detectImageMime(file) {
  if (!(file instanceof File) || file.size < 12) return "";
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) return "image/webp";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e &&
    bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a &&
    bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  return "";
}

async function experienceReadiness(env, project, slug, experience) {
  if (project.status !== "published") return false;
  try {
    if (experience === "geo") {
      return (await activeGeoReleaseState(env, slug)).state === "ok";
    }
    return (await activeReleaseState(env, slug)).state === "ok";
  } catch {
    return false;
  }
}

async function readShareVersion(env, projectId, experience, version) {
  if (!validVersion(version)) return null;
  return env.DB.prepare(
    `SELECT version,share_title AS title,share_description AS description,
            card_key AS cardKey,source_key AS sourceKey,mime_type AS mimeType,
            created_at AS createdAt
       FROM project_branding_share_versions_3d
      WHERE project_id=? AND experience_type=? AND version=?
      LIMIT 1`,
  ).bind(projectId, experience, version).first();
}

async function readLogoVersion(env, projectId, version) {
  if (!validVersion(version)) return null;
  return env.DB.prepare(
    `SELECT version,logo_key AS logoKey,favicon_key AS faviconKey,
            source_key AS sourceKey,source_mime_type AS sourceMimeType,
            logo_mime_type AS logoMimeType,favicon_mime_type AS faviconMimeType,
            published_at AS publishedAt
       FROM project_branding_logo_versions_3d
      WHERE project_id=? AND version=?
      LIMIT 1`,
  ).bind(projectId, version).first();
}

async function projectPublicContext(env, slug, experience) {
  if (!validExperience(experience)) return null;
  const project = await env.DB.prepare(
    `SELECT id,slug,name,location,status
       FROM projects_3d
      WHERE slug=? AND status='published'
      LIMIT 1`,
  ).bind(slug).first();
  if (!project) return null;
  if (!(await experienceReadiness(env, project, slug, experience))) return null;
  return project;
}

async function publicBrandingSnapshot(env, slug, experience, requestedVersion, strictVersion = false) {
  if (!(await brandingSchemaReady(env))) return null;
  const project = await projectPublicContext(env, slug, experience);
  if (!project) return null;

  const [branding, share] = await Promise.all([
    env.DB.prepare(
      `SELECT b.published_logo_version AS publishedLogoVersion,
              l.logo_key AS logoKey,l.favicon_key AS faviconKey
         FROM project_branding_3d b
         LEFT JOIN project_branding_logo_versions_3d l
           ON l.project_id=b.project_id
          AND l.version=b.published_logo_version
          AND l.published_at IS NOT NULL
        WHERE b.project_id=?
        LIMIT 1`,
    ).bind(project.id).first(),
    env.DB.prepare(
      `SELECT published_version AS publishedVersion
         FROM project_branding_shares_3d
        WHERE project_id=? AND experience_type=?
        LIMIT 1`,
    ).bind(project.id, experience).first(),
  ]);

  let selectedVersion = requestedVersion || share?.publishedVersion || "";
  let snapshot = selectedVersion
    ? await readShareVersion(env, project.id, experience, selectedVersion)
    : null;
  if (selectedVersion && !snapshot && strictVersion) return null;
  if (selectedVersion && !snapshot) {
    selectedVersion = share?.publishedVersion || "";
    snapshot = selectedVersion
      ? await readShareVersion(env, project.id, experience, selectedVersion)
      : null;
  }

  const label = experience === "geo" ? "Geo Experience" : "3D Experience";
  const title = snapshot?.title || `${project.name} — ${label}`;
  const description = snapshot?.description ||
    `Explore ${project.name} in the interactive AR3D ${experience === "geo" ? "Geo" : "Building"} experience.`;
  const origin = "https://ar3dstudio.in";
  const base = publicBaseUrl(origin, slug);
  const logoUrl = branding?.logoKey && branding?.publishedLogoVersion
    ? `${base}/logo?v=${encodeURIComponent(branding.publishedLogoVersion)}&experience=${experience}`
    : "";
  const faviconUrl = branding?.faviconKey && branding?.publishedLogoVersion
    ? `${base}/favicon?v=${encodeURIComponent(branding.publishedLogoVersion)}&experience=${experience}`
    : "";
  const shareImageUrl = snapshot?.cardKey
    ? `${base}/share-card?experience=${experience}&v=${encodeURIComponent(snapshot.version)}`
    : logoUrl;

  return {
    project: { id: project.id, slug: project.slug, name: project.name, location: project.location || "" },
    experience,
    title,
    description,
    brandName: "AR3D Studio",
    logoUrl,
    faviconUrl,
    shareImageUrl,
    hasShareCard: Boolean(snapshot?.cardKey),
    shareVersion: snapshot?.version || "",
    cardKey: snapshot?.cardKey || "",
    cardMimeType: snapshot?.mimeType || "",
    logoKey: branding?.logoKey || "",
    faviconKey: branding?.faviconKey || "",
    logoVersion: branding?.publishedLogoVersion || "",
  };
}

async function adminBrandingState(env, project, slug) {
  if (!(await brandingSchemaReady(env))) {
    return json({ error: "Project branding migration is not installed." }, { status: 503 });
  }
  const [branding, shares, buildingLive, geoLive] = await Promise.all([
    env.DB.prepare(
      `SELECT draft_logo_version AS draftLogoVersion,
              published_logo_version AS publishedLogoVersion,
              updated_at AS updatedAt,published_at AS publishedAt
         FROM project_branding_3d WHERE project_id=? LIMIT 1`,
    ).bind(project.id).first(),
    env.DB.prepare(
      `SELECT experience_type AS experienceType,draft_title AS draftTitle,
              draft_description AS draftDescription,draft_card_version AS draftCardVersion,
              draft_use_building_card AS draftUseBuildingCard,
              published_version AS publishedVersion,updated_at AS updatedAt
         FROM project_branding_shares_3d WHERE project_id=?`,
    ).bind(project.id).all(),
    experienceReadiness(env, project, slug, "building"),
    experienceReadiness(env, project, slug, "geo"),
  ]);

  const origin = "https://ar3dstudio.in";
  const logoDraftVersion = branding?.draftLogoVersion || "";
  const logoPublishedVersion = branding?.publishedLogoVersion || "";
  const logoPreviewVersion = logoDraftVersion || logoPublishedVersion;
  const shareRows = new Map((shares.results || []).map((row) => [row.experienceType, row]));
  const experiences = {};
  for (const type of ["building", "geo"]) {
    const row = shareRows.get(type) || {};
    const published = row.publishedVersion
      ? await readShareVersion(env, project.id, type, row.publishedVersion)
      : null;
    const cardVersion = row.draftCardVersion || row.publishedVersion || "";
    const live = type === "geo" ? geoLive : buildingLive;
    const origin = "https://ar3dstudio.in";
    const url = `${origin}${BASE_PATH}/${encodeURIComponent(slug)}${type === "geo" ? "/geo" : ""}`;
    const shareUrl = live && row.publishedVersion
      ? `${url}?share=${encodeURIComponent(row.publishedVersion)}`
      : "";
    experiences[type] = {
      experience: type,
      live,
      draftTitle: row.draftTitle || published?.title || `${project.name}${type === "geo" ? " — Geo Experience" : " — 3D Experience"}`,
      draftDescription: row.draftDescription || published?.description || `Explore ${project.name} in the interactive AR3D ${type === "geo" ? "Geo" : "Building"} experience.`,
      draftCardVersion: row.draftCardVersion || "",
      useBuildingPoster: Boolean(row.draftUseBuildingCard),
      draftCardPreviewUrl: cardVersion
        ? `${CLOUD_PATH}/projects/${encodeURIComponent(slug)}/branding/assets/share-card?experience=${type}&v=${encodeURIComponent(cardVersion)}`
        : "",
      publishedVersion: row.publishedVersion || "",
      publishedTitle: published?.title || "",
      publishedDescription: published?.description || "",
      publishedCardUrl: published?.version
        ? `${origin}${BASE_PATH}/api/projects/${encodeURIComponent(slug)}/branding/share-card?experience=${type}&v=${encodeURIComponent(published.version)}`
        : "",
      shareUrl,
      shareReady: Boolean(live && published?.cardKey && row.publishedVersion),
      updatedAt: row.updatedAt || "",
    };
  }

  return json({
    project: { id: project.id, slug, name: project.name, location: project.location || "", status: project.status },
    logo: {
      draftVersion: logoDraftVersion,
      publishedVersion: logoPublishedVersion,
      previewUrl: logoPreviewVersion
        ? `${CLOUD_PATH}/projects/${encodeURIComponent(slug)}/branding/assets/logo?v=${encodeURIComponent(logoPreviewVersion)}`
        : "",
      sourceUrl: logoPreviewVersion
        ? `${CLOUD_PATH}/projects/${encodeURIComponent(slug)}/branding/assets/source?v=${encodeURIComponent(logoPreviewVersion)}`
        : "",
      faviconPreviewUrl: logoPreviewVersion
        ? `${CLOUD_PATH}/projects/${encodeURIComponent(slug)}/branding/assets/favicon?v=${encodeURIComponent(logoPreviewVersion)}`
        : "",
      publishedLogoUrl: logoPublishedVersion
        ? `${origin}${BASE_PATH}/api/projects/${encodeURIComponent(slug)}/branding/logo?v=${encodeURIComponent(logoPublishedVersion)}`
        : "",
      publishedFaviconUrl: logoPublishedVersion
        ? `${origin}${BASE_PATH}/api/projects/${encodeURIComponent(slug)}/branding/favicon?v=${encodeURIComponent(logoPublishedVersion)}`
        : "",
      publishedAt: branding?.publishedAt || "",
    },
    experiences,
  });
}

async function cleanupR2Objects(env, keys) {
  await Promise.allSettled(keys.map((key) => env.MODEL_ASSETS.delete(key)));
}
async function uploadLogo(form, env, actor, project, slug) {
  const logoFile = form.get("logoFile");
  const faviconFile = form.get("faviconFile");
  const sourceFile = form.get("sourceFile");
  const logoMime = await detectImageMime(logoFile);
  const faviconMime = await detectImageMime(faviconFile);
  const sourceMime = await detectImageMime(sourceFile);
  if (logoMime !== "image/webp" || !(logoFile instanceof File) || logoFile.size < 1 || logoFile.size > MAX_LOGO_BYTES)
    return json({ error: "Logo must be an optimized WebP image under 512 KB." }, { status: 400 });
  if (faviconMime !== "image/png" || !(faviconFile instanceof File) || faviconFile.size < 1 || faviconFile.size > MAX_FAVICON_BYTES)
    return json({ error: "Circular favicon must be a PNG image under 128 KB." }, { status: 400 });
  if (!["image/jpeg", "image/png", "image/webp"].includes(sourceMime) || !(sourceFile instanceof File) || sourceFile.size < 1 || sourceFile.size > MAX_SOURCE_CARD_BYTES)
    return json({ error: "Original logo must be JPG, PNG or WebP under 8 MB." }, { status: 400 });

  const version = versionToken();
  const logoKey = `projects/${slug}/branding/logos/${version}.webp`;
  const faviconKey = `projects/${slug}/branding/favicons/${version}.png`;
  const sourceExtension = sourceMime === "image/jpeg" ? "jpg" : sourceMime === "image/png" ? "png" : "webp";
  const sourceKey = `projects/${slug}/branding/logo-sources/${version}.${sourceExtension}`;
  try {
    const uploadResults = await Promise.allSettled([
      env.MODEL_ASSETS.put(logoKey, await logoFile.arrayBuffer(), {
        httpMetadata: { contentType: logoMime },
        customMetadata: { projectId: project.id, projectSlug: slug, kind: "project-branding-logo", version },
      }),
      env.MODEL_ASSETS.put(faviconKey, await faviconFile.arrayBuffer(), {
        httpMetadata: { contentType: faviconMime },
        customMetadata: { projectId: project.id, projectSlug: slug, kind: "project-branding-favicon", version },
      }),
      env.MODEL_ASSETS.put(sourceKey, await sourceFile.arrayBuffer(), {
        httpMetadata: { contentType: sourceMime },
        customMetadata: { projectId: project.id, projectSlug: slug, kind: "project-branding-logo-source", version },
      }),
    ]);
    const failedUpload = uploadResults.find((result) => result.status === "rejected");
    if (failedUpload?.status === "rejected") throw failedUpload.reason;
  } catch (error) {
    await cleanupR2Objects(env, [logoKey, faviconKey, sourceKey]);
    throw error;
  }
  const now = new Date().toISOString();
  try {
    await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO project_branding_logo_versions_3d
        (project_id,version,logo_key,favicon_key,source_key,source_mime_type,
         logo_mime_type,favicon_mime_type,created_by,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).bind(project.id, version, logoKey, faviconKey, sourceKey, sourceMime, logoMime, faviconMime, actor.email, now),
    env.DB.prepare(
      `INSERT INTO project_branding_3d
        (project_id,draft_logo_version,updated_by,updated_at)
       VALUES (?,?,?,?)
       ON CONFLICT(project_id) DO UPDATE SET
         draft_logo_version=excluded.draft_logo_version,
         updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
    ).bind(project.id, version, actor.email, now),
    env.DB.prepare(
      `INSERT INTO engine_admin_audit
        (id,actor_email,action,project_id,target_id,details_json,created_at)
       VALUES (?,?,?,?,?,?,?)`,
    ).bind(crypto.randomUUID(), actor.email, "branding.logo_uploaded", project.id, project.id, JSON.stringify({ version, logoBytes: logoFile.size, faviconBytes: faviconFile.size, sourceBytes: sourceFile.size }), now),
    ]);
  } catch (error) {
    await cleanupR2Objects(env, [logoKey, faviconKey, sourceKey]);
    throw error;
  }
  return json({ ok: true, version });
}

async function uploadShareCard(form, env, actor, project, slug) {
  const experience = String(form.get("experience") || "");
  const cardFile = form.get("cardFile");
  const sourceFile = form.get("sourceFile");
  if (!validExperience(experience))
    return json({ error: "Choose Building or Geo for this share card." }, { status: 400 });
  const cardMime = await detectImageMime(cardFile);
  const sourceMime = await detectImageMime(sourceFile);
  if (!["image/webp", "image/jpeg"].includes(cardMime) || !(cardFile instanceof File) || cardFile.size < 1 || cardFile.size > MAX_PUBLIC_CARD_BYTES)
    return json({ error: "Final share card must be WebP or JPEG under 550 KB." }, { status: 400 });
  if (!["image/webp", "image/jpeg", "image/png"].includes(sourceMime) || !(sourceFile instanceof File) || sourceFile.size < 1 || sourceFile.size > MAX_SOURCE_CARD_BYTES)
    return json({ error: "Original poster must be JPEG, PNG or WebP under 8 MB." }, { status: 400 });

  const version = versionToken();
  const cardExtension = cardMime === "image/jpeg" ? "jpg" : "webp";
  const sourceExtension = sourceMime === "image/jpeg" ? "jpg" : sourceMime === "image/png" ? "png" : "webp";
  const cardKey = `projects/${slug}/branding/share/${experience}/cards/${version}.${cardExtension}`;
  const sourceKey = `projects/${slug}/branding/share/${experience}/sources/${version}.${sourceExtension}`;
  try {
    const uploadResults = await Promise.allSettled([
    env.MODEL_ASSETS.put(cardKey, await cardFile.arrayBuffer(), {
      httpMetadata: { contentType: cardMime },
      customMetadata: { projectId: project.id, projectSlug: slug, kind: "project-share-card", experience, version },
    }),
    env.MODEL_ASSETS.put(sourceKey, await sourceFile.arrayBuffer(), {
      httpMetadata: { contentType: sourceMime },
      customMetadata: { projectId: project.id, projectSlug: slug, kind: "project-share-source", experience, version },
    }),
  ]);
    const failedUpload = uploadResults.find((result) => result.status === "rejected");
    if (failedUpload?.status === "rejected") throw failedUpload.reason;
  } catch (error) {
    await cleanupR2Objects(env, [cardKey, sourceKey]);
    throw error;
  }

  const now = new Date().toISOString();
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO project_branding_shares_3d
          (project_id,experience_type,draft_card_version,draft_card_key,draft_source_key,draft_use_building_card,updated_by,updated_at)
         VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT(project_id,experience_type) DO UPDATE SET
           draft_card_version=excluded.draft_card_version,
           draft_card_key=excluded.draft_card_key,
           draft_source_key=excluded.draft_source_key,
           draft_use_building_card=0,
           updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
      ).bind(project.id, experience, version, cardKey, sourceKey, 0, actor.email, now),
      env.DB.prepare(
        `INSERT INTO engine_admin_audit
          (id,actor_email,action,project_id,target_id,details_json,created_at)
         VALUES (?,?,?,?,?,?,?)`,
      ).bind(
        crypto.randomUUID(), actor.email, "branding.share_card_uploaded",
        project.id, project.id,
        JSON.stringify({ experience, version, cardBytes: cardFile.size, sourceBytes: sourceFile.size }),
        now,
      ),
    ]);
  } catch (error) {
    await cleanupR2Objects(env, [cardKey, sourceKey]);
    throw error;
  }
  return json({ ok: true, experience, version });
}

async function saveShareDetails(request, env, actor, project) {
  const body = await request.json().catch(() => ({}));
  const experience = String(body.experience || "");
  const title = String(body.title || "").trim();
  const description = String(body.description || "").trim();
  const useBuildingPoster = experience === "geo" && body.useBuildingPoster === true;
  if (!validExperience(experience))
    return json({ error: "Choose Building or Geo for this share settings." }, { status: 400 });
  if (title.length < 3 || title.length > 120 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(title))
    return json({ error: "Share title must be 3–120 printable characters." }, { status: 400 });
  if (description.length < 10 || description.length > 280 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(description))
    return json({ error: "Share description must be 10–280 printable characters." }, { status: 400 });
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO project_branding_shares_3d
        (project_id,experience_type,draft_title,draft_description,draft_use_building_card,updated_by,updated_at)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(project_id,experience_type) DO UPDATE SET
         draft_title=excluded.draft_title,draft_description=excluded.draft_description,
         draft_use_building_card=excluded.draft_use_building_card,
         updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
    ).bind(project.id, experience, title, description, useBuildingPoster ? 1 : 0, actor.email, now),
    env.DB.prepare(
      `INSERT INTO engine_admin_audit
        (id,actor_email,action,project_id,target_id,details_json,created_at)
       VALUES (?,?,?,?,?,?,?)`,
    ).bind(crypto.randomUUID(), actor.email, "branding.share_details_saved", project.id, project.id, JSON.stringify({ experience, titleLength: title.length, descriptionLength: description.length }), now),
  ]);
  return json({ ok: true, experience, title, description });
}

async function publishLogo(request, env, actor, project) {
  const body = await request.json().catch(() => ({}));
  const requested = String(body.version || "");
  if (!validVersion(requested))
    return json({ error: "Upload a valid project logo before publishing." }, { status: 400 });
  const logo = await readLogoVersion(env, project.id, requested);
  if (!logo)
    return json({ error: "Logo version not found." }, { status: 404 });
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE project_branding_logo_versions_3d SET published_at=COALESCE(published_at,?) WHERE project_id=? AND version=?",
    ).bind(now, project.id, requested),
    env.DB.prepare(
      `INSERT INTO project_branding_3d
        (project_id,published_logo_version,updated_by,updated_at,published_at)
       VALUES (?,?,?,?,?)
       ON CONFLICT(project_id) DO UPDATE SET
         draft_logo_version=NULL,
         published_logo_version=excluded.published_logo_version,
         updated_by=excluded.updated_by,updated_at=excluded.updated_at,published_at=excluded.published_at`,
    ).bind(project.id, requested, actor.email, now, now),
    env.DB.prepare(
      `INSERT INTO engine_admin_audit
        (id,actor_email,action,project_id,target_id,details_json,created_at)
       VALUES (?,?,?,?,?,?,?)`,
    ).bind(crypto.randomUUID(), actor.email, "branding.logo_published", project.id, project.id, JSON.stringify({ version: requested }), now),
  ]);
  return json({ ok: true, version: requested, publishedAt: now });
}

async function publishShare(request, env, actor, project, slug) {
  const body = await request.json().catch(() => ({}));
  const experience = String(body.experience || "");
  if (!validExperience(experience))
    return json({ error: "Choose Building or Geo to publish its share card." }, { status: 400 });
  if (!(await experienceReadiness(env, project, slug, experience)))
    return json({ error: `The ${experience === "geo" ? "Geo" : "Building"} experience needs an active published release before sharing.` }, { status: 409 });

  const draft = await env.DB.prepare(
    `SELECT draft_title AS title,draft_description AS description,
            draft_card_key AS cardKey,draft_source_key AS sourceKey,
            draft_use_building_card AS useBuildingCard,
            published_version AS publishedVersion
       FROM project_branding_shares_3d
      WHERE project_id=? AND experience_type=? LIMIT 1`,
  ).bind(project.id, experience).first();
  if (!draft) return json({ error: "Save share title/description and upload a share poster first." }, { status: 409 });
  const title = String(draft.title || "").trim();
  const description = String(draft.description || "").trim();
  if (title.length < 3 || title.length > 120 || description.length < 10 || description.length > 280)
    return json({ error: "Save a valid share title and description before publishing." }, { status: 409 });

  let previous = null;
  const reuseBuildingPoster = experience === "geo" && Number(draft.useBuildingCard) === 1;
  if (reuseBuildingPoster) {
    const buildingRow = await env.DB.prepare(
      "SELECT published_version AS publishedVersion FROM project_branding_shares_3d WHERE project_id=? AND experience_type='building' LIMIT 1",
    ).bind(project.id).first();
    if (!buildingRow?.publishedVersion)
      return json({ error: "Publish a Building share poster before reusing it for Geo." }, { status: 409 });
    previous = await readShareVersion(env, project.id, "building", buildingRow.publishedVersion);
    if (!previous?.cardKey || !previous?.sourceKey)
      return json({ error: "The published Building share poster is unavailable." }, { status: 409 });
  } else if (!draft.cardKey && draft.publishedVersion) {
    previous = await readShareVersion(env, project.id, experience, draft.publishedVersion);
  }
  const cardKey = reuseBuildingPoster ? (previous?.cardKey || "") : (draft.cardKey || previous?.cardKey || "");
  const sourceKey = reuseBuildingPoster ? (previous?.sourceKey || "") : (draft.sourceKey || previous?.sourceKey || "");
  const mimeType = reuseBuildingPoster
    ? previous?.mimeType || ""
    : draft.cardKey
      ? (draft.cardKey.endsWith(".jpg") ? "image/jpeg" : "image/webp")
      : previous?.mimeType || "";
  if (!cardKey || !sourceKey || !mimeType)
    return json({ error: "Upload a final share poster before publishing this experience." }, { status: 409 });

  const version = versionToken();
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO project_branding_share_versions_3d
        (project_id,experience_type,version,share_title,share_description,card_key,source_key,mime_type,created_by,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).bind(project.id, experience, version, title, description, cardKey, sourceKey, mimeType, actor.email, now),
    env.DB.prepare(
      `UPDATE project_branding_shares_3d
          SET published_version=?,updated_by=?,updated_at=?
        WHERE project_id=? AND experience_type=?`,
    ).bind(version, actor.email, now, project.id, experience),
    env.DB.prepare(
      `INSERT INTO engine_admin_audit
        (id,actor_email,action,project_id,target_id,details_json,created_at)
       VALUES (?,?,?,?,?,?,?)`,
    ).bind(crypto.randomUUID(), actor.email, "branding.share_published", project.id, project.id, JSON.stringify({ experience, version, cardMimeType: mimeType }), now),
  ]);
  return json({ ok: true, experience, version, publishedAt: now });
}

async function adminBrandingAsset(request, env, project, slug, parts) {
  if (request.method !== "GET" && request.method !== "HEAD")
    return json({ error: "Method not allowed." }, { status: 405 });
  const url = new URL(request.url);
  const version = url.searchParams.get("v") || "";
  if (!validVersion(version))
    return json({ error: "Valid asset version required." }, { status: 400 });
  let key = "";
  let mimeType = "application/octet-stream";

  if (parts[0] === "logo" || parts[0] === "favicon" || parts[0] === "source") {
    const logo = await readLogoVersion(env, project.id, version);
    if (!logo) return new Response("Not found", { status: 404 });
    key = parts[0] === "logo" ? logo.logoKey : parts[0] === "favicon" ? logo.faviconKey : logo.sourceKey;
    mimeType = parts[0] === "logo" ? logo.logoMimeType : parts[0] === "favicon" ? logo.faviconMimeType : logo.sourceMimeType;
  } else if (parts[0] === "share-card") {
    const experience = url.searchParams.get("experience") || "";
    if (!validExperience(experience)) return json({ error: "Valid experience required." }, { status: 400 });
    const draft = await env.DB.prepare(
      `SELECT draft_card_version AS draftVersion,draft_card_key AS draftKey
         FROM project_branding_shares_3d
        WHERE project_id=? AND experience_type=? LIMIT 1`,
    ).bind(project.id, experience).first();
    if (draft?.draftVersion === version && draft?.draftKey) {
      key = draft.draftKey;
    } else {
      const snapshot = await readShareVersion(env, project.id, experience, version);
      if (!snapshot) return new Response("Not found", { status: 404 });
      key = snapshot.cardKey;
    }
    mimeType = key.endsWith(".jpg") ? "image/jpeg" : "image/webp";
  } else {
    return new Response("Not found", { status: 404 });
  }

  const prefix = `projects/${slug}/branding/`;
  if (!key.startsWith(prefix) || key.includes("..") || key.includes("\\"))
    return json({ error: "Branding asset key escaped its project storage boundary." }, { status: 500 });
  const served = await serveR2Object(env.MODEL_ASSETS, key, request, {
    mimeType,
    cacheControl: "private, no-store",
  });
  if (!served.response) return new Response("Not found", { status: 404 });
  const headers = new Headers(served.response.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "same-origin");
  return new Response(served.response.body, { status: served.response.status, headers });
}

export async function handleProjectBrandingAdmin(request, env, actor, project, slug, parts = []) {
  if (!(await brandingSchemaReady(env)))
    return json({ error: "Project branding migration is not installed." }, { status: 503 });

  if (parts[0] === "assets") {
    if (parts.length !== 2) return new Response("Not found", { status: 404 });
    return adminBrandingAsset(request, env, project, slug, parts.slice(1));
  }
  if (parts.length) return new Response("Not found", { status: 404 });

  if (request.method === "GET") return adminBrandingState(env, project, slug);
  if (request.method !== "POST") return json({ error: "Method not allowed." }, { status: 405 });
  if (!(await sameOrigin(request)))
    return json({ error: "Invalid request origin." }, { status: 403 });

  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > MAX_SOURCE_CARD_BYTES + MAX_PUBLIC_CARD_BYTES + 1024 * 1024)
      return json({ error: "Branding upload request exceeds the maximum supported size." }, { status: 413 });
    const form = await request.formData();
    const action = String(form.get("action") || "");
    if (action === "upload-logo") return uploadLogo(form, env, actor, project, slug);
    if (action === "upload-share-card") return uploadShareCard(form, env, actor, project, slug);
    return json({ error: "Unsupported branding upload action." }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "");
  if (action === "save-share") return saveShareDetails(new Request(request.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), env, actor, project);
  if (action === "publish-logo") return publishLogo(new Request(request.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), env, actor, project);
  if (action === "publish-share") return publishShare(new Request(request.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), env, actor, project, slug);
  return json({ error: "Unsupported branding action." }, { status: 400 });
}

export async function getPublicBrandingSnapshot(env, slug, experience, requestedVersion = "", strictVersion = false) {
  return publicBrandingSnapshot(env, slug, experience, requestedVersion, strictVersion);
}

export async function servePublicBrandingRoute(request, env, slug, parts, url = new URL(request.url)) {
  if (request.method !== "GET" && request.method !== "HEAD")
    return json({ error: "Method not allowed." }, { status: 405 });
  const experience = url.searchParams.get("experience") || "building";
  if (!validExperience(experience))
    return json({ error: "Valid experience required." }, { status: 400 });

  if (!parts.length) {
    const version = url.searchParams.get("share") || "";
    const snapshot = await publicBrandingSnapshot(env, slug, experience, version, Boolean(version));
    if (!snapshot) return new Response("Not found", { status: 404 });
    return json({
      project: snapshot.project,
      experience: snapshot.experience,
      title: snapshot.title,
      description: snapshot.description,
      logoUrl: snapshot.logoUrl,
      faviconUrl: snapshot.faviconUrl,
      shareImageUrl: snapshot.shareImageUrl,
      shareVersion: snapshot.shareVersion,
    });
  }

  const kind = parts[0];
  if (!["logo", "favicon", "share-card"].includes(kind) || parts.length !== 1)
    return new Response("Not found", { status: 404 });
  const version = url.searchParams.get("v") || "";
  if (!version || !validVersion(version))
    return new Response("Not found", { status: 404 });

  let key = "";
  let mimeType = "";
  if (kind === "logo" || kind === "favicon") {
    const project = await projectPublicContext(env, slug, experience);
    if (!project) return new Response("Not found", { status: 404 });
    const logo = await readLogoVersion(env, project.id, version);
    if (!logo?.publishedAt) return new Response("Not found", { status: 404 });
    key = kind === "logo" ? logo.logoKey : logo.faviconKey;
    mimeType = kind === "logo" ? logo.logoMimeType : logo.faviconMimeType;
  } else {
    const snapshot = await publicBrandingSnapshot(env, slug, experience, version, true);
    if (!snapshot) return new Response("Not found", { status: 404 });
    key = snapshot.cardKey;
    mimeType = snapshot.cardMimeType;
  }
  if (!key) return new Response("Not found", { status: 404 });
  const prefix = `projects/${slug}/branding/`;
  if (!key.startsWith(prefix) || key.includes("..") || key.includes("\\"))
    return json({ error: "Branding asset key escaped its project storage boundary." }, { status: 500 });

  const served = await serveR2Object(env.MODEL_ASSETS, key, request, {
    mimeType,
    cacheControl: `public, max-age=31536000, immutable`,
  });
  if (!served.response) return new Response("Not found", { status: 404 });
  const headers = new Headers(served.response.headers);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  return new Response(served.response.body, { status: served.response.status, headers });
}

export async function injectPublicBrandingMetadata(request, env, response, url = new URL(request.url)) {
  if (request.method !== "GET" || !response.ok ||
      !(response.headers.get("content-type") || "").toLowerCase().includes("text/html")) return response;
  let path = url.pathname;
  if (path === BASE_PATH || path === `${BASE_PATH}/`) path = "/";
  else if (path.startsWith(`${BASE_PATH}/`)) path = path.slice(BASE_PATH.length);
  const match = /^\/([a-z0-9]+(?:-[a-z0-9]+)*)(\/(?:geo|masterplan))?\/?$/.exec(path);
  if (!match) return response;
  const slug = match[1];
  const experience = match[2] === "/geo" ? "geo" : "building";
  const isMasterplan = match[2] === "/masterplan";
  const requestedVersion = url.searchParams.get("share") || "";
  let snapshot;
  try {
    snapshot = isMasterplan
      ? await publicMasterplanShareSnapshot(env,slug,requestedVersion)
      : await publicBrandingSnapshot(env, slug, experience, requestedVersion, Boolean(requestedVersion));
  } catch (error) {
    console.error("Public branding metadata lookup failed.", error instanceof Error ? error.message : "unknown error");
    return response;
  }
  if (!snapshot) return response;

  const origin = url.origin;
  const absolute = (value) => value ? new URL(value.replace("https://ar3dstudio.in", origin), origin).toString() : "";
  const title = htmlEscape(snapshot.title);
  const description = htmlEscape(snapshot.description);
  const logoUrl = htmlEscape(absolute(snapshot.logoUrl));
  const faviconUrl = htmlEscape(absolute(snapshot.faviconUrl));
  const imageUrl = htmlEscape(absolute(snapshot.shareImageUrl));
  const pageUrl = htmlEscape(url.toString());
  let html = await response.text();
  html = html.replace(/<title[^>]*>[\s\S]*?<\/title>/i, `<title>${title}</title>`);
  html = html.replace(/<meta\s+name=(["'])description\1[^>]*>/i, "");
  html = html.replace(/<meta\s+property=(["'])og:[^>]+>/gi, "");
  html = html.replace(/<meta\s+name=(["'])twitter:[^>]+>/gi, "");
  if (faviconUrl) html = html.replace(/<link\b[^>]*\brel=(["'])[^"']*icon[^"']*\1[^>]*>/gi, "");
  const tags = [
    `<meta name="description" content="${description}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="AR3D Studio">`,
    `<meta property="og:url" content="${pageUrl}">`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${description}">`,
    imageUrl ? `<meta property="og:image" content="${imageUrl}">` : "",
    imageUrl ? `<meta property="og:image:alt" content="${title}">` : "",
    `<meta name="twitter:card" content="${snapshot.hasShareCard ? "summary_large_image" : "summary"}">`,
    `<meta name="twitter:title" content="${title}">`,
    `<meta name="twitter:description" content="${description}">`,
    imageUrl ? `<meta name="twitter:image" content="${imageUrl}">` : "",
    faviconUrl ? `<link rel="apple-touch-icon" href="${faviconUrl}">` : "",
    faviconUrl ? `<link rel="icon" type="image/png" href="${faviconUrl}">` : "",
    faviconUrl ? `<link rel="shortcut icon" type="image/png" href="${faviconUrl}">` : "",
  ].filter(Boolean).join("\n    ");
  if (/<\/head>/i.test(html)) html = html.replace(/<\/head>/i, `    ${tags}\n  </head>`);
  else return response;

  const headers = new Headers(response.headers);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  headers.delete("Content-Length");
  headers.delete("Content-Encoding");
  headers.delete("Content-Range");
  headers.delete("ETag");
  headers.delete("Last-Modified");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
}
