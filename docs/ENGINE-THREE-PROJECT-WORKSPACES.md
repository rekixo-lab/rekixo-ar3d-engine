# Rekixo AR3D Engine — Independent Three-Type Project Workspaces

**Scope:** `rekixo-lab/rekixo-ar3d-engine` only. Nothing here writes to the proven `rekixo-ar3d-platform` repository, database, Workers, assets, user accounts or sales ledger.

## Project identity and compatibility

A project is one of:
- `legacy` (default for all existing production projects): unchanged Source → Building → optional Geo workflow, current Building/Geo share previews, public URLs and releases.
- `building`: a new independent Building customer website. Source Pack and Building release lifecycle.
- `building_geo`: a separate Building-source project whose approved immutable Building release can be georeferenced on Google Maps.
- `masterplan_geo`: a fully independent 2D image/plot mapping project. **No GLB, Building release or Building geo placement is required.**

Only explicitly new projects get a chosen nonlegacy kind; an old project is never silently reclassified. Project types are policy boundaries for new features and navigation. Existing Building and Geo experience data remains immutable.

## Admin navigation

- All three types: Project Overview, Clients directory, Project Profile, Project Assets; Platform-style discoverable navigation.
- Building: Source Pack, Building, Releases and Building Share Builder.
- Building Geo: Source Pack, Building, Geo Placement, Releases and existing Building/Geo Share Builder.
- Geo Masterplan: Original image/GPS calibration, polygon Plot Mapper, Mapping Controls, Sales & Accounts and separate Masterplan Share Builder.

## Independent Geo Masterplan

1. Create project as **Geo Masterplan / Plot Mapping** in the new-project wizard.
2. Upload an approved PNG/JPEG/WebP image. Upload archives the original into this project's draft-assets bucket; it does not convert it into a 3D GLB.
3. Mark 3–24 survey-backed image points with normalized U/V (0–1), exact WGS84 latitude/longitude and original source; review each.
4. Build clockwise/anticlockwise polygons (3–80 corners) and assign Front/Back/Depth sides, Area, Road Facing, Compass Source and verified measurement sources. Self-crossing and positive-area overlapping polygons are rejected; shared boundaries are allowed.
5. Save Draft → Verify the current revision (affine fit with maximum 2 metre residual) → Publish immutable image-mapping release. Publication updates only the project's active Masterplan release; it does not alter Building or Geo releases.
6. Public customer URL: `/3Dprojects/:slug/masterplan`. Satellite imagery is provided by Google Maps when configured; a clearly labeled original-image fallback is available. Customers see published polygons/measurements, **never buyer contact or private payments**.
7. Rollback activates a prior checksum-validated Masterplan mapping version. New source images clear old calibration and polygons before Save (historical publications remain immutable).
8. The independent Masterplan share builder creates optimized poster, title, description and published share card; it never changes existing Building/Geo share versions.

**Accuracy:** A georeferenced image overlay is not a cadastral survey or warranty of land dimensions. Image-to-ground control points, site survey, plot areas, front/back/depth and directions require human source review before publication. An affine projection is not a nonrigid correction of warped surveys.

## Clients, profiles, assets and accounts

- Project Profile is an owner-controlled private contact directory: builder name, primary contact, address, phones, WhatsApp, email, website, Maps and brochure URL. It does **not** silently edit already published customer release content.
- Clients directory stores names, contacts and **proposed** roles only. **No client login, session or data permissions are granted yet.** Do not describe these records as active users or send credentials.
- Project Assets lists existing source inventory and supports integrity-checked downloads plus a metadata manifest. The manifest is not a full recoverable ZIP backup.
- Sales & Accounts is an Engine-owner-only, project-private ledger for mapped image plots: immutable mapping-backed bookings, explicit sale confirmation, integer-paise receipts, reversal-only corrections, one live sale per plot, no overpayment and status-independent polygon editing. It does not link to AR3D Platform sales. A payment entry **does not trigger a bank transfer or refund**. It records supplied accounting evidence only.

## Required rollout/acceptance

- Apply additive D1 migrations 0040, 0041, 0042. Run fresh migration, TypeScript/Build, geometry, API owner checks, ledger integrity, asset deletion/protection, Wrangler dry runs, browser tests and post-deploy verification.
- Retain all existing legacy public URLs and Building/Geo release references. Test published legacy Building and Geo sites after deployment.
- Verify Google Satellite overlay on a **real surveyed masterplan** and mobile pinch/drag on iOS/Android before treating the new customer view as fully field-certified.
- Enable real client login and scoped permission roles only as a separate independently security-reviewed rollout, with project-role isolation, password/session lifecycle and finance approvals. Proposed roles have no authorization effect now.
- Full project recovery export/restore, finance installments, bank reconciliation, tax documents and scalable thousands-of-polygon mobile rendering are future capabilities, **not claims of this release**.
- Main merge and production deployment are permissible only when the exact head CI passes. AR3D Platform must remain untouched.
