-- Project-scoped CSV-first draft inventory for existing legacy Building/Geo sites.
-- Inventory does not publish, change model coordinates, or mutate mapped polygons.
CREATE TABLE IF NOT EXISTS geo_plot_inventory_3d (
  project_id TEXT PRIMARY KEY REFERENCES projects_3d(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  rows_json TEXT NOT NULL CHECK(json_valid(rows_json) AND json_type(rows_json)='array' AND length(rows_json)<=2000000),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
