import React, { Suspense, lazy, useEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./source-pack/source-pack-control-center.css";
import EngineAdminShell from "./layout/EngineAdminShell";

const EngineDashboard = lazy(() => import("./dashboard/EngineDashboard"));
const SourcePackReview = lazy(() => import("./source-pack/SourcePackReview"));
const ComponentMapper = lazy(() => import("./source-pack/ComponentMapper"));
const BuildingWorkspace = lazy(() => import("./building/BuildingWorkspace"));
const GeoWorkspace = lazy(() => import("./geo/GeoWorkspace"));
const GeoPlotMapper = lazy(() => import("./geo/GeoPlotMapper"));
const MasterplanWorkspace = lazy(() => import("./masterplan/MasterplanWorkspace"));
const ProjectManagement = lazy(() => import("./management/ProjectManagement"));
const ProjectAssets = lazy(() => import("./management/ProjectAssets"));
const SalesAccounts = lazy(() => import("./management/SalesAccounts"));
const EngineReleases = lazy(() => import("./releases/EngineReleases"));
const ProjectShareBuilder = lazy(() => import("./branding/ProjectShareBuilder"));
const EngineAdvanced = lazy(() => import("./advanced/EngineAdvanced"));
const PublishedViewer = lazy(() => import("./studio/PublishedViewer"));
const CloudLogin = lazy(() => import("./CloudLogin"));

function RouteLoading({ label }: { label: string }) {
  return (
    <div className="route-loading">
      <small>AUTOMATIC ENGINE</small>
      <p className="eyebrow">REKIXO AR3D ENGINE</p>
      <h1>{label}</h1>
    </div>
  );
}

function AdminShellRoute({ label, children }: { label: string; children: ReactNode }) {
  return (
    <EngineAdminShell>
      <Suspense fallback={<RouteLoading label={label} />}>
        {children}
      </Suspense>
    </EngineAdminShell>
  );
}

function LegacyStudioRedirect() {
  useEffect(() => {
    window.location.replace(`/3Dprojects/source-pack${window.location.search}`);
  }, []);

  return <RouteLoading label="Opening Review Source Pack…" />;
}

function AdminRouter() {
  const path = window.location.pathname.replace(/\/$/, "");

  if (path.startsWith("/3Dprojects/showcase/")) {
    return (
      <Suspense fallback={<RouteLoading label="Loading published design…" />}>
        <PublishedViewer />
      </Suspense>
    );
  }

  if (path === "/3Dprojects/login") {
    return (
      <Suspense fallback={<RouteLoading label="Opening Engine Admin sign-in…" />}>
        <CloudLogin />
      </Suspense>
    );
  }

  if (path === "/3Dprojects/studio") {
    return <LegacyStudioRedirect />;
  }

  if (path === "/3Dprojects/profile") {
    return <AdminShellRoute label="Opening Project Profile…"><ProjectManagement section="profile" /></AdminShellRoute>;
  }
  if (path === "/3Dprojects/clients") {
    return <AdminShellRoute label="Opening Client Directory…"><ProjectManagement section="clients" /></AdminShellRoute>;
  }
  if (path === "/3Dprojects/assets") {
    return <AdminShellRoute label="Opening Project Assets…"><ProjectAssets /></AdminShellRoute>;
  }
  if (path === "/3Dprojects/masterplan") {
    return <AdminShellRoute label="Opening Geo Masterplan…"><MasterplanWorkspace mode="source" /></AdminShellRoute>;
  }
  if (path === "/3Dprojects/masterplan-plots") {
    return <AdminShellRoute label="Opening Masterplan Plot Mapper…"><MasterplanWorkspace mode="plots" /></AdminShellRoute>;
  }
  if (path === "/3Dprojects/mapping-controls") {
    return <AdminShellRoute label="Opening Mapping Controls…"><MasterplanWorkspace mode="controls" /></AdminShellRoute>;
  }
  if (path === "/3Dprojects/sales") {
    return <AdminShellRoute label="Opening private Plot Sales Ledger…"><SalesAccounts /></AdminShellRoute>;
  }

  if (path === "/3Dprojects/source-pack") {
    return (
      <AdminShellRoute label="Opening Source Pack…">
        <SourcePackReview />
      </AdminShellRoute>
    );
  }

  if (path === "/3Dprojects/component-mapper") {
    return (
      <AdminShellRoute label="Opening Component Review…">
        <ComponentMapper />
      </AdminShellRoute>
    );
  }

  if (path === "/3Dprojects/building") {
    return (
      <AdminShellRoute label="Opening Building workspace…">
        <BuildingWorkspace />
      </AdminShellRoute>
    );
  }

  if (path === "/3Dprojects/geo-mapper") {
    return (
      <AdminShellRoute label="Opening 3D Geo Mapper…">
        <GeoWorkspace />
      </AdminShellRoute>
    );
  }

  if (path === "/3Dprojects/geo-plots") {
    return <AdminShellRoute label="Opening 3D Geo Plot Mapper…"><GeoPlotMapper /></AdminShellRoute>;
  }

  if (path === "/3Dprojects/releases") {
    return (
      <AdminShellRoute label="Opening immutable releases…">
        <EngineReleases />
      </AdminShellRoute>
    );
  }

  if (path === "/3Dprojects/share") {
    return (
      <AdminShellRoute label="Opening Share & Branding…">
        <ProjectShareBuilder />
      </AdminShellRoute>
    );
  }

  if (path === "/3Dprojects/advanced") {
    return (
      <AdminShellRoute label="Opening Engine administration…">
        <EngineAdvanced />
      </AdminShellRoute>
    );
  }

  return (
    <AdminShellRoute label="Opening Engine overview…">
      <EngineDashboard />
    </AdminShellRoute>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root mount node");
createRoot(root).render(
  <React.StrictMode>
    <AdminRouter />
  </React.StrictMode>,
);
