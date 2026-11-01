-- Private source-reviewable pricing drafts, release scoped; never implicit public prices.
CREATE TABLE IF NOT EXISTS geo_plot_pricing_sheets_3d (
 project_id TEXT NOT NULL REFERENCES projects_3d(id) ON DELETE CASCADE,
 mapping_release_id TEXT NOT NULL REFERENCES geo_plot_mapping_releases_3d(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL CHECK(revision>0),
 quotes_json TEXT NOT NULL CHECK(json_valid(quotes_json) AND json_type(quotes_json)='array'),
 sha256 TEXT NOT NULL CHECK(length(sha256)=64),
 source_ref TEXT NOT NULL CHECK(length(source_ref) BETWEEN 3 AND 250),
 updated_by TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(project_id,mapping_release_id)
);
CREATE TRIGGER IF NOT EXISTS trg_geo_pricing_source_owner_insert
BEFORE INSERT ON geo_plot_pricing_sheets_3d
WHEN NOT EXISTS (SELECT 1 FROM geo_plot_mapping_releases_3d r
  WHERE r.id=NEW.mapping_release_id AND r.project_id=NEW.project_id)
BEGIN SELECT RAISE(ABORT,'Pricing belongs to another project or release'); END;
CREATE TRIGGER IF NOT EXISTS trg_geo_pricing_source_owner_update
BEFORE UPDATE ON geo_plot_pricing_sheets_3d
WHEN NEW.project_id<>OLD.project_id OR NEW.mapping_release_id<>OLD.mapping_release_id
 OR NOT EXISTS (SELECT 1 FROM geo_plot_mapping_releases_3d r
  WHERE r.id=NEW.mapping_release_id AND r.project_id=NEW.project_id)
BEGIN SELECT RAISE(ABORT,'Pricing cannot change project or immutable source'); END;
