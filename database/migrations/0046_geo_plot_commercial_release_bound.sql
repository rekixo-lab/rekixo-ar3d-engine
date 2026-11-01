-- Private owner-only commercial facts keyed to immutable Geo mapping release + Plot ID.
-- No migration of existing buyer/payment records, no automatic Available defaults.
CREATE TABLE IF NOT EXISTS geo_plot_commercial_3d (
 project_id TEXT NOT NULL REFERENCES projects_3d(id) ON DELETE CASCADE,
 mapping_release_id TEXT NOT NULL REFERENCES geo_plot_mapping_releases_3d(id) ON DELETE CASCADE,
 plot_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('available','booked','sold')),
 price_paise INTEGER CHECK(price_paise IS NULL OR (price_paise>=0 AND price_paise<=1000000000000)),
 currency TEXT NOT NULL DEFAULT 'INR' CHECK(currency='INR'),
 evidence_ref TEXT NOT NULL CHECK(length(evidence_ref) BETWEEN 3 AND 250),
 public_approved INTEGER NOT NULL DEFAULT 0 CHECK(public_approved IN (0,1)),
 revision INTEGER NOT NULL CHECK(revision>=1),
 updated_by TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(project_id,mapping_release_id,plot_id)
);
CREATE INDEX IF NOT EXISTS idx_geo_commercial_release
 ON geo_plot_commercial_3d(project_id,mapping_release_id,public_approved,plot_id);
CREATE TABLE IF NOT EXISTS geo_plot_commercial_events_3d(
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects_3d(id) ON DELETE CASCADE,
 mapping_release_id TEXT NOT NULL REFERENCES geo_plot_mapping_releases_3d(id) ON DELETE CASCADE,
 plot_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>=1),
 event_json TEXT NOT NULL CHECK(json_valid(event_json)),
 actor_email TEXT NOT NULL,
 created_at TEXT NOT NULL,
 UNIQUE(project_id,mapping_release_id,plot_id,revision)
);
CREATE TRIGGER IF NOT EXISTS trg_geo_commercial_owner_insert
 BEFORE INSERT ON geo_plot_commercial_3d
 WHEN NOT EXISTS(SELECT 1 FROM geo_plot_mapping_releases_3d r
   WHERE r.id=NEW.mapping_release_id AND r.project_id=NEW.project_id)
 BEGIN SELECT RAISE(ABORT,'Geo commercial facts belong to another project'); END;
CREATE TRIGGER IF NOT EXISTS trg_geo_commercial_owner_update
 BEFORE UPDATE ON geo_plot_commercial_3d
 WHEN NEW.project_id<>OLD.project_id OR NEW.mapping_release_id<>OLD.mapping_release_id
 OR NEW.plot_id<>OLD.plot_id OR NOT EXISTS(SELECT 1 FROM geo_plot_mapping_releases_3d r
   WHERE r.id=NEW.mapping_release_id AND r.project_id=NEW.project_id)
 BEGIN SELECT RAISE(ABORT,'Canonical commercial identity cannot be rewritten'); END;
CREATE TRIGGER IF NOT EXISTS trg_geo_commercial_event_immutable_update
 BEFORE UPDATE ON geo_plot_commercial_events_3d
 BEGIN SELECT RAISE(ABORT,'Geo commercial evidence events are immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_geo_commercial_event_immutable_delete
 BEFORE DELETE ON geo_plot_commercial_events_3d
 WHEN EXISTS(SELECT 1 FROM projects_3d p WHERE p.id=OLD.project_id)
 BEGIN SELECT RAISE(ABORT,'Geo commercial evidence events are immutable while project exists'); END;
CREATE TRIGGER IF NOT EXISTS trg_geo_commercial_event_owner
 BEFORE INSERT ON geo_plot_commercial_events_3d
 WHEN NOT EXISTS(SELECT 1 FROM geo_plot_mapping_releases_3d r
   WHERE r.id=NEW.mapping_release_id AND r.project_id=NEW.project_id)
 BEGIN SELECT RAISE(ABORT,'Geo commercial event project ownership mismatch'); END;
