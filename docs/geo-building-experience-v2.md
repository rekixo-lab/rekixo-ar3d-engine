# Geo Building Experience V2 — Hybrid customer viewer

## Separation of responsibilities
- **Geo Map**: display the immutable published GLB at its saved WGS84 + local ENU position and uniform metric scale. Keep the Google satellite native zoom limit. Never apply visual-only scaling to a geolocated object.
- **Explore 3D**: a separate Three.js/WebGL scene loading the same immutable model URL **in source/model space**, with aspect-aware whole-model framing, OrbitControls, scroll/pinch zoom, pan, top, aerial, close and Reset. The camera is not tied to the geographic map.
- Only one renderer is mounted at a time; switching modes releases the prior GPU context. This matters for the large Shreem and Dholera GLBs.

## Demo defaults
- `dholera-villas-glb-demo-5809b995` and `shreem-palace-demo-a6532789`: Explore first **unless** an approved plot mapping exists.
- Every other project (including inventory projects): Geo Map first.
- Visitors can switch modes. This is a public-viewer code update, **not** a new Building/Geo release or DB edit.

## Camera integrity
- Orbit camera uses all eight model AABB corners, perspective FOV and viewport aspect ratio for whole-site/top/aerial fitting. Close view intentionally focuses nearer and may crop edges.
- Do not use an unrealistically high Google satellite zoom or a cosmetic GLB multiplier in Geo Map.
- An admin warning appears when the Geo scale is below 0.5, because uniform scaling shrinks the horizontal footprint and building height together.

## Source measurements still required before claiming real scale
Source AABB/model units do not prove a physical survey. Prior recorded values:
- Dholera simplified GLB: ~343.95 × 7.74 × 73.71 **model units**, with an earlier suggested draft scale near 0.12 (actual current published scale not independently verified in this change).
- Shreem Palace: ~663.04 × 149.96 × 402.52 **model units**, including possible surroundings and external geometry.
- Obtain verified parcel dimensions, the original FBX/DAE unit metadata, model orientation, and physically corresponding corners before correcting a Geo release. **Do not overwrite live releases based on appearance alone.**
- Dholera demo GLB is partial geometry; original missing external textures remain missing. The Viewer does not recreate those missing assets.

## Future quality work (not part of this runtime change)
- Frame-verify a compact map-only GLB derivative against the original immutable source, and LOD/mesh-texture optimization for mobile.
- Add independently measured component/unit focus points only after semantic node mapping. Do not invent unit, floor or plot IDs.
- Measure and record per-project true source dimensions before any Geo scale correction.
