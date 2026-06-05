/**
 * CLI: invite an admin to a tenant.
 *
 * Adds a row to tenant_admins. After this, the admin can log in via
 * /t/:slug/admin/login with their email.
 *
 * Usage:
 *   npx tsx scripts/cli/invite-admin.ts \
 *     --tenant-slug demo \
 *     --email someone@example.com \
 *     --name "Display Name" \
 *     [--role owner|manager|viewer]
 */

import "dotenv/config";
import { sb } from "../../src/lib/db-api.ts";
import { inviteAdmin } from "../../src/lib/tenant-admin.ts";

function parseArgs() {
  const a = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = a.indexOf(flag);
    return i >= 0 ? a[i + 1] : undefined;
  };
  const tenantSlug = get("--tenant-slug");
  const email = get("--email");
  if (!tenantSlug || !email) {
    console.error("Usage: --tenant-slug <slug> --email <email> [--name <name>] [--role owner|manager|viewer]");
    process.exit(1);
  }
  return {
    tenantSlug,
    email,
    name: get("--name"),
    role: (get("--role") ?? "owner") as "owner" | "manager" | "viewer",
  };
}

async function main() {
  const args = parseArgs();
  const tenants = await sb.select<{ id: string; slug: string }>(
    "tenants",
    `slug=eq.${encodeURIComponent(args.tenantSlug)}&select=id,slug`,
  );
  if (!tenants.length) {
    console.error(`Tenant "${args.tenantSlug}" not found`);
    process.exit(1);
  }
  const admin = await inviteAdmin({
    tenantId: tenants[0].id,
    email: args.email,
    displayName: args.name,
    role: args.role,
  });
  console.log(`✓ Invited ${admin.email} (${admin.role}) to ${args.tenantSlug}`);
  console.log(`  Login URL: ${process.env.PUBLIC_URL || "http://localhost:3333"}/t/${args.tenantSlug}/admin/login`);
}

main().catch((err) => {
  if (err?.message?.includes("23505")) {
    console.error(`Admin already exists for that tenant + email.`);
  } else {
    console.error("Failed:", err?.message ?? err);
  }
  process.exit(1);
});
