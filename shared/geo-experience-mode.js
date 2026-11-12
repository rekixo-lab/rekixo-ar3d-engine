/**
 * Only the two approved concept demos switch to Explore 3D by default.
 * Plotted production inventory continues to open the geographic map first.
 */
export function initialGeoExperienceMode(slug, hasMappedPlots = false) {
  if (hasMappedPlots) return "map";
  return slug === "dholera-villas-glb-demo-5809b995" ||
    slug === "shreem-palace-demo-a6532789" ? "explore" : "map";
}
