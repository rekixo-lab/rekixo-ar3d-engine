# Engine Geo Plot Mapping V1 — Independent 3D Masterplan Polygons

Scope: **rekixo-ar3d-engine only**. AR3D Platform code, APIs, inventory and customer websites are untouched.

## Ownership and coordinate truth

- Map an existing **published Geo Experience** and its pinned canonical Building release.
- The Geo mapper loads the checksum-verified canonical GLB. A Geo derivative may be visually useful but cannot define stable plot X/Z coordinates because its origin may shift.
- Plot vertices are ordered, Building-local `[X,Z]` pairs in metres. They are never Google map pixels, normalized image UV, or guessed latitude/longitude.
- Geo georeferencing uses the same rigid model placement as the public 3D runtime. No model source, asset, alignment or existing Building/Geo release is modified.
- Independent `geo_plot_mapping_*` tables and the versioned public mapping use project, Geo Experience, Geo Release and Building Release ownership. Active Geo source change suppresses a stale mapping.
- Source-backed measurements are authoritative; areas computed from model geometry are displayed as **unverified reference only**.
- Audit logs record publish/activation. Every editing write requires a valid Engine Admin session, same origin and expected draft revision.

## Author workflow

1. Publish a verified Building release and Geo Experience as usual.
2. Engine Admin → **Geo Plot Mapper** → choose a published Geo project.
3. Load the verified canonical source in a separate top-down mapping canvas.
4. Create a four-corner or irregular polygon (3–80 corners), or select/edit an existing plot. One finger pans in Pan mode; pinch zooms. Draw mode collects exact corners; Edit mode drags individual handles. Optional Snap aligns shared vertices.
5. Enter plot identity, authoritative area, Front/Back/Depth A/Depth B lengths, exact mapped edge chains and road-facing flags. Set unit and source reference; verify each entered measurement.
6. Choose Geo compass facing (North/NE/E/SE/S/SW/W/NW), record its source and confirm the direction. Auto suggestion is **not** verification.
7. Apply Plot → Save Mapping Draft → Verify All Plots → Publish Mapping. A successful save is returned by a fresh DB read. Publish requires every plot and its source checks to pass.
8. Use Export/Import Measurement CSV to work across many existing mapped polygons. CSV imports stage unverified values for review; they never publish automatically.
9. The independent immutable mapping release becomes visible as clickable polygons on Public Geo. Customer details display published plot numbers, area, facing, road and side measurements.
10. Previous versions may be reactivated only if they target the **currently active** Geo and Building release.

## API and rollout

- Authenticated: `GET/PUT/POST /3Dprojects/api/cloud/projects/:slug/geo-plots`.
- Public: mapping is embedded as an **optional** validated read-only `plotMapping` member of the published Geo placement response.
- Migration: `database/migrations/0039_geo_plot_mapping_v1.sql` must be applied to the Engine D1 before operators can save mapping.
- Existing Geo sites without mapping remain unchanged. A missing/corrupt/stale plot mapping does **not** interrupt the original Geo 3D viewer.
- No sales, inventory availability or booking status is created or mutated by this mapper.

## Safety checks

- Required: unique plot IDs, finite 3–80 vertices, positive area, no self-intersection, no repeated vertices, non-overlapping semantic edge assignments, continuous irregular side chains and all polygon edges mapped.
- Required for publication: positive authoritative area and side measurements, units, source refs, and explicit confirmation of source-backed area, each side and compass direction.
- Source Geo/Building identity is checked on every write and again on publish/activation. Optimistic concurrency prevents old tabs overwriting recent changes.
- If the active Geo/Building source changes, the old draft is locked. An operator may explicitly type the project-specific RESET confirmation to create a new empty draft for the new source; this action is audited and preserves historical immutable mapping releases.
- Browser tests and visual/manual operator review remain necessary before accepting production plot placement as surveyed truth.
- Hard-project deletion removes project-owned mapping rows first; existing project deletion is not blocked by new Foreign Keys.

## Important limitations

- Geo plot lines are a **visual, administrative mapping**, not a legal cadastral survey. Accuracy depends on the source model scale and operator review.
- Current release uses a top-down 3D canvas rather than direct clicking on tilted Google Maps for authoring. Public polygons are projected onto the map from the canonical model and must be visually checked against the published satellite placement.
- V1 CSV imports metadata for existing mapped Plot IDs; it does not infer boundaries or create new Plots from measurements alone.
- There is intentionally no automatic sales-state or pricing synchronization.
