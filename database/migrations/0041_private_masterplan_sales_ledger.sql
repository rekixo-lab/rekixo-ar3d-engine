-- Private Engine-only sales ledger. NEVER derived from polygon geometry or Platform sales.
CREATE TABLE IF NOT EXISTS masterplan_sales_3d (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects_3d(id) ON DELETE CASCADE,
  plot_id TEXT NOT NULL,
  source_mapping_release_id TEXT NOT NULL,
  buyer_name TEXT NOT NULL,
  buyer_phone TEXT NOT NULL DEFAULT '',
  agreement_paise INTEGER NOT NULL CHECK(agreement_paise>0 AND agreement_paise<=100000000000000),
  state TEXT NOT NULL DEFAULT 'booked' CHECK(state IN ('booked','confirmed','void')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  confirmed_by TEXT,
  confirmed_at TEXT,
  voided_by TEXT,
  voided_at TEXT,
  UNIQUE(project_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_masterplan_sale_one_live_per_plot
  ON masterplan_sales_3d(project_id,lower(plot_id)) WHERE state<>'void';
CREATE INDEX IF NOT EXISTS idx_masterplan_sales_project ON masterplan_sales_3d(project_id,created_at DESC);

CREATE TABLE IF NOT EXISTS masterplan_sale_payments_3d (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects_3d(id) ON DELETE CASCADE,
  sale_id TEXT NOT NULL REFERENCES masterplan_sales_3d(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('receipt','reversal')),
  amount_paise INTEGER NOT NULL CHECK(amount_paise>0 AND amount_paise<=100000000000000),
  paid_on TEXT NOT NULL,
  method TEXT NOT NULL,
  reference TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  reverses_id TEXT REFERENCES masterplan_sale_payments_3d(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(project_id,idempotency_key),
  CHECK((kind='receipt' AND reverses_id IS NULL) OR (kind='reversal' AND reverses_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_masterplan_reversal_once
  ON masterplan_sale_payments_3d(reverses_id) WHERE kind='reversal';
CREATE INDEX IF NOT EXISTS idx_masterplan_payments_sale ON masterplan_sale_payments_3d(sale_id,created_at DESC);
CREATE TRIGGER IF NOT EXISTS trg_masterplan_payment_immutable
BEFORE UPDATE ON masterplan_sale_payments_3d
BEGIN SELECT RAISE(ABORT,'Payment history is immutable; insert a reversal'); END;
CREATE TRIGGER IF NOT EXISTS trg_masterplan_sale_owner_immutable
BEFORE UPDATE OF project_id,plot_id,source_mapping_release_id,buyer_name,buyer_phone,agreement_paise,notes,created_by,created_at
ON masterplan_sales_3d
BEGIN SELECT RAISE(ABORT,'Sale facts cannot be overwritten; use audited corrections'); END;
CREATE TRIGGER IF NOT EXISTS trg_masterplan_payment_owner_insert
BEFORE INSERT ON masterplan_sale_payments_3d
WHEN NOT EXISTS(SELECT 1 FROM masterplan_sales_3d s WHERE s.id=NEW.sale_id AND s.project_id=NEW.project_id)
BEGIN SELECT RAISE(ABORT,'Payment project owner mismatch'); END;
CREATE TRIGGER IF NOT EXISTS trg_masterplan_reversal_owner_insert
BEFORE INSERT ON masterplan_sale_payments_3d
WHEN NEW.kind='reversal' AND NOT EXISTS(SELECT 1 FROM masterplan_sale_payments_3d prior
 WHERE prior.id=NEW.reverses_id AND prior.project_id=NEW.project_id
   AND prior.sale_id=NEW.sale_id AND prior.kind='receipt' AND prior.amount_paise=NEW.amount_paise)
BEGIN SELECT RAISE(ABORT,'Reversal must exactly match a receipt in the same sale'); END;
