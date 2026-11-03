# Universal grass ground cover and curved horizon

## Current customer-facing behavior (November 2026)

Customer-facing 3D Building views use **flat, continuously green grass only** around the source GLB/masterplan/building. `Viewer3D` selects `grassOnlyPresentation`, and `siteEnvironment` returns early with the `flatSurface: true` ground cover. The flat option has zero horizon rise and no blue/sky-tinted far ring; the original three-tier grass detail and the source-model footprint cutout remain.

No **additional scene objects** from the public site manifest or generic presentation fallback render in this mode: no roads, paving, trees, plants, cars, gates, outdoor lights, side lawns, urban backdrop, or decorative hardscape. The viewer's camera and original imported model remain unchanged and centered by the existing camera logic. This behavior applies across Overview, Front, Corner, Entry and Aerial.

**Important source boundary:** If a road or tree is part of the authored GLB itself, it remains inside the preserved masterplan/building model; do not remove source geometry by name or overwrite a published customer model without review. Operator/admin editing retains the normal site-element workflow.

## Older curved/tinted terrain implementation (retained for non-customer/editor context)

The public Building viewer now receives a presentation-only ground layer for customer-facing views, independent of optional decorative dressing. The layer combines the existing locally generated turf detail texture with a radial, low-poly landscape surface that gradually curves upward and tints from natural grass into a blue-green atmospheric horizon, blending with the existing shader-based sky.

## Grass detail

- Three deterministic, instanced grass-clump tiers use exact nominal heights of 1 inch (0.0254 m), 2 inches (0.0508 m), and 3 inches (0.0762 m).
- The continuous procedural turf material provides the distant lawn; instances add local depth without creating one scene object per blade. The ground mesh itself starts outside an expanded rectangular projection of the Building bounds, leaving a true central opening rather than a green surface beneath interior rooms or walls. When a reviewed profile box is unavailable, the viewer infers a tighter footprint from the loaded structural mesh bounds and filters ground/paving and short compound-wall geometry.
- Desktop and mobile use different instance/mesh-resolution budgets. Grass clumps do not cast individual shadows.
- Reviewed lawn/garden elements root blades at their actual surface height. Reviewed road, parking, and path footprints are excluded, with additional masks for fallback road, sidewalk, curb, and driveway geometry.

## Boundaries and safety

- The ground and grass are marked presentation-only and non-authoritative. They do not alter, cut, relocate, or rewrite a customer's building model or published Studio geometry. Only the measured Building footprint is conservatively excluded from both the ground surface and instanced blades; the broader loaded site bounds continue to size the surrounding lawn and horizon; the extra edge margin keeps turf just outside walls.
- If a project is a single merged, semantically unnamed mesh that combines the entire building and site, the runtime cannot confidently derive a separate Building footprint from its bounds and falls back to those bounds; for a precise cutout in that ambiguous case, the source needs a reviewed Building footprint/profile. A reliable surveyed parcel polygon is not currently available in every legacy project. For that reason the outer curved horizon is a cosmetic backdrop sized from model bounds, not a claim that it represents a surveyed plot boundary or the true legal parcel.
- Ground is omitted when model bounds are empty or the baseline elevation is not safe to infer.
- The former oversized flat surrounding-ground slab is disabled in this presentation path; the curved low-poly surface replaces it. Geometry tests assert that no terrain vertex enters the source model's projected rectangular footprint.

## Verification

The tests cover real-world grass height tiers, bounded geometry detail, source-area masking, universal activation in customer views, and the presentation-only boundary.


## Mesh-outline validation
A regression test uses a trapezoidal Building mesh plus an oversized flat ground slab. It verifies the contour keeps real source vertices and does not invent corners from the axis-aligned box around that mesh. This prevents the ground cutout from defaulting to a white rectangle merely because the model contains many separate mesh bounds.
