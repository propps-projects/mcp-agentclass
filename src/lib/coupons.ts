/**
 * Local coupon cache (Phase 11.3) — mirrors ValidaPay coupons + tracks
 * which coupon a tenant used at signup. ValidaPay owns the canonical
 * state; we cache metadata only so the super-admin listing is fast
 * and we can run analytics on redemption.
 *
 * Always validate via ValidaPay's public /coupons/validate before
 * applying — never trust local cache for pricing.
 */

import { sb } from "./db-api.ts";
import type {
  ValidaPayCoupon,
  CouponDiscountType,
  CouponStatus,
  CouponAppliesTo,
} from "./validapay.ts";

export interface Coupon {
  id: string;
  validapayCouponId: string;
  code: string;
  name: string | null;
  discountType: CouponDiscountType;
  discountValue: number;
  status: CouponStatus;
  maxRedemptions: number | null;
  maxCycles: number | null;
  minAmount: number | null;
  appliesTo: string | null;
  firstTimeOnly: boolean;
  validFrom: string | null;
  validUntil: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: string;
  validapay_coupon_id: string;
  code: string;
  name: string | null;
  discount_type: CouponDiscountType;
  discount_value: string | number;
  status: CouponStatus;
  max_redemptions: number | null;
  max_cycles: number | null;
  min_amount: string | number | null;
  applies_to: string | null;
  first_time_only: boolean | null;
  valid_from: string | null;
  valid_until: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function toCoupon(r: Row): Coupon {
  return {
    id: r.id,
    validapayCouponId: r.validapay_coupon_id,
    code: r.code,
    name: r.name,
    discountType: r.discount_type,
    discountValue: Number(r.discount_value),
    status: r.status,
    maxRedemptions: r.max_redemptions,
    maxCycles: r.max_cycles,
    minAmount: r.min_amount != null ? Number(r.min_amount) : null,
    appliesTo: r.applies_to,
    firstTimeOnly: !!r.first_time_only,
    validFrom: r.valid_from,
    validUntil: r.valid_until,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const COLUMNS = "id,validapay_coupon_id,code,name,discount_type,discount_value,status,max_redemptions,max_cycles,min_amount,applies_to,first_time_only,valid_from,valid_until,notes,created_at,updated_at";

export async function listCouponsLocal(): Promise<Coupon[]> {
  const rows = await sb.select<Row>(
    "coupons",
    `select=${COLUMNS}&order=created_at.desc`,
  );
  return rows.map(toCoupon);
}

export async function getCouponByCodeLocal(code: string): Promise<Coupon | null> {
  const row = await sb.selectOne<Row>(
    "coupons",
    `code=eq.${encodeURIComponent(code)}&select=${COLUMNS}`,
  );
  return row ? toCoupon(row) : null;
}

export async function getCouponLocal(id: string): Promise<Coupon | null> {
  const row = await sb.selectOne<Row>(
    "coupons",
    `id=eq.${encodeURIComponent(id)}&select=${COLUMNS}`,
  );
  return row ? toCoupon(row) : null;
}

/**
 * Mirror a ValidaPay coupon into our local cache (insert or update).
 * Called right after we create/update on ValidaPay so the super-admin
 * list reflects immediately.
 */
export async function syncCouponFromValidaPay(vp: ValidaPayCoupon, notes?: string): Promise<Coupon> {
  const existing = await sb.selectOne<{ id: string }>(
    "coupons",
    `validapay_coupon_id=eq.${encodeURIComponent(vp.couponId)}&select=id`,
  );
  const payload = {
    validapay_coupon_id: vp.couponId,
    code: vp.code,
    name: vp.name ?? null,
    discount_type: vp.discountType,
    discount_value: vp.discountValue,
    status: vp.status,
    max_redemptions: vp.maxRedemptions ?? null,
    max_cycles: vp.maxCycles ?? null,
    min_amount: vp.minAmount ?? null,
    applies_to: vp.appliesTo ?? null,
    first_time_only: vp.firstTimeOnly ?? false,
    valid_from: vp.validFrom ?? null,
    valid_until: vp.validUntil ?? null,
    ...(notes !== undefined ? { notes } : {}),
    updated_at: new Date().toISOString(),
  };
  if (existing) {
    await sb.update("coupons", `id=eq.${existing.id}`, payload);
    return (await getCouponLocal(existing.id))!;
  }
  const [inserted] = await sb.insert<Row>("coupons", payload, { returning: "representation" });
  return toCoupon(inserted);
}

/** Remove from local cache only — ValidaPay deletion is the caller's job. */
export async function deleteCouponLocal(id: string): Promise<void> {
  await sb.delete("coupons", `id=eq.${encodeURIComponent(id)}`);
}

export const ALL_STATUSES: CouponStatus[] = ["ACTIVE", "PAUSED", "INACTIVE"];
export const ALL_APPLIES_TO: CouponAppliesTo[] = ["RECURRING", "ONE_TIME", "ALL"];
