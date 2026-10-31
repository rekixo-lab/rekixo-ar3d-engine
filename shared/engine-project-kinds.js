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
  if (k === "legacy") return true;
  const common = ["overview","profile","clients","assets","branding","advanced","releases"];
  if (common.includes(module)) return true;
  if (k === "masterplan_geo") return ["masterplan","masterplan-plots","mapping-controls","sales"].includes(module);
  if (k === "building_geo") return ["source","building","geo"].includes(module);
  return ["source","building"].includes(module);
}
