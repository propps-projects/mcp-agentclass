-- Phase 8.4 follow-up: plan_prices becomes the canonical source of all
-- billing prices including MONTHLY. The monthly_price_brl + validapay_*
-- columns on the plans table were the original "single recurrence" model
-- and now move into plan_prices.
--
-- After this migration the plans table only describes capacity. Pricing
-- is fully owned by plan_prices.

INSERT INTO plan_prices (plan_id, recurrence, amount_brl, validapay_product_id, validapay_price_id, updated_at)
SELECT id, 'MONTHLY', monthly_price_brl, validapay_product_id, validapay_price_id, COALESCE(updated_at, NOW())
FROM plans
WHERE monthly_price_brl IS NOT NULL
ON CONFLICT (plan_id, recurrence) DO UPDATE SET
  amount_brl = EXCLUDED.amount_brl,
  validapay_product_id = EXCLUDED.validapay_product_id,
  validapay_price_id = EXCLUDED.validapay_price_id,
  updated_at = NOW();

ALTER TABLE plans DROP COLUMN IF EXISTS monthly_price_brl;
ALTER TABLE plans DROP COLUMN IF EXISTS validapay_product_id;
ALTER TABLE plans DROP COLUMN IF EXISTS validapay_price_id;
