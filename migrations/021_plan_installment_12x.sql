-- Annual card installment value (12x) for the public pricing display.
--
-- ValidaPay has no installments-simulation endpoint, so the "12x de R$ X" shown
-- on the landing can't be derived live. The operator simulates the annual
-- checkout link, reads ValidaPay's real installment (interest baked in), rounds
-- up, and stores it here. /pricing.json serves it to the landing.
--
-- Only meaningful on ANNUAL rows. Update this value when ValidaPay's rate
-- changes — one place, no deploy.
--
-- Idempotent.

ALTER TABLE plan_prices ADD COLUMN IF NOT EXISTS installment_12x_brl NUMERIC;

UPDATE plan_prices SET installment_12x_brl = 142 WHERE plan_id = 'starter' AND recurrence = 'ANNUAL';
UPDATE plan_prices SET installment_12x_brl = 286 WHERE plan_id = 'pro'     AND recurrence = 'ANNUAL';
UPDATE plan_prices SET installment_12x_brl = 478 WHERE plan_id = 'scale'   AND recurrence = 'ANNUAL';
