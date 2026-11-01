// Geo plot authoring is only possible for a canonical Building GLB placed in Geo.
// The image-only masterplan_geo project has a separate 2D authoring pipeline.
export const geoPlotMappingProjectKind = kind=>kind==="legacy"||kind==="building_geo";
