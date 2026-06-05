/**
 * Per-student hourly rate limit.
 *
 * Bucket: (key, hour_window_start). Fixed-window — not sliding — because
 * UPSERT-and-increment in Postgres is simpler than a sliding-window
 * algorithm and the worst case is 2x the limit at minute boundaries,
 * which is fine for fairness here.
 *
 * Keys: `t:${tenantId}:s:${studentId}` for tenant sessions; legacy MVP
 * isn't rate-limited (single-tenant, trusted env).
 *
 * Limits are intentionally generous for an MVP. Tighten via plan tier
 * later if abuse becomes a real concern.
 */

import { sb } from "./db-api.ts";

const DEFAULT_LIMIT_PER_HOUR = 200;     // most tools
const SEARCH_LIMIT_PER_HOUR = 60;       // search_course is embedder-heavy

export type RateLimitResult =
  | { ok: true; count: number; limit: number }
  | { ok: false; reason: "exceeded"; count: number; limit: number; retryAfterSec: number };

function windowStart(): string {
  const d = new Date();
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

function limitForTool(toolName: string): number {
  return toolName === "search_course" ? SEARCH_LIMIT_PER_HOUR : DEFAULT_LIMIT_PER_HOUR;
}

/**
 * Atomically (best-effort) increment and check. Race conditions can let
 * 2 calls through near the boundary — acceptable for soft limits.
 *
 * Returns ok=true with current count when under, ok=false with retry-after
 * when over.
 */
export async function checkAndCount(args: {
  tenantId: string;
  studentId: string;
  toolName: string;
}): Promise<RateLimitResult> {
  const key = `t:${args.tenantId}:s:${args.studentId}`;
  const ws = windowStart();
  const limit = limitForTool(args.toolName);

  let bucket = await sb.selectOne<{ count: number }>(
    "rate_limit_buckets",
    `key=eq.${encodeURIComponent(key)}&window_start=eq.${encodeURIComponent(ws)}&select=count`,
  );

  if (!bucket) {
    try {
      await sb.insert("rate_limit_buckets", { key, window_start: ws, count: 1 }, { returning: "minimal" });
      return { ok: true, count: 1, limit };
    } catch {
      // PK conflict (race) — re-read and fall through
      bucket = await sb.selectOne<{ count: number }>(
        "rate_limit_buckets",
        `key=eq.${encodeURIComponent(key)}&window_start=eq.${encodeURIComponent(ws)}&select=count`,
      );
    }
  }

  const next = (bucket?.count ?? 0) + 1;
  if (next > limit) {
    const nextWindow = new Date(ws);
    nextWindow.setUTCHours(nextWindow.getUTCHours() + 1);
    const retryAfterSec = Math.max(1, Math.ceil((nextWindow.getTime() - Date.now()) / 1000));
    return { ok: false, reason: "exceeded", count: bucket?.count ?? 0, limit, retryAfterSec };
  }

  await sb.update(
    "rate_limit_buckets",
    `key=eq.${encodeURIComponent(key)}&window_start=eq.${encodeURIComponent(ws)}`,
    { count: next },
  );
  return { ok: true, count: next, limit };
}
