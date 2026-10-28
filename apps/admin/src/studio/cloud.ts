import type { EngineExperienceSummary } from "@rekixo/3d-contracts";
import type { DwgNormalizedDocument } from "./dwgNormalized";
import {
  projectSlug,
  validateProject,
  type Asset,
  type Project,
} from "./domain";

const CLOUD_BASE = "/3Dprojects/api/cloud";

export interface CloudSession {
  configured: boolean;
  databaseReady: boolean;
  authenticated: boolean;
  user?: { email: string };
  expiresAt?: number;
}

export interface CloudProjectSummary {
  id: string;
  slug: string;
  name: string;
  location?: string;
  status: "draft" | "published" | "archived";
  updatedAt: string;
  draftRevision?: number;
  assetCount: number;
}

export interface CloudDeletionJob {
  id: string;
  status: "running" | "cleanup_pending" | "db_cleanup_pending";
  expectedProjectCount: number;
  deletedProjects: number;
  deletedR2Objects: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CloudReleaseSummary {
  id: string;
  version: number;
  manifestSha256: string;
  sourceDraftRevision?: number;
  createdBy: string;
  createdAt: string;
  active: boolean;
}

export interface CloudGeoPlacement {
  projectId: string;
  releaseId: string;
  releaseVersion: number;
  longitude: number;
  latitude: number;
  altitudeM: number;
  headingDeg: number;
  pitchDeg: number;
  rollDeg: number;
  scale: number;
  publicEnabled: boolean;
  updatedBy: string;
  updatedAt: string;
}

export interface CloudGeoPlacementState {
  schemaReady: boolean;
  project: {
    id: string;
    slug: string;
    name: string;
    location?: string;
    status: "draft" | "published" | "archived";
  };
  placement: CloudGeoPlacement | null;
  placementStale?: boolean;
  release: {
    id: string;
    version: number;
    manifestSha256?: string;
    createdAt?: string;
  } | null;
  mapsApiKey: string;
  mapsConfigured: boolean;
}


export interface CloudGeoDraft {
  experienceId: string;
  projectId: string;
  sourceBuildingReleaseId: string;
  sourceBuildingReleaseVersion: number;
  longitude: number | null;
  latitude: number | null;
  altitudeM: number;
  headingDeg: number;
  pitchDeg: number;
  rollDeg: number;
  scale: number;
  revision: number;
  updatedBy: string;
  updatedAt: string;
}

export interface CloudGeoDraftState {
  schemaReady: boolean;
  project: CloudGeoPlacementState["project"];
  experience: {
    id: string;
    lifecycle: "active" | "archived";
  } | null;
  draft: CloudGeoDraft | null;
  sourceRelease: {
    id: string;
    version: number;
    manifestSha256?: string;
    createdAt?: string;
  } | null;
  activeBuildingRelease: {
    id: string;
    version: number;
    manifestSha256?: string;
    createdAt?: string;
  } | null;
  sourceUpdateAvailable: boolean;
  sourcePreviewAvailable: boolean;
  legacyPlacement: {
    releaseId: string;
    releaseVersion: number;
    publicEnabled: boolean;
    updatedAt?: string;
  } | null;
  mapsApiKey: string;
  mapsConfigured: boolean;
}

export interface CloudGeoPreviewVerification {
  draftRevision: number;
  sourceBuildingReleaseId: string;
  sourceBuildingReleaseVersion: number;
  verifiedBy: string;
  verifiedAt: string;
  unchanged?: boolean;
}

export interface CloudGeoReleaseSummary {
  id: string;
  experienceId: string;
  projectId: string;
  version: number;
  manifestSha256: string;
  sourceDraftRevision: number;
  sourceBuildingReleaseId: string;
  sourceBuildingReleaseVersion: number;
  createdBy: string;
  createdAt: string;
  active: boolean;
  unchanged?: boolean;
}

export interface CloudGeoReleaseState {
  schemaReady: boolean;
  experienceId: string | null;
  draftRevision: number | null;
  previewVerified: boolean;
  previewVerification: CloudGeoPreviewVerification | null;
  activeRelease: CloudGeoReleaseSummary | null;
  releases: CloudGeoReleaseSummary[];
}

export interface CloudAssetSummary {
  id: string;
  projectId: string;
  kind: "model" | "reference" | "source" | "texture" | "other";
  name: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  refCount: number;
  orphanedAt?: string;
  createdAt: string;
  contentUrl: string;
}

async function api<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    cache: "no-store",
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const type = response.headers.get("content-type") || "";
  const body = type.includes("application/json")
    ? ((await response.json()) as T & { error?: string })
    : undefined;
  if (!response.ok)
    throw new Error(
      (body as { error?: string } | undefined)?.error ??
        `Cloud Admin request failed (${response.status}).`,
    );
  return body as T;
}

export const session = () => api<CloudSession>(`${CLOUD_BASE}/session`);

export async function login(email: string, password: string) {
  return api<{ ok: true; user: { email: string }; expiresAt: number }>(
    `${CLOUD_BASE}/login`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    },
  );
}

export async function logout() {
  return api<{ ok: true }>(`${CLOUD_BASE}/logout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

export async function projects(
  q = "",
  status: "active" | "archived" | "all" = "active",
  limit = 50,
  offset = 0,
) {
  const params = new URLSearchParams({
    q,
    status,
    limit: String(limit),
    offset: String(offset),
  });
  return api<{
    projects: CloudProjectSummary[];
    total: number;
    nextOffset: number;
    hasMore: boolean;
  }>(`${CLOUD_BASE}/projects?${params}`);
}

export async function deletionStatus() {
  return api<{ job: CloudDeletionJob | null }>(`${CLOUD_BASE}/deletion-status`);
}

export async function deleteAllProjects(
  expectedProjectCount: number,
  confirm: string,
) {
  return api<{
    ok: true;
    jobId?: string;
    status: "completed";
    deletedProjects: number;
    deletedR2Objects: number;
    remainingProjects: number;
  }>(`${CLOUD_BASE}/projects`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expectedProjectCount, confirm }),
  });
}

export async function ensureProject(project: Project) {
  validateProject(project);
  const slug = projectSlug(project);
  return api<{ project: CloudProjectSummary; created: boolean }>(
    `${CLOUD_BASE}/projects`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: project.id,
        slug,
        name: project.name,
        location: project.location ?? "",
      }),
    },
  );
}

export async function experiences(slug: string) {
  return api<{ experiences: EngineExperienceSummary[] }>(
    `${CLOUD_BASE}/projects/${encodeURIComponent(slug)}/experiences`,
  );
}

export async function createGeoExperience(
  slug: string,
  sourceBuildingReleaseId: string,
) {
  return api<{ created: boolean; experience: EngineExperienceSummary }>(
    `${CLOUD_BASE}/projects/${encodeURIComponent(slug)}/experiences`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "geo",
        sourceBuildingReleaseId,
      }),
    },
  );
}

export async function listAssets(slug: string) {
  return api<{ assets: CloudAssetSummary[] }>(
    `${CLOUD_BASE}/projects/${encodeURIComponent(slug)}/assets`,
  );
}

async function digestSha256(blob: Blob) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
  );
  return Array.from(digest, (item) =>
    item.toString(16).padStart(2, "0"),
  ).join("");
}

export async function uploadAsset(
  slug: string,
  asset: Asset,
  kind: CloudAssetSummary["kind"],
) {
  const params = new URLSearchParams({
    id: asset.id,
    kind,
    name: asset.name,
  });
  return api<{ asset: CloudAssetSummary; uploaded: boolean }>(
    `${CLOUD_BASE}/projects/${encodeURIComponent(slug)}/assets?${params}`,
    {
      method: "POST",
      headers: {
        "Content-Type": asset.type || "application/octet-stream",
        "X-Rekixo-Sha256": asset.hash,
      },
      body: asset.blob,
    },
  );
}

export async function processDwgArchitecture(asset: Asset) {
  if (!/\.dwg$/i.test(asset.name))
    throw Error("Choose a DWG source before running the architecture processor.");
  if (asset.size > 32 * 1024 * 1024)
    throw Error("DWG exceeds the 32 MB architecture processor limit.");

  return api<DwgNormalizedDocument>(`${CLOUD_BASE}/processors/dwg`, {
    method: "POST",
    headers: {
      "Content-Type": asset.type || "application/octet-stream",
      "X-Rekixo-Project-Id": asset.projectId,
      "X-Rekixo-Source-Asset-Id": asset.id,
      "X-Rekixo-Source-Sha256": asset.hash,
      "X-Rekixo-Source-Name": encodeURIComponent(asset.name),
    },
    body: asset.blob,
  });
}

export async function deleteAsset(slug: string, assetId: string) {
  return api<{ ok: true }>(
    `${CLOUD_BASE}/projects/${encodeURIComponent(slug)}/assets/${encodeURIComponent(assetId)}`,
    { method: "DELETE" },
  );
}

export async function loadDraft(slug: string) {
  return api<{
    project: CloudProjectSummary;
    revision: number;
    updatedAt: string;
    draft: Project;
  }>(`${CLOUD_BASE}/projects/${encodeURIComponent(slug)}/draft`);
}

export async function saveDraft(
  project: Project,
  expectedRevision: number | null,
) {
  validateProject(project);
  const slug = projectSlug(project);
  const draft = structuredClone(project);
  draft.slug = slug;
  delete draft.cloud;
  return api<{ ok: true; revision: number; updatedAt: string }>(
    `${CLOUD_BASE}/projects/${encodeURIComponent(slug)}/draft`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision, draft }),
    },
  );
}

export async function patchProject(
  slug: string,
  body:
    | { action: "archive" | "restore" }
    | { action: "metadata"; name: string; location?: string },
) {
  return api<{ ok: true; status?: string; name?: string; location?: string }>(
    `${CLOUD_BASE}/projects/${encodeURIComponent(slug)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

export async function downloadAsset(
  summary: CloudAssetSummary,
): Promise<Asset> {
  const response = await fetch(summary.contentUrl, {
    cache: "no-store",
    headers: { Accept: "*/*" },
  });
  if (!response.ok)
    throw new Error(`Could not download ${summary.name} (${response.status}).`);
  const blob = await response.blob();
  if (blob.size !== summary.byteSize)
    throw new Error(`Cloud asset size mismatch: ${summary.name}`);
  const hash = await digestSha256(blob);
  if (hash !== summary.sha256.toLowerCase())
    throw new Error(`Cloud asset checksum mismatch: ${summary.name}`);
  return {
    id: summary.id,
    projectId: summary.projectId,
    name: summary.name,
    type: summary.mimeType,
    size: summary.byteSize,
    hash,
    blob,
  };
}

export async function downloadProject(slug: string) {
  const [draftResult, assetResult] = await Promise.all([
    loadDraft(slug),
    listAssets(slug),
  ]);
  const project = structuredClone(draftResult.draft);
  project.slug = draftResult.project.slug;
  project.name = draftResult.project.name;
  project.location = draftResult.project.location ?? project.location ?? "";
  project.cloud = {
    revision: draftResult.revision,
    syncedAt: draftResult.updatedAt,
  };
  validateProject(project);

  const byId = new Map(assetResult.assets.map((asset) => [asset.id, asset]));
  const files: Asset[] = [];
  for (const assetId of project.assets) {
    const summary = byId.get(assetId);
    if (!summary)
      throw new Error(`Cloud draft asset metadata is missing: ${assetId}`);
    files.push(await downloadAsset(summary));
  }
  return { project, files };
}

export async function syncProject(project: Project, files: Asset[]) {
  validateProject(project);
  const slug = projectSlug(project);
  const created = await ensureProject({ ...project, slug });
  const remoteAssets = await listAssets(slug);
  const remoteById = new Map(remoteAssets.assets.map((asset) => [asset.id, asset]));
  const localById = new Map(files.map((asset) => [asset.id, asset]));

  for (const assetId of project.assets) {
    const local = localById.get(assetId);
    if (!local || local.projectId !== project.id)
      throw new Error(`Local asset is missing: ${assetId}`);
    const remote = remoteById.get(assetId);
    if (remote) {
      if (remote.sha256.toLowerCase() !== local.hash.toLowerCase())
        throw new Error(`Cloud asset ID has different bytes: ${local.name}`);
      continue;
    }
    await uploadAsset(
      slug,
      local,
      assetId === project.scene.modelId ||
        assetId === project.scene.publishModelId
        ? "model"
        : "reference",
    );
  }

  let expectedRevision = project.cloud?.revision ?? null;
  if (!created.created && expectedRevision === null) {
    try {
      const existing = await loadDraft(slug);
      if (existing)
        throw new Error(
          "This cloud project already has a draft. Open the cloud version before overwriting it.",
        );
    } catch (error) {
      if (
        error instanceof Error &&
        /Cloud draft not found/i.test(error.message)
      ) {
        expectedRevision = null;
      } else {
        throw error;
      }
    }
  }

  const saved = await saveDraft({ ...project, slug }, expectedRevision);
  const next: Project = {
    ...project,
    slug,
    cloud: {
      revision: saved.revision,
      syncedAt: saved.updatedAt,
    },
    updated: saved.updatedAt,
  };

  const referenced = new Set(project.assets);
  const after = await listAssets(slug);
  for (const asset of after.assets) {
    if (!referenced.has(asset.id) && asset.refCount === 0) {
      await deleteAsset(slug, asset.id);
    }
  }

  return next;
}



export type BrandingExperience = "building" | "geo";

export interface CloudBrandingExperienceState {
  experience: BrandingExperience;
  live: boolean;
  draftTitle: string;
  draftDescription: string;
  draftCardVersion: string;
  useBuildingPoster: boolean;
  draftCardPreviewUrl: string;
  publishedVersion: string;
  publishedTitle: string;
  publishedDescription: string;
  publishedCardUrl: string;
  shareUrl: string;
  shareReady: boolean;
  updatedAt: string;
}

export interface CloudProjectBrandingState {
  project: {
    id: string;
    slug: string;
    name: string;
    location?: string;
    status: "draft" | "published" | "archived";
  };
  logo: {
    draftVersion: string;
    publishedVersion: string;
    previewUrl: string;
    sourceUrl: string;
    faviconPreviewUrl: string;
    publishedLogoUrl: string;
    publishedFaviconUrl: string;
    publishedAt: string;
  };
  experiences: Record<BrandingExperience, CloudBrandingExperienceState>;
}

function brandingPath(slug: string) {
  return `${CLOUD_BASE}/projects/${encodeURIComponent(slug)}/branding`;
}

export async function getProjectBranding(slug: string) {
  return api<CloudProjectBrandingState>(brandingPath(slug));
}

export async function uploadProjectLogo(
  slug: string,
  logoFile: File,
  faviconFile: File,
  sourceFile: File,
) {
  const form = new FormData();
  form.set("action", "upload-logo");
  form.set("logoFile", logoFile);
  form.set("faviconFile", faviconFile);
  form.set("sourceFile", sourceFile);
  return api<{ ok: true; version: string }>(brandingPath(slug), {
    method: "POST",
    body: form,
  });
}

export async function uploadProjectShareCard(
  slug: string,
  experience: BrandingExperience,
  cardFile: File,
  sourceFile: File,
) {
  const form = new FormData();
  form.set("action", "upload-share-card");
  form.set("experience", experience);
  form.set("cardFile", cardFile);
  form.set("sourceFile", sourceFile);
  return api<{ ok: true; experience: BrandingExperience; version: string }>(
    brandingPath(slug),
    { method: "POST", body: form },
  );
}

export async function saveProjectShareDetails(
  slug: string,
  experience: BrandingExperience,
  title: string,
  description: string,
  useBuildingPoster = false,
) {
  return api<{ ok: true; experience: BrandingExperience; title: string; description: string }>(
    brandingPath(slug),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save-share", experience, title, description, useBuildingPoster }),
    },
  );
}

export async function publishProjectLogo(slug: string, version: string) {
  return api<{ ok: true; version: string; publishedAt: string }>(
    brandingPath(slug),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "publish-logo", version }),
    },
  );
}

export async function publishProjectShare(
  slug: string,
  experience: BrandingExperience,
) {
  return api<{ ok: true; experience: BrandingExperience; version: string; publishedAt: string }>(
    brandingPath(slug),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "publish-share", experience }),
    },
  );
}

export async function releases(slug: string) {
  return api<{ releases: CloudReleaseSummary[] }>(
    `${CLOUD_BASE}/projects/${encodeURIComponent(slug)}/releases`,
  );
}

export async function publishRelease(
  slug: string,
  expectedDraftRevision?: number,
  requireCanonicalSource = false,
) {
  return api<{ release: CloudReleaseSummary & { assetCount: number } }>(
    `${CLOUD_BASE}/projects/${encodeURIComponent(slug)}/releases`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "publish",
        ...(requireCanonicalSource ? { requireCanonicalSource: true } : {}),
        ...(expectedDraftRevision
          ? { expectedDraftRevision }
          : {}),
      }),
    },
  );
}


export async function activateRelease(slug: string, releaseId: string) {
  return api<{ release: CloudReleaseSummary & { unchanged?: boolean } }>(
    `${CLOUD_BASE}/projects/${encodeURIComponent(
      slug,
    )}/releases/${encodeURIComponent(releaseId)}/activate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    },
  );
}

export async function geoDraft(slug: string) {
  return api<CloudGeoDraftState>(
    `${CLOUD_BASE}/projects/${encodeURIComponent(slug)}/geo-draft`,
  );
}

export async function saveGeoDraft(
  slug: string,
  draft: {
    expectedRevision: number;
    sourceBuildingReleaseId: string;
    longitude: number;
    latitude: number;
    altitudeM: number;
    headingDeg: number;
    pitchDeg: number;
    rollDeg: number;
    scale: number;
  },
) {
  return api<CloudGeoDraftState>(
    `${CLOUD_BASE}/projects/${encodeURIComponent(slug)}/geo-draft`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    },
  );
}

export async function resetGeoDraft(slug: string, expectedRevision: number) {
  return api<CloudGeoDraftState>(
    `${CLOUD_BASE}/projects/${encodeURIComponent(slug)}/geo-draft`,
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision }),
    },
  );
}

export async function geoReleases(slug: string) {
  return api<CloudGeoReleaseState>(
    `${CLOUD_BASE}/projects/${encodeURIComponent(slug)}/geo-releases`,
  );
}

export async function verifyGeoPreview(
  slug: string,
  expectedDraftRevision: number,
) {
  return api<{ verification: CloudGeoPreviewVerification }>(
    `${CLOUD_BASE}/projects/${encodeURIComponent(slug)}/geo-draft/verify`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedDraftRevision }),
    },
  );
}

export async function publishGeoRelease(
  slug: string,
  expectedDraftRevision: number,
) {
  return api<{ release: CloudGeoReleaseSummary }>(
    `${CLOUD_BASE}/projects/${encodeURIComponent(slug)}/geo-releases`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "publish", expectedDraftRevision }),
    },
  );
}

export async function activateGeoRelease(
  slug: string,
  geoReleaseId: string,
) {
  return api<{ release: CloudGeoReleaseSummary }>(
    `${CLOUD_BASE}/projects/${encodeURIComponent(
      slug,
    )}/geo-releases/${encodeURIComponent(geoReleaseId)}/activate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    },
  );
}

export async function geoPlacement(slug: string) {
  return api<CloudGeoPlacementState>(
    `${CLOUD_BASE}/projects/${encodeURIComponent(slug)}/geo-placement`,
  );
}

export async function saveGeoPlacement(
  slug: string,
  placement: {
    longitude: number;
    latitude: number;
    altitudeM: number;
    headingDeg: number;
    pitchDeg: number;
    rollDeg: number;
    scale: number;
    publicEnabled: boolean;
  },
) {
  return api<CloudGeoPlacementState>(
    `${CLOUD_BASE}/projects/${encodeURIComponent(slug)}/geo-placement`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(placement),
    },
  );
}

export async function removeGeoPlacement(slug: string) {
  return api<CloudGeoPlacementState>(
    `${CLOUD_BASE}/projects/${encodeURIComponent(slug)}/geo-placement`,
    { method: "DELETE" },
  );
}



export async function geoMapsSettings() {
  return api<{ apiKey: string | null }>(`${CLOUD_BASE}/settings/maps`);
}

export async function saveGeoMapsKey(apiKey: string) {
  return api<{ ok: true; apiKey: string }>(`${CLOUD_BASE}/settings/maps`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey }),
  });
}
