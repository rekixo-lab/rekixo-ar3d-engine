# Geo Masterplan — Field Acceptance Checklist

**Repository:** Rekixo AR3D Engine only. This checklist supplements (not replaces)
the immutable-release verification and the [Engine recovery runbook](./RECOVERY-RUNBOOK.md).

## 1. Independent GPS survey verification

Only a qualified surveyor/operator with the approved site plan may fill out
the checkpoint file. **Do not invent coordinates or treat satellite images as a survey.**

Use a local JSON file (never commit private coordinates) with these exact properties:

- `controlPoints`: 3–24 separate image-to-GPS points used to fit the affine transform;
  each must have finite `u`/`v` values in [0,1], WGS84 `lat`/`lng`, a nonempty
  `source` and `verified:true`.
- `checkpoints`: at least **3 additional surveyed points not reused in controlPoints**,
  covering at least 40% of the image in **both** U and V. Use the same field names.
- The original signed survey drawing/control register and independent field readings
  must be retained separately as evidence.

Run after `npm ci`:

```bash
node scripts/check-masterplan-survey.mjs /secure/path/survey-checkpoints.json
```

The command fails closed when the fitted controls are invalid, field points are
not independent, coverage is insufficient, or any held-out error exceeds **2 m**.
It prints a concise summary with max/RMS held-out errors and estimated image size,
but does **not** send coordinates to a server or publish a project.
The result `fieldCertified:false` is intentional: neither a signed survey's
authenticity nor physical ground alignment is proven by numeric checks alone.

## 2. Device acceptance (physical testing required)

On at least one real Android Chrome and one real iOS Safari device, for the **same
published surveyed project**:

- Admin Source, Plot Mapper and Mapping Controls: use Pan to single-finger drag
  and two-finger pinch; verify image remains within bounds and plot coordinates
  do not change from view navigation. Fit/Zoom controls must restore intended view.
- Admin plotting: draw a boundary, edit a corner, save/reopen draft, verify/publish,
  and confirm no unapproved source/area/direction was marked verified.
- Public Google Satellite: two-finger zoom/pan in cooperative touch mode; tap plots,
  toggle Plots ON/OFF, adjust overlay opacity, rotate the device, and verify the
  approved image stays georeferenced rather than shifting relative to roads.
- Disable/block Google Maps API temporarily on a test device (not in production).
  In image-only fallback, single-finger pan, two-finger pinch, Fit Image, opacity,
  and tap-to-open plot details must still work. This fallback is *not* evidence of
  validated satellite alignment.
- Inspect narrow screens for blocked toolbar buttons or obscured Plot Details.

Record device model, OS/browser version, screenshot/video, project release ID,
date/time, and whether each step passed. **Automated Node/browser tests do not
substitute for these physical-device observations.**

## 3. WhatsApp and social sharing acceptance

Publish an immutable Share Builder poster with the verified masterplan. Copy the
link and confirm its origin is `https://ar3dstudio.in` with `?share=<share-id>`.
The public HTML response must include matching `og:url`, `og:title` and
`og:image`; the pinned image URL must return **HTTP 200**, image bytes and a
correct image content type for both GET and HEAD. Verify on WhatsApp Android
and iOS, including a previously shared version after activating a newer poster.

External social crawlers cache previews; use a new immutable share version/link
when refreshing an old preview. Do not interpret a messaging-app cache as an R2
asset-write failure without checking the public GET and metadata first.

## 4. Recovery and client access release gates

- Full per-project recoverable export/restore is **not yet implemented**. D1 Time
  Travel and Engine-owned R2 recovery require a separately reviewed operator
  procedure. Do not promise a downloadable full backup from the Project Assets
  manifest or attempt production restore without an incident plan.
- Client Directory proposed roles are not permissions. Actual client login,
  session lifecycle, tenant scoping, MFA/recovery and financial approval rules
  require a separate security-reviewed implementation and staged rollout.
  Do not automatically provision accounts or grant access from client records.
- Recheck legacy Building and Building Geo customer paths after any changes;
  the separate AR3D Platform must not be mutated.

**Completion criteria:** Independent surveyed readings, both physical mobile
devices, pinned social previews and recovery/access approvals have recorded
evidence. Until then describe the release as code-tested, *not field-certified*.
