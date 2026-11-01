# AR3D Engine · legacy Geo source, publishing, commercial, and acceptance runbook

**Scope:** Engine-owned legacy Geo mapping (including satharai). **Never operate on AR3D Platform or change its releases.**

## Verify, Save, Publish
1. Archive source image in the private project inventory. Check original image SHA and Building/Geo immutable release hashes. Verify at least three independent fit anchors and two separately withheld site-spanning checkpoints.
2. Keep canonical Plot IDs the same in approved CSV, original-image editing and 3D Geo mapper. Unapproved clone geometry is always a template; correct it against the signed original drawing.
3. Save the draft; review all inventory differences, road-facing Front and secondary road edges, signed side/area references, model-local X/Z footprint, model-local Y, geo-scaled estimates, compass and plane approvals.
4. Use **Preview Live vs Draft Plot Changes**. Record all additions, deletions, and field changes; source-sensitive approval remains mandatory. Publish uses a fresh checksum-pinned server preview and an active-release compare-and-swap.
5. Post-publish check the public Geo release and canonical Plot IDs; verify that no different active Geo or Building release is served.

## Replacing a Geo/Building source
- **Do not** reset all polygons by default. Export old source review and save current mapping/recovery manifest first.
- Once the new source has passed independently withheld image/model checks, select only affected Plot IDs for surveyed remap. **The original approved image SHA must remain identical**; if image content differs, complete manual source reconciliation—automatic cross-image remapping is forbidden.
- Preview displacement per Plot ID, confirm exact project and affected records. All plot measurement, model-plane, compass and road approvals become unverified (even untouched polygons need new source review). An old mapping release remains sealed and unchanged.
- Manually review all carried-over plots; Save -> Verify -> new Publish.

## Recovery drill
The **Download Geo Recovery Manifest** endpoint contains D1 Geo mapping metadata and sealed SHA256-verified mapping release data, plus project-scoped R2 keys and hashes. **It does not contain R2 bytes, Cloudflare bindings, buyer/payment ledgers, secrets, or a full production point-in-time database backup.**

- Save the project manifest on an authorized encrypted backup volume; separately export and verify **all referenced R2 object bytes** and full D1 snapshot, environment settings and any payment ledger under project authorization.
- Run `node scripts/geo-restore-isolated.mjs manifest.json` to validate SHA references.
- Run `node scripts/geo-restore-isolated.mjs manifest.json /tmp/geo-review.sqlite` to create a **new offline inspection copy**; existing target files are never overwritten.
- Restore full D1+R2 into a separate, access-controlled Cloudflare/nonproduction environment using an operator-owned procedure, verify R2 SHA256 against manifest, and separately verify project ownership, auth scoping and immutable active release integrity before any production rollback.
- Do not treat the metadata-only rehearsal as a real cloud recovery drill.

## Commercial and client authorization
- Only owner-verified canonical Geo Plot ID records for the *exact published mapping release* may advertise Available, Booked or Sold and an INR amount. Missing records stay **unverified**, never assumed Available.
- Record source evidence and explicit public approval; all updates are revision-gated, audited and append immutable review events. **These are listing facts, not proof of receipt, buyer identity, or a payment ledger.**
- Historic source-map business records do not silently apply after a new map release. Verify the new release and reapprove each plot.
- Existing contact directory entries are **not live client accounts**. Do not promise client-admin scoped access until identity verification, session provisioning, least-privilege authorizations and owner approval are implemented and security-reviewed.

## Mandatory real-world acceptance
Run `node scripts/geo-site-acceptance.mjs verified-field-samples.json` with **at least 10 actual, independently surveyed, unique satharai plots** referencing approved source sheets, plot corners, image coordinates and approved areas. Source-checkpoint numeric acceptance alone is not a legal survey certificate.

Automated generated fixtures test 500, 1,000 and 2,500 plot geometry, viewport culling and approximate processing cost. This **does not measure mobile frame rate, real device GPU load or real network/data latency**. Separately test Android Chrome, iOS Safari, pointer/mouse, keyboard, screen-reader ergonomics, physical site survey GPS and production browser WhatsApp preview fetch, cached image dimensions and version-bound link metadata.

**Acceptance remains OPEN** until: independent 10-site plot review, remote D1+R2 backup and isolated full restore, device checks, mobile 500/1k/2.5k performance measurements, live WhatsApp crawler verification and scoped client-admin auth are backed by retained evidence.
