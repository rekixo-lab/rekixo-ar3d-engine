-- Independent image-masterplan social share previews. Existing Building/Geo branding is untouched.
CREATE TABLE IF NOT EXISTS masterplan_share_drafts_3d(
  project_id TEXT PRIMARY KEY REFERENCES projects_3d(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  card_asset_id TEXT REFERENCES studio_assets_3d(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS masterplan_share_releases_3d(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects_3d(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK(version>0),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 3 AND 120),
  description TEXT NOT NULL CHECK(length(description) BETWEEN 10 AND 280),
  card_asset_id TEXT NOT NULL REFERENCES studio_assets_3d(id) ON DELETE RESTRICT,
  card_sha256 TEXT NOT NULL CHECK(length(card_sha256)=64),
  mapping_release_id TEXT NOT NULL REFERENCES masterplan_geo_releases_3d(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK(revision>0),
  published_by TEXT NOT NULL,
  published_at TEXT NOT NULL,
  UNIQUE(project_id,version),
  UNIQUE(project_id,revision)
);
CREATE TABLE IF NOT EXISTS masterplan_share_active_3d(
  project_id TEXT PRIMARY KEY REFERENCES projects_3d(id) ON DELETE CASCADE,
  release_id TEXT NOT NULL REFERENCES masterplan_share_releases_3d(id) ON DELETE RESTRICT,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS trg_masterplan_share_immutable
BEFORE UPDATE ON masterplan_share_releases_3d
BEGIN SELECT RAISE(ABORT,'Published masterplan share version is immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_masterplan_share_owner_insert
BEFORE INSERT ON masterplan_share_active_3d
WHEN NOT EXISTS(SELECT 1 FROM masterplan_share_releases_3d r
  WHERE r.id=NEW.release_id AND r.project_id=NEW.project_id)
BEGIN SELECT RAISE(ABORT,'Share release belongs to another project'); END;
CREATE TRIGGER IF NOT EXISTS trg_masterplan_share_owner_update
BEFORE UPDATE ON masterplan_share_active_3d
WHEN NOT EXISTS(SELECT 1 FROM masterplan_share_releases_3d r
  WHERE r.id=NEW.release_id AND r.project_id=NEW.project_id)
BEGIN SELECT RAISE(ABORT,'Share release belongs to another project'); END;
