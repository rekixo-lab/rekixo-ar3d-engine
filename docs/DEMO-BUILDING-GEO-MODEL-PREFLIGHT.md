# Building + Geo demos: large-GLB and COLLADA preflight (2026-11-11)

This is an operator checklist for **new independent `building_geo` demo projects**. It does not create projects, publish releases or alter existing customer data.

## Shreem Palace: original GLB

- Source: `shreem palace glb.glb` (148,874,960 bytes; self-contained GLB 2.0).
- Audited JSON chunk: `12,966,136` bytes. Canonical processing and automatic Building release inspection accept up to **32 MiB** glTF JSON, with the full GLB still limited to **512 MiB**. Invalid headers, external dependencies and mismatched source identities continue to fail closed.
- The original model includes many meshes, a large site footprint, and an off-center origin. **Do not** auto-center, warp, scale or translate its canonical geometry merely to make it fit on Google Maps.
- Confirm model dimensions in *actual metres* against an independently known site length. The geometry-only dimensions from file inspection are ~663.04 × 149.96 × 402.52 (X/Y/Z), but may include landscaping or export offset and must not be assumed a surveyed parcel.

## Geo derivative and placement

1. Publish the verified **Building** source first. Geo must pin the exact immutable Building release.
2. Use `node scripts/build-geo-model-derivative.mjs <project-slug> <output-dir>` with operator access to the published Building project endpoint. This builds an **optional map-only** derivative; it does not overwrite the canonical source.
3. Derivative V5 does **not** recenter the model. An explicit min/max bounding-box guard rejects wrong local coordinates beyond a per-axis tolerance (0.1–0.5 metres). Its metadata records `coordinateFrame: canonical-model-local-v1` and validation results.
4. Keep existing V4 derivatives available for existing releases. For **new** demos use a V5-derived model; manually compare original vs optimized alignment with actual corners and all 3 axes.
5. An optimized model with more than 8,000,000 bytes, 180 rendered meshes, missing normals or incompatible extensions fails closed. If it cannot be generated without too much quality loss, do **not** share a slow full-size fallback as a validated mobile demo. Optimize source mesh/material structure separately and retry.
6. In Geo Editor, select the canonical Building release, use an exact model-local anchor, verify WGS84 coordinate and heading, fit 2–4 stable site points, inspect vertical base, then **Save → Verify Preview → Publish Geo**.
7. Require real desktop + mobile browser tests (including reload, orbit, textures and GPU/context recovery). An automated test passing is **not** equivalent to a visual acceptance on the supplied 142 MB model.
8. Geo public site should be marked **Conceptual Demo Location** when the placement is intentionally illustrative.

## Dholera: external-texture COLLADA source

- `DHOLERA.dae`: SketchUp COLLADA 1.4.1; **Z_UP**; **inch units** (meter=0.0254). Its ~52 external images are referenced under a sibling `DHOLERA/` folder.
- The source **must include all images**; the Engine does not publish raw DAE as Building geometry authority. Do not fabricate replacement colors and present them as exact.
- Install **Blender 4.5 LTS** (5.x no longer bundles a native COLLADA importer). Convert on a machine with sufficient RAM and CPU.
- Put `DHOLERA/` textures in the same directory as `DHOLERA.dae`, then run:

```bash
blender -b -t 4 \
  --python scripts/asset-pipeline/convert-collada-to-glb.py \
  -- /path/DHOLERA.dae /path/DHOLERA-converted.glb \
  --expected-xyz 444.83 685.77 34.69
```

The script fails on missing external images, unsupported Blender, empty mesh scene, suspicious unit-size differences or failed export. It writes a conversion JSON report alongside a new GLB and refuses to overwrite existing output. The `--expected-xyz` values are **preliminary** metrics from source-scene inspection, not certified site measurements; adjust only after confirming survey/model dimensions and axis handling.

After conversion, visually inspect all villas, roads, landscaping, materials and repeated components before submitting the GLB to the Engine as the sole approved geometry authority. Preserve `DHOLERA.dae` and texture assets as immutable source evidence.

## Safe rollout

- Never replace a live model/project to make a demo. Use separate draft `building_geo` projects.
- Test in an isolated branch and CI. Verify actual uploaded models and live preview on desktop/mobile. Merge/deploy only after these gates.
- Dholera cannot pass its production conversion gate until the referenced textures are supplied.
