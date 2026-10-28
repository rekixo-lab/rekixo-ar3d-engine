import type { GeoGuidedRigidSolution, GeoGuidedSourcePoint } from "@rekixo/3d-engine-core";
import { useEffect, useMemo, useState } from "react";
import {
  activateGeoRelease,
  createGeoExperience,
  geoMapsSettings,
  geoReleases,
  projects,
  publishGeoRelease,
  releases,
  saveGeoMapsKey,
  session,
  verifyGeoPreview,
  type CloudGeoReleaseState,
  type CloudProjectSummary,
  type CloudReleaseSummary,
} from "../studio/cloud";
import GeoGuidedRigidAlignment, {
  type GeoGuidedFineDelta,
  type GeoGuidedPairDraft,
} from "./GeoGuidedRigidAlignment";
import GeoIntegratedAuthoringMap, {
  type GeoAlignmentMapTarget,
  type GeoIntegratedPreviewState,
} from "./GeoIntegratedAuthoringMap";
import {
  createGeoV2Anchor,
  loadGeoV2,
  saveGeoV2,
  type GeoAnchorKind,
  type GeoHeightMode,
  type GeoV2Draft,
  type GeoV2State,
} from "./geoV2Api";
import "./geo-mapper.css";
import "./geo-v2.css";

type IntegrationModel = {
  id: string;
  name: string;
  mimeType: string;
  available?: boolean;
  url?: string;
  variant?: string;
};

type IntegrationPayload = {
  model?: IntegrationModel;
  geoModel?: IntegrationModel & { sourceModelId?: string };
  release?: { id: string; version: number };
  error?: string;
};

type FormState = {
  longitude: string;
  latitude: string;
  altitudeM: string;
  eastOffsetM: string;
  northOffsetM: string;
  verticalOffsetM: string;
  headingDeg: string;
  pitchDeg: string;
  rollDeg: string;
  scale: string;
  heightMode: GeoHeightMode;
  modelAnchorId: string;
};

type AnchorForm = {
  name: string;
  kind: GeoAnchorKind;
  xM: string;
  yM: string;
  zM: string;
};

type ParsedAlignment = {
  altitudeM: number;
  eastOffsetM: number;
  northOffsetM: number;
  verticalOffsetM: number;
  headingDeg: number;
  pitchDeg: number;
  rollDeg: number;
  scale: number;
  heightMode: GeoHeightMode;
};

const GUIDED_POINT_IDS = ["P1", "P2", "P3", "P4"] as const;

function blankGuidedPairs(): GeoGuidedPairDraft[] {
  return GUIDED_POINT_IDS.map((id) => ({ id, label: id, source: null, target: null }));
}

// Browser-tab scratch state only. Published Geo still uses the immutable saved
// WGS84 transform, never these unverified clicked pairs.
function restoreGuidePairs(key: string): GeoGuidedPairDraft[] {
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(key) || "null");
    if (!Array.isArray(value)) return blankGuidedPairs();
    return blankGuidedPairs().map((base) => {
      const item = value.find((candidate) => candidate && typeof candidate === "object" && candidate.id === base.id);
      const source = item?.source;
      const target = item?.target;
      const safeSource = source && [source.x, source.y, source.z].every(
        (n: unknown) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 100000,
      ) ? { x: source.x as number, y: source.y as number, z: source.z as number } : null;
      const safeTarget = target && typeof target.latitude === "number" &&
        typeof target.longitude === "number" && Number.isFinite(target.latitude) &&
        Number.isFinite(target.longitude) && Math.abs(target.latitude) <= 90 &&
        Math.abs(target.longitude) <= 180
        ? { latitude: target.latitude as number, longitude: target.longitude as number } : null;
      return { ...base, source: safeSource, target: safeTarget };
    });
  } catch {
    return blankGuidedPairs();
  }
}

function requestedProjectSlug() {
  return new URLSearchParams(window.location.search)
    .get("project")
    ?.trim()
    .toLowerCase() || "";
}

function numberValue(value: string) {
  const result = Number(value);
  return Number.isFinite(result) ? result : NaN;
}

function inRange(value: number, min: number, max: number) {
  return Number.isFinite(value) && value >= min && value <= max;
}

function validCoordinate(form: FormState) {
  const longitude = numberValue(form.longitude);
  const latitude = numberValue(form.latitude);
  return form.longitude.trim() !== "" && form.latitude.trim() !== "" &&
    inRange(longitude, -180, 180) && inRange(latitude, -90, 90);
}

function parsedAlignment(form: FormState): ParsedAlignment | null {
  const value: ParsedAlignment = {
    altitudeM: numberValue(form.altitudeM),
    eastOffsetM: numberValue(form.eastOffsetM),
    northOffsetM: numberValue(form.northOffsetM),
    verticalOffsetM: numberValue(form.verticalOffsetM),
    headingDeg: numberValue(form.headingDeg),
    pitchDeg: numberValue(form.pitchDeg),
    rollDeg: numberValue(form.rollDeg),
    scale: numberValue(form.scale),
    heightMode: form.heightMode,
  };
  if (!inRange(value.altitudeM, -12000, 100000) ||
    !inRange(value.headingDeg, -360000, 360000) ||
    !inRange(value.pitchDeg, -180, 180) ||
    !inRange(value.rollDeg, -180, 180) ||
    !inRange(value.scale, 0.01, 100) ||
    !inRange(value.eastOffsetM, -100000, 100000) ||
    !inRange(value.northOffsetM, -100000, 100000) ||
    !inRange(value.verticalOffsetM, -12000, 100000)) return null;
  return value;
}

function blankForm(): FormState {
  return {
    longitude: "",
    latitude: "",
    altitudeM: "0",
    eastOffsetM: "0",
    northOffsetM: "0",
    verticalOffsetM: "0",
    headingDeg: "0",
    pitchDeg: "0",
    rollDeg: "0",
    scale: "1",
    heightMode: "ground-relative",
    modelAnchorId: "",
  };
}

function formFromState(state: GeoV2State): FormState {
  const draft = state.draft;
  if (!draft) return blankForm();
  return {
    longitude: draft.longitude === null ? "" : String(draft.longitude),
    latitude: draft.latitude === null ? "" : String(draft.latitude),
    altitudeM: String(draft.altitudeM),
    eastOffsetM: String(draft.eastOffsetM),
    northOffsetM: String(draft.northOffsetM),
    verticalOffsetM: String(draft.verticalOffsetM),
    headingDeg: String(draft.headingDeg),
    pitchDeg: String(draft.pitchDeg),
    rollDeg: String(draft.rollDeg),
    scale: String(draft.scale),
    heightMode: draft.heightMode,
    modelAnchorId: draft.modelAnchorId || "",
  };
}

function draftMatchesForm(
  draft: GeoV2Draft | null | undefined,
  form: FormState,
  sourceReleaseId: string,
) {
  if (!draft || !validCoordinate(form)) return false;
  const alignment = parsedAlignment(form);
  if (!alignment) return false;
  return draft.sourceBuildingReleaseId === sourceReleaseId &&
    draft.longitude === Number(form.longitude) &&
    draft.latitude === Number(form.latitude) &&
    draft.altitudeM === alignment.altitudeM &&
    draft.eastOffsetM === alignment.eastOffsetM &&
    draft.northOffsetM === alignment.northOffsetM &&
    draft.verticalOffsetM === alignment.verticalOffsetM &&
    draft.headingDeg === alignment.headingDeg &&
    draft.pitchDeg === alignment.pitchDeg &&
    draft.rollDeg === alignment.rollDeg &&
    draft.scale === alignment.scale &&
    draft.heightMode === alignment.heightMode &&
    (draft.modelAnchorId || "") === form.modelAnchorId;
}

function normalizeHeading(value: number) {
  let next = value % 360;
  if (next <= -180) next += 360;
  if (next > 180) next -= 360;
  return next;
}

function formatFormNumber(value: number, digits: number) {
  const rounded = Number(value.toFixed(digits));
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

async function integration(slug: string) {
  const response = await fetch(
    `/3Dprojects/api/integration/projects/${encodeURIComponent(slug)}`,
    { cache: "no-store", headers: { Accept: "application/json" } },
  );
  const body = (await response.json()) as IntegrationPayload;
  if (!response.ok)
    throw new Error(body.error || `Engine integration load failed (${response.status}).`);
  return body;
}

function previewStateLabel(state: GeoIntegratedPreviewState) {
  switch (state) {
    case "ready": return "Integrated map preview rendered";
    case "map-key-required": return "Save Google Maps browser key";
    case "loading-map": return "Integrated 3D map is loading";
    case "map-ready": return "Active immutable Building preview unavailable";
    case "loading-model": return "Current Building placement is rendering";
    case "waiting-coordinate": return "Set real WGS84 Building anchor";
    case "waiting-anchor": return "Select exact Building-local model anchor";
    case "invalid-alignment": return "Fix invalid rigid alignment values";
    case "error": return "Integrated preview has an error";
  }
}

export default function GeoMapper3DV2() {
  const [projectList, setProjectList] = useState<CloudProjectSummary[]>([]);
  const [selectedSlug, setSelectedSlug] = useState("");
  const [state, setState] = useState<GeoV2State>();
  const [releaseItems, setReleaseItems] = useState<CloudReleaseSummary[]>([]);
  const [geoReleaseState, setGeoReleaseState] = useState<CloudGeoReleaseState>();
  const [engine, setEngine] = useState<IntegrationPayload>();
  const [sourceReleaseId, setSourceReleaseId] = useState("");
  const [form, setForm] = useState<FormState>(blankForm);
  const [anchorForm, setAnchorForm] = useState<AnchorForm>({
    name: "Model origin",
    kind: "custom",
    xM: "0",
    yM: "0",
    zM: "0",
  });
  const [guidedPairs, setGuidedPairs] = useState<GeoGuidedPairDraft[]>(blankGuidedPairs);
  const [loadedGuideKey, setLoadedGuideKey] = useState("");
  const [guidedSourceId, setGuidedSourceId] = useState<string | null>(null);
  const [guidedTargetId, setGuidedTargetId] = useState<string | null>(null);
  const [guidedAllowScale, setGuidedAllowScale] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [dockOpen, setDockOpen] = useState(true);
  const [editorTab, setEditorTab] = useState<"corners" | "fine" | "position" | "release">("corners");
  const [previewVariant, setPreviewVariant] = useState<"canonical" | "geo">("canonical");
  const [mapsApiKey, setMapsApiKey] = useState("");
  const [configuredMapsApiKey, setConfiguredMapsApiKey] = useState("");
  const [previewState, setPreviewState] = useState<GeoIntegratedPreviewState>("loading-map");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // A single keyboard-accessible editing surface; do not fullscreen only
  // Google Maps, which removes the corner tools and save gate from view.
  useEffect(() => {
    if (!focusMode) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFocusMode(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [focusMode]);

  useEffect(() => {
    let live = true;
    void session()
      .then((value) => {
        if (!value.authenticated) {
          window.location.replace(
            `/3Dprojects/login?return=${encodeURIComponent(window.location.pathname + window.location.search)}`,
          );
          return null;
        }
        return Promise.all([
          projects("", "active", 100, 0),
          geoMapsSettings().catch(() => ({ apiKey: null })),
        ]);
      })
      .then((payload) => {
        if (!live || !payload) return;
        const [projectResult, maps] = payload;
        setProjectList(projectResult.projects);
        if (maps.apiKey) {
          setMapsApiKey(maps.apiKey);
          setConfiguredMapsApiKey(maps.apiKey);
        }
        const requested = requestedProjectSlug();
        setSelectedSlug(
          projectResult.projects.find((item) => item.slug === requested)?.slug ||
            projectResult.projects[0]?.slug ||
            "",
        );
      })
      .catch((reason) => {
        if (live) setError(reason instanceof Error ? reason.message : "Projects load nahi hue.");
      });
    return () => { live = false; };
  }, []);

  async function reload(slug = selectedSlug) {
    if (!slug) return;
    const [v2, buildingReleases, geoHistory, integrationState] = await Promise.all([
      loadGeoV2(slug),
      releases(slug),
      geoReleases(slug),
      integration(slug),
    ]);
    setState(v2);
    setReleaseItems(buildingReleases.releases);
    setGeoReleaseState(geoHistory);
    setEngine(integrationState);
    const source = v2.draft?.sourceBuildingReleaseId ||
      v2.experience?.sourceBuildingReleaseId ||
      v2.project.activeBuildingReleaseId ||
      "";
    setSourceReleaseId(source);
    setForm(formFromState(v2));
  }

  useEffect(() => {
    if (!selectedSlug) return;
    let live = true;
    setBusy(true);
    setError("");
    setMessage("");
    setPreviewState("loading-map");
    void reload(selectedSlug)
      .catch((reason) => {
        if (live) setError(reason instanceof Error ? reason.message : "Geo V2 load nahi hua.");
      })
      .finally(() => { if (live) setBusy(false); });
    const url = new URL(window.location.href);
    url.searchParams.set("project", selectedSlug);
    window.history.replaceState({}, "", url);
    return () => { live = false; };
  }, [selectedSlug]);

  const guideScratchKey = selectedSlug && sourceReleaseId
    ? `rekixo-geo-guided-draft-v1:${selectedSlug}:${sourceReleaseId}` : "";

  useEffect(() => {
    setLoadedGuideKey("");
    setGuidedPairs(guideScratchKey ? restoreGuidePairs(guideScratchKey) : blankGuidedPairs());
    setGuidedSourceId(null);
    setGuidedTargetId(null);
    setGuidedAllowScale(false);
    setPreviewVariant("canonical");
    setLoadedGuideKey(guideScratchKey);
  }, [guideScratchKey]);

  useEffect(() => {
    if (!guideScratchKey || loadedGuideKey !== guideScratchKey) return;
    try { window.sessionStorage.setItem(guideScratchKey, JSON.stringify(guidedPairs)); }
    catch { /* Storage can be disabled; do not mutate the original Geo draft. */ }
  }, [guideScratchKey, loadedGuideKey, guidedPairs]);

  const selectedRelease = useMemo(
    () => releaseItems.find((item) => item.id === sourceReleaseId),
    [releaseItems, sourceReleaseId],
  );
  const activeRelease = useMemo(
    () => releaseItems.find((item) => item.active),
    [releaseItems],
  );
  const sourcePreviewAvailable = Boolean(
    engine?.release?.id && sourceReleaseId === engine.release.id,
  );
  const geoDerivativeAvailable = Boolean(sourcePreviewAvailable && engine?.geoModel?.url &&
    engine?.model && engine.geoModel.sourceModelId === engine.model.id &&
    engine.geoModel.mimeType === "model/gltf-binary");
  const renderModel = useMemo(() => {
    if (!sourcePreviewAvailable) return null;
    const source = engine?.model;
    const geo = engine?.geoModel;
    if (previewVariant === "geo" && geoDerivativeAvailable && geo) return geo;
    return source?.url && source.mimeType === "model/gltf-binary" ? source : null;
  }, [engine, sourcePreviewAvailable, previewVariant, geoDerivativeAvailable]);
  const selectedAnchor = useMemo(
    () => state?.anchors.find((anchor) =>
      anchor.id === form.modelAnchorId &&
      anchor.sourceBuildingReleaseId === sourceReleaseId,
    ) || null,
    [state?.anchors, form.modelAnchorId, sourceReleaseId],
  );
  const previewCoordinate = useMemo(
    () => validCoordinate(form)
      ? { latitude: Number(form.latitude), longitude: Number(form.longitude) }
      : null,
    [form.latitude, form.longitude],
  );
  const previewPlacement = useMemo(() => parsedAlignment(form), [
    form.altitudeM,
    form.eastOffsetM,
    form.northOffsetM,
    form.verticalOffsetM,
    form.headingDeg,
    form.pitchDeg,
    form.rollDeg,
    form.scale,
    form.heightMode,
  ]);
  const savedForm = useMemo(
    () => draftMatchesForm(state?.draft, form, sourceReleaseId),
    [state?.draft, form, sourceReleaseId],
  );
  const guidedMapTargets = useMemo<GeoAlignmentMapTarget[]>(
    () => guidedPairs.flatMap((pair) => pair.target
      ? [{
          id: pair.id,
          label: pair.label,
          latitude: pair.target.latitude,
          longitude: pair.target.longitude,
        }]
      : []),
    [guidedPairs],
  );

  const verificationBlocker = useMemo(() => {
    if (!state?.draft) return "Geo draft missing hai.";
    if (sourceReleaseId !== state.project.activeBuildingReleaseId)
      return "Verification ke liye current ACTIVE Building release select karein.";
    if (!previewCoordinate) return "Valid WGS84 latitude/longitude set karein.";
    if (!previewPlacement) return "Rigid alignment values valid range me karein.";
    if (!selectedAnchor) return "Exact Building-local model anchor select karein.";
    if (!renderModel) return "Active immutable Building GLB preview available hona chahiye.";
    if (previewVariant !== "canonical") return "Use Canonical GLB before verification; derivative is diagnostic only.";
    if (!savedForm) return "Current map placement ko Save Geo V2 Draft karke revision lock karein.";
    if (previewState !== "ready") return previewStateLabel(previewState);
    return "";
  }, [
    state?.draft,
    state?.project.activeBuildingReleaseId,
    sourceReleaseId,
    previewCoordinate,
    previewPlacement,
    selectedAnchor,
    renderModel,
    previewVariant,
    savedForm,
    previewState,
  ]);

  const publishReady = Boolean(
    state?.draft &&
    geoReleaseState?.previewVerified &&
    savedForm &&
    sourceReleaseId === state.project.activeBuildingReleaseId &&
    previewState === "ready" &&
    previewVariant === "canonical",
  );

  function toggleEditor() {
    setFocusMode((open) => {
      if (!open) {
        setDockOpen(true);
        setEditorTab("corners");
      }
      return !open;
    });
  }

  function patch<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function setCoordinate(latitude: number, longitude: number) {
    setForm((current) => ({
      ...current,
      latitude: latitude.toFixed(7),
      longitude: longitude.toFixed(7),
    }));
  }

  function captureGuidedSource(pointId: string, point: GeoGuidedSourcePoint) {
    setGuidedPairs((current) => current.map((pair) =>
      pair.id === pointId ? { ...pair, source: point } : pair,
    ));
    setGuidedSourceId(null);
  }

  function captureGuidedTarget(pointId: string, latitude: number, longitude: number) {
    setGuidedPairs((current) => current.map((pair) =>
      pair.id === pointId
        ? { ...pair, target: { latitude, longitude } }
        : pair,
    ));
    setGuidedTargetId(null);
  }

  function clearGuidedPair(pointId: string) {
    setGuidedPairs((current) => current.map((pair) =>
      pair.id === pointId ? { ...pair, source: null, target: null } : pair,
    ));
    if (guidedSourceId === pointId) setGuidedSourceId(null);
    if (guidedTargetId === pointId) setGuidedTargetId(null);
  }

  function applyGuidedSolution(solution: GeoGuidedRigidSolution) {
    setForm((current) => ({
      ...current,
      eastOffsetM: formatFormNumber(solution.eastOffsetM, 4),
      northOffsetM: formatFormNumber(solution.northOffsetM, 4),
      headingDeg: formatFormNumber(solution.headingDeg, 6),
      scale: formatFormNumber(solution.scale, 6),
    }));
    setError("");
    setMessage(
      `Guided rigid solution applied (${solution.pointCount} points, RMS ${solution.rmsErrorM.toFixed(3)} m). Review live map, fine-align if needed, then Save Geo V2 Draft.`,
    );
  }

  function fineAdjustGuided(delta: GeoGuidedFineDelta) {
    setForm((current) => {
      const east = Number(current.eastOffsetM);
      const north = Number(current.northOffsetM);
      const vertical = Number(current.verticalOffsetM);
      const heading = Number(current.headingDeg);
      const scale = Number(current.scale);
      const nextScale = delta.scaleMultiplier
        ? Math.min(1.5, Math.max(0.5, (Number.isFinite(scale) ? scale : 1) * delta.scaleMultiplier))
        : (Number.isFinite(scale) ? scale : 1);
      return {
        ...current,
        eastOffsetM: formatFormNumber((Number.isFinite(east) ? east : 0) + (delta.eastM || 0), 4),
        northOffsetM: formatFormNumber((Number.isFinite(north) ? north : 0) + (delta.northM || 0), 4),
        verticalOffsetM: formatFormNumber((Number.isFinite(vertical) ? vertical : 0) + (delta.verticalM || 0), 4),
        headingDeg: formatFormNumber(
          normalizeHeading((Number.isFinite(heading) ? heading : 0) + (delta.headingDeg || 0)),
          6,
        ),
        scale: formatFormNumber(nextScale, 6),
      };
    });
    setError("");
    setMessage("Fine alignment applied to the unsaved form. Confirm on the live map, then Save Geo V2 Draft.");
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Geo operation failed.");
    } finally {
      setBusy(false);
    }
  }

  function draftBody(
    modelAnchorId = form.modelAnchorId || null,
    expectedRevision = state?.draft?.revision,
  ) {
    if (!state?.draft || expectedRevision === undefined)
      throw new Error("Geo draft missing.");
    if (!sourceReleaseId || !selectedRelease)
      throw new Error("Building release select karein.");
    if (!validCoordinate(form))
      throw new Error("Valid WGS84 longitude/latitude required hai.");
    const alignment = parsedAlignment(form);
    if (!alignment)
      throw new Error("Geo V2 rigid alignment values valid range me hone chahiye.");
    return {
      expectedRevision,
      sourceBuildingReleaseId: sourceReleaseId,
      longitude: Number(form.longitude),
      latitude: Number(form.latitude),
      ...alignment,
      modelAnchorId,
    };
  }

  async function save() {
    const next = await saveGeoV2(selectedSlug, draftBody());
    await reload(selectedSlug);
    setMessage(next.draft?.modelAnchorId
      ? "Current integrated WGS84 + ENU placement saved. Render complete hone ke baad verify karein."
      : "Alignment saved. Ab exact Building-local model anchor create/select karein.");
  }

  async function createAnchor() {
    if (!selectedRelease) throw new Error("Building release select karein.");
    const anchorName = anchorForm.name.trim();
    if (!anchorName) throw new Error("Model anchor name required hai.");
    if (anchorName.length > 160) throw new Error("Model anchor name 160 characters se chhota rakhein.");

    let workingRevision = state?.draft?.revision;
    if (workingRevision === undefined) throw new Error("Geo draft missing.");
    if (state?.experience?.sourceBuildingReleaseId !== sourceReleaseId) {
      const switched = await saveGeoV2(
        selectedSlug,
        draftBody(null, workingRevision),
      );
      workingRevision = switched.draft?.revision;
      if (workingRevision === undefined)
        throw new Error("Geo source switch ke baad draft revision missing hai.");
    }

    const values = [anchorForm.xM, anchorForm.yM, anchorForm.zM].map(Number);
    if (values.some((value) => !inRange(value, -100000, 100000)))
      throw new Error("Model anchor X/Y/Z canonical metres me -100000 se 100000 ke beech hone chahiye.");

    const next = await createGeoV2Anchor(selectedSlug, {
      sourceBuildingReleaseId: sourceReleaseId,
      kind: anchorForm.kind,
      name: anchorName,
      xM: values[0],
      yM: values[1],
      zM: values[2],
    });
    const created = next.anchors.find((anchor) =>
      anchor.sourceBuildingReleaseId === sourceReleaseId &&
      anchor.name === anchorName &&
      anchor.xM === values[0] &&
      anchor.yM === values[1] &&
      anchor.zM === values[2],
    );
    if (!created) throw new Error("Created model anchor response me resolve nahi hua.");

    const revision = next.draft?.revision ?? workingRevision;
    await saveGeoV2(selectedSlug, draftBody(created.id, revision));
    await reload(selectedSlug);
    setMessage(`Model anchor “${created.name}” created, selected and draft-saved.`);
  }

  async function enableGeo() {
    const source = activeRelease || selectedRelease;
    if (!source) throw new Error("Publish one Building release before enabling Geo.");
    await createGeoExperience(selectedSlug, source.id);
    await reload(selectedSlug);
    setMessage("Optional Geo Experience created. Set WGS84 + ENU alignment next.");
  }

  async function verify() {
    if (verificationBlocker) throw new Error(verificationBlocker);
    if (!state?.draft) throw new Error("Geo draft missing.");
    if (previewVariant !== "canonical") throw new Error("Verify in Canonical GLB mode only.");
    await verifyGeoPreview(selectedSlug, state.draft.revision);
    await reload(selectedSlug);
    setMessage("Current saved revision verified from the integrated same-map Building preview.");
  }

  async function publish() {
    if (!state?.draft) throw new Error("Geo draft missing.");
    if (!publishReady)
      throw new Error("Current saved revision ko integrated preview me render + verify karke publish karein.");
    await publishGeoRelease(selectedSlug, state.draft.revision);
    await reload(selectedSlug);
    setMessage("Immutable Geo V2 release published and activated.");
  }

  async function activate(id: string) {
    await activateGeoRelease(selectedSlug, id);
    await reload(selectedSlug);
    setMessage("Selected immutable Geo release activated.");
  }

  async function saveKey() {
    const key = mapsApiKey.trim();
    if (!key) throw new Error("Google Maps browser key enter karein.");
    const saved = await saveGeoMapsKey(key);
    setMapsApiKey(saved.apiKey);
    setConfiguredMapsApiKey(saved.apiKey);
    setMessage("Google Maps browser key saved. Integrated map is reloading with the saved key.");
  }

  return (
    <main className={`geo3d-shell geo3d-v2-shell${focusMode ? " geo3d-v2-shell--focus-active" : ""}`}>
      <header className="geo3d-topbar">
        <div>
          <p className="eyebrow">REKIXO AR3D ENGINE · GEO V2</p>
          <h1>WGS84 + ENU 3D Geo Mapper</h1>
          <p>Rigid Building placement only. Masterplan calibration never warps Building geometry.</p>
        </div>
        <div className="geo3d-actions">
          <select value={selectedSlug} disabled={busy} onChange={(event) => setSelectedSlug(event.target.value)}>
            {projectList.map((project) => <option key={project.id} value={project.slug}>{project.name}</option>)}
          </select>
          {selectedSlug && <a href={`/3Dprojects/${encodeURIComponent(selectedSlug)}/geo`} target="_blank" rel="noreferrer">Public Geo</a>}
          <a href="/3Dprojects">Projects</a>
        </div>
      </header>

      {error && <div className="geo3d-alert geo3d-alert--error">{error}</div>}
      {message && <div className="geo3d-alert geo3d-alert--ok">{message}</div>}

      <section className="geo3d-health">
        <article><span>BUILDING SOURCE</span><strong>{selectedRelease ? `v${selectedRelease.version}` : "—"}</strong><small>{sourcePreviewAvailable ? "Immutable preview available" : "Select active release for verification"}</small></article>
        <article><span>GEO DRAFT</span><strong>{state?.draft ? `r${state.draft.revision}` : "Not enabled"}</strong><small>{savedForm ? "Current form matches saved revision" : "Unsaved placement changes"}</small></article>
        <article><span>INTEGRATED PREVIEW</span><strong>{previewState === "ready" ? "Ready" : "Pending"}</strong><small>{previewStateLabel(previewState)}</small></article>
        <article><span>LIVE GEO</span><strong>{geoReleaseState?.activeRelease ? `v${geoReleaseState.activeRelease.version}` : "None"}</strong><small>Immutable Geo release</small></article>
      </section>

      {!state?.experience ? (
        <section className="geo3d-form-card">
          <div className="geo3d-section-head"><div><p className="eyebrow">OPTIONAL EXPERIENCE</p><h3>Enable 3D Geo for this project</h3></div></div>
          <p className="geo3d-help">Building release stays independent. Geo pins one immutable Building release and adds geographic truth.</p>
          <div className="geo3d-save-row"><button className="geo3d-primary" disabled={busy || !activeRelease} onClick={() => void run(enableGeo)}>Enable Geo Experience</button></div>
        </section>
      ) : (
        <>
          <section className="geo3d-form-card geo3d-source-card">
            <div className="geo3d-section-head"><div><p className="eyebrow">PINNED BUILDING SOURCE</p><h3>Immutable Building Release</h3></div><span className="geo3d-draft-badge">{state.experience.lifecycle}</span></div>
            <div className="geo3d-source-grid">
              <label><span>BUILDING RELEASE</span><select value={sourceReleaseId} disabled={busy} onChange={(event) => { setSourceReleaseId(event.target.value); patch("modelAnchorId", ""); }}>
                {releaseItems.map((release) => <option key={release.id} value={release.id}>v{release.version}{release.active ? " · ACTIVE" : ""} · {release.id}</option>)}
              </select></label>
              <div className="geo3d-source-note"><strong>{sourceReleaseId === state.project.activeBuildingReleaseId ? "Active Building release" : "Historical Building release"}</strong><span>Verification deliberately requires the active immutable Building release so authoring cannot approve an unseen source.</span></div>
            </div>
          </section>

          <section className="geo3d-workspace geo-v2-workspace--integrated">
            <article className={`geo3d-map-card geo-v2-integrated-card${focusMode ? " geo-v2-integrated-card--focus" : ""}${!dockOpen ? " geo-v2-integrated-card--dock-closed" : ""}`}>
              <div className="geo3d-section-head geo-v2-focus-header">
                <div><p className="eyebrow">GEO SITE ALIGNMENT</p><h3>3D Plot Site · Satellite Alignment</h3></div>
                <div className="geo-v2-focus-actions">
                  {geoDerivativeAvailable && <label className="geo-v2-variant-control"><span>COMPARE GEOMETRY</span>
                    <select aria-label="3D preview geometry variant" value={previewVariant} onChange={(event) => setPreviewVariant(event.target.value as "canonical" | "geo")}>
                      <option value="canonical">Canonical GLB (alignment)</option>
                      <option value="geo">Geo derivative (diagnostic)</option>
                    </select>
                  </label>}
                  {focusMode && <button type="button" onClick={() => setDockOpen((open) => !open)}>{dockOpen ? "Hide Tools" : "Show Tools"}</button>}
                  <button type="button" className="geo-v2-focus-button" aria-pressed={focusMode} onClick={toggleEditor}>
                    {focusMode ? "Exit Full Editor" : "Open Full Editor"}
                  </button>
                </div>
              </div>
              {previewVariant === "geo" && <p className="geo-v2-variant-note" role="status">Derivative diagnostic only: origin can differ. Return to Canonical GLB before verifying.</p>}
              {focusMode && <div className="geo-v2-editor-statusline">
                <strong>{selectedSlug.toUpperCase()} · {selectedRelease ? `3D v${selectedRelease.version}` : "No 3D release"}</strong>
                <span>Geo {state?.draft ? `r${state.draft.revision}` : "not enabled"}</span>
                <span>{savedForm ? "Saved revision" : "Unsaved changes"}</span>
                <span>{previewState === "ready" ? "Preview ready" : previewStateLabel(previewState)}</span>
                <span>{guidedPairs.filter((pair) => pair.source && pair.target).length}/4 corner pairs</span>
              </div>}
              <div className="geo-v2-exact-placement-grid">
                <div className="geo-v2-map-column">
                  <GeoIntegratedAuthoringMap
                    apiKey={configuredMapsApiKey}
                    projectKey={selectedSlug}
                    modelUrl={renderModel?.url || null}
                    modelName={renderModel?.name || "Building"}
                    coordinate={previewCoordinate}
                    anchor={selectedAnchor}
                    placement={previewPlacement}
                    alignmentCaptureId={guidedTargetId}
                    alignmentTargets={guidedMapTargets}
                    onCoordinateChange={setCoordinate}
                    onAlignmentTargetCapture={captureGuidedTarget}
                    onPreviewStateChange={setPreviewState}
                    editorFocused={focusMode}
                    onToggleEditor={toggleEditor}
                  />
                </div>
                <div className={`geo-v2-guided-dock${focusMode ? " geo-v2-guided-dock--editor" : ""}`}>
                  {focusMode && <nav className="geo-v2-editor-tabs" role="tablist" aria-label="Geo editor tools">
                    {([["corners", "Corners"], ["fine", "Fine Tune"], ["position", "Position"], ["release", "Release"]] as const).map(([tab, label]) => (
                      <button type="button" key={tab} role="tab" aria-selected={editorTab === tab}
                        onClick={() => setEditorTab(tab)}>{label}</button>
                    ))}
                  </nav>}
                  <div className={`geo-v2-editor-guide${focusMode ? ` geo-v2-editor-guide--${editorTab}` : ""}`}>
                  <GeoGuidedRigidAlignment
                  modelUrl={renderModel?.url || null}
                  modelName={renderModel?.name || "Building"}
                  coordinate={previewCoordinate}
                  anchor={selectedAnchor}
                  pairs={guidedPairs}
                  activeSourceId={guidedSourceId}
                  activeTargetId={guidedTargetId}
                  allowScale={guidedAllowScale}
                  onActivateSource={setGuidedSourceId}
                  onActivateTarget={setGuidedTargetId}
                  onSourceCapture={captureGuidedSource}
                  onClearPair={clearGuidedPair}
                  onAllowScaleChange={setGuidedAllowScale}
                  onApply={applyGuidedSolution}
                  onFineAdjust={fineAdjustGuided}
                /></div>
                  {focusMode && editorTab === "position" && <section className="geo-v2-editor-position" aria-label="Geo placement and model anchor">
                    <h4>WGS84 · Site Position</h4>
                    <p>Use the same verified project coordinates, heading and uniform scale as the main editor.</p>
                    <div className="geo-v2-editor-position-grid">
                      <label className="geo-v2-editor-span-2"><span>BUILDING SOURCE RELEASE</span>
                        <select disabled={busy} value={sourceReleaseId} onChange={(event) => {
                          setSourceReleaseId(event.target.value);
                          patch("modelAnchorId", "");
                        }}>
                          {releaseItems.map((release) => <option key={release.id} value={release.id}>
                            v{release.version}{release.active ? " · ACTIVE" : " · HISTORICAL"}
                          </option>)}
                        </select>
                      </label>
                      {(["latitude", "longitude", "eastOffsetM", "northOffsetM", "headingDeg", "scale", "altitudeM", "verticalOffsetM", "pitchDeg", "rollDeg"] as const).map((key) => (
                        <label key={key}><span>{key.replace(/([A-Z])/g, " $1").toUpperCase()}</span>
                          <input inputMode="decimal" value={form[key]} onChange={(event) => patch(key, event.target.value)} />
                        </label>
                      ))}
                      <label><span>HEIGHT MODE</span><select value={form.heightMode} onChange={(event) => patch("heightMode", event.target.value as GeoHeightMode)}>
                        <option value="ground-clamped">ground-clamped</option><option value="ground-relative">ground-relative</option><option value="absolute">absolute</option>
                      </select></label>
                      <label><span>MODEL ANCHOR</span><select value={form.modelAnchorId} onChange={(event) => patch("modelAnchorId", event.target.value)}>
                        <option value="">Select exact anchor</option>
                        {state.anchors.filter((anchor) => anchor.sourceBuildingReleaseId === sourceReleaseId).map((anchor) =>
                          <option key={anchor.id} value={anchor.id}>{anchor.name} · {anchor.kind}</option>)}
                      </select></label>
                    </div>
                    <div className="geo-v2-editor-anchor-creator">
                      <h4>Create / select new model anchor</h4>
                      <div className="geo-v2-editor-position-grid">
                        <label><span>ANCHOR NAME</span><input value={anchorForm.name} onChange={(event) => setAnchorForm((current) => ({ ...current, name: event.target.value }))} /></label>
                        <label><span>ANCHOR TYPE</span><select value={anchorForm.kind} onChange={(event) => setAnchorForm((current) => ({ ...current, kind: event.target.value as GeoAnchorKind }))}>
                          <option value="custom">custom</option><option value="main-gate">main-gate</option>
                          <option value="site-center">site-center</option><option value="south-west-corner">south-west-corner</option><option value="entrance">entrance</option>
                        </select></label>
                        {(["xM", "yM", "zM"] as const).map((key) => <label key={key}><span>{key.toUpperCase()} · MODEL METRES</span>
                          <input inputMode="decimal" value={anchorForm[key]}
                            onChange={(event) => setAnchorForm((current) => ({ ...current, [key]: event.target.value }))} /></label>)}
                      </div>
                      <button type="button" disabled={busy || !selectedRelease} onClick={() => void run(createAnchor)}>Create & Select Anchor</button>
                      <p>Only use measured canonical 3D coordinates. Model origin 0,0,0 is not automatically the site gate.</p>
                    </div>
                    <p>To pick the four site corners, switch to Corners. A normal map click outside point-capture mode moves the main WGS84 anchor.</p>
                  </section>}
                  {focusMode && editorTab === "release" && <section className="geo-v2-editor-release" aria-label="Review and publish Geo release">
                    <h4>Release checklist</h4>
                    <div><span>Immutable 3D source</span><strong>{sourceReleaseId === state.project.activeBuildingReleaseId ? "ACTIVE" : "Source not active"}</strong></div>
                    <div><span>Saved Geo revision</span><strong>{savedForm ? `r${state.draft?.revision}` : "Save required"}</strong></div>
                    <div><span>Integrated preview</span><strong>{previewState === "ready" ? "Ready" : "Pending"}</strong></div>
                    <div><span>Verification</span><strong>{geoReleaseState?.previewVerified && savedForm ? "Verified" : "Not verified"}</strong></div>
                    <div><span>Live Geo</span><strong>{geoReleaseState?.activeRelease ? `v${geoReleaseState.activeRelease.version}` : "Unpublished"}</strong></div>
                    <p>{verificationBlocker || "Review the saved site position and all real-world corners before verifying."}</p>
                    <p>Publish creates a separate immutable Geo release. It never warps the canonical GLB.</p>
                  </section>}
                </div>
              </div>
              {focusMode && <footer className="geo-v2-editor-footer">
                <div className="geo-v2-editor-footer-summary" role="status">
                  <strong>{error ? "Error" : message ? "Updated" : savedForm ? "Draft saved" : "Unsaved placement"}</strong>
                  <span>{error || message || (guidedTargetId ? `Pick ${guidedTargetId} on Satellite Map now` : guidedSourceId ? `Pick ${guidedSourceId} on the model preview now` : verificationBlocker || "Ready to verify current saved Geo revision")}</span>
                </div>
                <div className="geo-v2-editor-footer-actions">
                  <button type="button" onClick={() => setEditorTab("corners")}>4-point Fit</button>
                  <button type="button" className="geo-v2-editor-save" disabled={busy || !previewCoordinate || !previewPlacement}
                    onClick={() => void run(save)}>{busy ? "Working…" : "Save Draft"}</button>
                  <button type="button" disabled={busy || Boolean(verificationBlocker)}
                    title={verificationBlocker || "Verify saved current revision"}
                    onClick={() => void run(verify)}>Verify Preview</button>
                  <button type="button" className="geo-v2-editor-publish" disabled={busy || !publishReady}
                    title={!publishReady ? "Verify current saved preview first" : "Publish immutable Geo release"}
                    onClick={() => {
                      if (window.confirm("Publish this exact saved and verified Geo placement to the public website? Confirm the actual site corners, orientation and scale were checked."))
                        void run(publish);
                    }}>Publish Geo</button>
                </div>
              </footer>}
              <p className="geo3d-help">Normal map click/drag moves the WGS84 anchor. While a P1–P4 Map capture is active, the WGS84 anchor is locked and the next map click records only that real-site control point.</p>
              <p className="geo3d-help">P1–P4 picks are browser-tab scratch data (restored on refresh for this release), not saved to Cloud or the immutable Geo release. Apply the solution and Save Geo V2 Draft to store the approved transform.</p>
              <p className="geo3d-help">Guided alignment solves a rigid least-squares Building fit only. P1/P2 provide heading + East/North; P3/P4 expose residual error without homography, shear, or Building deformation.</p>
              <p className="geo3d-help">Verify is fail-closed: the current values must be saved, the selected source must be ACTIVE, the exact model anchor must be selected, and the same-map Building frame must render successfully.</p>
            </article>
          </section>

          <section className="geo3d-form-card">
            <div className="geo3d-section-head"><div><p className="eyebrow">RIGID ALIGNMENT</p><h3>WGS84 + local ENU</h3></div></div>
            <div className="geo3d-form-grid">
              {(["longitude", "latitude", "eastOffsetM", "northOffsetM", "verticalOffsetM", "headingDeg", "pitchDeg", "rollDeg", "scale", "altitudeM"] as const).map((key) => (
                <label key={key}><span>{key.toUpperCase()}</span><input value={form[key]} onChange={(event) => patch(key, event.target.value)} /></label>
              ))}
              <label><span>HEIGHT MODE</span><select value={form.heightMode} onChange={(event) => patch("heightMode", event.target.value as GeoHeightMode)}><option value="ground-clamped">ground-clamped</option><option value="ground-relative">ground-relative</option><option value="absolute">absolute</option></select></label>
              <label><span>MODEL ANCHOR</span><select data-geo-model-anchor value={form.modelAnchorId} onChange={(event) => patch("modelAnchorId", event.target.value)}><option value="">Select explicit anchor</option>{state.anchors.filter((anchor) => anchor.sourceBuildingReleaseId === sourceReleaseId).map((anchor) => <option key={anchor.id} value={anchor.id}>{anchor.name} · {anchor.kind}</option>)}</select></label>
            </div>
            <div className="geo3d-save-row"><button className="geo3d-primary" disabled={busy || !previewCoordinate || !previewPlacement} onClick={() => void run(save)}>Save Geo V2 Draft</button><span>Every save advances the draft revision; verification applies only to that saved revision.</span></div>
          </section>

          <section className="geo3d-form-card">
            <div className="geo3d-section-head"><div><p className="eyebrow">BUILDING-LOCAL ANCHOR</p><h3>Create explicit model anchor</h3></div></div>
            <div className="geo3d-form-grid">
              <label><span>NAME</span><input value={anchorForm.name} onChange={(event) => setAnchorForm((current) => ({ ...current, name: event.target.value }))} /></label>
              <label><span>KIND</span><select value={anchorForm.kind} onChange={(event) => setAnchorForm((current) => ({ ...current, kind: event.target.value as GeoAnchorKind }))}><option value="entrance">entrance</option><option value="main-gate">main-gate</option><option value="site-center">site-center</option><option value="south-west-corner">south-west-corner</option><option value="custom">custom</option></select></label>
              {(["xM", "yM", "zM"] as const).map((key) => <label key={key}><span>{key.toUpperCase()} · CANONICAL M</span><input value={anchorForm[key]} onChange={(event) => setAnchorForm((current) => ({ ...current, [key]: event.target.value }))} /></label>)}
            </div>
            <p className="geo3d-help">Coordinates are measured in the immutable Building model's canonical metre frame. Keep “Model origin / custom / 0,0,0” unless a semantic gate/corner has actually been measured; map pixels are never used to guess Building-local coordinates.</p>
            <div className="geo3d-save-row"><button disabled={busy} onClick={() => void run(createAnchor)}>Create & Select Anchor</button></div>
          </section>

          <section className="geo3d-form-card geo3d-release-card">
            <div className="geo3d-section-head"><div><p className="eyebrow">VERIFY → IMMUTABLE RELEASE</p><h3>Publication gate</h3></div></div>
            <div className="geo3d-save-row">
              <button disabled={busy || Boolean(verificationBlocker)} onClick={() => void run(verify)}>Verify Current Preview</button>
              <button className="geo3d-primary" disabled={busy || !publishReady} onClick={() => void run(publish)}>Publish Immutable Geo Release</button>
              <span className={verificationBlocker ? "geo-v2-verification-note geo-v2-verification-note--blocked" : "geo-v2-verification-note"}>{verificationBlocker || (geoReleaseState?.previewVerified ? "Current saved revision is verified and ready to publish." : "Integrated preview is ready. Verify this saved revision next.")}</span>
            </div>
            {!!geoReleaseState?.releases.length && <div className="geo-v2-release-list">{geoReleaseState.releases.map((release) => <article key={release.id}><div><strong>Geo v{release.version}{release.active ? " · LIVE" : ""}</strong><small>{release.id}</small></div>{!release.active && <button disabled={busy} onClick={() => void run(() => activate(release.id))}>Activate</button>}</article>)}</div>}
          </section>
        </>
      )}

      <section className="geo3d-form-card">
        <div className="geo3d-section-head"><div><p className="eyebrow">MAP PROVIDER</p><h3>Browser key</h3></div></div>
        <div className="geo3d-key-row"><input type="password" value={mapsApiKey} onChange={(event) => setMapsApiKey(event.target.value)} placeholder="Google Maps browser API key" /><button disabled={busy} onClick={() => void run(saveKey)}>Save Key</button></div>
        <p className="geo3d-help">The authoring map uses only the last saved key, so editing this field cannot tear down a live placement session.</p>
      </section>
    </main>
  );
}
