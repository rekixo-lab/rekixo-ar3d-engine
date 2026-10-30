-- Engine-only, additive 3D Geo plot mapping. No Platform tables or source models change.
-- All plot vertices use immutable Building-local [X,Z] metres, not map pixels.
CREATE TABLE IF NOT EXISTS geo_plot_mapping_drafts_3d (
  project_id TEXT PRIMARY KEY REFERENCES projects_3d(id) ON DELETE CASCADE,
  experience_id TEXT NOT NULL REFERENCES experiences_3d(id) ON DELETE CASCADE,
  geo_release_id TEXT NOT NULL REFERENCES geo_releases_3d(id) ON DELETE RESTRICT,
  building_release_id TEXT NOT NULL REFERENCES releases_3d(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
  verified_revision INTEGER CHECK(verified_revision IS NULL OR verified_revision <= revision),
  plots_json TEXT NOT NULL CHECK(json_valid(plots_json) AND json_type(plots_json)='array'),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_geo_plot_drafts_experience ON geo_plot_mapping_drafts_3d(experience_id);
CREATE TABLE IF NOT EXISTS geo_plot_mapping_releases_3d (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects_3d(id) ON DELETE RESTRICT,
  experience_id TEXT NOT NULL REFERENCES experiences_3d(id) ON DELETE RESTRICT,
  geo_release_id TEXT NOT NULL REFERENCES geo_releases_3d(id) ON DELETE RESTRICT,
  building_release_id TEXT NOT NULL REFERENCES releases_3d(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK(version > 0),
  draft_revision INTEGER NOT NULL CHECK(draft_revision > 0),
  plots_json TEXT NOT NULL CHECK(json_valid(plots_json) AND json_type(plots_json)='array'),
  sha256 TEXT NOT NULL CHECK(length(sha256)=64),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(experience_id,version),
  UNIQUE(experience_id,geo_release_id,draft_revision)
);
CREATE INDEX IF NOT EXISTS idx_geo_plot_releases_project ON geo_plot_mapping_releases_3d(project_id,version DESC);
CREATE TABLE IF NOT EXISTS geo_plot_mapping_active_3d (
  experience_id TEXT PRIMARY KEY REFERENCES experiences_3d(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects_3d(id) ON DELETE CASCADE,
  mapping_release_id TEXT NOT NULL REFERENCES geo_plot_mapping_releases_3d(id) ON DELETE RESTRICT,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS geo_plot_release_immutable_update
BEFORE UPDATE ON geo_plot_mapping_releases_3d BEGIN SELECT RAISE(ABORT,'Published Geo plot mapping is immutable'); END;
-- Historical rows have no public delete API; explicit hard-project deletion may
-- remove their project-owned history. UPDATE remains database-immutable.
CREATE TRIGGER IF NOT EXISTS geo_plot_active_owner_insert BEFORE INSERT ON geo_plot_mapping_active_3d
WHEN NOT EXISTS (SELECT 1 FROM geo_plot_mapping_releases_3d r
 WHERE r.id=NEW.mapping_release_id AND r.project_id=NEW.project_id AND r.experience_id=NEW.experience_id)
BEGIN SELECT RAISE(ABORT,'Geo plot mapping active release owner mismatch'); END;
CREATE TRIGGER IF NOT EXISTS geo_plot_active_owner_update BEFORE UPDATE ON geo_plot_mapping_active_3d
WHEN NOT EXISTS (SELECT 1 FROM geo_plot_mapping_releases_3d r
 WHERE r.id=NEW.mapping_release_id AND r.project_id=NEW.project_id AND r.experience_id=NEW.experience_id)
BEGIN SELECT RAISE(ABORT,'Geo plot mapping active release owner mismatch'); END;
