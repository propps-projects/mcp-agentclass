-- Phase 8.4: alternative billing periods for plans
--
-- The plans.monthly_price_brl column stays as the canonical monthly
-- price (public /pricing and signup default to MONTHLY). plan_prices
-- holds the alternative periods (QUARTERLY, SEMI_ANNUAL, ANNUAL) so
-- super-admin can configure discounts for longer commitments.
--
-- ValidaPay sync currently supports MONTHLY only. Non-monthly rows
-- have their validapay_* columns NULL and the UI disables the sync
-- button with a banner until the recurrence API ships in their docs.

CREATE TABLE IF NOT EXISTS plan_prices (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id                  TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  recurrence               TEXT NOT NULL CHECK (recurrence IN ('MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL')),
  amount_brl               NUMERIC NOT NULL CHECK (amount_brl > 0),
  validapay_product_id     TEXT,
  validapay_price_id       TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (plan_id, recurrence)
);
CREATE INDEX IF NOT EXISTS idx_plan_prices_plan ON plan_prices(plan_id);
