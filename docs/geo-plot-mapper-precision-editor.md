# 3D Geo Plot Mapper — precision studio operator flow

This is the **Engine-only** Building-local X/Z 3D plot editor. The existing AR3D Platform 2D Plot Mapper, source GLB, Geo location, active mappings, customer statuses, private pricing and contact details are not migrated, reset or implicitly published.

## SATHARAI test using the existing 36-row Platform Plot Data CSV

1. Open `/3Dprojects/geo-plots?project=satharai-50a45356` in Engine Admin.
2. Confirm `36 CSV Inventory` and `36 Pending`. The toolbar's **Current CSV Plot** dropdown must offer IDs 1…36. If an old **unconfirmed Plot 37** is on the drawing canvas, Cancel it or choose a legitimate CSV Plot ID; do not confirm Plot 37.
3. Select **Plot 1** and choose **4 corners**. Zoom to inspect real model boundaries. The magnifier follows the cursor near the precision point, flipping within viewport edges; reticle identifies the exact model point. Enable Snap only when intentionally sharing adjacent corners.
4. Click four corners clockwise beginning at the actual road-facing Front. `Boundary complete` changes to Edit mode. The normal/fullscreen toolbar shows **Confirm Plot 1 & Next** without scrolling.
5. In **2 · Plot Details**, review the CSV area, Front, Back, Depth, source and road. Use **Assign Sides**, select Front/Back/Depth and click the real boundary segment. Four-corner Back/Depth reassignments swap roles without losing a segment; for irregular polygons enable connected-segment mode and select a clockwise chain. Do not claim the road is north just because it appears at the top of the screen.
6. Inspect any source-size vs Geo-scaled GLB estimate warnings; confirm that model scale and original CAD dimensions refer to the same site. Check Area/Source, verified model-local Y plane, facing and each side before final Verify.
7. Click **Confirm Plot 1 & Next**. This saves **only an unpublished private D1 mapping draft** with revision CAS and verifies a second no-cache server read of the same polygon. A verified save automatically opens the next unmapped CSV ID. A failed save keeps the current unsaved points for review.
8. Refresh and confirm previously saved plot ID/boundary still exists. To test safe local recovery, make an unfinished change, refresh before confirming, then explicitly use **Restore unfinished plot**. Recovery requires the same project, same immutable Geo/Building source and same mapping revision; it expires after seven days. It does not change D1 or customer sites.
9. Finish remaining CSV IDs. The toolbar shows `Confirmed / Inventory` and `Pending`. The quality panel shows the particular unreviewed source/geometry issues without taking over the canvas.
10. In **1 · CSV / Image**, archive the approved original JPG/PNG/WebP reference and, if required for this project, verify its image ↔ model alignment using 3 distributed anchors and 2 independent withheld checkpoints. Alignment is different from Geo GPS placement. Changes of source/release invalidate old approvals rather than silently moving published polygons.
11. In **3 · Quality**, review mismatched area/side lengths and missing required source approvals. Then in **4 · Publish**, `Save Mapping Draft` for any explicitly staged edits, `Verify All Plots`, `Preview Live vs Draft Plot Changes`, and only then `Publish Verified Mapping to Customer Site` with explicit confirmation. Verify Customer Geo Plot click details on the customer site. Confirming a single polygon never does this automatically.

## Rechecks

- **CSV**: All IDs 1–36 import without auto-generating a polygon. Invalid ID 37 cannot be saved against an imported 36-ID inventory via the new Confirm workflow.
- **Geometry**: No crossing, zero-length edge, overlapping plot, duplicate ID, incomplete role, stale source or mixed project is accepted by the existing server validators.
- **Pointer**: Real mouse, pen and touch; cursor loupe near the point at 100–5000% zoom; pan, pinch, corner handle drag, frame batching and final pointer-up coordinate; no accidental tap during a drag.
- **Fullscreen**: The Confirm/Next toolbar stays visible; Current CSV Plot selector, 4 sections, visual edge roles and mobile Publish action remain accessible.
- **Recovery**: Recovering is opt-in and local-browser-only. Invalid project/model/release/revision or older-than-seven-days data fails closed. Browser storage is not a D1/R2 backup.
- **Release**: Existing published mapping remains unchanged until separately verified and explicitly published; inactive/current Geo releases are independently guarded.

## Important limitations

CSV cannot derive the real GLB plot geometry by itself. It supplies approved dimensional **facts**, not model-bound corner coordinates. Field certification requires separate evidence only when such a real-world survey claim is being made; **ordinary drafting is not subject to a blanket ten-plot physical-survey requirement**.

Pure Node/regression and CI browser smoke validate code paths, but a real manual mouse/touch pass on the customer's particular GLB is still the final way to assess pointer feel and 3D geometry accuracy. Do not describe that field pass as completed until performed.
