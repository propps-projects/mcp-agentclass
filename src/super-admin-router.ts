/**
 * Super-admin (platform operator) router. Tenant-less — operates across
 * all tenants. Routes mounted at /super-admin/*.
 *
 *   GET  /super-admin/login         — email form
 *   POST /super-admin/login         — magic link (only emails in env list)
 *   GET  /super-admin/verify        — consume token, set cookie
 *   GET  /super-admin               — dashboard (aggregate stats)
 *   GET  /super-admin/tenants       — list all tenants
 *   POST /super-admin/tenants/:slug/plan   — change tenant plan
 *   POST /super-admin/tenants/:slug/status — change tenant status
 *   GET  /super-admin/plans         — list + edit form
 *   POST /super-admin/plans/:id     — update plan limits/price
 *   GET  /super-admin/logout
 */

import { IncomingMessage, ServerResponse } from "node:http";
import { sb } from "./lib/db-api.ts";
import {
  isSuperAdminEmail, readSuperAdminCookie, setSuperAdminCookie, clearSuperAdminCookie,
  type SuperAdminSession,
} from "./lib/super-admin.ts";
import { issueMagicLink, consumeMagicLink, sendMagicLinkEmail } from "./lib/magic-links.ts";
import { adminShell, icons, ADMIN_SHELL_CSS } from "./ui/admin-shell.ts";

function publicUrl(): string {
  return (process.env.PUBLIC_URL ?? "http://localhost:3333").replace(/\/+$/, "");
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
}

function html(res: ServerResponse, status: number, body: string, extra: Record<string, string> = {}): void {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", ...extra }).end(body);
}

function redirect(res: ServerResponse, location: string, extra: Record<string, string> = {}): void {
  res.writeHead(302, { Location: location, ...extra }).end();
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  return new URLSearchParams(await readBody(req));
}

function getQuery(req: IncomingMessage): URLSearchParams {
  return new URL(req.url ?? "/", "http://x").searchParams;
}

async function requireSuperAdmin(req: IncomingMessage, res: ServerResponse): Promise<SuperAdminSession | null> {
  const sess = readSuperAdminCookie(req.headers.cookie);
  if (!sess) {
    redirect(res, `${publicUrl()}/super-admin/login`);
    return null;
  }
  return sess;
}

// ----- Handlers ------------------------------------------------------------

async function loginGet(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const sess = readSuperAdminCookie(req.headers.cookie);
  if (sess) return redirect(res, `${publicUrl()}/super-admin`);
  const q = getQuery(req);
  html(res, 200, loginHtml({ error: q.get("error") ?? undefined, sent: q.get("sent") === "1" }));
}

async function loginPost(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const form = await readForm(req);
  const email = (form.get("email") ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return redirect(res, `${publicUrl()}/super-admin/login?error=email_invalid`);
  }
  if (!isSuperAdminEmail(email)) {
    // Same UX as for known emails — never reveal whitelist contents
    return redirect(res, `${publicUrl()}/super-admin/login?sent=1`);
  }
  const token = await issueMagicLink({
    tenantId: null,
    email,
    intent: "super_admin_login",
    oauthState: null,
  });
  const url = `${publicUrl()}/super-admin/verify?token=${encodeURIComponent(token)}`;
  try {
    await sendMagicLinkEmail({ to: email, url, tenantName: "Askine (Super Admin)" });
  } catch (err) {
    console.error("Super-admin magic link send failed:", err);
    return redirect(res, `${publicUrl()}/super-admin/login?error=send_failed`);
  }
  redirect(res, `${publicUrl()}/super-admin/login?sent=1`);
}

async function verifyMagicLink(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const q = getQuery(req);
  const token = q.get("token") ?? "";
  const claims = await consumeMagicLink(token);
  if (!claims || claims.intent !== "super_admin_login") {
    return html(res, 400, layout({
      title: "Link inválido",
      body: `<h1>Link expirado ou inválido</h1><p><a href="/super-admin/login">Pedir novo</a></p>`,
    }));
  }
  if (!isSuperAdminEmail(claims.email)) {
    return html(res, 403, layout({
      title: "Sem permissão",
      body: `<h1>Sem permissão</h1>`,
    }));
  }
  res.setHeader("Set-Cookie", setSuperAdminCookie(claims.email));
  redirect(res, `${publicUrl()}/super-admin`);
}

async function logout(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader("Set-Cookie", clearSuperAdminCookie());
  redirect(res, `${publicUrl()}/super-admin/login`);
}

async function dashboard(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const sess = await requireSuperAdmin(req, res);
  if (!sess) return;

  const tenants = await sb.select<{
    id: string; slug: string; name: string; plan_id: string; status: string;
    subscription_active_until: string | null; created_at: string;
  }>(
    "tenants",
    `select=id,slug,name,plan_id,status,subscription_active_until,created_at&order=created_at.desc`,
  );

  // MRR estimate: sum MONTHLY plan_prices of active tenants per plan_id.
  // For non-MONTHLY subscriptions we'd amortize, but until tenants can
  // pick a recurrence everyone is MONTHLY anyway.
  const planRows = await sb.select<{ id: string }>("plans", "select=id");
  const { getMonthlyPricesByPlanId } = await import("./lib/plan-prices.ts");
  const priceMap = await getMonthlyPricesByPlanId(planRows.map((p) => p.id));
  const priceById = new Map<string, number>();
  for (const p of planRows) priceById.set(p.id, priceMap.get(p.id)?.amountBrl ?? 0);
  const mrr = tenants
    .filter((t) => t.status === "active")
    .reduce((sum, t) => sum + (priceById.get(t.plan_id) ?? 0), 0);

  const byStatus: Record<string, number> = { trial: 0, active: 0, suspended: 0, canceled: 0 };
  for (const t of tenants) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;

  html(res, 200, layout({
    title: "Super Admin",
    activeNav: "dashboard",
    session: sess,
    body: dashboardHtml({ tenants, byStatus, mrr }),
  }));
}

async function tenantsList(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const sess = await requireSuperAdmin(req, res);
  if (!sess) return;
  const tenants = await sb.select<{
    id: string; slug: string; name: string; plan_id: string; status: string;
    contact_email: string; subscription_active_until: string | null; created_at: string;
  }>(
    "tenants",
    `select=id,slug,name,plan_id,status,contact_email,subscription_active_until,created_at&order=created_at.desc`,
  );
  const plans = await sb.select<{ id: string; name: string }>("plans", "select=id,name&order=display_order.asc");
  const q = getQuery(req);
  html(res, 200, layout({
    title: "Tenants",
    activeNav: "tenants",
    session: sess,
    body: tenantsListHtml({ tenants, plans, message: q.get("msg") ?? undefined }),
  }));
}

async function tenantPlanPost(slug: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const sess = await requireSuperAdmin(req, res);
  if (!sess) return;
  const form = await readForm(req);
  const planId = (form.get("plan_id") ?? "").trim();
  if (!planId) return redirect(res, `${publicUrl()}/super-admin/tenants?msg=plan_missing`);
  await sb.update("tenants", `slug=eq.${encodeURIComponent(slug)}`, { plan_id: planId });
  redirect(res, `${publicUrl()}/super-admin/tenants?msg=plan_changed`);
}

async function tenantStatusPost(slug: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const sess = await requireSuperAdmin(req, res);
  if (!sess) return;
  const form = await readForm(req);
  const status = (form.get("status") ?? "").trim();
  if (!["trial", "active", "suspended", "canceled"].includes(status)) {
    return redirect(res, `${publicUrl()}/super-admin/tenants?msg=status_invalid`);
  }
  await sb.update("tenants", `slug=eq.${encodeURIComponent(slug)}`, { status });
  redirect(res, `${publicUrl()}/super-admin/tenants?msg=status_changed`);
}

async function plansList(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const sess = await requireSuperAdmin(req, res);
  if (!sess) return;
  const plans = await sb.select<PlanRowFull>("plans", "select=*&order=display_order.asc");
  // Load alternative recurrence prices (Phase 8.4)
  const { listPlanPrices } = await import("./lib/plan-prices.ts");
  const pricesByPlan = new Map<string, Array<import("./lib/plan-prices.ts").PlanPrice>>();
  for (const p of plans) {
    pricesByPlan.set(p.id, await listPlanPrices(p.id));
  }
  const q = getQuery(req);
  html(res, 200, layout({
    title: "Plans",
    activeNav: "plans",
    session: sess,
    body: plansHtml({
      plans,
      pricesByPlan,
      message: q.get("msg") ?? undefined,
      activeTabId: q.get("tab") ?? plans[0]?.id ?? "",
    }),
  }));
}

interface PlanRowFull {
  id: string;
  name: string;
  max_courses: number | null;
  transcribe_hours_month: string | number | null;
  active_students_month: number | null;
  kb_size_bytes: string | number | null;
  is_public: boolean;
  display_order: number;
}

/**
 * Sync ValidaPay for the MONTHLY plan_price. (Migration 014: monthly
 * lives in plan_prices, no longer on the plans row.) Non-monthly
 * recurrence sync goes through /plans/:id/prices/sync-validapay
 * (stub until ValidaPay's recurrence API ships).
 */
async function planSyncToValidapay(id: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const sess = await requireSuperAdmin(req, res);
  if (!sess) return;
  const plan = await sb.selectOne<PlanRowFull>(
    "plans",
    `id=eq.${encodeURIComponent(id)}&select=*`,
  );
  if (!plan) return redirect(res, `${publicUrl()}/super-admin/plans?msg=plan_not_found`);
  const { getPlanMonthlyPrice, updatePlanPriceValidapay, upsertPlanPrice } = await import("./lib/plan-prices.ts");
  const monthly = await getPlanMonthlyPrice(id);
  if (!monthly) {
    return redirect(res, `${publicUrl()}/super-admin/plans?tab=${encodeURIComponent(id)}&msg=sync_needs_price`);
  }
  try {
    const { createProductWithMonthlyPrice } = await import("./lib/validapay.ts");
    const product = await createProductWithMonthlyPrice({
      name: plan.name,
      description: `Askine ${plan.name}`,
      statementDescriptor: `ASKINE ${plan.id.toUpperCase()}`.slice(0, 22),
      amountBrl: monthly.amountBrl,
      externalId: plan.id,
    });
    const priceId = product.prices[0]?.priceId ?? null;
    await updatePlanPriceValidapay({
      planId: id, recurrence: "MONTHLY",
      validapayProductId: product.productId,
      validapayPriceId: priceId,
    });
    redirect(res, `${publicUrl()}/super-admin/plans?tab=${encodeURIComponent(id)}&msg=sync_ok`);
  } catch (err) {
    console.error("ValidaPay sync failed:", err);
    redirect(res, `${publicUrl()}/super-admin/plans?tab=${encodeURIComponent(id)}&msg=sync_failed`);
  }
}

async function planUpdate(id: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const sess = await requireSuperAdmin(req, res);
  if (!sess) return;
  const form = await readForm(req);
  const num = (s: string | null) => s == null || s === "" ? null : Number(s);
  const big = (s: string | null) => s == null || s === "" ? null : Number(s);

  // Capacity-only update. Pricing is managed in the periods table via
  // /plans/:id/prices (Phase 8.4 plan_prices canonical).
  const patch: Record<string, unknown> = {
    name: form.get("name") ?? undefined,
    max_courses: num(form.get("max_courses")),
    transcribe_hours_month: num(form.get("transcribe_hours_month")),
    active_students_month: num(form.get("active_students_month")),
    kb_size_bytes: big(form.get("kb_size_bytes")),
    is_public: (form.get("is_public") ?? "true") === "true",
    display_order: num(form.get("display_order")) ?? 0,
    updated_at: new Date().toISOString(),
  };
  for (const k of Object.keys(patch)) if (patch[k] === undefined) delete patch[k];

  await sb.update("plans", `id=eq.${encodeURIComponent(id)}`, patch);
  redirect(res, `${publicUrl()}/super-admin/plans?tab=${encodeURIComponent(id)}&msg=plan_saved`);
}

// ----- Add-ons (Phase 8.3) -------------------------------------------------

async function addonsList(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const sess = await requireSuperAdmin(req, res);
  if (!sess) return;
  const { listAddons } = await import("./lib/addons.ts");
  const addons = await listAddons();
  const q = getQuery(req);
  html(res, 200, layout({
    title: "Add-ons",
    activeNav: "addons",
    session: sess,
    body: addonsHtml({
      addons,
      message: q.get("msg") ?? undefined,
      activeTabId: q.get("tab") ?? (addons[0]?.id ?? "_new"),
    }),
  }));
}

async function addonCreate(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const sess = await requireSuperAdmin(req, res);
  if (!sess) return;
  const form = await readForm(req);
  const id = (form.get("id") ?? "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
  const name = (form.get("name") ?? "").trim();
  const description = (form.get("description") ?? "").trim() || null;
  const kind = (form.get("kind") ?? "").trim() as "more_courses" | "more_hours" | "more_students" | "more_kb";
  const increment_value = Number(form.get("increment_value") ?? "0");
  const monthly_price_brl = Number(form.get("monthly_price_brl") ?? "0");
  const display_order = Number(form.get("display_order") ?? "99");
  const is_public = (form.get("is_public") ?? "true") === "true";

  if (!id || !name || !kind || !increment_value || !monthly_price_brl) {
    return redirect(res, `${publicUrl()}/super-admin/addons?msg=missing_fields`);
  }
  try {
    await sb.insert("addons", {
      id, name, description, kind, increment_value, monthly_price_brl, display_order, is_public,
    }, { returning: "minimal" });
    redirect(res, `${publicUrl()}/super-admin/addons?msg=addon_created`);
  } catch (err) {
    console.error("Addon create failed:", err);
    redirect(res, `${publicUrl()}/super-admin/addons?msg=create_failed`);
  }
}

async function addonUpdate(id: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const sess = await requireSuperAdmin(req, res);
  if (!sess) return;
  const form = await readForm(req);
  const patch: Record<string, unknown> = {
    name: form.get("name") ?? undefined,
    description: form.get("description") ?? null,
    increment_value: form.get("increment_value") ? Number(form.get("increment_value")) : undefined,
    monthly_price_brl: form.get("monthly_price_brl") ? Number(form.get("monthly_price_brl")) : undefined,
    display_order: form.get("display_order") ? Number(form.get("display_order")) : undefined,
    is_public: form.get("is_public") != null ? (form.get("is_public") === "true") : undefined,
    updated_at: new Date().toISOString(),
  };
  for (const k of Object.keys(patch)) if (patch[k] === undefined) delete patch[k];
  await sb.update("addons", `id=eq.${encodeURIComponent(id)}`, patch);
  redirect(res, `${publicUrl()}/super-admin/addons?msg=addon_saved`);
}

async function addonSyncToValidapay(id: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const sess = await requireSuperAdmin(req, res);
  if (!sess) return;
  const { getAddon, updateAddon } = await import("./lib/addons.ts");
  const addon = await getAddon(id);
  if (!addon) return redirect(res, `${publicUrl()}/super-admin/addons?msg=addon_not_found`);
  try {
    const { createProductWithMonthlyPrice } = await import("./lib/validapay.ts");
    const product = await createProductWithMonthlyPrice({
      name: `Askine — ${addon.name}`,
      description: addon.description ?? addon.name,
      statementDescriptor: `ASKINE+${addon.id.toUpperCase()}`.slice(0, 22),
      amountBrl: addon.monthlyPriceBrl,
      externalId: `addon_${addon.id}`,
    });
    const priceId = product.prices[0]?.priceId ?? null;
    await updateAddon(addon.id, {
      validapay_product_id: product.productId,
      validapay_price_id: priceId,
    });
    redirect(res, `${publicUrl()}/super-admin/addons?msg=sync_ok`);
  } catch (err) {
    console.error("Addon ValidaPay sync failed:", err);
    redirect(res, `${publicUrl()}/super-admin/addons?msg=sync_failed`);
  }
}

// ----- Plan recurrence prices (Phase 8.4) -----------------------------

async function planPriceUpsert(planId: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const sess = await requireSuperAdmin(req, res);
  if (!sess) return;
  const form = await readForm(req);
  const recurrence = (form.get("recurrence") ?? "") as import("./lib/plan-prices.ts").Recurrence;
  const amountBrl = Number(form.get("amount_brl") ?? "");
  if (!recurrence || !Number.isFinite(amountBrl) || amountBrl <= 0) {
    return redirect(res, `${publicUrl()}/super-admin/plans?tab=${encodeURIComponent(planId)}&msg=price_invalid`);
  }
  const validRecs = ["MONTHLY", "QUARTERLY", "SEMI_ANNUAL", "ANNUAL"];
  if (!validRecs.includes(recurrence)) {
    return redirect(res, `${publicUrl()}/super-admin/plans?tab=${encodeURIComponent(planId)}&msg=price_invalid`);
  }
  try {
    const { upsertPlanPrice } = await import("./lib/plan-prices.ts");
    await upsertPlanPrice({ planId, recurrence, amountBrl });
    redirect(res, `${publicUrl()}/super-admin/plans?tab=${encodeURIComponent(planId)}&msg=price_saved`);
  } catch (err) {
    console.error("Plan price upsert failed:", err);
    redirect(res, `${publicUrl()}/super-admin/plans?tab=${encodeURIComponent(planId)}&msg=price_failed`);
  }
}

async function planPriceDeleteH(planId: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const sess = await requireSuperAdmin(req, res);
  if (!sess) return;
  const form = await readForm(req);
  const recurrence = (form.get("recurrence") ?? "") as import("./lib/plan-prices.ts").Recurrence;
  if (!recurrence) {
    return redirect(res, `${publicUrl()}/super-admin/plans?tab=${encodeURIComponent(planId)}&msg=price_invalid`);
  }
  const { deletePlanPrice } = await import("./lib/plan-prices.ts");
  await deletePlanPrice(planId, recurrence);
  redirect(res, `${publicUrl()}/super-admin/plans?tab=${encodeURIComponent(planId)}&msg=price_deleted`);
}

async function planPriceSyncToValidapay(planId: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const sess = await requireSuperAdmin(req, res);
  if (!sess) return;
  const form = await readForm(req);
  const recurrence = (form.get("recurrence") ?? "MONTHLY") as import("./lib/plan-prices.ts").Recurrence;
  // MONTHLY uses the existing createProductWithMonthlyPrice flow.
  // Non-monthly is a stub until ValidaPay's recurrence API ships.
  if (recurrence !== "MONTHLY") {
    return redirect(res, `${publicUrl()}/super-admin/plans?tab=${encodeURIComponent(planId)}&msg=sync_unavailable`);
  }
  const plan = await sb.selectOne<{ id: string; name: string }>("plans",
    `id=eq.${encodeURIComponent(planId)}&select=id,name`);
  if (!plan) return redirect(res, `${publicUrl()}/super-admin/plans?msg=plan_not_found`);
  const { getPlanMonthlyPrice, updatePlanPriceValidapay } = await import("./lib/plan-prices.ts");
  const monthly = await getPlanMonthlyPrice(planId);
  if (!monthly) {
    return redirect(res, `${publicUrl()}/super-admin/plans?tab=${encodeURIComponent(planId)}&msg=sync_needs_price`);
  }
  try {
    const { createProductWithMonthlyPrice } = await import("./lib/validapay.ts");
    const product = await createProductWithMonthlyPrice({
      name: plan.name,
      description: `Askine ${plan.name}`,
      statementDescriptor: `ASKINE ${planId.toUpperCase()}`.slice(0, 22),
      amountBrl: monthly.amountBrl,
      externalId: planId,
    });
    const priceId = product.prices[0]?.priceId ?? null;
    await updatePlanPriceValidapay({
      planId, recurrence: "MONTHLY",
      validapayProductId: product.productId,
      validapayPriceId: priceId,
    });
    redirect(res, `${publicUrl()}/super-admin/plans?tab=${encodeURIComponent(planId)}&msg=sync_ok`);
  } catch (err) {
    console.error("ValidaPay sync (monthly) failed:", err);
    redirect(res, `${publicUrl()}/super-admin/plans?tab=${encodeURIComponent(planId)}&msg=sync_failed`);
  }
}

function addonTabHtml(a: import("./lib/addons.ts").Addon, args: { isActive: boolean }): string {
  const kindLabel: Record<string, string> = {
    more_courses: "+ Cursos", more_hours: "+ Horas Whisper",
    more_students: "+ Alunos", more_kb: "+ Storage KB",
  };
  return `
<div class="ax-card" style="display:${args.isActive ? "block" : "none"}" data-addon-panel="${esc(a.id)}">
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
    <h2 style="margin:0">${esc(a.name)}</h2>
    <code style="font-size:12px;color:var(--ax-text-mute)">${esc(a.id)}</code>
    <span class="ax-badge" style="background:var(--ax-surface-2);color:var(--ax-text-soft)">${esc(kindLabel[a.kind] ?? a.kind)}</span>
    ${a.validapayPriceId
      ? `<span class="ax-badge" style="background:#e8f5e9;color:#1e6f3e">● ValidaPay sync</span>`
      : `<span class="ax-badge" style="background:#fff4d6;color:#8a5a00">○ não sincronizado</span>`}
  </div>
  ${a.validapayPriceId ? `<p class="help" style="margin:0 0 18px;font-family:ui-monospace,monospace;font-size:12px">price ${esc(a.validapayPriceId)}</p>` : ""}

  <form method="POST" action="/super-admin/addons/${esc(a.id)}" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px">
    <div><label>Nome</label><input name="name" value="${esc(a.name)}"></div>
    <div><label>Increment</label><input name="increment_value" type="number" step="0.01" value="${a.incrementValue}"></div>
    <div><label>Preço BRL/mês</label><input name="monthly_price_brl" type="number" step="0.01" value="${a.monthlyPriceBrl}"></div>
    <div><label>Ordem</label><input name="display_order" type="number" value="${a.displayOrder}"></div>
    <div><label>Público?</label>
      <select name="is_public">
        <option value="true"${a.isPublic ? " selected" : ""}>Sim</option>
        <option value="false"${!a.isPublic ? " selected" : ""}>Não</option>
      </select>
    </div>
    <div style="grid-column:1/-1"><label>Descrição</label><input name="description" value="${esc(a.description ?? "")}"></div>
    <div style="grid-column:1/-1;display:flex;gap:8px;justify-content:flex-end;margin-top:6px">
      <button type="submit" class="ax-btn">Salvar ${esc(a.name)}</button>
    </div>
  </form>

  <form method="POST" action="/super-admin/addons/${esc(a.id)}/sync-validapay" style="margin-top:14px;text-align:right">
    <button type="submit" class="ax-btn ghost">
      ${a.validapayPriceId ? "Re-sync" : "Sync"} ValidaPay
    </button>
  </form>
</div>`;
}

function addonNewTabHtml(isActive: boolean): string {
  return `
<div class="ax-card" style="display:${isActive ? "block" : "none"}" data-addon-panel="_new">
  <h2 style="margin:0 0 12px">Novo add-on</h2>
  <p class="help" style="margin:0 0 18px">Crie um novo add-on no catálogo. Depois de criar, clique no tab dele e use "Sync ValidaPay" pra disponibilizar pra compra.</p>
  <form method="POST" action="/super-admin/addons" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px">
    <div><label>ID (slug)</label><input name="id" required placeholder="extra_course_5" pattern="[a-z0-9_]+"></div>
    <div><label>Nome</label><input name="name" required placeholder="+5 cursos"></div>
    <div><label>Kind</label>
      <select name="kind" required>
        <option value="more_courses">more_courses</option>
        <option value="more_hours">more_hours</option>
        <option value="more_students">more_students</option>
        <option value="more_kb">more_kb</option>
      </select>
    </div>
    <div><label>Increment</label><input name="increment_value" type="number" step="0.01" required placeholder="ex: 1, 20, 500"></div>
    <div><label>Preço BRL/mês</label><input name="monthly_price_brl" type="number" step="0.01" required></div>
    <div><label>Ordem</label><input name="display_order" type="number" value="99"></div>
    <div><label>Público?</label>
      <select name="is_public">
        <option value="true">Sim</option>
        <option value="false">Não</option>
      </select>
    </div>
    <div style="grid-column:1/-1"><label>Descrição</label><input name="description" placeholder="Texto pro infoprodutor entender"></div>
    <div style="grid-column:1/-1;display:flex;justify-content:flex-end;margin-top:6px">
      <button type="submit" class="ax-btn">Criar add-on</button>
    </div>
  </form>
</div>`;
}

function addonsHtml(args: {
  addons: Array<import("./lib/addons.ts").Addon>;
  message?: string;
  activeTabId: string;
}): string {
  const msgs: Record<string, [string, "success" | "error"]> = {
    addon_created:   ["Add-on criado.", "success"],
    addon_saved:     ["Add-on atualizado.", "success"],
    sync_ok:         ["Add-on sincronizado com ValidaPay.", "success"],
    sync_failed:     ["Falha ao sincronizar. Veja logs.", "error"],
    addon_not_found: ["Add-on não encontrado.", "error"],
    missing_fields:  ["Preencha id, nome, kind, valor e preço.", "error"],
    create_failed:   ["Erro ao criar (talvez id duplicado).", "error"],
  };
  const [text, kind] = args.message ? msgs[args.message] ?? [args.message, "error"] : ["", ""];

  // Default active tab: if "_new" requested or no addons, show new form
  const ids = new Set(args.addons.map((a) => a.id));
  const activeId = args.activeTabId === "_new" || !ids.has(args.activeTabId)
    ? (ids.has(args.activeTabId) ? args.activeTabId : args.addons[0]?.id ?? "_new")
    : args.activeTabId;
  const isNewActive = activeId === "_new" || args.addons.length === 0;

  const tabs = args.addons.map((a) => `
    <a href="?tab=${esc(a.id)}" class="plan-tab${a.id === activeId && !isNewActive ? " active" : ""}">
      ${esc(a.name)}
      ${a.validapayPriceId ? `<span class="tab-dot" style="background:var(--ax-success)"></span>` : `<span class="tab-dot" style="background:var(--ax-warn)"></span>`}
    </a>`).join("");
  const newTab = `<a href="?tab=_new" class="plan-tab${isNewActive ? " active" : ""}" style="border-left:1px dashed var(--ax-border);margin-left:8px;padding-left:14px">+ Novo</a>`;

  return `
<style>
  .plan-tabs { display:flex; gap:4px; border-bottom:1px solid var(--ax-border); margin-bottom:20px; padding:0 2px; flex-wrap:wrap }
  .plan-tab { display:inline-flex; align-items:center; gap:8px; padding:10px 16px; border-radius:8px 8px 0 0; font-size:13.5px; color:var(--ax-text-soft); border-bottom:2px solid transparent; margin-bottom:-1px; transition: color 0.1s ease, border 0.1s ease }
  .plan-tab:hover { color:var(--ax-text); background:var(--ax-surface-2) }
  .plan-tab.active { color:var(--ax-text); font-weight:500; border-bottom-color:var(--ax-text); background:var(--ax-surface-2) }
  .tab-dot { width:6px; height:6px; border-radius:50%; display:inline-block }
</style>

<h1>Add-ons</h1>
${text ? `<div class="ax-msg ${kind}">${esc(text)}</div>` : ""}
<p class="help" style="margin-bottom:18px">Catálogo de add-ons para upgrade dos planos. Cada add-on vira um produto/price separado no ValidaPay — quando o tenant compra, criamos uma subscription dedicada.</p>

<div class="plan-tabs">${tabs}${newTab}</div>

${args.addons.map((a) => addonTabHtml(a, { isActive: a.id === activeId && !isNewActive })).join("")}
${addonNewTabHtml(isNewActive)}`;
}

// ----- Templates -----------------------------------------------------------

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// Phase 7: super-admin shares the same OpenAI-style shell as the tenant
// admin, with its own sidebar items + "Platform" subtitle.
// Status pill colors for tenants table (kept for back-compat with existing
// page templates that emit class="badge X").
const SUPER_LEGACY_BADGE_CSS = `
  .ax-content .badge { display:inline-block; padding:2px 8px; border-radius:99px; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.04em }
  .ax-content .badge.active    { background:#e8f5e9; color:#1e6f3e }
  .ax-content .badge.trial     { background:#fff4d6; color:#8a5a00 }
  .ax-content .badge.suspended { background:#ffe5e5; color:#a01818 }
  .ax-content .badge.canceled  { background:#ececec; color:#5e5e5e }
  .ax-content .row { display:flex; gap:8px; align-items:end }
  .ax-content .stat { padding:14px 16px; background:var(--ax-surface); border-radius:var(--ax-radius); border:1px solid var(--ax-border) }
  .ax-content .stat .label { font-size:11px; color:var(--ax-text-mute); text-transform:uppercase; letter-spacing:.04em }
  .ax-content .stat .value { font-size:24px; font-weight:600; margin-top:4px; color:var(--ax-text) }
`;

function layout(args: {
  title: string;
  activeNav?: string;
  session?: SuperAdminSession;
  body: string;
}): string {
  // Unauthenticated screens (login + verify) use the centered auth-card.
  if (!args.session) {
    return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(args.title)} — Askine</title>
<link rel="icon" type="image/png" href="/brand/favicon.png">
<style>${ADMIN_SHELL_CSS}${SUPER_LEGACY_BADGE_CSS}
  .ax-auth-wrap { min-height:100vh; display:flex; align-items:center; justify-content:center; padding:32px 16px; background: var(--ax-surface-2) }
  .ax-auth-card { background: var(--ax-surface); border:1px solid var(--ax-border); border-radius: var(--ax-radius-lg); padding: 32px; max-width: 420px; width: 100%; box-shadow: var(--ax-shadow-md) }
  .ax-auth-brand { display:flex; flex-direction:column; align-items:center; margin-bottom: 24px }
  .ax-auth-brand img { height: 26px; margin-bottom: 8px }
  .ax-auth-brand small { color: var(--ax-text-mute); font-size: 12.5px; letter-spacing: 0.08em; text-transform: uppercase }
</style></head>
<body>
<div class="ax-auth-wrap">
  <div class="ax-auth-card">
    <div class="ax-auth-brand">
      <img src="/brand/logo-black.svg" alt="Askine">
      <small>Platform</small>
    </div>
    ${args.body}
  </div>
</div>
</body></html>`;
  }

  return adminShell({
    pageTitle: args.title,
    brandLabel: "Askine Platform",
    brandSub: "Platform admin",
    brandHref: "/super-admin",
    nav: [{
      items: [
        { id: "dashboard", label: "Dashboard", href: "/super-admin",          icon: icons.dashboard },
        { id: "tenants",   label: "Tenants",   href: "/super-admin/tenants",  icon: icons.tenants },
        { id: "plans",     label: "Plans",     href: "/super-admin/plans",    icon: icons.plan },
        { id: "addons",    label: "Add-ons",   href: "/super-admin/addons",   icon: icons.plug },
      ],
    }],
    activeId: args.activeNav,
    userEmail: args.session.email,
    logoutHref: "/super-admin/logout",
    extraHead: `<style>${SUPER_LEGACY_BADGE_CSS}</style>`,
    body: args.body,
  });
}

function loginHtml(args: { error?: string; sent: boolean }): string {
  const errors: Record<string, string> = {
    email_invalid: "Email inválido.",
    send_failed: "Não foi possível enviar o email.",
  };
  const errMsg = args.error ? errors[args.error] ?? "Erro." : null;
  return layout({
    title: "Super Admin Login",
    body: `
<div class="card" style="max-width:420px;margin:60px auto">
  <h1>Super Admin</h1>
  <p style="color:#94a3b8;font-size:13px">Acesso restrito. Magic link enviado pra emails autorizados.</p>
  ${args.sent ? '<div class="msg success">Se autorizado, o link chega em segundos.</div>' : ""}
  ${errMsg ? `<div class="msg error">${esc(errMsg)}</div>` : ""}
  <form method="POST" action="/super-admin/login">
    <label>Email</label>
    <input type="email" name="email" autofocus required placeholder="voce@infosaas.co">
    <div style="margin-top:16px"><button type="submit">Enviar link</button></div>
  </form>
</div>`,
  });
}

function dashboardHtml(args: {
  tenants: Array<{ id: string; slug: string; name: string; plan_id: string; status: string; created_at: string }>;
  byStatus: Record<string, number>;
  mrr: number;
}): string {
  return `
<h1>Dashboard</h1>
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:24px">
  <div class="stat"><div class="label">MRR (ativos)</div><div class="value">R$ ${args.mrr.toFixed(2).replace(".", ",")}</div></div>
  <div class="stat"><div class="label">Tenants</div><div class="value">${args.tenants.length}</div></div>
  <div class="stat"><div class="label">Ativos</div><div class="value" style="color:#34d399">${args.byStatus.active ?? 0}</div></div>
  <div class="stat"><div class="label">Trial</div><div class="value" style="color:#fbbf24">${args.byStatus.trial ?? 0}</div></div>
  <div class="stat"><div class="label">Suspensos</div><div class="value" style="color:#f87171">${args.byStatus.suspended ?? 0}</div></div>
  <div class="stat"><div class="label">Cancelados</div><div class="value" style="color:#94a3b8">${args.byStatus.canceled ?? 0}</div></div>
</div>

<div class="card">
  <h2>Últimos tenants</h2>
  <table>
    <thead><tr><th>Slug</th><th>Nome</th><th>Plano</th><th>Status</th><th>Criado</th></tr></thead>
    <tbody>
      ${args.tenants.slice(0, 10).map((t) => `
        <tr>
          <td><a href="/super-admin/tenants" style="color:#60a5fa">${esc(t.slug)}</a></td>
          <td>${esc(t.name)}</td>
          <td><code>${esc(t.plan_id)}</code></td>
          <td><span class="badge ${esc(t.status)}">${esc(t.status)}</span></td>
          <td>${esc(new Date(t.created_at).toLocaleDateString("pt-BR"))}</td>
        </tr>
      `).join("")}
    </tbody>
  </table>
</div>`;
}

function tenantsListHtml(args: {
  tenants: Array<{ id: string; slug: string; name: string; plan_id: string; status: string; contact_email: string; created_at: string }>;
  plans: Array<{ id: string; name: string }>;
  message?: string;
}): string {
  const msgs: Record<string, [string, "success" | "error"]> = {
    plan_changed: ["Plano alterado.", "success"],
    status_changed: ["Status alterado.", "success"],
    plan_missing: ["Plano não informado.", "error"],
    status_invalid: ["Status inválido.", "error"],
  };
  const [msgText, msgKind] = args.message ? msgs[args.message] ?? [args.message, "error"] : ["", ""];
  return `
<h1>Tenants (${args.tenants.length})</h1>
${msgText ? `<div class="msg ${msgKind}">${esc(msgText)}</div>` : ""}
<div class="card">
  <table>
    <thead><tr><th>Slug</th><th>Nome</th><th>Email</th><th>Plano</th><th>Status</th><th>Ações</th></tr></thead>
    <tbody>
      ${args.tenants.map((t) => `
        <tr>
          <td><code>${esc(t.slug)}</code></td>
          <td>${esc(t.name)}</td>
          <td style="font-size:12px;color:#94a3b8">${esc(t.contact_email)}</td>
          <td>
            <form method="POST" action="/super-admin/tenants/${esc(t.slug)}/plan" style="display:flex;gap:4px">
              <select name="plan_id">
                ${args.plans.map((p) => `<option value="${esc(p.id)}"${p.id === t.plan_id ? " selected" : ""}>${esc(p.name)}</option>`).join("")}
              </select>
              <button type="submit" style="padding:6px 10px;font-size:11px">salvar</button>
            </form>
          </td>
          <td>
            <form method="POST" action="/super-admin/tenants/${esc(t.slug)}/status" style="display:flex;gap:4px">
              <select name="status">
                ${["trial", "active", "suspended", "canceled"].map((s) => `<option value="${s}"${s === t.status ? " selected" : ""}>${s}</option>`).join("")}
              </select>
              <button type="submit" style="padding:6px 10px;font-size:11px">salvar</button>
            </form>
          </td>
          <td><a href="/t/${esc(t.slug)}/admin" target="_blank" style="color:#60a5fa;font-size:11px">abrir admin →</a></td>
        </tr>
      `).join("")}
    </tbody>
  </table>
</div>`;
}

// Margin calculator constants — tweak as cost structure changes
const COST_WHISPER_BRL_PER_HOUR = 2.16;   // ~$0.006/min × USD 6
const COST_STORAGE_BRL_PER_GB = 0.10;     // Supabase Storage rough estimate
const NF_PERCENT = 0.06;                  // Simples Nacional 6%

interface MarginBreakdown {
  whisperCost: number;
  storageCost: number;
  nfCost: number;
  totalCost: number;
  margin: number;
  marginPct: number;
}

function calcMargin(args: {
  priceBrl: number | null;
  hoursMonth: number | null;
  kbBytes: number | null;
}): MarginBreakdown {
  const price = Number(args.priceBrl ?? 0);
  const hours = Number(args.hoursMonth ?? 0);
  const gb = Number(args.kbBytes ?? 0) / (1024 ** 3);
  const whisperCost = Math.round(hours * COST_WHISPER_BRL_PER_HOUR * 100) / 100;
  const storageCost = Math.round(gb * COST_STORAGE_BRL_PER_GB * 100) / 100;
  const nfCost = Math.round(price * NF_PERCENT * 100) / 100;
  const totalCost = Math.round((whisperCost + storageCost + nfCost) * 100) / 100;
  const margin = Math.round((price - totalCost) * 100) / 100;
  const marginPct = price > 0 ? Math.round((margin / price) * 1000) / 10 : 0;
  return { whisperCost, storageCost, nfCost, totalCost, margin, marginPct };
}

function fmtBrl(n: number): string {
  return `R$ ${n.toFixed(2).replace(".", ",")}`;
}

function planPricesSectionHtml(
  planId: string,
  prices: Array<import("./lib/plan-prices.ts").PlanPrice>,
): string {
  // All recurrences as first-class options. The customer at signup
  // picks one of those that have an amount + ValidaPay sync. MONTHLY
  // syncs through the existing createProductWithMonthlyPrice path;
  // the others stub until ValidaPay ships the recurrence API.
  const periods: Array<{ key: "MONTHLY" | "QUARTERLY" | "SEMI_ANNUAL" | "ANNUAL"; label: string; months: number }> = [
    { key: "MONTHLY",     label: "Mensal",     months: 1 },
    { key: "QUARTERLY",   label: "Trimestral", months: 3 },
    { key: "SEMI_ANNUAL", label: "Semestral",  months: 6 },
    { key: "ANNUAL",      label: "Anual",      months: 12 },
  ];
  const byKey = new Map(prices.map((p) => [p.recurrence, p]));
  const monthly = byKey.get("MONTHLY");
  const fmt = (n: number) => `R$ ${n.toFixed(2).replace(".", ",")}`;
  const hint = (months: number): string => {
    if (months === 1 || monthly == null) return "";
    const fullPrice = monthly.amountBrl * months;
    return `<span style="color:var(--ax-text-mute);font-size:11.5px;margin-left:6px">≈ ${fmt(fullPrice)} sem desconto (${fmt(monthly.amountBrl)} × ${months})</span>`;
  };

  return `
<h3 style="margin-top:28px;font-size:13px;color:var(--ax-text-mute);text-transform:uppercase;letter-spacing:0.05em">Períodos de cobrança</h3>
<p class="help" style="margin:6px 0 14px">Defina preço e sincronize com ValidaPay para cada período em que o plano é oferecido. Mensal sincroniza agora; Trimestral/Semestral/Anual aguardam o ValidaPay publicar a rota de recurrence.</p>
<table class="ax-table" style="font-size:13px">
  <tr><th style="width:140px">Período</th><th style="width:240px">Preço total</th><th>Status ValidaPay</th><th style="width:220px;text-align:right">Ações</th></tr>
  ${periods.map((per) => {
    const cur = byKey.get(per.key);
    const synced = !!cur?.validapayPriceId;
    const syncDisabledAttrs = per.key === "MONTHLY"
      ? ""
      : ` disabled title="Aguardando ValidaPay liberar API de recurrence não-mensal"`;
    return `<tr>
      <td><strong>${per.label}</strong>${hint(per.months)}</td>
      <td>
        <form method="POST" action="/super-admin/plans/${esc(planId)}/prices" style="display:flex;gap:6px">
          <input type="hidden" name="recurrence" value="${per.key}">
          <input name="amount_brl" type="number" step="0.01" value="${cur?.amountBrl ?? ""}" placeholder="0.00" style="width:140px">
          <button type="submit" class="ax-btn sm">${cur ? "Salvar" : "Definir"}</button>
        </form>
      </td>
      <td>${
        cur == null
          ? `<span style="color:var(--ax-text-mute)">—</span>`
          : synced
            ? `<span class="ax-badge" style="background:#e8f5e9;color:#1e6f3e">● ${esc(cur.validapayPriceId ?? "sync")}</span>`
            : per.key === "MONTHLY"
              ? `<span class="ax-badge" style="background:#fff4d6;color:#8a5a00">○ não sincronizado</span>`
              : `<span class="ax-badge" style="background:#fff4d6;color:#8a5a00">○ aguardando API</span>`
      }</td>
      <td style="text-align:right">
        ${cur ? `
          <form method="POST" action="/super-admin/plans/${esc(planId)}/prices/sync-validapay" style="display:inline">
            <input type="hidden" name="recurrence" value="${per.key}">
            <button type="submit" class="ax-btn ghost sm"${syncDisabledAttrs}>${synced ? "Re-sync" : "Sync"}</button>
          </form>
          <form method="POST" action="/super-admin/plans/${esc(planId)}/prices/delete" style="display:inline" onsubmit="return confirm('Remover este período?')">
            <input type="hidden" name="recurrence" value="${per.key}">
            <button type="submit" class="ax-btn ghost sm" style="color:var(--ax-danger)">Remover</button>
          </form>` : ""}
      </td>
    </tr>`;
  }).join("")}
</table>`;
}

function planTabHtml(p: PlanRowFull, args: { isActive: boolean; prices: Array<import("./lib/plan-prices.ts").PlanPrice> }): string {
  const monthly = args.prices.find((pp) => pp.recurrence === "MONTHLY");
  const monthlyAmount = monthly?.amountBrl ?? null;
  const m = calcMargin({
    priceBrl: monthlyAmount,
    hoursMonth: p.transcribe_hours_month != null ? Number(p.transcribe_hours_month) : null,
    kbBytes: p.kb_size_bytes != null ? Number(p.kb_size_bytes) : null,
  });
  const marginColor = m.marginPct >= 50 ? "var(--ax-success)" : m.marginPct >= 25 ? "var(--ax-warn)" : "var(--ax-danger)";
  const hasAnyPrice = args.prices.length > 0;
  return `
<div class="ax-card" style="display:${args.isActive ? "block" : "none"}" data-plan-panel="${esc(p.id)}">
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
    <h2 style="margin:0">${esc(p.name)}</h2>
    <code style="font-size:12px;color:var(--ax-text-mute)">${esc(p.id)}</code>
    ${monthly?.validapayPriceId
      ? `<span class="ax-badge" style="background:#e8f5e9;color:#1e6f3e">● Mensal sync</span>`
      : monthly
        ? `<span class="ax-badge" style="background:#fff4d6;color:#8a5a00">○ Mensal não sincronizado</span>`
        : !hasAnyPrice
          ? `<span class="ax-badge" style="background:#fff4d6;color:#8a5a00">○ sem preço</span>`
          : `<span class="ax-badge" style="background:var(--ax-surface-2);color:var(--ax-text-soft)">apenas períodos longos</span>`}
  </div>

  <form method="POST" action="/super-admin/plans/${esc(p.id)}" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px">
    <div><label>Nome</label><input name="name" value="${esc(p.name)}"></div>
    <div><label>Max cursos</label><input name="max_courses" type="number" value="${p.max_courses ?? ""}" placeholder="∞"></div>
    <div><label>Transcrição h/mês</label><input name="transcribe_hours_month" type="number" step="0.1" value="${p.transcribe_hours_month ?? ""}" placeholder="∞"></div>
    <div><label>Alunos ativos/mês</label><input name="active_students_month" type="number" value="${p.active_students_month ?? ""}" placeholder="∞"></div>
    <div><label>KB bytes</label><input name="kb_size_bytes" type="number" value="${p.kb_size_bytes ?? ""}" placeholder="∞"></div>
    <div><label>Ordem display</label><input name="display_order" type="number" value="${p.display_order}"></div>
    <div><label>Público?</label><select name="is_public"><option value="true"${p.is_public ? " selected" : ""}>Sim</option><option value="false"${!p.is_public ? " selected" : ""}>Não</option></select></div>
    <div style="grid-column:1/-1;display:flex;gap:8px;justify-content:flex-end;margin-top:6px">
      <button type="submit" class="ax-btn">Salvar capacidades</button>
    </div>
  </form>

  ${planPricesSectionHtml(p.id, args.prices)}

  <h3 style="margin-top:28px;font-size:13px;color:var(--ax-text-mute);text-transform:uppercase;letter-spacing:0.05em">Margem estimada (base mensal)</h3>
  <table class="ax-table" style="font-size:13px;margin-top:8px">
    <tr><th style="width:60%">Item</th><th style="text-align:right">Valor</th></tr>
    <tr><td>Whisper (${p.transcribe_hours_month ?? "∞"} h × ${fmtBrl(COST_WHISPER_BRL_PER_HOUR)})</td><td style="text-align:right">- ${fmtBrl(m.whisperCost)}</td></tr>
    <tr><td>Storage Supabase (${((Number(p.kb_size_bytes ?? 0)) / 1024 / 1024).toFixed(0)} MB × ${fmtBrl(COST_STORAGE_BRL_PER_GB)}/GB)</td><td style="text-align:right">- ${fmtBrl(m.storageCost)}</td></tr>
    <tr><td>NF Simples Nacional (${(NF_PERCENT * 100).toFixed(0)}% × preço)</td><td style="text-align:right">- ${fmtBrl(m.nfCost)}</td></tr>
    <tr style="background:var(--ax-surface-2)"><td><strong>Custo total</strong></td><td style="text-align:right"><strong>- ${fmtBrl(m.totalCost)}</strong></td></tr>
    <tr><td><strong>Preço mensal</strong></td><td style="text-align:right"><strong>+ ${fmtBrl(Number(monthlyAmount ?? 0))}</strong></td></tr>
    <tr style="background:var(--ax-surface-2)"><td><strong>Margem líquida (mensal)</strong></td><td style="text-align:right;color:${marginColor}"><strong>${fmtBrl(m.margin)} (${m.marginPct.toFixed(1)}%)</strong></td></tr>
  </table>
</div>`;
}

function plansHtml(args: {
  plans: PlanRowFull[];
  pricesByPlan: Map<string, Array<import("./lib/plan-prices.ts").PlanPrice>>;
  message?: string;
  activeTabId: string;
}): string {
  const msgs: Record<string, [string, "success" | "error" | "warn"]> = {
    plan_saved:        ["Plano atualizado.", "success"],
    sync_ok:           ["Plano sincronizado com ValidaPay.", "success"],
    sync_failed:       ["Falha ao sincronizar com ValidaPay. Veja logs.", "error"],
    sync_needs_price:  ["Configure o preço BRL primeiro.", "error"],
    plan_not_found:    ["Plano não encontrado.", "error"],
    price_saved:       ["Periodicidade salva.", "success"],
    price_deleted:     ["Periodicidade removida.", "success"],
    price_invalid:     ["Preço ou periodicidade inválidos.", "error"],
    price_failed:      ["Falha ao salvar a periodicidade.", "error"],
    sync_unavailable:  ["Sync de periodicidades não-mensais aguardando API do ValidaPay. O preço fica salvo localmente.", "warn"],
  };
  const [msgText, msgKind] = args.message ? msgs[args.message] ?? [args.message, "error"] : ["", ""];
  const activeId = args.plans.find((p) => p.id === args.activeTabId) ? args.activeTabId : args.plans[0]?.id ?? "";

  const tabs = args.plans.map((p) => {
    const prices = args.pricesByPlan.get(p.id) ?? [];
    const monthly = prices.find((pp) => pp.recurrence === "MONTHLY");
    const synced = !!monthly?.validapayPriceId;
    return `
    <a href="?tab=${esc(p.id)}" class="plan-tab${p.id === activeId ? " active" : ""}">
      ${esc(p.name)}
      ${synced ? `<span class="tab-dot" style="background:var(--ax-success)"></span>` : `<span class="tab-dot" style="background:var(--ax-warn)"></span>`}
    </a>`;
  }).join("");

  return `
<style>
  .plan-tabs { display:flex; gap:4px; border-bottom:1px solid var(--ax-border); margin-bottom:20px; padding:0 2px }
  .plan-tab { display:inline-flex; align-items:center; gap:8px; padding:10px 16px; border-radius:8px 8px 0 0; font-size:13.5px; color:var(--ax-text-soft); border-bottom:2px solid transparent; margin-bottom:-1px; transition: color 0.1s ease, border 0.1s ease }
  .plan-tab:hover { color:var(--ax-text); background:var(--ax-surface-2) }
  .plan-tab.active { color:var(--ax-text); font-weight:500; border-bottom-color:var(--ax-text); background:var(--ax-surface-2) }
  .tab-dot { width:6px; height:6px; border-radius:50%; display:inline-block }
</style>

<h1>Plans</h1>
${msgText ? `<div class="ax-msg ${msgKind}">${esc(msgText)}</div>` : ""}
<p class="help" style="margin-bottom:18px">Edite preços e limites. Mudança fica ativa imediatamente. <strong>"Sync ValidaPay"</strong> cria product+price no ValidaPay e salva os IDs. Cálculo de margem embaixo de cada plano.</p>

<div class="plan-tabs">${tabs}</div>

${args.plans.map((p) => planTabHtml(p, { isActive: p.id === activeId, prices: args.pricesByPlan.get(p.id) ?? [] })).join("")}`;
}

// ----- Router --------------------------------------------------------------

export type SuperAdminRouteMatch =
  | { type: "login-get" } | { type: "login-post" } | { type: "verify" }
  | { type: "dashboard" }
  | { type: "tenants-list" }
  | { type: "tenant-plan"; slug: string }
  | { type: "tenant-status"; slug: string }
  | { type: "plans-list" }
  | { type: "plan-update"; id: string }
  | { type: "plan-sync"; id: string }
  | { type: "addons-list" }
  | { type: "addon-create" }
  | { type: "addon-update"; id: string }
  | { type: "addon-sync"; id: string }
  | { type: "plan-price-upsert"; planId: string }
  | { type: "plan-price-delete"; planId: string }
  | { type: "plan-price-sync"; planId: string }
  | { type: "logout" };

export function matchSuperAdminRoute(suffix: string, method: string): SuperAdminRouteMatch | null {
  const path = suffix.split("?")[0];
  if (method === "GET"  && (path === "" || path === "/" || path === "/dashboard")) return { type: "dashboard" };
  if (method === "GET"  && path === "/login")    return { type: "login-get" };
  if (method === "POST" && path === "/login")    return { type: "login-post" };
  if (method === "GET"  && path === "/verify")   return { type: "verify" };
  if (method === "GET"  && path === "/tenants")  return { type: "tenants-list" };
  if (method === "GET"  && path === "/plans")    return { type: "plans-list" };
  if (method === "GET"  && path === "/addons")   return { type: "addons-list" };
  if (method === "POST" && path === "/addons")   return { type: "addon-create" };
  if (method === "GET"  && path === "/logout")   return { type: "logout" };
  const tenantPlan = path.match(/^\/tenants\/([a-z0-9][a-z0-9-]{0,62})\/plan$/i);
  if (method === "POST" && tenantPlan) return { type: "tenant-plan", slug: tenantPlan[1] };
  const tenantStatus = path.match(/^\/tenants\/([a-z0-9][a-z0-9-]{0,62})\/status$/i);
  if (method === "POST" && tenantStatus) return { type: "tenant-status", slug: tenantStatus[1] };
  const planSync = path.match(/^\/plans\/([a-z0-9_-]+)\/sync-validapay$/i);
  if (method === "POST" && planSync) return { type: "plan-sync", id: planSync[1] };
  const planUp = path.match(/^\/plans\/([a-z0-9_-]+)$/i);
  if (method === "POST" && planUp) return { type: "plan-update", id: planUp[1] };
  const addonSync = path.match(/^\/addons\/([a-z0-9_-]+)\/sync-validapay$/i);
  if (method === "POST" && addonSync) return { type: "addon-sync", id: addonSync[1] };
  const addonUp = path.match(/^\/addons\/([a-z0-9_-]+)$/i);
  if (method === "POST" && addonUp) return { type: "addon-update", id: addonUp[1] };
  // Phase 8.4: plan recurrence prices
  const planPriceSync = path.match(/^\/plans\/([a-z0-9_-]+)\/prices\/sync-validapay$/i);
  if (method === "POST" && planPriceSync) return { type: "plan-price-sync", planId: planPriceSync[1] };
  const planPriceDel = path.match(/^\/plans\/([a-z0-9_-]+)\/prices\/delete$/i);
  if (method === "POST" && planPriceDel) return { type: "plan-price-delete", planId: planPriceDel[1] };
  const planPriceUp = path.match(/^\/plans\/([a-z0-9_-]+)\/prices$/i);
  if (method === "POST" && planPriceUp) return { type: "plan-price-upsert", planId: planPriceUp[1] };
  return null;
}

export async function handleSuperAdminRoute(
  match: SuperAdminRouteMatch,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  switch (match.type) {
    case "login-get":      return loginGet(req, res);
    case "login-post":     return loginPost(req, res);
    case "verify":         return verifyMagicLink(req, res);
    case "dashboard":      return dashboard(req, res);
    case "tenants-list":   return tenantsList(req, res);
    case "tenant-plan":    return tenantPlanPost(match.slug, req, res);
    case "tenant-status":  return tenantStatusPost(match.slug, req, res);
    case "plans-list":     return plansList(req, res);
    case "plan-update":    return planUpdate(match.id, req, res);
    case "plan-sync":      return planSyncToValidapay(match.id, req, res);
    case "addons-list":    return addonsList(req, res);
    case "addon-create":   return addonCreate(req, res);
    case "addon-update":   return addonUpdate(match.id, req, res);
    case "addon-sync":     return addonSyncToValidapay(match.id, req, res);
    case "plan-price-upsert": return planPriceUpsert(match.planId, req, res);
    case "plan-price-delete": return planPriceDeleteH(match.planId, req, res);
    case "plan-price-sync":   return planPriceSyncToValidapay(match.planId, req, res);
    case "logout":         return logout(req, res);
  }
}

// Quiet unused-warning — json is exported elsewhere if needed.
void json;
