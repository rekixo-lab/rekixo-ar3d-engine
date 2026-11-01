-- Project-scoped PRIVATE owner-entered plot deal records (not financial attestation).
CREATE TABLE IF NOT EXISTS geo_plot_deals_3d (
 project_id TEXT NOT NULL REFERENCES projects_3d(id) ON DELETE CASCADE,
 mapping_release_id TEXT NOT NULL REFERENCES geo_plot_mapping_releases_3d(id) ON DELETE CASCADE,
 plot_id TEXT NOT NULL,
 stage TEXT NOT NULL CHECK(stage IN ('inquiry','booked','agreement_pending','agreement_done','registered','cancelled')),
 buyer_name TEXT NOT NULL DEFAULT '',
 buyer_phone TEXT NOT NULL DEFAULT '',
 claimed_payment_paise INTEGER NOT NULL DEFAULT 0 CHECK(claimed_payment_paise BETWEEN 0 AND 1000000000000),
 payment_reference TEXT NOT NULL DEFAULT '',
 agreement_reference TEXT NOT NULL DEFAULT '',
 registration_reference TEXT NOT NULL DEFAULT '',
 evidence_reference TEXT NOT NULL,
 notes TEXT NOT NULL DEFAULT '',
 revision INTEGER NOT NULL CHECK(revision>0),
 updated_by TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(project_id,mapping_release_id,plot_id)
);
CREATE TRIGGER IF NOT EXISTS trg_geo_deal_owner_insert BEFORE INSERT ON geo_plot_deals_3d
WHEN NOT EXISTS(SELECT 1 FROM geo_plot_mapping_releases_3d r
 WHERE r.id=NEW.mapping_release_id AND r.project_id=NEW.project_id)
BEGIN SELECT RAISE(ABORT,'Geo deal mapping release belongs to another project'); END;
CREATE TRIGGER IF NOT EXISTS trg_geo_deal_owner_update BEFORE UPDATE ON geo_plot_deals_3d
WHEN NEW.project_id<>OLD.project_id OR NEW.mapping_release_id<>OLD.mapping_release_id OR NEW.plot_id<>OLD.plot_id
 OR NEW.revision<=OLD.revision
BEGIN SELECT RAISE(ABORT,'Geo deal cannot change source identity or move revision backwards'); END;
CREATE TABLE IF NOT EXISTS geo_plot_deal_events_3d (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects_3d(id) ON DELETE CASCADE,
 mapping_release_id TEXT NOT NULL REFERENCES geo_plot_mapping_releases_3d(id) ON DELETE CASCADE,
 plot_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0),
 event_json TEXT NOT NULL CHECK(json_valid(event_json)),
 actor_email TEXT NOT NULL,
 created_at TEXT NOT NULL,
 UNIQUE(project_id,mapping_release_id,plot_id,revision)
);
CREATE TRIGGER IF NOT EXISTS trg_geo_deal_events_immutable_update BEFORE UPDATE ON geo_plot_deal_events_3d
BEGIN SELECT RAISE(ABORT,'Private Geo deal events are immutable'); END;
CREATE INDEX IF NOT EXISTS idx_geo_deals_project_source ON geo_plot_deals_3d(project_id,mapping_release_id,stage);
