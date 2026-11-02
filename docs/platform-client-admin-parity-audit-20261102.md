# AR3D Platform → AR3D Engine | Project Client Admin audit

Audited 2026-11-02 against
`rekixo-lab/rekixo-ar3d-platform` and
`rekixo-lab/rekixo-ar3d-engine` (GitHub `main`).

## Verified Platform flow

1. Super Admin creates a project or selects an existing project, attaches one or more
   `client_admin` accounts with a mobile/email login ID, temporary password and optional
   admin/public domains. An atomic D1 transaction inserts the user, project membership
   and audit event.
2. Client Admin signs in via the project-specific `/projects/:slug/admin-login` path.
   Authentication is project- and host-scoped. A forced password change follows first
   use/reset; disabled users and rotated session versions lose access.
3. The Platform Client Admin dashboard contains Overview counts and masterplan
   preview; Plots status and booking details (owner name, booking amount, broker);
   optional per-plot pricing; Gallery image upload/delete; customer-facing Contact
   fields; gated Sales & Accounts, Deal Progress, and Plot Updates modules. Super
   Admin controls enabling permissions. Client accounts cannot use owner-only
   mapping, CAD, domain and release-publishing endpoints.
4. Server APIs independently enforce project scope, same-origin writes, immutable
   mapped inventory constraints, explicit financial roles and audit logs.

## Engine parity state (PR #376 + password/branding follow-up #377)

| Capability | Platform | Engine in this PR |
| --- | --- | --- |
| Dedicated client login URL | /projects/:slug/admin-login | /3Dprojects/:slug/client-admin |
| Project isolation & client session | Yes | Yes, checked on enrollment/session/data requests |
| Super Admin client provisioning | Yes | New Client Admin creates mobile/email ID + temporary password atomically; invitations remain available |
| Dashboard | Counts + masterplan preview | Counts + status summary (source-backed) |
| Plot statuses | Available / Booked / Sold, Metro special | 3D Geo review/commercial approvals; Image Geo read-only booked/confirmed |
| Private prices | Optional, permissions | Existing 3D Geo CSV review and commercial records |
| Deal progress | Optional | Existing scoped 3D Geo deal records |
| Sale/payment ledger | Role-gated accounting | **Not yet available to client**; Engine Owner ledger remains private |
| Booking customer/broker details | Client details | **Not yet available to client** |
| Gallery images | Upload/delete | **Not yet available** |
| Customer contact editing | Whitelisted | Client Admin-only customer-facing fields with revision and audit; Owner identity and public-consent remain restricted |
| Plot notices | Optional drafts/publish | **Not yet available** |
| Email/mobile password login | Yes | Project-scoped PBKDF2 password login, hashed rate limits and 8-hour HttpOnly session; legacy invite retained |
| Password reset & forced rotation | Yes | Owner one-time password issuance/reset, revoked sessions and required first-login password change |
| Project custom domain | Yes | Canonical `ar3dstudio.in/3Dprojects/:slug/client-admin` (legacy Engine Owner host remains separate) |
| Client access to mapper/CAD/releases | No | No |

## Security requirements before enabling remaining modules

- **Passwords:** this follow-up adds an independent project-bound credential table,
  PBKDF2 hashing, identifier/IP rate limits, session revocation, password reset,
  mandatory change and Platform-compatible India/E.164 mobile normalization.
  Never reuse Engine Owner credentials. Production deployment must apply the
  additive D1 migration before enabling the new login UI.
- **Sales:** distinguish 3D Geo commercial *listing* records from legal sales and
  the Image Geo masterplan financial ledger. Build a separate role-controlled
  client API, version checks, transaction/audit rows and cash reconciliation
  before any buyer, payment or confirmed-sale writes.
- **Contacts:** client-only narrow field whitelist and revision-safe writes are in
  this PR. Owner must still approve public contact visibility and initialize profile;
  validate on live devices before broader roles can edit.
- **Gallery:** project-owned R2 keys, file/MIME/size limits, at-rest visibility,
  safe deletion, audit trail and public rendering rules.
- **Notices:** draft/review/publish permissions, event audit and project-bound
  immutable release references.
- **Older projects:** migrate non-destructively; don't remap plots, overwrite
  releases, reassign clients or enable any client write by default.

Owner and client authorization must be enforced **server-side**, not through
hidden React tabs. All client queries must use the verified session project ID
and active release; URLs/request bodies cannot elevate scope.
