# Canonical Plot / Site Layout publication workflow

Existing Builder supports both buildings and site/plot layouts. For a plot-only source
(FBX reviewed to GLB), Floor/Room mapping does **not** assign plot identities and
should not be required to publish the intact geometry.

The explicit new Building-workspace **Plot Layout** path now:

1. Reads the authenticated per-project component mapper state, checking a sealed
   Source Pack and `succeeded` canonical processing job.
2. Allows an operator to **Initialize Plot Site Draft** only if no Studio draft exists.
   The new draft uses the *existing* project ID and slug; an internal **Site Base**
   floor exists solely to satisfy existing Studio schema, with **zero rooms**.
   A 404 is distinguished from network/auth/corruption errors. Existing draft is
   never overwritten.
3. Requests visual confirmation of geometry, source scale and material before
   explicit **Publish First 3D Site Release**. This action additionally sends
   `requireCanonicalSource: true` to the existing release API.
4. On the server, that flag rejects alternate models, existing releases, and
   missing/stale canonical artifacts instead of silently publishing an empty
   Studio or legacy model. Existing Building callers remain unchanged.
5. Operator checks the standalone 3D site; then the existing Geo Mapper
   handles WGS84 placement, main-gate anchors, P1-P4 rigid alignment,
   Save -> Verify -> Geo Publish. No coordinates are guessed.

The immutable Source Pack and historical Building/Geo releases are never mutated
by draft initialization. Source site geometry is *not* warped by Geo.
Plot-number-to-node metadata remains a separate, reviewed enhancement.

A draft creation is not publication. Publication requires a separate user action
and explicit confirmation. Never auto-activate Geo or synthesize GPS bounds.
