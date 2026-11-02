import { useEffect, useMemo, useState } from "react";
type BrandingIconName = "badge" | "building" | "check" | "copy" | "external" | "image" | "loader" | "map" | "save" | "share" | "shield" | "upload";

function BrandingIcon({ name, size = 17, className }: { name: BrandingIconName; size?: number; className?: string }) {
  const symbols: Record<BrandingIconName, string> = {
    badge: "✓", building: "▥", check: "✓", copy: "▣", external: "↗",
    image: "▧", loader: "◌", map: "⌖", save: "▣", share: "↗",
    shield: "⬡", upload: "↑",
  };
  return <span aria-hidden="true" className={className} style={{ width: size, height: size, display: "inline-flex", flex: "0 0 auto", alignItems: "center", justifyContent: "center", fontSize: Math.max(12, size), lineHeight: 1 }}>{symbols[name]}</span>;
}
import {
  getProjectBranding,
  publishProjectLogo,
  publishGeoSiteBranding,
  publishBuildingSiteBranding,
  publishProjectShare,
  saveProjectShareDetails,
  uploadProjectLogo,
  uploadProjectShareCard,
  type BrandingExperience,
  type CloudProjectBrandingState,
} from "../studio/cloud";
import { prepareBrandedShareCard } from "./shareCardBranding";
import "./project-share-builder.css";

const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type PreparedLogo = { sourceFile: File; logoFile: File; faviconFile: File };
type PreparedCard = { sourceFile: File; cardFile: File };
type ShareDraft = { title: string; description: string };
type BusyAction = "load" | "logo" | "share" | "details" | "publish-logo" | "publish-share" | "update-geo" | "update-building" | "";

function fileFromBlob(blob: Blob, name: string, type: string) {
  return new File([blob], name, { type, lastModified: Date.now() });
}

async function canvasImageFile(
  file: File,
  dimension: number,
  mime: "image/webp" | "image/png",
  quality?: number,
) {
  if (!IMAGE_TYPES.has(file.type)) throw new Error("JPG, PNG ya WebP image upload karein.");
  if (!file.size || file.size > MAX_SOURCE_BYTES) throw new Error("Image 8 MB se chhoti honi chahiye.");
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width < 1 || bitmap.height < 1 || bitmap.width * bitmap.height > 100_000_000)
      throw new Error("Image dimensions supported range me nahi hain.");
    const canvas = document.createElement("canvas");
    canvas.width = dimension;
    canvas.height = dimension;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("Image canvas initialize nahi hua.");
    context.clearRect(0, 0, dimension, dimension);
    context.save();
    context.beginPath();
    context.arc(dimension / 2, dimension / 2, dimension / 2, 0, Math.PI * 2);
    context.clip();
    const scale = Math.max(dimension / bitmap.width, dimension / bitmap.height);
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    context.drawImage(bitmap, (dimension - width) / 2, (dimension - height) / 2, width, height);
    context.restore();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, mime, quality),
    );
    if (!blob || blob.type !== mime) throw new Error("Image ko required format me convert nahi kar paaye.");
    return blob;
  } finally {
    bitmap.close();
  }
}

async function prepareLogo(file: File): Promise<PreparedLogo> {
  const [logo, favicon] = await Promise.all([
    canvasImageFile(file, 512, "image/webp", 0.86),
    canvasImageFile(file, 64, "image/png"),
  ]);
  if (logo.size > 512 * 1024) throw new Error("Optimized circular logo 512 KB se chhota rakhein.");
  if (favicon.size > 128 * 1024) throw new Error("Favicon 128 KB se chhota rakhein.");
  return {
    sourceFile: file,
    logoFile: fileFromBlob(logo, "project-logo.webp", "image/webp"),
    faviconFile: fileFromBlob(favicon, "project-favicon.png", "image/png"),
  };
}

function revokeUrl(url: string) {
  if (url.startsWith("blob:")) URL.revokeObjectURL(url);
}

export default function ProjectShareBuilder() {
  const slug = useMemo(
    () => new URLSearchParams(window.location.search).get("project")?.trim().toLowerCase() || "",
    [],
  );
  const [state, setState] = useState<CloudProjectBrandingState>();
  const [activeExperience, setActiveExperience] = useState<BrandingExperience>("building");
  const [drafts, setDrafts] = useState<Record<BrandingExperience, ShareDraft>>({
    building: { title: "", description: "" },
    geo: { title: "", description: "" },
  });
  const [reuseBuildingPoster, setReuseBuildingPoster] = useState(false);
  const [logoFiles, setLogoFiles] = useState<PreparedLogo>();
  const [shareFiles, setShareFiles] = useState<Partial<Record<BrandingExperience, PreparedCard>>>({});
  const [logoPreviewUrl, setLogoPreviewUrl] = useState("");
  const [cardPreviewUrl, setCardPreviewUrl] = useState("");
  const [busy, setBusy] = useState<BusyAction>("");
  const [brandBusy, setBrandBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadState() {
    if (!slug) return;
    setBusy("load");
    setError("");
    try {
      const next = await getProjectBranding(slug);
      setState(next);
      setDrafts({
        building: {
          title: next.experiences.building.draftTitle,
          description: next.experiences.building.draftDescription,
        },
        geo: {
          title: next.experiences.geo.draftTitle,
          description: next.experiences.geo.draftDescription,
        },
      });
      setReuseBuildingPoster(Boolean(next.experiences.geo.useBuildingPoster));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Project branding load nahi hui.");
    } finally {
      setBusy("");
    }
  }

  useEffect(() => {
    void loadState();
  }, [slug]);

  useEffect(() => {
    if (!logoFiles) {
      setLogoPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(logoFiles.logoFile);
    setLogoPreviewUrl(url);
    return () => revokeUrl(url);
  }, [logoFiles]);

  useEffect(() => {
    const file = shareFiles[activeExperience]?.cardFile;
    if (!file) {
      setCardPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(file);
    setCardPreviewUrl(url);
    return () => revokeUrl(url);
  }, [shareFiles, activeExperience]);

  async function chooseLogo(file?: File) {
    if (!file) return;
    setMessage("");
    setError("");
    setBusy("logo");
    try {
      setLogoFiles(await prepareLogo(file));
      setMessage("Circular logo aur favicon preview ready hai. Ab draft upload karein.");
    } catch (reason) {
      setLogoFiles(undefined);
      setError(reason instanceof Error ? reason.message : "Logo optimize nahi hua.");
    } finally {
      setBusy("");
    }
  }

  async function uploadLogoDraft() {
    if (!slug || !logoFiles || busy) return;
    setBusy("logo");
    setError("");
    try {
      await uploadProjectLogo(slug, logoFiles.logoFile, logoFiles.faviconFile, logoFiles.sourceFile);
      setLogoFiles(undefined);
      setMessage("Logo aur favicon draft upload ho gaye. Live site par aane ke liye Publish Logo karein.");
      await loadState();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Logo upload nahi hua.");
    } finally {
      setBusy("");
    }
  }

  async function chooseShareCard(file?: File) {
    if (!file) return;
    setBrandBusy(true);
    setMessage("");
    setError("");
    try {
      const prepared = await prepareBrandedShareCard(file);
      if (activeExperience === "geo") setReuseBuildingPoster(false);
      setShareFiles((current) => ({ ...current, [activeExperience]: prepared }));
      setMessage("Share poster ka preview ready hai; original image unchanged rahegi aur AR3D footer alag hai.");
    } catch (reason) {
      setShareFiles((current) => ({ ...current, [activeExperience]: undefined }));
      setError(reason instanceof Error ? reason.message : "Share poster prepare nahi hua.");
    } finally {
      setBrandBusy(false);
    }
  }

  async function uploadShareDraft() {
    const files = shareFiles[activeExperience];
    if (!slug || !files || busy || brandBusy) return;
    setBusy("share");
    setError("");
    try {
      await uploadProjectShareCard(slug, activeExperience, files.cardFile, files.sourceFile);
      setShareFiles((current) => ({ ...current, [activeExperience]: undefined }));
      setMessage(`${activeExperience === "geo" ? "Geo" : "Building"} share poster draft upload ho gaya.`);
      await loadState();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Share poster upload nahi hua.");
    } finally {
      setBusy("");
    }
  }

  async function saveDetails() {
    if (!slug || busy || brandBusy) return;
    const draft = drafts[activeExperience];
    setBusy("details");
    setError("");
    setMessage("");
    try {
      await saveProjectShareDetails(
        slug,
        activeExperience,
        draft.title,
        draft.description,
        activeExperience === "geo" && reuseBuildingPoster,
      );
      setMessage("Share settings save ho gayi. Public preview Publish Share ke baad badlega.");
      await loadState();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Share details save nahi hue.");
    } finally {
      setBusy("");
    }
  }

  async function publishLogo() {
    if (!slug || !state?.logo.draftVersion || busy) return;
    setBusy("publish-logo");
    setError("");
    try {
      await publishProjectLogo(slug, state.logo.draftVersion);
      setMessage("Project logo aur favicon publish ho gaye. Building aur Geo dono isi published logo ko use karenge.");
      await loadState();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Logo publish nahi hua.");
    } finally {
      setBusy("");
    }
  }

  async function publishShare() {
    if (!slug || busy) return;
    setBusy("publish-share");
    setError("");
    setMessage("");
    try {
      const draft = drafts[activeExperience];
      // Keep the publish API authoritative, but save the latest edited text first.
      await saveProjectShareDetails(
        slug,
        activeExperience,
        draft.title,
        draft.description,
        activeExperience === "geo" && reuseBuildingPoster,
      );
      await publishProjectShare(slug, activeExperience);
      setMessage(`${activeExperience === "geo" ? "Geo" : "Building"} share preview version publish ho gaya.`);
      await loadState();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Share publish nahi hua.");
    } finally {
      setBusy("");
    }
  }

  async function updateBuildingSite() {
    if (!slug || !state || busy || brandBusy) return;
    if (logoFiles || shareFiles.building || shareFiles.geo) {
      setError("Upload the chosen Logo / Share poster first, then publish the Building update.");
      return;
    }
    setBusy("update-building");
    setError("");
    setMessage("");
    try {
      const result = await publishBuildingSiteBranding(slug, {
        title: drafts.building.title,
        description: drafts.building.description,
        expectedLogoDraftVersion: state.logo.draftVersion || "",
        expectedBuildingCardVersion: state.experiences.building.draftCardVersion || "",
      });
      setMessage("Building site branding updated: logo, favicon and WhatsApp share preview are published.");
      await loadState();
      if (!result.shareUrl) setError("Refresh and verify the new Building share link.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Building update failed. Previously published branding is unchanged.");
    } finally {
      setBusy("");
    }
  }

  async function updateGeoSite() {
    if (!slug || !state || busy || brandBusy) return;
    if (logoFiles || shareFiles.geo || shareFiles.building) {
      setError("Pehle selected Logo / Share poster ka draft upload karein, phir Update Geo Site dabayein.");
      return;
    }
    setBusy("update-geo");
    setError("");
    setMessage("");
    try {
      const result = await publishGeoSiteBranding(slug, {
        title: drafts.geo.title,
        description: drafts.geo.description,
        useBuildingPoster: reuseBuildingPoster,
        expectedLogoDraftVersion: state.logo.draftVersion || "",
        expectedGeoCardVersion: state.experiences.geo.draftCardVersion || "",
        expectedBuildingCardVersion: state.experiences.building.draftCardVersion || "",
      });
      setMessage("Geo site updated successfully. Logo aur WhatsApp preview publish ho gaye. Naya versioned Geo share link neeche hai.");
      await loadState();
      if (!result.shareUrl) setError("Geo share URL reload karke verify karein.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Geo site update nahi hui. Published changes pehle jaise hain.");
    } finally {
      setBusy("");
    }
  }

  async function copyLink() {
    const shareUrl = state?.experiences[activeExperience].shareUrl || "";
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setMessage("Published share link copy ho gaya.");
    } catch {
      setError("Clipboard permission nahi mili. Link box se URL manually copy karein.");
    }
  }

  const currentShare = state?.experiences[activeExperience];
  const currentDraft = drafts[activeExperience];
  const buildingPosterPreview = state?.experiences.building.draftCardPreviewUrl ||
    state?.experiences.building.publishedCardUrl || "";
  const cardUrl =
    activeExperience === "geo"
      ? (reuseBuildingPoster
          ? buildingPosterPreview
          : cardPreviewUrl || currentShare?.draftCardPreviewUrl || buildingPosterPreview)
      : cardPreviewUrl || currentShare?.draftCardPreviewUrl || "";
  const busyNow = Boolean(busy || brandBusy);
  const titleValid = currentDraft.title.trim().length >= 3 && currentDraft.title.trim().length <= 120;
  const descriptionValid = currentDraft.description.trim().length >= 10 && currentDraft.description.trim().length <= 280;
  const geoShareUrl = state?.experiences.geo.shareUrl || "";
  const geoWhatsAppUrl = geoShareUrl
    ? `https://wa.me/?text=${encodeURIComponent(`${state?.project.name || "Project"} — 3D Geo\n${geoShareUrl}`)}`
    : "";
  const stagedFiles = Boolean(logoFiles || shareFiles.geo || shareFiles.building);

  if (!slug) {
    return (
      <section className="engine-branding-empty engine-control-card">
        <BrandingIcon name="shield" size={30} />
        <h2>Select a project</h2>
        <p>Overview se project create karein ya project select karke Share & Branding workspace kholein.</p>
        <a className="engine-control-link" href="/3Dprojects">Open Project Overview</a>
      </section>
    );
  }

  return (
    <div className="engine-branding">
      <section className="engine-branding-hero engine-control-card">
        <div className="engine-branding-hero__mark"><BrandingIcon name="share" size={22} /></div>
        <div>
          <p className="eyebrow">PROJECT BRANDING</p>
          <h2>{state?.project.name || slug}</h2>
          <p>One logo and favicon for Building + Geo, with independent share previews for each live experience.</p>
        </div>
        <div className="engine-branding-hero__actions">
          <button type="button" className="engine-control-button engine-control-button--primary"
            onClick={() => void (activeExperience === "geo" ? updateGeoSite() : updateBuildingSite())}
            disabled={busyNow || !state?.experiences[activeExperience].live}
            title={state?.experiences[activeExperience].live
              ? "Publish the selected site's logo and WhatsApp share preview as one versioned update"
              : "Publish this experience first"}>
            <BrandingIcon name={busy === "update-geo" || busy === "update-building" ? "loader" :
              activeExperience === "geo" ? "map" : "building"} size={16} />
            {busy === "update-geo" || busy === "update-building" ? "Publishing…" :
              activeExperience === "geo" ? "Update Geo Site" : "Update Building Site"}
          </button>
          <button type="button" className="engine-control-button" onClick={() => void loadState()} disabled={busyNow}>
            {busy === "load" ? <BrandingIcon name="loader" size={17} className="engine-branding-spin" /> : "Refresh"}
          </button>
          {geoShareUrl ? (
            <a className="engine-control-link engine-branding-whatsapp-link" href={geoWhatsAppUrl}
              target="_blank" rel="noopener noreferrer">
              <BrandingIcon name="share" size={15} />Share Geo on WhatsApp
            </a>
          ) : null}
        </div>
      </section>

      <p className="engine-branding-update-hint">
        {!state?.experiences[activeExperience].live
          ? "Publish the selected experience first. No draft changes will appear on the live site until then."
          : stagedFiles
            ? "Upload selected logo and poster files before publishing. The current public site remains unchanged."
            : "Update publishes the selected experience's logo and WhatsApp preview as a versioned change, without replacing other experiences or prior releases."}
      </p>
      {error ? <div className="engine-branding-alert engine-branding-alert--error" role="alert">{error}</div> : null}
      {message ? <div className="engine-branding-alert engine-branding-alert--ok" role="status"><BrandingIcon name="check" size={17} />{message}</div> : null}

      <section className="engine-branding-card engine-control-card">
        <div className="engine-branding-section-head">
          <div>
            <p className="eyebrow">COMMON PROJECT IDENTITY</p>
            <h3>Logo & Favicon</h3>
            <span>Upload once. The same published circular logo and PNG favicon are used by the Building and Geo experiences.</span>
          </div>
          <span className={state?.logo.publishedVersion ? "engine-branding-status engine-branding-status--ready" : "engine-branding-status"}>
            {state?.logo.publishedVersion ? "PUBLISHED" : "NOT PUBLISHED"}
          </span>
        </div>
        <div className="engine-branding-logo-grid">
          <div className="engine-branding-logo-preview">
            {logoPreviewUrl || state?.logo.previewUrl ? (
              <img src={logoPreviewUrl || state?.logo.previewUrl} alt="Circular project logo preview" />
            ) : <div className="engine-branding-logo-empty">LOGO</div>}
            <span>Website logo</span>
          </div>
          <div className="engine-branding-logo-preview engine-branding-favicon-preview">
            {logoFiles ? (
              <img src={logoPreviewUrl} alt="Favicon preview" />
            ) : state?.logo.faviconPreviewUrl ? (
              <img src={state.logo.faviconPreviewUrl} alt="Favicon preview" />
            ) : <div className="engine-branding-favicon-empty">R</div>}
            <span>64 px favicon</span>
          </div>
          <div className="engine-branding-logo-controls">
            <label className="engine-branding-file">
              <BrandingIcon name="upload" size={17} />
              {busy === "logo" ? "Preparing logo…" : "Choose / replace circular logo"}
              <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busyNow} onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                void chooseLogo(file);
              }} />
            </label>
            <p>Logo preview is circularly cropped. Original upload is not used as a public direct file; optimized WebP and PNG variants are stored under this project.</p>
            {logoFiles ? (
              <button className="engine-control-button engine-control-button--primary" type="button" onClick={() => void uploadLogoDraft()} disabled={busyNow}>
                {busy === "logo" ? "Uploading draft…" : "Upload logo draft"}
              </button>
            ) : null}
            <details className="engine-branding-advanced-action">
              <summary>Advanced · Publish logo only</summary>
              <button className="engine-control-button" type="button" onClick={() => void publishLogo()} disabled={busyNow || !state?.logo.draftVersion}>
                {busy === "publish-logo" ? "Publishing…" : "Publish Logo & Favicon"}
              </button>
            </details>
            {state?.logo.publishedLogoUrl ? <a className="engine-branding-small-link" href={state.logo.publishedLogoUrl} target="_blank" rel="noreferrer"><BrandingIcon name="external" size={14} /> Open published logo</a> : null}
            {state?.logo.sourceUrl ? <a className="engine-branding-small-link" href={state.logo.sourceUrl} target="_blank" rel="noreferrer" download><BrandingIcon name="external" size={14} /> Download original logo</a> : null}
          </div>
        </div>
      </section>

      <section className="engine-branding-card engine-control-card">
        <div className="engine-branding-section-head">
          <div>
            <p className="eyebrow">EXPERIENCE SHARE BUILDER</p>
            <h3>Share Preview</h3>
            <span>Building and Geo have their own title, description, poster and versioned share URL.</span>
          </div>
        </div>
        <div className="engine-branding-tabs" role="tablist" aria-label="Experience share">
          <button type="button" role="tab" aria-selected={activeExperience === "building"} className={activeExperience === "building" ? "active" : ""} onClick={() => setActiveExperience("building")}><BrandingIcon name="building" size={17} />Building</button>
          <button type="button" role="tab" aria-selected={activeExperience === "geo"} className={activeExperience === "geo" ? "active" : ""} onClick={() => setActiveExperience("geo")}><BrandingIcon name="map" size={17} />Geo</button>
        </div>

        <div className="engine-branding-share-grid">
          <div className="engine-branding-fields">
            <div className="engine-branding-live-note">
              <span className={currentShare?.live ? "engine-branding-live-dot" : "engine-branding-live-dot engine-branding-live-dot--off"} />
              <div><b>{currentShare?.live ? "Experience is live" : "Experience not live yet"}</b><small>{currentShare?.live ? "Publish Share creates an immutable preview version without republishing the 3D model." : "Publish a valid " + (activeExperience === "geo" ? "Geo" : "Building") + " release before sharing."}</small></div>
            </div>

            <label className="engine-branding-label">
              <span>SHARE TITLE</span>
              <input value={currentDraft.title} maxLength={120} onChange={(event) => setDrafts((all) => ({ ...all, [activeExperience]: { ...all[activeExperience], title: event.target.value } }))} placeholder={state?.project.name || "Project title"} />
              <small>{currentDraft.title.length}/120</small>
            </label>
            <label className="engine-branding-label">
              <span>SHARE DESCRIPTION</span>
              <textarea value={currentDraft.description} maxLength={280} rows={4} onChange={(event) => setDrafts((all) => ({ ...all, [activeExperience]: { ...all[activeExperience], description: event.target.value } }))} placeholder="Customer ko share link open karne se pehle kya samajhna chahiye?" />
              <small>{currentDraft.description.length}/280</small>
            </label>
            <button className="engine-control-button" type="button" onClick={() => void saveDetails()} disabled={busyNow || !titleValid || !descriptionValid}>
              <BrandingIcon name="save" size={16} />{busy === "details" ? "Saving settings…" : "Save share settings"}
            </button>

            <label className="engine-branding-file engine-branding-card-file">
              <BrandingIcon name="image" size={18} />
              <span>{brandBusy ? "Preparing branded poster…" : shareFiles[activeExperience]?.sourceFile.name || (currentShare?.draftCardVersion ? "Choose a new poster to replace the draft" : "Choose share image / WhatsApp poster")}</span>
              <small>Original ≤8 MB · output ≤550 KB · no crop · AR3D footer added</small>
              <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busyNow} onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                void chooseShareCard(file);
              }} />
            </label>
            {activeExperience === "geo" ? (
              <label className="engine-branding-reuse-poster">
                <input
                  type="checkbox"
                  checked={reuseBuildingPoster}
                  disabled={busyNow || !(state?.experiences.building.publishedCardUrl || state?.experiences.building.draftCardVersion)}
                  onChange={(event) => setReuseBuildingPoster(event.currentTarget.checked)}
                />
                <span>
                  <b>Use the Building poster for Geo</b>
                  <small>Uses the published Building image or its uploaded draft; Geo keeps its own versioned URL and metadata.</small>
                </span>
              </label>
            ) : null}
            {shareFiles[activeExperience] ? (
              <button className="engine-control-button engine-control-button--primary" type="button" onClick={() => void uploadShareDraft()} disabled={busyNow}>
                <BrandingIcon name="upload" size={16} />{busy === "share" ? "Uploading poster…" : "Upload share poster draft"}
              </button>
            ) : null}
            <details className="engine-branding-advanced-action">
              <summary>Advanced · Publish share poster only</summary>
              <button className="engine-control-button" type="button" onClick={() => void publishShare()} disabled={busyNow || !currentShare?.live || !titleValid || !descriptionValid || (!currentShare?.draftCardVersion && !currentShare?.publishedVersion && !(activeExperience === "geo" && reuseBuildingPoster && state?.experiences.building.publishedCardUrl))}>
                <BrandingIcon name="share" size={16} />{busy === "publish-share" ? "Publishing share…" : `Publish ${activeExperience === "geo" ? "Geo" : "Building"} Share`}
              </button>
            </details>
            <div className="engine-branding-share-actions">
              <button type="button" className="engine-control-button" disabled={!currentShare?.shareUrl} onClick={() => void copyLink()}><BrandingIcon name="copy" size={15} />Copy published link</button>
              {currentShare?.shareUrl ? <a className="engine-control-link" href={currentShare.shareUrl} target="_blank" rel="noreferrer"><BrandingIcon name="external" size={15} />Open shared link</a> : null}
            </div>
            <div className="engine-branding-url-box">
              <span>VERSIONED SHARE LINK</span>
              <code>{currentShare?.shareUrl || "Publish a live experience share preview to generate its link."}</code>
            </div>
          </div>

          <aside className="engine-branding-preview">
            <div className="engine-branding-preview-head"><span>LINK PREVIEW</span><span>{activeExperience.toUpperCase()}</span></div>
            <div className="engine-branding-social-card">
              <div className={cardUrl ? "engine-branding-image engine-branding-image--populated" : "engine-branding-image"}>
                {cardUrl ? <img src={cardUrl} alt="Final share card preview" /> : <div><BrandingIcon name="image" size={30} /><b>Share poster preview</b><small>Choose the image customers will see on social links.</small></div>}
              </div>
              <div className="engine-branding-social-copy">
                {state?.project.location ? <small>{state.project.location}</small> : null}
                <strong>{currentDraft.title || state?.project.name || "Project"}</strong>
                <p>{currentDraft.description || "Your share description appears here."}</p>
                <span>ar3dstudio.in</span>
              </div>
            </div>
            <div className="engine-branding-preview-note">
              <BrandingIcon name="check" size={16} />
              <p>Share metadata and poster publish as an immutable version. Changing a poster will not change an older versioned share URL.</p>
            </div>
            <div className="engine-branding-status-line">
              {currentShare?.shareReady ? <><BrandingIcon name="badge" size={16} /> Published share preview is ready</> : <><BrandingIcon name="share" size={16} /> {currentShare?.live ? "Upload a poster and publish this share preview" : "Publish the 3D experience first"}</>}
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}
