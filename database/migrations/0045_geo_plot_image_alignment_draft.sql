-- Stage 2: owner-private, revisioned source image -> immutable Building-local X/Z alignment.
-- Does not modify existing legacy plots, public releases, sales, assets or geo placement.
CREATE TABLE IF NOT EXISTS geo_plot_image_alignment_drafts_3d (
  project_id TEXT PRIMARY KEY REFERENCES projects_3d(id) ON DELETE CASCADE,
  image_asset_id TEXT NOT NULL REFERENCES studio_assets_3d(id) ON DELETE RESTRICT,
  image_sha256 TEXT NOT NULL CHECK(length(image_sha256)=64),
  geo_release_id TEXT NOT NULL REFERENCES geo_releases_3d(id) ON DELETE RESTRICT,
  building_release_id TEXT NOT NULL REFERENCES releases_3d(id) ON DELETE RESTRICT,
  model_sha256 TEXT NOT NULL CHECK(length(model_sha256)=64),
  revision INTEGER NOT NULL CHECK(revision >= 1),
  verified_revision INTEGER CHECK(verified_revision IS NULL OR verified_revision <= revision),
  control_points_json TEXT NOT NULL CHECK(json_valid(control_points_json) AND json_type(control_points_json)='array'),
  checkpoints_json TEXT NOT NULL CHECK(json_valid(checkpoints_json) AND json_type(checkpoints_json)='array'),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
