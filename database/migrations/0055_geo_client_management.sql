-- Additive, project/release-scoped Client Admin management. No project data seeded or rewritten.
CREATE TABLE IF NOT EXISTS geo_client_plot_details_3d(
 project_id TEXT NOT NULL REFERENCES projects_3d(id) ON DELETE CASCADE,
 mapping_release_id TEXT NOT NULL REFERENCES geo_plot_mapping_releases_3d(id) ON DELETE CASCADE,
 plot_id TEXT NOT NULL,
 owner_name TEXT NOT NULL DEFAULT '',
 broker_name TEXT NOT NULL DEFAULT '',
 booking_amount_paise INTEGER CHECK(booking_amount_paise IS NULL OR booking_amount_paise BETWEEN 0 AND 1000000000000),
 notes TEXT NOT NULL DEFAULT '',
 revision INTEGER NOT NULL CHECK(revision>0),
 updated_by TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(project_id,mapping_release_id,plot_id)
);
CREATE TABLE IF NOT EXISTS geo_client_plot_detail_events_3d(
 id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects_3d(id) ON DELETE CASCADE,
 mapping_release_id TEXT NOT NULL REFERENCES geo_plot_mapping_releases_3d(id) ON DELETE CASCADE,
 plot_id TEXT NOT NULL,revision INTEGER NOT NULL,
 actor_email TEXT NOT NULL,detail_json TEXT NOT NULL CHECK(json_valid(detail_json)),
 created_at TEXT NOT NULL,UNIQUE(project_id,mapping_release_id,plot_id,revision)
);
CREATE TRIGGER IF NOT EXISTS trg_geo_client_plot_identity BEFORE INSERT ON geo_client_plot_details_3d
 WHEN NOT EXISTS(SELECT 1 FROM geo_plot_mapping_releases_3d WHERE id=NEW.mapping_release_id AND project_id=NEW.project_id)
 BEGIN SELECT RAISE(ABORT,'Plot details must belong to project release'); END;
CREATE TRIGGER IF NOT EXISTS trg_geo_client_plot_update BEFORE UPDATE ON geo_client_plot_details_3d
 WHEN NEW.project_id<>OLD.project_id OR NEW.mapping_release_id<>OLD.mapping_release_id OR NEW.plot_id<>OLD.plot_id OR NEW.revision<=OLD.revision
 BEGIN SELECT RAISE(ABORT,'Plot identity immutable or revision not advanced'); END;
CREATE TRIGGER IF NOT EXISTS trg_geo_client_plot_events_update BEFORE UPDATE ON geo_client_plot_detail_events_3d
 BEGIN SELECT RAISE(ABORT,'Plot detail history is immutable'); END;

CREATE TABLE IF NOT EXISTS geo_client_gallery_3d(
 id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects_3d(id) ON DELETE CASCADE,
 r2_key TEXT NOT NULL UNIQUE,mime TEXT NOT NULL CHECK(mime IN ('image/jpeg','image/png','image/webp')),
 size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 1 AND 8388608),
 caption TEXT NOT NULL DEFAULT '',created_by TEXT NOT NULL,created_at TEXT NOT NULL,
 deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_geo_client_gallery ON geo_client_gallery_3d(project_id,deleted_at,created_at);

CREATE TABLE IF NOT EXISTS geo_client_notices_3d(
 id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects_3d(id) ON DELETE CASCADE,
 mapping_release_id TEXT NOT NULL REFERENCES geo_plot_mapping_releases_3d(id) ON DELETE CASCADE,
 plot_id TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('draft','published')),
 revision INTEGER NOT NULL CHECK(revision>0),
 created_by TEXT NOT NULL,updated_by TEXT NOT NULL,updated_at TEXT NOT NULL,published_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_geo_client_notices ON geo_client_notices_3d(project_id,mapping_release_id,state,plot_id);
CREATE TRIGGER IF NOT EXISTS trg_geo_client_notice_scope BEFORE INSERT ON geo_client_notices_3d
 WHEN NOT EXISTS(SELECT 1 FROM geo_plot_mapping_releases_3d WHERE id=NEW.mapping_release_id AND project_id=NEW.project_id)
 BEGIN SELECT RAISE(ABORT,'Plot notice belongs to another project'); END;

CREATE TABLE IF NOT EXISTS geo_client_sales_3d(
 id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects_3d(id) ON DELETE CASCADE,
 mapping_release_id TEXT NOT NULL REFERENCES geo_plot_mapping_releases_3d(id) ON DELETE CASCADE,
 plot_id TEXT NOT NULL,buyer_name TEXT NOT NULL,buyer_phone TEXT NOT NULL DEFAULT '',
 agreement_paise INTEGER NOT NULL CHECK(agreement_paise>0 AND agreement_paise<=1000000000000),
 state TEXT NOT NULL CHECK(state IN ('booked','confirmed','void')),
 revision INTEGER NOT NULL CHECK(revision>0),
 notes TEXT NOT NULL DEFAULT '',evidence_ref TEXT NOT NULL,
 created_by TEXT NOT NULL,created_at TEXT NOT NULL,
 confirmed_at TEXT,confirmed_by TEXT,
 UNIQUE(project_id,mapping_release_id,plot_id)
);
CREATE INDEX IF NOT EXISTS idx_geo_client_sales ON geo_client_sales_3d(project_id,state,created_at);
CREATE TRIGGER IF NOT EXISTS trg_geo_client_sales_scope BEFORE INSERT ON geo_client_sales_3d
 WHEN NOT EXISTS(SELECT 1 FROM geo_plot_mapping_releases_3d WHERE id=NEW.mapping_release_id AND project_id=NEW.project_id)
 BEGIN SELECT RAISE(ABORT,'Sale belongs to another mapping release'); END;
CREATE TABLE IF NOT EXISTS geo_client_receipts_3d(
 id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects_3d(id) ON DELETE CASCADE,
 sale_id TEXT NOT NULL REFERENCES geo_client_sales_3d(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('receipt','reversal')),
 amount_paise INTEGER NOT NULL CHECK(amount_paise>0 AND amount_paise<=1000000000000),
 paid_on TEXT NOT NULL,method TEXT NOT NULL CHECK(method IN ('cash','upi','bank','card','other')),
 reference TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '',
 reverses_id TEXT REFERENCES geo_client_receipts_3d(id),
 created_by TEXT NOT NULL,created_at TEXT NOT NULL,
 operation_id TEXT NOT NULL,UNIQUE(project_id,operation_id),UNIQUE(reverses_id)
);
CREATE INDEX IF NOT EXISTS idx_geo_client_receipts ON geo_client_receipts_3d(project_id,sale_id,created_at);
