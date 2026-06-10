-- Phase 8.5: active-price pattern for plans + addons.
--
-- For each plan/addon, ONE price (period+amount) is active at any time.
-- Activating a new price auto-deactivates the previous active one. Old
-- prices remain in the DB to grandfather existing subscribers. New
-- signups always use the active price.

-- ===== Plans =====

ALTER TABLE plan_prices ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT false;

UPDATE plan_prices SET is_active = true WHERE recurrence = 'MONTHLY';

DROP INDEX IF EXISTS uniq_active_per_plan;
CREATE UNIQUE INDEX uniq_active_per_plan ON plan_prices(plan_id) WHERE is_active = true;

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan_price_id UUID REFERENCES plan_prices(id);

UPDATE tenants t SET plan_price_id = pp.id
  FROM plan_prices pp
  WHERE pp.plan_id = t.plan_id AND pp.recurrence = 'MONTHLY' AND t.plan_price_id IS NULL;

-- ===== Addons =====

CREATE TABLE IF NOT EXISTS addon_prices (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  addon_id                 TEXT NOT NULL REFERENCES addons(id) ON DELETE CASCADE,
  recurrence               TEXT NOT NULL CHECK (recurrence IN ('MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL')),
  amount_brl               NUMERIC NOT NULL CHECK (amount_brl > 0),
  is_active                BOOLEAN NOT NULL DEFAULT false,
  validapay_product_id     TEXT,
  validapay_price_id       TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (addon_id, recurrence)
);
CREATE INDEX IF NOT EXISTS idx_addon_prices_addon ON addon_prices(addon_id);
DROP INDEX IF EXISTS uniq_active_per_addon;
CREATE UNIQUE INDEX uniq_active_per_addon ON addon_prices(addon_id) WHERE is_active = true;

INSERT INTO addon_prices (addon_id, recurrence, amount_brl, is_active, validapay_product_id, validapay_price_id)
SELECT id, 'MONTHLY', monthly_price_brl, true, validapay_product_id, validapay_price_id
FROM addons
WHERE monthly_price_brl > 0
ON CONFLICT (addon_id, recurrence) DO NOTHING;

ALTER TABLE addons DROP COLUMN IF EXISTS monthly_price_brl;
ALTER TABLE addons DROP COLUMN IF EXISTS validapay_product_id;
ALTER TABLE addons DROP COLUMN IF EXISTS validapay_price_id;

ALTER TABLE tenant_addons ADD COLUMN IF NOT EXISTS addon_price_id UUID REFERENCES addon_prices(id);

UPDATE tenant_addons ta SET addon_price_id = ap.id
  FROM addon_prices ap
  WHERE ap.addon_id = ta.addon_id AND ap.recurrence = 'MONTHLY' AND ta.addon_price_id IS NULL;
