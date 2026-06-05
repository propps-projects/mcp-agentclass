/**
 * Stateless session cookies for the tenant-admin dashboard.
 *
 * Payload is HMAC-SHA256-signed and base64url-encoded; no DB row needed.
 * Cookie format: `<base64url-payload>.<base64url-signature>`.
 *
 * Used only for the dashboard. MCP students still go through OAuth Bearer.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "askine_admin";
const DEFAULT_TTL_SEC = 60 * 60 * 24 * 30; // 30 days

export interface AdminSession {
  adminId: string;
  tenantId: string;
  email: string;
  exp: number;
}

function secret(): string {
  const s = process.env.ADMIN_SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error("ADMIN_SESSION_SECRET must be set to a value >= 32 chars (use `openssl rand -hex 32`)");
  }
  return s;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function signAdminSession(session: Omit<AdminSession, "exp">, ttlSec: number = DEFAULT_TTL_SEC): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const full: AdminSession = { ...session, exp };
  const payload = Buffer.from(JSON.stringify(full)).toString("base64url");
  const sig = sign(payload);
  return `${payload}.${sig}`;
}

export function verifyAdminSession(cookieValue: string | undefined): AdminSession | null {
  if (!cookieValue) return null;
  const dot = cookieValue.indexOf(".");
  if (dot < 0) return null;
  const payload = cookieValue.slice(0, dot);
  const got = cookieValue.slice(dot + 1);
  const want = sign(payload);
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AdminSession;
    if (typeof parsed.exp !== "number") return null;
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setSessionCookie(session: AdminSession): string {
  const value = signAdminSession({
    adminId: session.adminId,
    tenantId: session.tenantId,
    email: session.email,
  });
  // Secure in prod (HTTPS), Lax to allow OAuth redirects, HttpOnly to block JS.
  const flags = ["HttpOnly", "Path=/", "SameSite=Lax", "Max-Age=" + DEFAULT_TTL_SEC];
  if (process.env.NODE_ENV === "production") flags.push("Secure");
  return `${COOKIE_NAME}=${value}; ${flags.join("; ")}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}

export function readSessionFromCookieHeader(cookieHeader: string | undefined): AdminSession | null {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(";").map((c) => c.trim());
  for (const c of cookies) {
    const eq = c.indexOf("=");
    if (eq < 0) continue;
    const name = c.slice(0, eq);
    const value = c.slice(eq + 1);
    if (name === COOKIE_NAME) return verifyAdminSession(value);
  }
  return null;
}
