# Rekixo AR3D Engine — 30 October 2026 Production Recheck and Hardening

Scope: **Engine only**. The sibling `rekixo-ar3d-platform`, its production inventory/sales and its D1/R2/Workers are never modified.

## Applied in this hardening PR

- Pin live customer Playwright verification to `ubuntu-24.04`. The previous live QA run failed before browser testing because Playwright 1.55.1 did not support the ubuntu-26.04 runner. Do not describe the prior failure as proof of a customer-site failure or success.
- Detect changes in both `workers/geo-plot-public.mjs` and `workers/geo-plot-geometry.mjs` when choosing whether to deploy the Public Worker.
- Reject positive-area intersection or containment of different project plot footprints while allowing aligned shared edges/corners. This applies on draft validation, verification and publication.
- Require explicit model-local Plot Mapping Plane elevation with a source-backed operator verification before any **new** plot publication. Existing sealed V1 plot releases are still accepted by the public checksum-validated reader, using legacy ground-plane fallback if needed.
- Display authoritative area/side measurements alongside Geometry × Geo Scale estimates and warn on >10% discrepancies. Geometry estimates are explicitly nonauthoritative; do not automatically change surveyed measurements.
- Carry all plot measurements, per-side sources, units, road flags, compass and model-geometry fingerprints in CSV exports. CSV import checks ID/geometry match and resets all source-verification approvals, rather than silently treating uploaded claims as verified.
- Guard plot verification and immutable publish against active Building and Geo release swaps **inside database write statements**, in addition to preflight checks.

## Unresolved dependencies / future work (not declared fixed)

1. Native DWG processing needs Cloudflare Workers Paid / Containers permissions. The latest deploy log explicitly reported Container access unavailable and deployed a fail-closed Worker-only mode. Never bypass the Cloudflare security boundary or claim DWG decode is live.
2. GitHub `main` branch protection / required Validate check is a repository administrator setting. Issue #143 remains open; current GitHub connector cannot verify protection (403) or apply these settings. Enable required PR validation and block direct pushes/force pushes and deletion.
3. Live Building releases inspected by the post-deploy verifier reported zero authored Floor/Unit/Room metadata. Do **not** invent surveyed floors or units; establish the source-pack and approved geometry first, then publish a reviewed new Building release.
4. Browser-based **real masterplan** plot placement/overlap, device gestures, Google Maps satellite limits and Customer Plot Detail UX must be verified on actual projects. Unit/schema tests and an on-demand Browser smoke cannot substitute for operator-reviewed geospatial fit.
5. A true multi-actor independent mapping approval workflow requires operator identity/roles and an auditable reviewer separate from the author. Single-owner checkboxes do not constitute independent approval; implement only after safe role/access design.
6. A large viewer/codebase refactor must be gradual, behind regression tests. Avoid rewriting a 2,000+ line production viewer during release safety fixes.
7. Package audit warnings need a named-package, reachable-path audit and compatibility-tested upgrades. Never run `npm audit fix --force` blindly in production.
8. Large project mapping needs mobile E2E and 2,500-plot performance/Google Polygon benchmark before lifting production publish-volume expectations.

## Release acceptance and rollback

- Require `npm run typecheck`, `npm run build`, source-level and runtime geometry tests, `npm run test:migrations`, Wrangler dry runs and desktop Browser E2E to pass on the **exact final commit** before merging.
- Confirm the merged `main` SHA, Engine Cloudflare Admin/Public Worker deploy results and the *separate* post-deploy live browser verification.
- Keep project/tenant identities and immutable Building, Geo, Plot Mapping releases intact. Revert an active mapping through the Engine's mapping-release pointer only after checking it targets the active Geo/Building release. Do not edit an immutable release.
- No unrelated Platform or customer project migration/asset mutation is authorized.
