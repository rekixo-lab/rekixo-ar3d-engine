# Engine Workflow Hardening — November 3, 2026

## Scope
- Fix Masterplan Dashboard to request its own project-scoped `masterplan-geo` state, not forbidden Building/Geo endpoints. Next Action follows draft and active release revisions.
- Server-backed search and pagination for Dashboard and Admin sidebar, including project location; retain the selected project when filtering.
- Masterplan operator safety: protect unapplied plot edits, bounded Undo/Redo, explicit browser recovery matched by project slug, source asset ID and server draft revision.
- Masterplan CSV preflight with mapped metadata updates, missing ID and measurement review, and no remapping of existing polygons. Unmapped CSV rows remain unmapped; only valid normalized corners may create a draft polygon. Changed source approvals must be rechecked.
- Safe source replacement offers side-by-side preview, with geometry preservation only for the same image dimensions after an explicit visual comparison checkbox. All measurement/facing/GPS approvals are revoked. Historical immutable releases are untouched.
- Compact Basic editing view and separate Advanced proof/edge options, retaining the same four project editors and existing project-type guards.
- One-click read-only customer handoff checks in Dashboard and manual recovery readiness checklist in Advanced.
- Correct permanent-delete expected project count to include archived projects across every page of the server query.

## Operator workflow
1. Select project, open its relevant editor; avoid changing live release until verification.
2. For CSV: upload source CSV, inspect additions, changed values, unmapped plot IDs, absent mapped IDs and missing-data warnings, then Apply CSV to Draft, Save Draft, Verify and Publish independently.
3. For source replacement: compare current and proposed images. If exact geometry aligns and dimensions match, choose Preserve as Unverified Draft. Otherwise reset the current draft after downloading the source-change JSON. Neither option changes the live release automatically.
4. If a browser reload interrupted work, restore only from an exact revision/source match. If recovery conflicts, export the JSON and manually compare; never auto-merge stale changes.
5. Use Check Handoff as a preliminary readiness view. Independently inspect desktop/mobile, customer account login, social crawler previews, source-backed surveys and isolated D1/R2 restore proof.
6. Before any risky deploy, run `npm test` and Playwright, verify production resource isolation, then use a reviewed PR and successful production workflow.

## Non-goals and safety
- No new universal Geo editor, second customer project, Sales/CRM duplication, direct Platform database access, or automatic AI plot approval.
- CSV and JSON files are not complete production backups.
- This change set does not alter Cloudflare production D1 tables or R2 objects on its own.
- Reusable existing Geo backup/restore scripts are maintained; live backup status and field certification cannot be inferred from browser UI.
