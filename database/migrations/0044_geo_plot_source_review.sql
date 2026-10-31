-- Existing legacy Geo Plot Mapper: pin source-inventory revision on review.
-- Null represents old verification, which must be re-reviewed before a new publish.
-- Existing immutable releases, active public mapping, project statuses and sales
-- remain untouched. Zero represents no imported inventory (legacy compatibility).
ALTER TABLE geo_plot_mapping_drafts_3d
  ADD COLUMN verified_inventory_revision INTEGER
  CHECK(verified_inventory_revision IS NULL OR verified_inventory_revision >= 0);
