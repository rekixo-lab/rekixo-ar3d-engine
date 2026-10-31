// Engine-owned project kind contract. 'legacy' preserves every existing customer
// workflow and is never silently reclassified by a database migration.
export const ENGINE_PROJECT_KINDS = Object.freeze([
  "legacy", "building", "building_geo", "masterplan_geo",
]);
export const PROJECT_KIND_LABELS = Object.freeze({
  legacy: "Existing Engine project",
  building: "3D Building Customer Website",
  building_geo: "3D Building on Geo Map",
  masterplan_geo: "Geo Masterplan / Plot Mapping",
});
export function isEngineProjectKind(kind) {
  return typeof kind === "string" && ENGINE_PROJECT_KINDS.includes(kind);
}
export function selectedProjectKind(kind) {
  return isEngineProjectKind(kind) ? kind : "legacy";
}
export function newProjectStartPath(kind) {
  return kind === "masterplan_geo" ? "masterplan" : "source-pack";
}
export function projectModuleVisible(kind, module) {
  const k = selectedProjectKind(kind);
  const common = ["overview","profile","clients","assets","advanced"];
  if (common.includes(module)) return true;
  if (k === "legacy") return ["source","building","geo","geo-plots","releases","branding"].includes(module);
  if (k === "masterplan_geo") return ["masterplan","masterplan-plots","mapping-controls","sales","branding"].includes(module);
  if (k === "building_geo") return ["source","building","geo","releases","branding"].includes(module);
  return ["source","building","releases","branding"].includes(module);
}

// Hide-only navigation is not an authorization boundary. Gate direct Admin API
// calls too, while leaving every existing legacy project route unchanged.
export function projectKindAllowsCloudRoute(kind,route) {
  const k=selectedProjectKind(kind);
  if(k==="legacy")return true;
  const geoRoutes=["geo-draft","geo-releases","geo-placement","geo-plots"];
  if(k==="building")return !geoRoutes.includes(route);
  if(k==="building_geo")return route!=="geo-plots";
  return !["draft","releases","experiences","branding",...geoRoutes].includes(route);
}
