import { useEffect, useMemo, useState, type ReactNode } from "react";
import { geoPublicProjectPath, publicProjectPath } from "@rekixo/3d-engine-core";
import {
  geoReleases,
  logout,
  projects,
  releases,
  session,
  type CloudProjectSummary,
} from "../studio/cloud";
import "./engine-admin-shell.css";

type ShellSection = "overview" | "source" | "building" | "geo" | "geo-plots" | "releases" | "branding" | "advanced";

type NavItem = {
  id: ShellSection;
  label: string;
  short: string;
  href: (slug: string) => string;
  description: string;
};

const navItems: NavItem[] = [
  {
    id: "overview",
    label: "Overview",
    short: "OV",
    href: (slug) => `/3Dprojects${slug ? `?project=${encodeURIComponent(slug)}` : ""}`,
    description: "Project status and next action",
  },
  {
    id: "source",
    label: "Source Pack",
    short: "SP",
    href: (slug) => `/3Dprojects/source-pack${slug ? `?project=${encodeURIComponent(slug)}` : ""}`,
    description: "Sources, scale, components and processing",
  },
  {
    id: "building",
    label: "Building",
    short: "3D",
    href: (slug) => `/3Dprojects/building${slug ? `?project=${encodeURIComponent(slug)}` : ""}`,
    description: "Build, review, presentation and publish",
  },
  {
    id: "geo",
    label: "Geo",
    short: "GO",
    href: (slug) => `/3Dprojects/geo-mapper${slug ? `?project=${encodeURIComponent(slug)}` : ""}`,
    description: "Real-world placement and Geo publish",
  },
  {
    id: "geo-plots",
    label: "Geo Plot Mapper",
    short: "PL",
    href: (slug) => `/3Dprojects/geo-plots${slug ? `?project=${encodeURIComponent(slug)}` : ""}`,
    description: "3D polygon plots, measurements and facing",
  },
  {
    id: "releases",
    label: "Releases",
    short: "RL",
    href: (slug) => `/3Dprojects/releases${slug ? `?project=${encodeURIComponent(slug)}` : ""}`,
    description: "Immutable Building and Geo history",
  },
  {
    id: "branding",
    label: "Share & Branding",
    short: "BR",
    href: (slug) => `/3Dprojects/share${slug ? `?project=${encodeURIComponent(slug)}` : ""}`,
    description: "Project logo, favicon and Building/Geo share previews",
  },
  {
    id: "advanced",
    label: "Advanced",
    short: "AD",
    href: (slug) => `/3Dprojects/advanced${slug ? `?project=${encodeURIComponent(slug)}` : ""}`,
    description: "Diagnostics, provider settings and danger zone",
  },
];

function requestedProjectSlug() {
  return new URLSearchParams(window.location.search).get("project")?.trim().toLowerCase() || "";
}

function currentSection(pathname: string): ShellSection {
  if (pathname.includes("/component-mapper") || pathname.includes("/source-pack")) return "source";
  if (pathname.includes("/geo-plots")) return "geo-plots";
  if (pathname.includes("/geo-mapper")) return "geo";
  if (pathname.includes("/releases")) return "releases";
  if (pathname.includes("/share") || pathname.includes("/branding")) return "branding";
  if (pathname.includes("/advanced")) return "advanced";
  if (pathname.includes("/building") || pathname.includes("/studio")) return "building";
  return "overview";
}

const sectionMeta: Record<ShellSection, { eyebrow: string; title: string; help: string }> = {
  overview: {
    eyebrow: "CONTROL CENTER",
    title: "Project Overview",
    help: "Current state, next action and customer-facing deliverables.",
  },
  source: {
    eyebrow: "INPUT & PROCESSING",
    title: "Source Pack",
    help: "Review verified originals, geometry authority, scale, components and processing.",
  },
  building: {
    eyebrow: "BUILDING WORKSPACE",
    title: "3D Building",
    help: "Build, review, presentation and immutable Building release workflow.",
  },
  geo: {
    eyebrow: "GEO WORKSPACE",
    title: "3D Geo Mapper",
    help: "Place the immutable Building in the real world, verify it and publish Geo.",
  },
  "geo-plots": {
    eyebrow: "GEO PLOT MAPPING",
    title: "3D Geo Plot Mapper",
    help: "Polygon boundaries, directional sides, verified measurements and independent publication.",
  },
  releases: {
    eyebrow: "IMMUTABLE HISTORY",
    title: "Releases",
    help: "See active Building and Geo releases, history and safe activation controls.",
  },
  branding: {
    eyebrow: "CUSTOMER-FACING BRANDING",
    title: "Share & Branding",
    help: "Manage one project logo/favicon and separate immutable Building and Geo share previews.",
  },
  advanced: {
    eyebrow: "ENGINE ADMINISTRATION",
    title: "Advanced",
    help: "Diagnostics, provider configuration and destructive controls live here only.",
  },
};

export default function EngineAdminShell({ children }: { children: ReactNode }) {
  const [projectItems, setProjectItems] = useState<CloudProjectSummary[]>([]);
  const [selectedSlug, setSelectedSlug] = useState(requestedProjectSlug());
  const [email, setEmail] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [buildingLive, setBuildingLive] = useState(false);
  const [geoLive, setGeoLive] = useState(false);
  const [loading, setLoading] = useState(true);

  const section = currentSection(window.location.pathname);
  const meta = sectionMeta[section];
  const selectedProject = useMemo(
    () => projectItems.find((project) => project.slug === selectedSlug),
    [projectItems, selectedSlug],
  );

  useEffect(() => {
    let live = true;
    void session()
      .then((auth) => {
        if (!auth.authenticated) {
          window.location.replace(
            `/3Dprojects/login?return=${encodeURIComponent(window.location.pathname + window.location.search)}`,
          );
          return null;
        }
        if (live) setEmail(auth.user?.email || "Engine Admin");
        return projects("", "active", 100, 0);
      })
      .then((result) => {
        if (!live || !result) return;
        setProjectItems(result.projects);
        const requested = requestedProjectSlug();
        const next = result.projects.find((project) => project.slug === requested)?.slug || result.projects[0]?.slug || "";
        setSelectedSlug(next);
        if (!requested && next) {
          const url = new URL(window.location.href);
          url.searchParams.set("project", next);
          window.history.replaceState({}, "", url);
        }
      })
      .catch(() => {
        if (live) setProjectItems([]);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedSlug) {
      setBuildingLive(false);
      setGeoLive(false);
      return;
    }
    let live = true;
    void Promise.all([
      releases(selectedSlug),
      geoReleases(selectedSlug).catch(() => ({
        schemaReady: true,
        experienceId: null,
        draftRevision: null,
        previewVerified: false,
        previewVerification: null,
        activeRelease: null,
        releases: [],
      })),
    ]).then(([building, geo]) => {
      if (!live) return;
      setBuildingLive(Boolean(building.releases.some((release) => release.active)));
      setGeoLive(Boolean(geo.activeRelease));
    }).catch(() => {
      if (!live) return;
      setBuildingLive(false);
      setGeoLive(false);
    });
    return () => {
      live = false;
    };
  }, [selectedSlug]);

  function changeProject(slug: string) {
    if (!slug || slug === selectedSlug) return;
    const url = new URL(window.location.href);
    url.searchParams.set("project", slug);
    window.location.assign(`${url.pathname}${url.search}`);
  }

  async function signOut() {
    try {
      await logout();
    } finally {
      window.location.assign("/3Dprojects/login");
    }
  }

  const liveHref = section === "geo"
    ? selectedSlug && geoLive
      ? geoPublicProjectPath(selectedSlug)
      : ""
    : selectedSlug && buildingLive
      ? publicProjectPath(selectedSlug)
      : "";

  return (
    <div className="engine-admin-shell">
      <aside className={menuOpen ? "engine-admin-side engine-admin-side--open" : "engine-admin-side"}>
        <a className="engine-admin-brand" href={navItems[0].href(selectedSlug)}>
          <span className="engine-admin-brand__mark">R</span>
          <span>
            <b>REKIXO</b>
            <small>AR3D ENGINE</small>
          </span>
        </a>

        <div className="engine-admin-project-picker">
          <label htmlFor="engine-project-switcher">ACTIVE PROJECT</label>
          <select
            id="engine-project-switcher"
            value={selectedSlug}
            disabled={loading || !projectItems.length}
            onChange={(event) => changeProject(event.target.value)}
          >
            {!projectItems.length ? <option value="">No project</option> : null}
            {projectItems.map((project) => (
              <option key={project.id} value={project.slug}>{project.name}</option>
            ))}
          </select>
          <small>{selectedProject?.location || selectedProject?.slug || "Create a project from Overview"}</small>
        </div>

        <nav className="engine-admin-nav" aria-label="AR3D Engine sections">
          {navItems.map((item) => {
            const active = item.id === section;
            const status = item.id === "building" || item.id === "releases"
              ? buildingLive
              : (item.id === "geo" || item.id === "geo-plots")
                ? geoLive
                : false;
            return (
              <a
                key={item.id}
                className={active ? "engine-admin-nav__item engine-admin-nav__item--active" : "engine-admin-nav__item"}
                href={item.href(selectedSlug)}
                onClick={() => setMenuOpen(false)}
              >
                <span className="engine-admin-nav__icon" aria-hidden="true">{item.short}</span>
                <span className="engine-admin-nav__copy">
                  <b>{item.label}</b>
                  <small>{item.description}</small>
                </span>
                {status ? <i className="engine-admin-nav__live" title="Live / active" /> : null}
              </a>
            );
          })}
        </nav>

        <div className="engine-admin-account">
          <span className="engine-admin-account__avatar">{email.trim().charAt(0).toUpperCase() || "A"}</span>
          <span>
            <b>Engine Admin</b>
            <small>{email || "Authenticated session"}</small>
          </span>
          <button type="button" onClick={() => void signOut()}>Sign out</button>
        </div>
      </aside>

      {menuOpen ? <button className="engine-admin-scrim" type="button" aria-label="Close navigation" onClick={() => setMenuOpen(false)} /> : null}

      <div className="engine-admin-main">
        <header className="engine-admin-header">
          <button className="engine-admin-menu" type="button" aria-label="Open navigation" onClick={() => setMenuOpen(true)}>
            <span />
            <span />
            <span />
          </button>
          <div className="engine-admin-header__copy">
            <p>{meta.eyebrow}{selectedProject ? ` · ${selectedProject.name.toUpperCase()}` : ""}</p>
            <h1>{meta.title}</h1>
            <span>{meta.help}</span>
          </div>
          <div className="engine-admin-header__actions">
            {liveHref ? (
              <a href={liveHref} target="_blank" rel="noreferrer">Open Live Site</a>
            ) : (
              <span className="engine-admin-header__offline">{section === "geo" ? "Geo not live" : "Building not live"}</span>
            )}
          </div>
        </header>

        <div className="engine-admin-content">{children}</div>
      </div>
    </div>
  );
}
