/**
 * Per-recurrence prices for add-ons (Phase 8.5).
 *
 * Mirrors plan_prices: each addon can have multiple prices defined
 * (Mensal / Trimestral / Semestral / Anual). Exactly ONE is active at
 * any time — activating a new one auto-deactivates the previous active.
 * Old prices remain for grandfathered subscribers.
 */

import { sb } from "./db-api.ts";
import type { Recurrence } from "./plan-prices.ts";

export interface AddonPrice {
  id: string;
  addonId: string;
  recurrence: Recurrence;
  amountBrl: number;
  isActive: boolean;
  validapayProductId: string | null;
  validapayPriceId: string | null;
}

interface AddonPriceRow {
  id: string;
  addon_id: string;
  recurrence: Recurrence;
  amount_brl: string | number;
  is_active: boolean;
  validapay_product_id: string | null;
  validapay_price_id: string | null;
}

function map(r: AddonPriceRow): AddonPrice {
  return {
    id: r.id,
    addonId: r.addon_id,
    recurrence: r.recurrence,
    amountBrl: Number(r.amount_brl),
    isActive: r.is_active,
    validapayProductId: r.validapay_product_id,
    validapayPriceId: r.validapay_price_id,
  };
}

export async function listAddonPrices(addonId: string): Promise<AddonPrice[]> {
  const rows = await sb.select<AddonPriceRow>(
    "addon_prices",
    `addon_id=eq.${encodeURIComponent(addonId)}&select=*`,
  );
  return rows.map(map);
}

export async function getActiveAddonPrice(addonId: string): Promise<AddonPrice | null> {
  const r = await sb.selectOne<AddonPriceRow>(
    "addon_prices",
    `addon_id=eq.${encodeURIComponent(addonId)}&is_active=is.true&select=*`,
  );
  return r ? map(r) : null;
}

export async function getActivePricesByAddonId(addonIds: string[]): Promise<Map<string, AddonPrice>> {
  const out = new Map<string, AddonPrice>();
  if (addonIds.length === 0) return out;
  const rows = await sb.select<AddonPriceRow>(
    "addon_prices",
    `is_active=is.true&addon_id=in.(${addonIds.map((id) => encodeURIComponent(id)).join(",")})&select=*`,
  );
  for (const r of rows) out.set(r.addon_id, map(r));
  return out;
}

export async function getAddonPriceById(id: string): Promise<AddonPrice | null> {
  const r = await sb.selectOne<AddonPriceRow>("addon_prices", `id=eq.${id}&select=*`);
  return r ? map(r) : null;
}

export async function upsertAddonPrice(args: {
  addonId: string;
  recurrence: Recurrence;
  amountBrl: number;
}): Promise<AddonPrice> {
  const inserted = await sb.insert<AddonPriceRow>(
    "addon_prices",
    {
      addon_id: args.addonId,
      recurrence: args.recurrence,
      amount_brl: args.amountBrl,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "addon_id,recurrence", returning: "representation" },
  );
  return map(inserted[0]);
}

export async function deleteAddonPrice(addonId: string, recurrence: Recurrence): Promise<void> {
  await sb.delete(
    "addon_prices",
    `addon_id=eq.${encodeURIComponent(addonId)}&recurrence=eq.${recurrence}`,
  );
}

export async function updateAddonPriceValidapay(args: {
  addonId: string;
  recurrence: Recurrence;
  validapayProductId: string | null;
  validapayPriceId: string | null;
}): Promise<void> {
  await sb.update(
    "addon_prices",
    `addon_id=eq.${encodeURIComponent(args.addonId)}&recurrence=eq.${args.recurrence}`,
    {
      validapay_product_id: args.validapayProductId,
      validapay_price_id: args.validapayPriceId,
      updated_at: new Date().toISOString(),
    },
  );
}

export async function activateAddonPrice(addonId: string, recurrence: Recurrence): Promise<void> {
  await sb.update("addon_prices", `addon_id=eq.${encodeURIComponent(addonId)}&is_active=is.true`, {
    is_active: false, updated_at: new Date().toISOString(),
  });
  await sb.update("addon_prices", `addon_id=eq.${encodeURIComponent(addonId)}&recurrence=eq.${recurrence}`, {
    is_active: true, updated_at: new Date().toISOString(),
  });
}

export async function deactivateAddonPrice(addonId: string, recurrence: Recurrence): Promise<void> {
  await sb.update("addon_prices", `addon_id=eq.${encodeURIComponent(addonId)}&recurrence=eq.${recurrence}`, {
    is_active: false, updated_at: new Date().toISOString(),
  });
}
