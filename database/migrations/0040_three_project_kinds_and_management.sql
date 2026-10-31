-- Engine-only, forward-compatible three-project management foundation.
-- Existing projects remain 'legacy'; their Building/Geo ownership, URLs, assets and releases are unchanged.
ALTER TABLE projects_3d ADD COLUMN project_kind TEXT NOT NULL DEFAULT 'legacy'
  CHECK(project_kind IN ('legacy','building','building_geo','masterplan_geo'));

CREATE INDEX IF NOT EXISTS idx_projects_3d_kind_status
  ON projects_3d(project_kind,status,updated_at DESC);

CREATE TABLE IF NOT EXISTS project_profiles_3d (
  project_id TEXT PRIMARY KEY REFERENCES projects_3d(id) ON DELETE CASCADE,
  builder_name TEXT NOT NULL DEFAULT '',
  contact_name TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  phone_primary TEXT NOT NULL DEFAULT '',
  phone_secondary TEXT NOT NULL DEFAULT '',
  whatsapp TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  website_url TEXT NOT NULL DEFAULT '',
  maps_url TEXT NOT NULL DEFAULT '',
  brochure_url TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Project client directory is not a login/session grant. It records owner-reviewed
-- client contacts until a separately audited client authentication flow is enabled.
CREATE TABLE IF NOT EXISTS project_client_directory_3d (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects_3d(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  proposed_role TEXT NOT NULL DEFAULT 'viewer'
    CHECK(proposed_role IN ('viewer','editor','approver','client_admin')),
  access_state TEXT NOT NULL DEFAULT 'not_provisioned'
    CHECK(access_state IN ('not_provisioned','disabled')),
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_project_clients_project ON project_client_directory_3d(project_id,updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_clients_unique_email
  ON project_client_directory_3d(project_id,lower(email)) WHERE email<>'';

-- Image masterplan projects own their source, normalized 2D polygons and calibrated
-- geographic placement; they do not require a Building or Geo-GLB release.
CREATE TABLE IF NOT EXISTS masterplan_geo_drafts_3d (
  project_id TEXT PRIMARY KEY REFERENCES projects_3d(id) ON DELETE CASCADE,
  image_asset_id TEXT REFERENCES studio_assets_3d(id) ON DELETE RESTRICT,
  source_width INTEGER CHECK(source_width BETWEEN 1 AND 50000),
  source_height INTEGER CHECK(source_height BETWEEN 1 AND 50000),
  control_points_json TEXT NOT NULL DEFAULT '[]'
    CHECK(json_valid(control_points_json) AND json_type(control_points_json)='array'),
  plots_json TEXT NOT NULL DEFAULT '[]'
    CHECK(json_valid(plots_json) AND json_type(plots_json)='array'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  verified_revision INTEGER CHECK(verified_revision IS NULL OR verified_revision<=revision),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS masterplan_geo_releases_3d (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects_3d(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK(version>0),
  source_asset_id TEXT NOT NULL REFERENCES studio_assets_3d(id) ON DELETE RESTRICT,
  source_sha256 TEXT NOT NULL CHECK(length(source_sha256)=64),
  width INTEGER NOT NULL CHECK(width>0),
  height INTEGER NOT NULL CHECK(height>0),
  mapping_json TEXT NOT NULL CHECK(json_valid(mapping_json)),
  mapping_sha256 TEXT NOT NULL CHECK(length(mapping_sha256)=64),
  draft_revision INTEGER NOT NULL CHECK(draft_revision>0),
  published_by TEXT NOT NULL,
  published_at TEXT NOT NULL,
  UNIQUE(project_id,version),
  UNIQUE(project_id,draft_revision)
);
CREATE TABLE IF NOT EXISTS masterplan_geo_active_3d (
  project_id TEXT PRIMARY KEY REFERENCES projects_3d(id) ON DELETE CASCADE,
  release_id TEXT NOT NULL REFERENCES masterplan_geo_releases_3d(id) ON DELETE RESTRICT,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS trg_masterplan_release_no_update
BEFORE UPDATE ON masterplan_geo_releases_3d
BEGIN SELECT RAISE(ABORT,'Masterplan release is immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_masterplan_active_owner_insert
BEFORE INSERT ON masterplan_geo_active_3d
WHEN NOT EXISTS(SELECT 1 FROM masterplan_geo_releases_3d r
  WHERE r.id=NEW.release_id AND r.project_id=NEW.project_id)
BEGIN SELECT RAISE(ABORT,'Masterplan release belongs to another project'); END;
CREATE TRIGGER IF NOT EXISTS trg_masterplan_active_owner_update
BEFORE UPDATE ON masterplan_geo_active_3d
WHEN NOT EXISTS(SELECT 1 FROM masterplan_geo_releases_3d r
  WHERE r.id=NEW.release_id AND r.project_id=NEW.project_id)
BEGIN SELECT RAISE(ABORT,'Masterplan release belongs to another project'); END;
