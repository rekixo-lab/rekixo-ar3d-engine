# AR3D Engine: evidence-backed 3D Geo customer launch review

Scope: **new `building_geo` projects**. This tool is a read-only operator review; it does not change the production D1 database, R2 objects, public customer site, immutable releases, or source approval. It does **not** independently authenticate physical survey records, screenshots, operator statements, or cloud isolation. A person with project authority must sign off separately.

## Inputs before running

1. Create/publish the real 3D Building GLB, checked WGS84 Geo release, and all source-reviewed Geo Plot polygons. Note the **project slug** and **active immutable Geo Plot mapping release ID**. Never substitute a screenshot polygon for surveyed geometry.
2. Put the actual ten-plus signed plot survey measurements and independent image-to-model control-point observations in `evidence/survey.json`, using the exact `rekixo-geo-site-field-review-v1` format accepted by `scripts/geo-site-acceptance.mjs`. Use signed source IDs; do not reuse calibration anchors as independent survey checkpoints.
3. On **physical** Android Chrome and iPhone Safari, test public placement, touch/pan/zoom, tapping a plot, mobile layout, and performance. Test WhatsApp share cards **inside WhatsApp** on both devices. Record real hardware/browser/tester/version/timestamp and screenshot files under a private `evidence/` directory. Playwright device emulation does not qualify.
4. Run a complete authorized **read-only** remote D1 export and download all project-owned R2 bytes, using `scripts/geo-cloud-backup.mjs` and the latest owner recovery manifest. Stop writes during the snapshot. Use an encrypted, access-controlled private folder; it contains customer/private records.
5. Rehearse an independent **isolated Cloudflare D1+R2 restore** using independently approved **non-production resources and separate credentials**. This is operator infrastructure work, not something the CLI silently initiates. Keep proof of the isolated DB name, isolated R2 bucket, source matching, test results and no production changes, as a private local evidence file.
6. Publish the actual Geo share poster and include the complete version-bound HTTPS Geo share URL, including the `?share=<version>` parameter. The CLI fetches the public OG page and image as a crawler and checks real image bytes. A successful crawler probe alone is not an in-app WhatsApp acceptance.

## Manifest example

Save to `launch-evidence.json`. Replace every placeholder and generate actual lowercase SHA-256 hashes for each local evidence file (for example, `sha256sum evidence/android-geo.png`). The following is a **shape example, not accepted evidence**.

```json
{
  "schema": "rekixo-geo-customer-launch-evidence-v1",
  "projectSlug": "real-project-slug",
  "mappingReleaseId": "actual-immutable-geo-mapping-release-id",
  "shareUrl": "https://customer.example.com/3Dprojects/real-project-slug/geo?share=actual-version",
  "surveyEvidence": {
    "path": "survey.json",
    "sha256": "REPLACE_WITH_REAL_SHA256"
  },
  "devices": [
    {
      "platform": "android",
      "browser": "Chrome",
      "projectSlug": "real-project-slug",
      "mappingReleaseId": "actual-immutable-geo-mapping-release-id",
      "realDevice": true,
      "emulated": false,
      "deviceModel": "actual Android model",
      "osVersion": "actual Android version",
      "browserVersion": "actual Chrome version",
      "tester": "responsible operator",
      "checkedAt": "2026-11-01T12:00:00+05:30",
      "checks": {
        "geoPlacement": true,
        "panZoom": true,
        "plotClick": true,
        "mobileLayout": true,
        "performance": true
      },
      "siteScreenshot": {
        "path": "android-geo.png",
        "sha256": "REPLACE_WITH_REAL_SHA256"
      },
      "whatsappScreenshot": {
        "path": "android-whatsapp.png",
        "sha256": "REPLACE_WITH_REAL_SHA256"
      }
    },
    {
      "platform": "ios",
      "browser": "Safari",
      "projectSlug": "real-project-slug",
      "mappingReleaseId": "actual-immutable-geo-mapping-release-id",
      "realDevice": true,
      "emulated": false,
      "deviceModel": "actual iPhone model",
      "osVersion": "actual iOS version",
      "browserVersion": "actual Safari version",
      "tester": "responsible operator",
      "checkedAt": "2026-11-01T12:00:00+05:30",
      "checks": {
        "geoPlacement": true,
        "panZoom": true,
        "plotClick": true,
        "mobileLayout": true,
        "performance": true
      },
      "siteScreenshot": {
        "path": "iphone-geo.png",
        "sha256": "REPLACE_WITH_REAL_SHA256"
      },
      "whatsappScreenshot": {
        "path": "iphone-whatsapp.png",
        "sha256": "REPLACE_WITH_REAL_SHA256"
      }
    }
  ],
  "isolatedCloudRestore": {
    "success": true,
    "projectSlug": "real-project-slug",
    "mappingReleaseId": "actual-immutable-geo-mapping-release-id",
    "verifiedAt": "2026-11-01T12:00:00+05:30",
    "operator": "authorized recovery operator",
    "database": "private-qa-d1-name-not-production",
    "bucket": "private-qa-r2-name-not-production",
    "productionChanged": false,
    "evidence": {
      "path": "isolated-cloud-restore-report.txt",
      "sha256": "REPLACE_WITH_REAL_SHA256"
    }
  }
}
```

## Run

Use Node 22+, from Engine repository root, after the real evidence and authorized backup are ready.

```bash
node scripts/geo-site-acceptance.mjs evidence/survey.json
node scripts/geo-social-preview-check.mjs 'https://customer.example.com/3Dprojects/real-project-slug/geo?share=actual-version'
node scripts/geo-customer-launch-gate.mjs \
  launch-evidence.json /private/full-backup /private/geo-restore-fresh.sqlite evidence
```

The target SQLite file must **not exist**; the isolated offline restore deliberately refuses to overwrite it. Evidence screenshot files must reside inside the evidence folder, be nonempty, and match their SHA-256 hashes; symlink escapes and production-named recovery resources are rejected. A failed/missing check exits nonzero and prevents an `EVIDENCE_COMPLETE` report.

If successful, the report status is `EVIDENCE_COMPLETE_PENDING_INDEPENDENT_OWNER_SIGNOFF`, **not** `fieldCertified: true`. Archive the result privately and have the real owner compare GPS, survey, WhatsApp visual card, cloud isolation, developer contact/privacy and customer plot facts independently before selling or handing off the site. Any published mapping revision, changed share version, or updated model requires fresh relevant evidence.

## Still not automated by this tool

- Acquiring independent field measurements or signing legal plot boundaries.
- Genuine iPhone/Android hardware operation and WhatsApp's own caches.
- Provisioning isolated Cloudflare resources, obtaining approval/credentials or restoring live D1/R2 into them.
- Implementing full Platform-style custom-domain operations or delegated client geometry publishing. These remain separate engineering scopes; do not mark them complete because this review script passes.
- Enabling repository branch-protection rules (an authorized GitHub repository administrator must do it).

**Never commit real buyer names, contact numbers, production backups, cloud credentials, signed survey documents, or customer screenshots to this repository.**
