# Existing Geo projects — CSV-first Plot Inventory (Engine-only)

This is the first, **non-destructive** bridge from AR3D Platform's pre-mapping
data-first workflow into legacy AR3D Engine Geo projects such as `satharai`.
It DOES NOT merge the Platform database, replace a Building model, or change
3D Geo's published mapping coordinate system.

## Super Admin workflow

1. Select an **existing legacy** project with a verified published Building/Geo release.
   Open **Geo Plot Mapper → 01 · Plot Inventory & original sources**.
2. Download the CSV template. Provide one row per unique Plot ID; optional approved
   area, units, dimensions, Front/Back/Depth A/B, road, facing and exact source refs.
   Numeric side sizes require an explicit `ft` or `m` unit and
   `measurementSource`. An approved area requires `areaSource`.
   Legacy aliases `Plot No`, `Sqft`, `Sqm`, `Sqyd`, `Dimension Unit`, etc.
   are also recognized. Contradictory area units are rejected.
3. Choose the CSV. **Preflight performs no writes**, reports added/updated/mapped
   counts, rejects duplicates and malformed units. If the file omits any previous
   inventory Plot ID, import is rejected: omission is *never* a deletion.
4. Confirm draft import. The server records only project-owned private source
   inventory, with optimistic revision protection, audit and read-back.
5. Choose **Start Next Unmapped** or select any pending inventory ID. Draw 4
   corners (or switch to Irregular), review the imported dimensions, mark source
   verification, Apply Plot → Save Mapping Draft → Verify → Publish.
6. A previously mapped plot is edited via **Plot Editor**, not by blindly
   overwriting geometry from the imported CSV. CSV changes to its source inventory
   remain pending review until explicitly applied to that mapped plot.

## Original masterplan reference

Use the same panel to **Archive original reference image** (JPEG/PNG/WebP,
max 16 MB). It is stored as a *private* checksum-verified Engine `reference`
asset and is visible/downloadable from Project Assets. This stage intentionally
does NOT align, overlay, activate or replace the verified model; the existing
3D canvas remains Building-local X/Z. Image/GLB calibration and survey-grounded
update publishing are separate future implementation milestones.

## Non-negotiable safety boundaries

- Inventory lives in `geo_plot_inventory_3d`. There are no writes to
  `geo_plot_mapping_drafts_3d`, mapping releases, Building/Geo releases,
  customer plot statuses, payments, AR3D Platform, or public Workers during import.
- Imported metadata is **never automatically verified**. CSV values are
  informative until a human reviews sources and explicitly verifies each
  mapped plot before publishing.
- Project archives are read-only. All API actions require Engine Admin session;
  mutation requires same-origin and exact inventory revision.
- No silent source replacement. New Building/Geo release still makes old
  geometry stale until an operator reviews any subsequent migration.
- No claims of cadastral measurement accuracy are justified solely by CSV,
  image drawing or 3D model-scale estimates.

## Follow-up milestones

1. Reviewed image-to-canonical-model calibration, with independent checkpoints;
   proof that source-image normalized UV remains invariant across fullscreen/pan.
2. Loupe/cursor-anchored high zoom and repeatable vertex/edge snap on image
   underlay, while retaining the existing 3D model local coordinates.
3. Source-change reconciliation that preserves customer business data and requires
   re-verification before Publish Update; release snapshots and rollback.
4. Real Chrome/Safari device validation and live `satharai` human review.
