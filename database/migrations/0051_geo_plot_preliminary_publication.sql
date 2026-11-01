-- Map-first publication: existing releases remain VERIFIED by default.
-- Source assertions must not be published as confirmed before source review.
-- Only newly inserted immutable mapping releases may select 'preliminary'.
ALTER TABLE geo_plot_mapping_releases_3d
  ADD COLUMN publication_mode TEXT NOT NULL DEFAULT 'verified'
  CHECK(publication_mode IN ('verified','preliminary'));
