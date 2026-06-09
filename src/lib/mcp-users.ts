/**
 * Global identity for the unified /mcp connector.
 *
 * One mcp_users row per real human (email). The OAuth flow at /oauth/*
 * issues access tokens that reference mcp_user_id; tools then resolve
 * which courses the user has access to by joining mcp_user.email →
 * students.email → course_access.course_id across ALL tenants.
 */

import { sb } from "./db-api.ts";

export interface McpUser {
  id: string;
  email: string;
  displayName: string | null;
  lastActiveAt: string | null;
}

interface McpUserRow {
  id: string;
  email: string;
  display_name: string | null;
  last_active_at: string | null;
}

function mapUser(r: McpUserRow): McpUser {
  return {
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    lastActiveAt: r.last_active_at,
  };
}

export async function findMcpUserById(id: string): Promise<McpUser | null> {
  const row = await sb.selectOne<McpUserRow>(
    "mcp_users",
    `id=eq.${id}&select=id,email,display_name,last_active_at`,
  );
  return row ? mapUser(row) : null;
}

export async function findMcpUserByEmail(email: string): Promise<McpUser | null> {
  const row = await sb.selectOne<McpUserRow>(
    "mcp_users",
    `email=eq.${encodeURIComponent(email.toLowerCase())}&select=id,email,display_name,last_active_at`,
  );
  return row ? mapUser(row) : null;
}

/**
 * Upsert by email. If an mcp_user already exists, returns it; otherwise
 * creates one. Display name is filled only on insert — we never overwrite
 * what the user themselves may have set later.
 */
export async function upsertMcpUser(args: {
  email: string;
  displayName?: string;
}): Promise<McpUser> {
  const email = args.email.toLowerCase();
  const existing = await findMcpUserByEmail(email);
  if (existing) {
    // Bump last_active_at as a side-effect of seeing the user
    await sb.update("mcp_users", `id=eq.${existing.id}`, {
      last_active_at: new Date().toISOString(),
    });
    return existing;
  }
  const inserted = await sb.insert<McpUserRow>("mcp_users", {
    email,
    display_name: args.displayName ?? null,
    last_active_at: new Date().toISOString(),
  });
  return mapUser(inserted[0]);
}

// ----- Cross-tenant course access -----------------------------------------

export interface AccessibleCourse {
  courseId: string;
  courseSlug: string;
  courseName: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  /** Human-facing handle: "VMA — Produtificação" */
  displayName: string;
}

/**
 * Every course the user has access to across all tenants, joining via
 * per-tenant student rows. Suspended/canceled tenants are filtered out
 * so revoked subscriptions don't leak content.
 */
export async function listAccessibleCoursesGlobal(email: string): Promise<AccessibleCourse[]> {
  const lower = email.toLowerCase();

  // PostgREST embedded query:
  //   course_access → students (filtered by email)
  //   course_access → courses → tenants (filtered by status)
  const rows = await sb.select<{
    course_id: string;
    students: { email: string };
    courses: {
      id: string; slug: string; name: string; ingest_status: string;
      tenants: { id: string; slug: string; name: string; status: string };
    };
  }>(
    "course_access",
    `revoked_at=is.null` +
    `&select=course_id,students!inner(email),courses!inner(id,slug,name,ingest_status,tenants!inner(id,slug,name,status))` +
    `&students.email=eq.${encodeURIComponent(lower)}` +
    `&courses.ingest_status=eq.ready` +
    `&courses.tenants.status=in.(trial,active)`,
  );

  // Dedupe by course_id; same course may show up if user has multiple
  // student rows in the same tenant (shouldn't, but defensive).
  const seen = new Set<string>();
  const out: AccessibleCourse[] = [];
  for (const r of rows) {
    if (seen.has(r.course_id)) continue;
    seen.add(r.course_id);
    out.push({
      courseId: r.courses.id,
      courseSlug: r.courses.slug,
      courseName: r.courses.name,
      tenantId: r.courses.tenants.id,
      tenantSlug: r.courses.tenants.slug,
      tenantName: r.courses.tenants.name,
      displayName: `${r.courses.tenants.name} — ${r.courses.name}`,
    });
  }
  // Sort by tenant name then course name for stable list output
  out.sort((a, b) => a.tenantName.localeCompare(b.tenantName) || a.courseName.localeCompare(b.courseName));
  return out;
}
