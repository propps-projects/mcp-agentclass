/**
 * Plan price alternatives — non-MONTHLY billing recurrences (Phase 8.4).
 *
 * plans.monthly_price_brl remains the canonical MONTHLY price (read by
 * /pricing and /signup). plan_prices stores additional periodicities
 * (QUARTERLY, SEMI_ANNUAL, ANNUAL). When ValidaPay's recurrence API
 * ships, sync these rows the same way we sync monthly today.
 */

import { sb } from "./db-api.ts";

export type Recurrence = "MONTHLY" | "QUARTERLY" | "SEMI_ANNUAL" | "ANNUAL";

export const RECURRENCE_LABELS: Record<Recurrence, string> = {
  MONTHLY: "Mensal",
  QUARTERLY: "Trimestral",
  SEMI_ANNUAL: "Semestral",
  ANNUAL: "Anual",
};

/** Number of months each recurrence represents — used by signup to
 *  multiply the base monthly price when no explicit amount is set. */
export const RECURRENCE_MONTHS: Record<Recurrence, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  SEMI_ANNUAL: 6,
  ANNUAL: 12,
};

export interface PlanPrice {
  id: string;
  planId: string;
  recurrence: Recurrence;
  amountBrl: number;
  validapayProductId: string | null;
  validapayPriceId: string | null;
}

interface PlanPriceRow {
  id: string;
  plan_id: string;
  recurrence: Recurrence;
  amount_brl: string | number;
  validapay_product_id: string | null;
  validapay_price_id: string | null;
}

function map(r: PlanPriceRow): PlanPrice {
  return {
    id: r.id,
    planId: r.plan_id,
    recurrence: r.recurrence,
    amountBrl: Number(r.amount_brl),
    validapayProductId: r.validapay_product_id,
    validapayPriceId: r.validapay_price_id,
  };
}

export async function listPlanPrices(planId: string): Promise<PlanPrice[]> {
  const rows = await sb.select<PlanPriceRow>(
    "plan_prices",
    `plan_id=eq.${encodeURIComponent(planId)}&select=*`,
  );
  // Sort by months ascending for stable UI rendering
  const sorted = rows.map(map).sort((a, b) => RECURRENCE_MONTHS[a.recurrence] - RECURRENCE_MONTHS[b.recurrence]);
  return sorted;
}

/** Upsert by (plan_id, recurrence). Returns the resulting row. */
export async function upsertPlanPrice(args: {
  planId: string;
  recurrence: Recurrence;
  amountBrl: number;
}): Promise<PlanPrice> {
  // PostgREST upsert needs on_conflict + Prefer resolution
  const inserted = await sb.insert<PlanPriceRow>(
    "plan_prices",
    {
      plan_id: args.planId,
      recurrence: args.recurrence,
      amount_brl: args.amountBrl,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "plan_id,recurrence", returning: "representation" },
  );
  return map(inserted[0]);
}

export async function deletePlanPrice(planId: string, recurrence: Recurrence): Promise<void> {
  await sb.delete(
    "plan_prices",
    `plan_id=eq.${encodeURIComponent(planId)}&recurrence=eq.${recurrence}`,
  );
}

export async function updatePlanPriceValidapay(args: {
  planId: string;
  recurrence: Recurrence;
  validapayProductId: string | null;
  validapayPriceId: string | null;
}): Promise<void> {
  await sb.update(
    "plan_prices",
    `plan_id=eq.${encodeURIComponent(args.planId)}&recurrence=eq.${args.recurrence}`,
    {
      validapay_product_id: args.validapayProductId,
      validapay_price_id: args.validapayPriceId,
      updated_at: new Date().toISOString(),
    },
  );
}
