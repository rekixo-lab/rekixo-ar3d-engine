# Safe 3D model replacement — Engine only

## Fast track: Color / Material Only (new, one-click)
1. Upload and publish the new GLB as an immutable Building version using **3D Model → Use This Model & Prepare → Publish**.
2. Go to **3D Building Editor → Publish** or **3D Building Geo Editor**, then click **Auto Update Geo**.
3. The Engine reads both actual release-pinned GLBs and checks exact metric POSITION vertices, indices, scene/node hierarchy and transforms. It does **not** compare just file names, bounding boxes or a visual screenshot.
4. If identical: confirm once. Engine atomically creates a new immutable Geo release and equal-geometry Plot Mapping release, retains the previous geo transform and mapped Plot IDs, and moves the private status/price, pricing sheet, deal and Client Admin plot metadata to the new release. The public renderer is pinned to the original canonical GLB (not a separately simplified Geo derivative) for coordinate continuity.
5. Review the live Geo on desktop/mobile; historical versions are retained for rollback. No new Geo anchor, 4-point alignment, plot-by-plot drawing or temporary live mapping gap is needed for a **proven cosmetic-only** change.
6. If the geometry differs, an unsupported GLB feature is present, an unpublished Geo/plot edit exists, or a project has active client financial sale/receipt records, the Engine refuses automatic activation and keeps the old live Geo/map as-is. Do not override the existing Geo mapping-gap warning to work around this guard. A reviewed migration is required for non-cosmetic changes.


This operation never changes the separate AR3D Platform repository, D1, R2 or live sites.

## 1. Start a new model revision
1. Building → Source & Processing → **Upload original source files**. Upload the corrected GLB/FBX and any new source evidence.
2. Choose **Replace 3D Model · New Version** to start another Source Pack; select the exact new geometry authority and seal it. Original files, earlier packs and immutable releases are retained.
3. Run processing and model/scale/component review. Publish a **new** Building release only after the new source has been verified. Publishing a Building release does **not** automatically retarget an existing Geo release.

## 2. Keep Geo customer mapping safe
- A new Geo release with an existing live Geo Plot Mapping requires the exact owner confirmation **ALLOW GEO MAPPING GAP <project-slug>**. Cancelling leaves the old Geo source/mapping live. Do not proceed unless you have a planned Geo mapping rebind and accept that plots temporarily disappear from the public Geo view.
- A historical Geo rollback automatically selects the newest checksum-valid matching historical Plot Mapping release (if present), in the same database batch.
- After deliberately switching Geo source, Geo Plot Mapper shows a stale-source notice. **Never reset the mapped plots by default.**
- If the old and new models have the **same metre-scale local X/Z coordinate frame, origin, orientation and plot layout**, the owner may use **Keep Existing Plot Coordinates · Unverified Draft**. This takes a revision- and source-pinned preflight, requires an exact typed confirmation, keeps every Plot ID and polygon coordinate, revokes ALL source, plane, area/side, road and facing approvals, and does not publish anything.
- If model coordinates differ, use the existing independently reviewed original-image↔old-model and original-image↔new-model alignment workflow. Select affected Plot IDs for a surveyed remap. Same-source-image SHA and independent checkpoints remain mandatory for this route.
- Verify model-local Y plane and every plotted boundary in the new actual 3D model before verified publication. A preserved draft is **not proof of geometric correspondence**. Never claim physical or legal survey certainty based solely on bounds, image fit or a browser checkbox.

## 3. Publish and review commercial continuity
- Review the server-produced live-vs-draft mapping diff and private status/price carry-forward counts.
- When the next immutable Mapping Release is published, matching canonical Plot IDs' private commercial status and price rows are copied transactionally, with a source-mapped audit event. Old release data is not edited.
- Public approval is retained only when Geo AND Building release identity and exact model-local polygon geometry match. A replaced model forces the copied status/price facts into **pending owner review**, even when old Plot IDs have been preserved.
- Previous unmatched commercial records remain in their historical release. Do not duplicate sales, buyer or receipt ledger rows. Client-admin details and financial transactions require their own reviewed migration workflow; this feature does not claim those details have been moved.

## 4. Recovery and final validation
- Before a source switch, export the private Geo Recovery Manifest and independently archive the full encrypted D1 snapshot plus every referenced R2 object byte. The manifest alone is **not** a full backup.
- Test the current Building site, Geo customer map, Plot IDs, areas/sides/road, available/booked/sold, editor/client-admin authorization and private ledger before replacing a live source.
- Run tests, migrations, Worker dry runs and real desktop/mobile model comparison; after any reviewed publish verify real public parity and replay a historical rollback against its matching Mapping Release.
- Use a guarded PR and successful exact-commit CI; never overwrite the current Building/Geo/Mapping releases in place.

**Intentional limitation:** the implementation does not claim zero-downtime swapping between arbitrary different models. A source that changes scale, origin, plots or geometry needs independent remapping and explicit publication. The default is to protect the existing live Geo mapping until the owner explicitly chooses a review gap.
