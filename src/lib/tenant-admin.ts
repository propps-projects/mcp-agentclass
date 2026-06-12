/**
 * Tenant admin records (infoprodutores who own a tenant). Separate from
 * `students` because they have admin permissions over the tenant's tools,
 * not just consumer-level chat access.
 */

import { sb } from "./db-api.ts";

export interface TenantAdmin {
  id: string;
  tenantId: string;
  email: string;
  displayName: string | null;
  role: "owner" | "manager" | "viewer";
}

interface AdminRow {
  id: string;
  tenant_id: string;
  email: string;
  display_name: string | null;
  role: string;
}

function mapAdmin(r: AdminRow): TenantAdmin {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    email: r.email,
    displayName: r.display_name,
    role: r.role as TenantAdmin["role"],
  };
}

export async function findAdmin(tenantId: string, email: string): Promise<TenantAdmin | null> {
  const row = await sb.selectOne<AdminRow>(
    "tenant_admins",
    `tenant_id=eq.${tenantId}&email=eq.${encodeURIComponent(email.toLowerCase())}&select=id,tenant_id,email,display_name,role`,
  );
  return row ? mapAdmin(row) : null;
}

export async function findAdminById(id: string): Promise<TenantAdmin | null> {
  const row = await sb.selectOne<AdminRow>(
    "tenant_admins",
    `id=eq.${id}&select=id,tenant_id,email,display_name,role`,
  );
  return row ? mapAdmin(row) : null;
}

/**
 * Lookup global: todos os tenants em que este e-mail é admin. Usado pelo login
 * único /entrar (resolve o tenant a partir do e-mail). Embute slug/name do
 * tenant via FK do PostgREST.
 */
export async function listAdminTenantsByEmail(
  email: string,
): Promise<{ tenantId: string; slug: string; name: string }[]> {
  const rows = await sb.select<{ tenant_id: string; tenants: { slug: string; name: string } | null }>(
    "tenant_admins",
    `email=eq.${encodeURIComponent(email.toLowerCase())}&select=tenant_id,tenants(slug,name)`,
  );
  return rows
    .filter((r) => r.tenants)
    .map((r) => ({ tenantId: r.tenant_id, slug: r.tenants!.slug, name: r.tenants!.name }));
}

export async function inviteAdmin(args: {
  tenantId: string;
  email: string;
  displayName?: string;
  role?: "owner" | "manager" | "viewer";
}): Promise<TenantAdmin> {
  const inserted = await sb.insert<AdminRow>("tenant_admins", {
    tenant_id: args.tenantId,
    email: args.email.toLowerCase(),
    display_name: args.displayName ?? null,
    role: args.role ?? "owner",
  });
  return mapAdmin(inserted[0]);
}

export async function recordAdminLogin(adminId: string): Promise<void> {
  await sb.update("tenant_admins", `id=eq.${adminId}`, {
    last_login_at: new Date().toISOString(),
  });
}
