/**
 * Public-facing routes (no auth required).
 *
 *   GET  /pricing  — public pricing page (reads from plans table)
 *   GET  /signup   — form: tenant name, slug, contact email, CPF/CNPJ, plan
 *   POST /signup   — creates tenant + admin + ValidaPay checkout, redirects
 */

import { IncomingMessage, ServerResponse } from "node:http";
import { sb } from "./lib/db-api.ts";
import { inviteAdmin } from "./lib/tenant-admin.ts";
import { createCheckoutSession } from "./lib/validapay.ts";

function publicUrl(): string {
  return (process.env.PUBLIC_URL ?? "http://localhost:3333").replace(/\/+$/, "");
}

function html(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" }).end(body);
}

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { Location: location }).end();
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

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function slugify(s: string): string {
  return s.toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

interface PlanPublic {
  id: string; name: string;
  monthly_price_brl: number | null;
  max_courses: number | null;
  transcribe_hours_month: number | null;
  active_students_month: number | null;
  kb_size_bytes: number | null;
  validapay_price_id: string | null;
  display_order: number;
}

async function pricingPage(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const plans = await sb.select<PlanPublic>(
    "plans",
    "select=id,name,monthly_price_brl,max_courses,transcribe_hours_month,active_students_month,kb_size_bytes,validapay_price_id,display_order&is_public=is.true&order=display_order.asc",
  );
  html(res, 200, pricingHtml(plans));
}

async function signupGet(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const q = getQuery(req);
  const plans = await sb.select<PlanPublic>(
    "plans",
    "select=id,name,monthly_price_brl,validapay_price_id&is_public=is.true&order=display_order.asc",
  );
  html(res, 200, signupHtml({
    plans,
    selected: q.get("plan") ?? plans[0]?.id ?? "",
    error: q.get("error") ?? undefined,
  }));
}

async function signupPost(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const form = await readForm(req);
  const name = (form.get("name") ?? "").trim();
  const email = (form.get("email") ?? "").trim().toLowerCase();
  const planId = (form.get("plan") ?? "").trim();
  const documentRaw = (form.get("document") ?? "").replace(/\D+/g, "");
  const slug = slugify(form.get("slug") || name);

  if (!name || !email || !email.includes("@") || !slug || !planId) {
    return redirect(res, `/signup?error=missing_fields&plan=${encodeURIComponent(planId)}`);
  }
  if (documentRaw.length !== 11 && documentRaw.length !== 14) {
    return redirect(res, `/signup?error=bad_document&plan=${encodeURIComponent(planId)}`);
  }

  // Resolve plan + ValidaPay price
  const plan = await sb.selectOne<PlanPublic>(
    "plans",
    `id=eq.${encodeURIComponent(planId)}&select=id,name,monthly_price_brl,validapay_price_id`,
  );
  if (!plan) return redirect(res, `/signup?error=bad_plan`);
  if (!plan.validapay_price_id) {
    return redirect(res, `/signup?error=plan_not_synced&plan=${encodeURIComponent(planId)}`);
  }

  // Slug must be unique
  const existing = await sb.selectOne<{ id: string }>(
    "tenants",
    `slug=eq.${encodeURIComponent(slug)}&select=id`,
  );
  if (existing) {
    return redirect(res, `/signup?error=slug_taken&plan=${encodeURIComponent(planId)}`);
  }

  // Create tenant in trial state — checkout completion will flip to active
  const tenantRow = await sb.insert<{ id: string; slug: string }>("tenants", {
    slug,
    name,
    contact_email: email,
    contact_document: documentRaw,
    plan_id: planId,
    status: "trial",
    trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
  });
  const tenant = tenantRow[0];
  await inviteAdmin({ tenantId: tenant.id, email, role: "owner" });

  // Create ValidaPay checkout session
  let checkoutUrl: string;
  try {
    const session = await createCheckoutSession({
      priceId: plan.validapay_price_id,
      customer: { email, documentNumber: documentRaw },
      allowedPaymentMethods: ["pix", "creditcard"],
    });
    await sb.update("tenants", `id=eq.${tenant.id}`, {
      validapay_checkout_id: session.id,
    });
    checkoutUrl = session.url;
  } catch (err) {
    console.error("ValidaPay checkout session failed:", err);
    // Roll back nothing — tenant exists in trial state. Admin can retry
    // checkout from their admin dashboard later.
    return html(res, 200, signupSuccessFallbackHtml({ tenant, email }));
  }

  redirect(res, checkoutUrl);
}

// ----- Templates -----------------------------------------------------------

const CSS = `
  *{box-sizing:border-box}
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#0f172a;color:#e2e8f0;line-height:1.6}
  .nav{max-width:1100px;margin:0 auto;padding:16px 24px;display:flex;align-items:center;gap:24px}
  .nav .brand{font-weight:700;font-size:20px;color:#60a5fa}
  .nav a{color:#94a3b8;text-decoration:none;font-size:14px}
  .nav a:hover{color:#fff}
  main{max-width:1100px;margin:24px auto;padding:0 24px}
  h1{font-size:36px;margin:32px 0 8px;color:#f1f5f9}
  h2{font-size:22px;margin:24px 0 8px;color:#f1f5f9}
  .sub{color:#94a3b8;font-size:16px;margin-bottom:32px}
  .plans{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}
  .plan{background:#1e293b;border:1px solid #334155;border-radius:16px;padding:24px}
  .plan.featured{border:2px solid #3b82f6}
  .plan h3{font-size:20px;margin:0 0 8px;color:#f1f5f9}
  .price{font-size:32px;font-weight:700;color:#3b82f6;margin:8px 0}
  .price .per{font-size:14px;color:#94a3b8;font-weight:400}
  .features{list-style:none;padding:0;margin:16px 0}
  .features li{padding:6px 0;border-bottom:1px solid #1e293b;font-size:14px}
  .features li::before{content:"✓ ";color:#34d399}
  button,a.btn{display:inline-block;padding:10px 20px;background:#3b82f6;color:#fff;border:0;border-radius:8px;font-size:14px;cursor:pointer;text-decoration:none;font-weight:500}
  button:hover,a.btn:hover{background:#2563eb}
  .card{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:24px;margin-bottom:16px}
  label{display:block;font-size:12px;color:#94a3b8;margin:12px 0 4px}
  input,select{width:100%;padding:10px;border:1px solid #475569;border-radius:8px;font-size:14px;background:#0f172a;color:#e2e8f0;font-family:inherit}
  .msg{padding:10px 14px;border-radius:8px;margin-bottom:16px;font-size:13px}
  .msg.error{background:#7f1d1d;color:#fecaca}
  .msg.success{background:#064e3b;color:#a7f3d0}
  footer.site{max-width:1100px;margin:64px auto 32px;padding:24px;border-top:1px solid #1e293b;display:flex;flex-wrap:wrap;gap:24px;font-size:13px;color:#64748b}
  footer.site a{color:#94a3b8;text-decoration:none}
  footer.site a:hover{color:#fff}
  footer.site .col{display:flex;flex-direction:column;gap:6px}
  footer.site .col strong{color:#cbd5e1;text-transform:uppercase;font-size:11px;letter-spacing:1px;margin-bottom:4px}
`;

const NAV = `
  <div class="nav">
    <div class="brand"><a href="/" style="color:#60a5fa;text-decoration:none">Askine</a></div>
    <div style="flex:1"></div>
    <a href="/pricing">Pricing</a>
    <a href="/docs">Docs</a>
    <a href="/status">Status</a>
    <a href="/signup">Começar</a>
  </div>`;

const FOOTER = `
  <footer class="site">
    <div class="col">
      <strong>Produto</strong>
      <a href="/pricing">Pricing</a>
      <a href="/docs">Documentação</a>
      <a href="/status">Status</a>
    </div>
    <div class="col">
      <strong>Empresa</strong>
      <a href="/about">Sobre</a>
      <a href="/enterprise">Enterprise</a>
      <a href="/contact">Contato</a>
    </div>
    <div class="col">
      <strong>Legal</strong>
      <a href="/privacy">Privacidade</a>
      <a href="/terms">Termos</a>
    </div>
    <div style="flex:1;text-align:right">
      <div style="color:#64748b">© 2026 Propps Media · CNPJ 35.735.278/0001-91</div>
      <div style="margin-top:4px"><a href="/contact">rafael@infosaas.co</a></div>
    </div>
  </footer>`;

function fmtBytes(n: number | null): string {
  if (n == null) return "ilimitado";
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(0)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function pricingHtml(plans: PlanPublic[]): string {
  const fmtPrice = (n: number | null) =>
    n == null ? "Sob proposta" : `R$ ${n.toFixed(2).replace(".", ",")}`;
  const featured = plans.find((p) => p.id === "pro");
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Pricing — Askine</title>
<style>${CSS}</style>
${NAV}
<main>
  <h1>Planos</h1>
  <p class="sub">Tutor agêntico via MCP pro teu curso. Aluno conversa com Claude.ai ou ChatGPT usando o conteúdo do teu curso.</p>
  <div class="plans">
    ${plans.map((p) => `
      <div class="plan ${p.id === featured?.id ? "featured" : ""}">
        <h3>${esc(p.name)}</h3>
        <div class="price">${esc(fmtPrice(Number(p.monthly_price_brl)))}<span class="per">${p.monthly_price_brl != null ? "/mês" : ""}</span></div>
        <ul class="features">
          <li>${p.max_courses ?? "∞"} curso${p.max_courses === 1 ? "" : "s"}</li>
          <li>${p.transcribe_hours_month ?? "∞"} h de transcrição/mês</li>
          <li>${p.active_students_month ?? "∞"} alunos ativos/mês</li>
          <li>${esc(fmtBytes(p.kb_size_bytes != null ? Number(p.kb_size_bytes) : null))} de arquivos</li>
        </ul>
        ${p.monthly_price_brl == null
          ? `<a class="btn" href="/enterprise" style="display:block;text-align:center;background:#475569">Fale com vendas</a>`
          : p.validapay_price_id
            ? `<a class="btn" href="/signup?plan=${esc(p.id)}" style="display:block;text-align:center">Começar com ${esc(p.name)}</a>`
            : `<div style="color:#fbbf24;font-size:12px;text-align:center">Em breve</div>`}
      </div>`).join("")}
  </div>
</main>${FOOTER}`;
}

function signupHtml(args: { plans: Array<Pick<PlanPublic, "id" | "name" | "monthly_price_brl" | "validapay_price_id">>; selected: string; error?: string }): string {
  const errors: Record<string, string> = {
    missing_fields: "Preencha todos os campos.",
    bad_document: "CPF (11 dígitos) ou CNPJ (14 dígitos) inválido.",
    bad_plan: "Plano inválido.",
    plan_not_synced: "Esse plano ainda não está disponível pra checkout. Tente outro.",
    slug_taken: "Esse slug já existe. Escolha outro.",
  };
  const errMsg = args.error ? errors[args.error] ?? "Erro." : null;
  const usable = args.plans.filter((p) => !!p.validapay_price_id);

  // Friendly empty state when no plan has been synced to ValidaPay yet.
  if (!usable.length) {
    return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Em breve — Askine</title>
<style>${CSS}</style>
${NAV}
<main style="max-width:560px">
  <h1>🚧 Checkout em preparação</h1>
  <div class="card">
    <p>Os planos ainda estão sendo configurados no nosso provedor de pagamentos.</p>
    <p>Volta em alguns minutos ou manda email pra
       <a href="mailto:rafael@infosaas.co" style="color:#60a5fa">rafael@infosaas.co</a>
       e eu te coloco manualmente.</p>
  </div>
</main>${FOOTER}`;
  }

  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Começar — Askine</title>
<style>${CSS}</style>
${NAV}
<main style="max-width:560px">
  <h1>Começar</h1>
  <p class="sub">Trial de 14 dias. Após o trial, cobrança recorrente via PIX ou cartão.</p>
  <div class="card">
    ${errMsg ? `<div class="msg error">${esc(errMsg)}</div>` : ""}
    <form method="POST" action="/signup">
      <label>Nome da empresa / marca *</label>
      <input name="name" required placeholder="VMA Produtificação">
      <label>Slug (URL) *</label>
      <input name="slug" placeholder="vma — deixe em branco pra gerar do nome" pattern="[a-z0-9-]+">
      <label>Seu email *</label>
      <input name="email" type="email" required placeholder="voce@empresa.com.br">
      <label>CPF ou CNPJ *</label>
      <input name="document" required placeholder="000.000.000-00 ou 00.000.000/0001-00">
      <label>Plano *</label>
      <select name="plan" required>
        ${usable.map((p) => `<option value="${esc(p.id)}"${p.id === args.selected ? " selected" : ""}>${esc(p.name)} — R$ ${Number(p.monthly_price_brl).toFixed(2).replace(".", ",")}/mês</option>`).join("")}
      </select>
      <div style="margin-top:24px"><button type="submit">Ir pro checkout →</button></div>
    </form>
    <p style="font-size:12px;color:#94a3b8;margin-top:12px">Você será redirecionado pro ValidaPay pra finalizar o pagamento.</p>
  </div>
</main>${FOOTER}`;
}

function signupSuccessFallbackHtml(args: { tenant: { slug: string }; email: string }): string {
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Conta criada — Askine</title>
<style>${CSS}</style>
${NAV}
<main style="max-width:560px">
  <h1>✓ Conta criada</h1>
  <div class="card">
    <p>Seu tenant <code>${esc(args.tenant.slug)}</code> foi criado em modo trial.</p>
    <p>Não conseguimos abrir o checkout agora. Você pode fazer login no admin e tentar de novo de lá:</p>
    <p><a class="btn" href="/t/${esc(args.tenant.slug)}/admin/login">Entrar no admin</a></p>
    <p style="font-size:12px;color:#94a3b8;margin-top:16px">Login via magic link enviado pra <code>${esc(args.email)}</code>.</p>
  </div>
</main>${FOOTER}`;
}

// ----- Router --------------------------------------------------------------

export type PublicRouteMatch =
  | { type: "pricing" }
  | { type: "signup-get" }
  | { type: "signup-post" }
  | { type: "status" }
  | { type: "status-json" }
  | { type: "docs" }
  | { type: "enterprise-get" }
  | { type: "enterprise-post" }
  | { type: "privacy" }
  | { type: "terms" }
  | { type: "contact" }
  | { type: "about" }
  | { type: "logo-svg" }
  | { type: "favicon" }
  | { type: "og-image" }
  | { type: "home" };

export function matchPublicRoute(path: string, method: string): PublicRouteMatch | null {
  const p = path.split("?")[0];
  if (method === "GET"  && p === "/pricing") return { type: "pricing" };
  if (method === "GET"  && p === "/signup")  return { type: "signup-get" };
  if (method === "POST" && p === "/signup")  return { type: "signup-post" };
  if (method === "GET"  && p === "/status")  return { type: "status" };
  if (method === "GET"  && p === "/status.json") return { type: "status-json" };
  if (method === "GET"  && p === "/docs")    return { type: "docs" };
  if (method === "GET"  && p === "/enterprise") return { type: "enterprise-get" };
  if (method === "POST" && p === "/enterprise") return { type: "enterprise-post" };
  if (method === "GET"  && p === "/privacy")    return { type: "privacy" };
  if (method === "GET"  && p === "/terms")      return { type: "terms" };
  if (method === "GET"  && p === "/contact")    return { type: "contact" };
  if (method === "GET"  && p === "/about")      return { type: "about" };
  if (method === "GET"  && p === "/logo.svg")   return { type: "logo-svg" };
  if (method === "GET"  && p === "/favicon.ico") return { type: "favicon" };
  if (method === "GET"  && p === "/og-image.svg") return { type: "og-image" };
  if (method === "GET"  && (p === "/" || p === "")) return { type: "home" };
  return null;
}

export async function handlePublicRoute(
  match: PublicRouteMatch,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  switch (match.type) {
    case "pricing":     return pricingPage(req, res);
    case "signup-get":  return signupGet(req, res);
    case "signup-post": return signupPost(req, res);
    case "status":      return statusPage(req, res);
    case "status-json": return statusJsonPage(req, res);
    case "docs":        return docsPage(req, res);
    case "enterprise-get":  return enterpriseGet(req, res);
    case "enterprise-post": return enterprisePost(req, res);
    case "privacy":         return legalPage(res, "privacy");
    case "terms":           return legalPage(res, "terms");
    case "contact":         return legalPage(res, "contact");
    case "about":           return legalPage(res, "about");
    case "logo-svg":        return assetPage(res, LOGO_SVG, "image/svg+xml");
    case "favicon":         return assetPage(res, FAVICON_SVG, "image/svg+xml");
    case "og-image":        return assetPage(res, OG_IMAGE_SVG, "image/svg+xml");
    case "home":            return homePage(req, res);
  }
}

// ---------- Assets (Phase 6.2) ----------------------------------------

function assetPage(res: ServerResponse, body: string, contentType: string): void {
  res.setHeader("Cache-Control", "public, max-age=86400, immutable");
  res.writeHead(200, { "Content-Type": contentType });
  res.end(body);
}

// Minimal SVG logo — "A" mark with a blue→cyan gradient. Placeholder
// until you commission real branding. Renders at any size.
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#06b6d4"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="14" fill="url(#g)"/>
  <path d="M20 46 L32 18 L44 46 M25 38 L39 38" stroke="#f1f5f9" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const FAVICON_SVG = LOGO_SVG;

// 1200×630 Open Graph card — gradient background + Askine wordmark +
// tagline. Will render fine on social previews; replace with a real
// 1200×630 PNG once you have one.
const OG_IMAGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#1e293b"/>
    </linearGradient>
    <linearGradient id="mark" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#06b6d4"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <g transform="translate(120, 200)">
    <rect width="120" height="120" rx="26" fill="url(#mark)"/>
    <path d="M36 92 L60 28 L84 92 M44 76 L76 76" stroke="#f1f5f9" stroke-width="8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  <text x="280" y="280" font-family="system-ui, -apple-system, sans-serif" font-size="92" font-weight="700" fill="#f1f5f9">Askine</text>
  <text x="280" y="340" font-family="system-ui, -apple-system, sans-serif" font-size="32" fill="#94a3b8">Tutor agêntico via MCP para infoprodutores</text>
  <text x="120" y="540" font-family="system-ui, -apple-system, sans-serif" font-size="22" fill="#64748b">Claude.ai · ChatGPT · OpenAI Whisper · pgvector</text>
</svg>`;

// ---------- Home (Phase 6.2) ------------------------------------------

async function homePage(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  html(res, 200, homeHtml());
}

function homeHtml(): string {
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Askine — Tutor agêntico via MCP</title>
<meta name="description" content="Transforme cursos em vídeo em tutores agênticos. Aluno conversa com Claude.ai ou ChatGPT sobre o conteúdo do curso usando MCP.">
${OG_META(esc("Askine — Tutor agêntico via MCP"), "Transforme cursos em vídeo em tutores agênticos para Claude.ai e ChatGPT.")}
<style>${CSS}
  .hero { padding:64px 0 32px; text-align:center }
  .hero h1 { font-size:48px; margin-bottom:16px }
  .hero .grad { background:linear-gradient(135deg,#3b82f6,#06b6d4);-webkit-background-clip:text;background-clip:text;color:transparent }
  .hero p.sub { font-size:18px; max-width:640px; margin:0 auto 32px }
  .cta-row { display:flex; gap:12px; justify-content:center; flex-wrap:wrap }
  .secondary { background:#1e293b !important; border:1px solid #334155 }
  .features-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:16px; margin-top:48px }
  .feature { background:#1e293b; border:1px solid #334155; border-radius:12px; padding:24px }
  .feature h3 { margin:0 0 8px; color:#f1f5f9; font-size:18px }
  .feature p { font-size:14px; color:#94a3b8; margin:0 }
  .feature .icon { font-size:24px; margin-bottom:8px }
</style>
${NAV}
<main>
  <div class="hero">
    <h1>Seu curso virou um <span class="grad">tutor agêntico</span></h1>
    <p class="sub">Aluno conversa com Claude.ai ou ChatGPT sobre o conteúdo do curso. A IA responde com base nas aulas reais — citando o trecho exato e mostrando o vídeo no minuto certo.</p>
    <div class="cta-row">
      <a class="btn" href="/signup">Começar trial 14 dias</a>
      <a class="btn secondary" href="/docs">Ver como funciona</a>
    </div>
  </div>

  <div class="features-grid">
    <div class="feature">
      <div class="icon">🎓</div>
      <h3>Whisper transcreve</h3>
      <p>Cada aula vira texto. Não precisa fornecer transcrição.</p>
    </div>
    <div class="feature">
      <div class="icon">🔎</div>
      <h3>Busca semântica</h3>
      <p>pgvector + embeddings. Aluno pergunta, IA acha o trecho certo.</p>
    </div>
    <div class="feature">
      <div class="icon">▶️</div>
      <h3>Vídeo no chat</h3>
      <p>Tool play_lesson mostra o vídeo da aula no Claude.ai começando no minuto exato.</p>
    </div>
    <div class="feature">
      <div class="icon">🛒</div>
      <h3>Webhook Hotmart</h3>
      <p>Vendeu, liberou. Aluno logga com o email da compra.</p>
    </div>
    <div class="feature">
      <div class="icon">🔐</div>
      <h3>OAuth + LGPD</h3>
      <p>OAuth 2.1 + PKCE. Secrets criptografados em repouso. LGPD-aware.</p>
    </div>
    <div class="feature">
      <div class="icon">📊</div>
      <h3>Insights por curso</h3>
      <p>Sabe quais aulas o aluno toca mais, o que ele pergunta, onde para.</p>
    </div>
  </div>

  <h2 style="text-align:center;margin-top:64px">Aluno conecta uma vez. Vê todos os cursos.</h2>
  <p style="text-align:center;color:#94a3b8;max-width:680px;margin:0 auto 32px">Conector global no Claude.ai e ChatGPT. Aluno entra com email da compra, vê todos os cursos que comprou — não importa de qual infoprodutor.</p>
  <div style="text-align:center;margin-bottom:64px">
    <a class="btn" href="/pricing">Ver planos</a>
  </div>
</main>${FOOTER}`;
}

function OG_META(title: string, description: string): string {
  return `
  <link rel="icon" type="image/svg+xml" href="/logo.svg">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:image" content="/og-image.svg">
  <meta property="og:type" content="website">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${description}">
  <meta name="twitter:image" content="/og-image.svg">`;
}

// ---------- Legal + about + contact (Phase 6.1) ----------------------

function legalPage(res: ServerResponse, kind: "privacy" | "terms" | "contact" | "about"): void {
  const body = kind === "privacy" ? privacyHtml()
             : kind === "terms"   ? termsHtml()
             : kind === "contact" ? contactHtml()
             : aboutHtml();
  const title = kind === "privacy" ? "Política de Privacidade"
              : kind === "terms"   ? "Termos de Uso"
              : kind === "contact" ? "Contato"
              : "Sobre a Askine";
  html(res, 200, `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>${esc(title)} — Askine</title>
<style>${CSS}
  article { max-width:760px; margin:0 auto; line-height:1.7; color:#cbd5e1 }
  article h2 { margin-top:32px; font-size:20px; color:#f1f5f9 }
  article h3 { margin-top:20px; font-size:16px; color:#e2e8f0 }
  article p, article ul { font-size:15px }
  article ul { padding-left:24px }
  article li { margin:6px 0 }
  article code { color:#a5f3fc }
  .meta { color:#64748b; font-size:13px; border-top:1px solid #334155; margin-top:48px; padding-top:16px }
  .contact-card { background:#1e293b; border:1px solid #334155; border-radius:12px; padding:28px; margin:24px 0 }
  .contact-card a { color:#3b82f6; text-decoration:none }
  .contact-card a:hover { text-decoration:underline }
</style>
${NAV}
<main>
  <article>
    <h1>${esc(title)}</h1>
    ${body}
    <div class="meta">
      Última atualização: 09 de junho de 2026 · Askine, marca operada por <strong>Propps Media</strong> (CNPJ 35.735.278/0001-91).
    </div>
  </article>
</main>${FOOTER}`);
}

function privacyHtml(): string {
  return `
    <p>Esta política descreve como a Askine, marca operada pela Propps Media (CNPJ 35.735.278/0001-91), coleta, usa e protege dados pessoais. Estamos em conformidade com a Lei Geral de Proteção de Dados (LGPD — Lei 13.709/2018).</p>

    <h2>1. Dados coletados</h2>
    <h3>1.1 Do infoprodutor (cliente pagante)</h3>
    <ul>
      <li>Nome, email de contato, CPF ou CNPJ — pra emissão de NF e cobrança via ValidaPay</li>
      <li>Slug e nome do produto, planos contratados</li>
      <li>Credenciais de integração (Hottok Hotmart, API key Panda Video) — armazenadas criptografadas com AES-256-GCM</li>
      <li>Logs de operação do painel administrativo</li>
    </ul>

    <h3>1.2 Do aluno (consumidor final)</h3>
    <ul>
      <li>Email — usado como identidade única para login OAuth no MCP</li>
      <li>Nome (quando fornecido pelo infoprodutor via importação ou pelo Hotmart no webhook)</li>
      <li>Registros de interação: quais cursos acessou, quais aulas tocou, em que minuto parou</li>
      <li>Histórico de chamadas a tools para fins de rate limiting e analytics agregados</li>
    </ul>

    <h2>2. Como usamos</h2>
    <ul>
      <li><strong>Autenticação:</strong> validar que o email do aluno tem direito a acessar o curso comprado</li>
      <li><strong>Funcionamento do tutor:</strong> servir transcrições, embeddings e vídeo player</li>
      <li><strong>Métricas:</strong> mostrar ao infoprodutor quem está engajado, quais aulas são mais buscadas</li>
      <li><strong>Cobrança:</strong> processar assinaturas via ValidaPay e emitir NF quando aplicável</li>
      <li><strong>Comunicação operacional:</strong> magic links de login, notificações de pagamento, alertas críticos</li>
    </ul>

    <h2>3. Compartilhamento com terceiros</h2>
    <p>Não vendemos dados. Compartilhamos com processadores quando necessário pra operar o serviço:</p>
    <ul>
      <li><strong>Supabase</strong> (Postgres + Storage) — armazenamento dos dados</li>
      <li><strong>OpenAI</strong> — transcrição via Whisper + geração de embeddings (conteúdo das aulas e queries de busca)</li>
      <li><strong>Panda Video</strong> — leitura dos vídeos do infoprodutor para download/HLS</li>
      <li><strong>Resend</strong> — entrega de emails transacionais</li>
      <li><strong>ValidaPay</strong> — processamento de pagamentos do infoprodutor</li>
      <li><strong>Hotmart</strong> — webhook de compras (somente quando o infoprodutor configura)</li>
      <li><strong>Anthropic e OpenAI</strong> — quando o aluno conversa com Claude ou ChatGPT, o conteúdo da conversa passa por essas plataformas (sob suas próprias políticas)</li>
    </ul>

    <h2>4. Retenção</h2>
    <ul>
      <li>Dados de aluno: retidos enquanto a conta do infoprodutor estiver ativa + 6 meses após cancelamento</li>
      <li>Logs de pagamento: 5 anos (obrigação fiscal brasileira)</li>
      <li>Logs de tool calls: 90 dias agregados; logs brutos 30 dias</li>
    </ul>

    <h2>5. Seus direitos (LGPD Art. 18)</h2>
    <p>Você pode solicitar a qualquer momento:</p>
    <ul>
      <li>Confirmação da existência de tratamento</li>
      <li>Acesso aos dados</li>
      <li>Correção de dados incompletos, inexatos ou desatualizados</li>
      <li>Anonimização, bloqueio ou eliminação de dados desnecessários ou tratados em desconformidade</li>
      <li>Portabilidade dos dados</li>
      <li>Eliminação dos dados (com ressalvas legais)</li>
      <li>Informação sobre compartilhamento</li>
      <li>Revogação do consentimento</li>
    </ul>
    <p>Envie a solicitação para <a href="/contact" style="color:#3b82f6">nosso canal de contato</a>. Respondemos em até 15 dias.</p>

    <h2>6. Segurança</h2>
    <ul>
      <li>Comunicação por HTTPS em todos os endpoints públicos</li>
      <li>Credenciais sensíveis criptografadas em repouso (AES-256-GCM)</li>
      <li>OAuth 2.1 com PKCE S256 obrigatório para acesso ao MCP</li>
      <li>Sessões assinadas com HMAC-SHA256; chaves rotacionáveis</li>
      <li>Backup diário automatizado (Supabase PITR de 7 dias)</li>
    </ul>

    <h2>7. Encarregado de Dados (DPO)</h2>
    <p>Rafael Almeida Souza — <code>rafael@infosaas.co</code>. Para solicitações formais LGPD, use <a href="/contact" style="color:#3b82f6">/contact</a>.</p>

    <h2>8. Alterações nesta política</h2>
    <p>Mudanças materiais serão comunicadas com 30 dias de antecedência ao email cadastrado de cada infoprodutor. A data de última atualização aparece no rodapé.</p>
  `;
}

function termsHtml(): string {
  return `
    <p>Estes termos regem o uso da plataforma <strong>Askine</strong>, marca operada pela <strong>Propps Media Ltda</strong> (CNPJ 35.735.278/0001-91). Ao criar uma conta ou usar o serviço, você concorda com estes termos.</p>

    <h2>1. Definições</h2>
    <ul>
      <li><strong>Plataforma:</strong> os serviços técnicos da Askine (painel administrativo, MCP server, processamento de transcrições, busca semântica)</li>
      <li><strong>Infoprodutor:</strong> pessoa física ou jurídica que contrata um plano para servir seu curso através da Askine</li>
      <li><strong>Aluno:</strong> consumidor final que comprou um curso do infoprodutor e acessa o tutor via Claude.ai ou ChatGPT</li>
      <li><strong>Conteúdo:</strong> vídeos, transcrições, materiais e quaisquer ativos que o infoprodutor sirva pela plataforma</li>
    </ul>

    <h2>2. Contas e cadastro</h2>
    <ul>
      <li>Você precisa ter pelo menos 18 anos ou ser representante de uma pessoa jurídica capaz</li>
      <li>Os dados de cadastro (email, CPF/CNPJ) devem ser verdadeiros e atualizados</li>
      <li>Você é responsável por manter sigilo das credenciais de acesso</li>
    </ul>

    <h2>3. Planos e pagamento</h2>
    <ul>
      <li>Os planos estão descritos em <a href="/pricing" style="color:#3b82f6">/pricing</a>. As cotas (cursos, horas Whisper, alunos, KB) são por plano e renovam mensalmente</li>
      <li>Cobrança mensal via ValidaPay. Inadimplência suspende o serviço em D+0 (sem período de carência)</li>
      <li>Reativação automática no próximo pagamento bem-sucedido</li>
      <li>Cancelamento a qualquer momento no painel administrativo. Sem multa rescisória</li>
      <li>Reembolso em até 7 dias do primeiro pagamento (CDC Art. 49)</li>
    </ul>

    <h2>4. Conteúdo do infoprodutor</h2>
    <ul>
      <li>Todo conteúdo (vídeos, transcrições, materiais) é e permanece de propriedade do infoprodutor</li>
      <li>Você concede à Askine licença não exclusiva pra processar o conteúdo (transcrever, indexar, servir aos seus alunos) enquanto a conta estiver ativa</li>
      <li>Você é responsável por ter direitos autorais sobre o conteúdo carregado</li>
      <li>Conteúdo ilegal, fraudulento ou que viole direitos de terceiros é proibido. Reservamos o direito de suspender contas em violação</li>
    </ul>

    <h2>5. Uso aceitável</h2>
    <p>Está proibido:</p>
    <ul>
      <li>Tentar acessar dados de outros tenants ou alunos</li>
      <li>Engenharia reversa, scraping em massa ou tentativa de bypass de cotas</li>
      <li>Distribuição de malware, spam ou phishing</li>
      <li>Uso pra atividades ilegais sob legislação brasileira</li>
    </ul>

    <h2>6. Disponibilidade e SLA</h2>
    <ul>
      <li>Buscamos disponibilidade ≥ 99,5% em horário comercial. Não garantimos uptime contínuo para planos abaixo de Enterprise</li>
      <li>Manutenções programadas comunicadas com 48h de antecedência</li>
      <li>Plano Enterprise tem SLA negociado em contrato dedicado (≥ 99,9%)</li>
      <li>Política de DR documentada em <a href="https://github.com/propps-projects/mcp-agentclass/blob/main/docs/DR_PLAN.md" style="color:#3b82f6">DR_PLAN.md</a></li>
    </ul>

    <h2>7. Limitação de responsabilidade</h2>
    <p>A Askine fornece um serviço técnico de orquestração. Não somos responsáveis por:</p>
    <ul>
      <li>Conteúdo educacional do infoprodutor (correção, atualidade, qualidade)</li>
      <li>Relação comercial entre infoprodutor e aluno (vendas, reembolsos, suporte ao aluno)</li>
      <li>Falhas em serviços de terceiros (Supabase, OpenAI, Panda, Resend, ValidaPay, Hotmart, Claude.ai, ChatGPT)</li>
      <li>Lucros cessantes ou danos indiretos decorrentes do uso</li>
    </ul>
    <p>Nossa responsabilidade total agregada está limitada ao valor pago nos últimos 12 meses pelo serviço.</p>

    <h2>8. Privacidade</h2>
    <p>Tratamento de dados pessoais conforme nossa <a href="/privacy" style="color:#3b82f6">Política de Privacidade</a>. Em caso de conflito entre estes termos e a política de privacidade, prevalece a política de privacidade pra questões de dados pessoais.</p>

    <h2>9. Alterações</h2>
    <p>Podemos atualizar estes termos. Mudanças materiais são comunicadas com 30 dias de antecedência ao email cadastrado. Continuar usando o serviço após o prazo significa aceitar a nova versão.</p>

    <h2>10. Lei aplicável e foro</h2>
    <p>Estes termos são regidos pela legislação brasileira. Fica eleito o foro da Comarca onde a Propps Media tem sede, com renúncia a qualquer outro, exceto se a legislação consumerista determinar foro do consumidor.</p>
  `;
}

function contactHtml(): string {
  return `
    <p>Pra falar com a gente, escolha o canal que faz mais sentido:</p>

    <div class="contact-card">
      <h3 style="margin-top:0">📧 Suporte geral</h3>
      <p>Dúvidas sobre uso da plataforma, integrações, problemas técnicos.</p>
      <p><a href="mailto:rafael@infosaas.co">rafael@infosaas.co</a></p>
      <p style="color:#94a3b8;font-size:13px">Respondo em até 1 dia útil.</p>
    </div>

    <div class="contact-card">
      <h3 style="margin-top:0">💼 Vendas / Enterprise</h3>
      <p>Volume alto, SLA negociado, integrações próprias, contrato dedicado.</p>
      <p><a href="/enterprise">Formulário Enterprise</a> · <a href="mailto:rafael@infosaas.co">rafael@infosaas.co</a></p>
    </div>

    <div class="contact-card">
      <h3 style="margin-top:0">🔒 Privacidade / LGPD</h3>
      <p>Solicitações de acesso, correção, exclusão de dados pessoais. Encarregado de Dados (DPO): Rafael Almeida Souza.</p>
      <p><a href="mailto:rafael@infosaas.co?subject=LGPD%20%E2%80%94%20Solicita%C3%A7%C3%A3o">rafael@infosaas.co</a> (assunto: "LGPD")</p>
      <p style="color:#94a3b8;font-size:13px">Atendimento conforme Art. 18 da LGPD em até 15 dias.</p>
    </div>

    <div class="contact-card">
      <h3 style="margin-top:0">🚨 Incidentes de segurança</h3>
      <p>Vulnerabilidade encontrada, vazamento de dados, suspeita de fraude.</p>
      <p><a href="mailto:rafael@infosaas.co?subject=Security">rafael@infosaas.co</a> (assunto: "Security")</p>
      <p style="color:#94a3b8;font-size:13px">Prioridade máxima. Damos retorno em até 24h.</p>
    </div>

    <h2>Empresa</h2>
    <p>
      <strong>Propps Media Ltda</strong><br>
      CNPJ: 35.735.278/0001-91<br>
      Marca: <strong>Askine</strong>
    </p>
  `;
}

function aboutHtml(): string {
  return `
    <h2>O que fazemos</h2>
    <p>Transformamos cursos em vídeo em <strong>tutores agênticos</strong>. O aluno conversa com Claude.ai ou ChatGPT sobre o conteúdo do curso, e a IA responde com base nas aulas reais — citando o trecho exato e mostrando o vídeo no minuto certo.</p>

    <h2>Para quem</h2>
    <p>Infoprodutores brasileiros que vendem cursos pelo Hotmart, hospedam vídeos no Panda Video e querem entregar uma experiência educacional ativa em vez de "vídeo + PDF".</p>

    <h2>Como funciona em uma frase</h2>
    <p>O infoprodutor configura o curso uma vez. A gente transcreve via Whisper, indexa com embeddings vetoriais (pgvector), expõe via Model Context Protocol. O aluno adiciona um conector no Claude.ai ou ChatGPT, autentica com o email da compra, e ganha acesso a um tutor 24/7 ancorado no conteúdo daquele curso específico.</p>

    <h2>Decisões deliberadas</h2>
    <ul>
      <li><strong>MCP global, não por infoprodutor.</strong> Um aluno que compra de vários infoprodutores adiciona um conector só</li>
      <li><strong>Whisper como única fonte de transcrição.</strong> Qualidade consistente; cobrança previsível</li>
      <li><strong>Sem período de carência.</strong> Assinatura vence no dia, sem 7d de tolerância — modelo claro</li>
      <li><strong>OAuth 2.1 + magic link.</strong> Sem senha; sem conta separada; quem comprou no Hotmart entra</li>
      <li><strong>Multi-tenant desde o dia 1.</strong> Cada infoprodutor é isolado; mesmo schema, hardening via filtros</li>
    </ul>

    <h2>Stack</h2>
    <ul>
      <li>TypeScript + Node 24 (sem build step — tsx direto)</li>
      <li>Supabase Postgres 17 + pgvector HNSW + pg_cron + Storage</li>
      <li>PostgREST como camada runtime de DB</li>
      <li>OpenAI Whisper + text-embedding-3-small</li>
      <li>Resend (transactional), ValidaPay (billing), Hotmart (webhooks de venda)</li>
      <li>EasyPanel auto-deploy a partir do GitHub</li>
    </ul>

    <h2>Quem mantém</h2>
    <p><a href="https://www.linkedin.com/in/rafaelalmeidasouza" style="color:#3b82f6" rel="nofollow">Rafael Almeida Souza</a>, fundador da <strong>Propps Media</strong> (CNPJ 35.735.278/0001-91). Brasileiro, engenheiro solo, técnico em todas as camadas.</p>

    <h2>Onde estamos</h2>
    <ul>
      <li><a href="/pricing" style="color:#3b82f6">Pricing</a></li>
      <li><a href="/docs" style="color:#3b82f6">Documentação</a></li>
      <li><a href="/status" style="color:#3b82f6">Status</a></li>
      <li><a href="/contact" style="color:#3b82f6">Contato</a></li>
    </ul>
  `;
}

// ---------- Enterprise lead capture (Phase 5.6.d) ----------------------

async function enterpriseGet(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const q = new URL(req.url ?? "/", "http://x").searchParams;
  html(res, 200, enterpriseHtml({ sent: q.get("sent") === "1", error: q.get("error") ?? undefined }));
}

async function enterprisePost(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body = "";
  for await (const c of req) body += c;
  const form = new URLSearchParams(body);
  const name = (form.get("name") ?? "").trim();
  const email = (form.get("email") ?? "").trim().toLowerCase();
  const company = (form.get("company") ?? "").trim();
  const volume = (form.get("volume") ?? "").trim();
  const message = (form.get("message") ?? "").trim();

  if (!name || !email || !email.includes("@") || !company) {
    return redirect(res, "/enterprise?error=missing_fields");
  }

  // Send via Resend to the sales inbox. We don't store lead data in the
  // DB yet — Phase 6 may add a `leads` table; for now an email + Slack
  // (if wired) is enough not to lose anyone.
  const SALES_INBOX = process.env.SALES_INBOX || "rafael@infosaas.co";
  const from = process.env.RESEND_FROM || "Askine <login@update.infosaas.co>";
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("[enterprise] RESEND_API_KEY unset — lead lost:", { name, email, company });
    return redirect(res, "/enterprise?error=send_failed");
  }

  const subject = `[Lead Enterprise] ${company} (${name})`;
  const html_body = `
<p>Novo lead via /enterprise:</p>
<ul>
  <li><strong>Nome:</strong> ${esc(name)}</li>
  <li><strong>Email:</strong> ${esc(email)}</li>
  <li><strong>Empresa:</strong> ${esc(company)}</li>
  <li><strong>Volume estimado:</strong> ${esc(volume || "(não informado)")}</li>
</ul>
<p><strong>Mensagem:</strong></p>
<p>${esc(message || "(sem mensagem)").replace(/\n/g, "<br>")}</p>
`;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from, to: SALES_INBOX, subject, html: html_body, reply_to: email,
      }),
    });
    if (!r.ok) {
      console.error("[enterprise] Resend send failed:", r.status, await r.text().catch(() => ""));
      return redirect(res, "/enterprise?error=send_failed");
    }
  } catch (err) {
    console.error("[enterprise] Resend send threw:", err);
    return redirect(res, "/enterprise?error=send_failed");
  }
  redirect(res, "/enterprise?sent=1");
}

function enterpriseHtml(args: { sent: boolean; error?: string }): string {
  const errors: Record<string, string> = {
    missing_fields: "Preencha nome, email e empresa.",
    send_failed: "Não foi possível enviar agora. Tenta de novo ou manda direto para rafael@infosaas.co.",
  };
  const errMsg = args.error ? errors[args.error] ?? "Erro." : null;
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Enterprise — Askine</title>
<style>${CSS}
  .hero { background:#1e293b; border-radius:16px; padding:32px; margin-bottom:24px; border:1px solid #334155 }
  .hero h1 { margin:0 0 8px }
  .hero p { color:#94a3b8; font-size:16px; line-height:1.6 }
  .perks { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:12px; margin:20px 0 32px }
  .perk { background:#1e293b; border:1px solid #334155; border-radius:10px; padding:16px 18px }
  .perk strong { color:#f1f5f9; display:block; margin-bottom:4px }
  .perk small { color:#94a3b8; font-size:13px; line-height:1.5 }
  textarea { width:100%; padding:10px; border:1px solid #475569; border-radius:8px; background:#0f172a; color:#e2e8f0; font-family:inherit; font-size:14px; resize:vertical }
</style>
${NAV}
<main>
  <div class="hero">
    <h1>Plano Enterprise</h1>
    <p>Pra produtores com volume alto, integrações próprias, SLA negociado e suporte direto. Fale com a gente e a gente desenha um plano que faz sentido.</p>
  </div>

  <div class="perks">
    <div class="perk"><strong>Cursos ilimitados</strong><small>Sem teto. Tu cria, tu sobe, tu cobra.</small></div>
    <div class="perk"><strong>Whisper ilimitado</strong><small>Sem cota por mês. Reprocessa quantas vezes quiser.</small></div>
    <div class="perk"><strong>Alunos ilimitados</strong><small>Volume não impede crescimento.</small></div>
    <div class="perk"><strong>SLA + on-call</strong><small>RTO ≤ 1h. Suporte direto comigo via WhatsApp/Slack.</small></div>
    <div class="perk"><strong>Branding custom</strong><small>Conector com tua URL e logo (askine.com → courses.teunome.com).</small></div>
    <div class="perk"><strong>DPA + LGPD</strong><small>Contrato de processamento de dados pra integrar com o jurídico.</small></div>
  </div>

  <h2>Fale com vendas</h2>
  ${args.sent ? '<div class="msg success">Recebemos. Eu respondo em até 1 dia útil.</div>' : ""}
  ${errMsg ? `<div class="msg error">${esc(errMsg)}</div>` : ""}
  <form method="POST" action="/enterprise" class="card">
    <label>Seu nome *</label>
    <input name="name" required>
    <label>Email *</label>
    <input name="email" type="email" required>
    <label>Empresa *</label>
    <input name="company" required>
    <label>Volume estimado</label>
    <select name="volume">
      <option value="">— selecione —</option>
      <option value="<5k_alunos">Até 5.000 alunos ativos</option>
      <option value="5k_20k">5.000 – 20.000</option>
      <option value="20k+">Mais de 20.000</option>
    </select>
    <label>Conta um pouco do contexto (opcional)</label>
    <textarea name="message" rows="4" placeholder="Quantos cursos, qual plataforma de vídeo, integrações desejadas..."></textarea>
    <div style="margin-top:20px"><button type="submit">Enviar</button></div>
  </form>
</main>${FOOTER}`;
}

// ---------- Docs page (Phase 5.6.c) -----------------------------------

async function docsPage(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const base = (process.env.PUBLIC_URL ?? "http://localhost:3333").replace(/\/+$/, "");
  html(res, 200, docsHtml(base));
}

function docsHtml(base: string): string {
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Docs — Askine</title>
<style>${CSS}
  .toc { background:#1e293b; border-radius:12px; padding:20px 28px; margin-bottom:32px; border:1px solid #334155 }
  .toc h3 { margin:0 0 12px; font-size:14px; color:#94a3b8; text-transform:uppercase; letter-spacing:1px }
  .toc ul { list-style:none; padding:0; margin:0 }
  .toc li { padding:4px 0; font-size:14px }
  .toc a { color:#e2e8f0; text-decoration:none }
  .toc a:hover { color:#3b82f6 }
  section { margin-bottom:48px }
  section h2 { border-bottom:1px solid #334155; padding-bottom:8px }
  pre { background:#0f172a; border:1px solid #334155; border-radius:8px; padding:14px 18px; overflow-x:auto; font-size:13px; color:#e2e8f0 }
  code { background:#0f172a; padding:2px 6px; border-radius:4px; font-size:13px; color:#a5f3fc }
  .tool { background:#1e293b; border:1px solid #334155; border-radius:10px; padding:18px 20px; margin-bottom:12px }
  .tool h3 { margin:0 0 4px; color:#f1f5f9; font-size:16px }
  .tool .sig { color:#94a3b8; font-size:13px; font-family:monospace; margin-bottom:8px }
  .tool p { font-size:14px; margin:6px 0; color:#cbd5e1 }
  .pill { display:inline-block; padding:2px 8px; border-radius:10px; background:#334155; color:#94a3b8; font-size:11px; margin-left:6px }
  .pill.required { background:#1e3a8a; color:#bfdbfe }
  ol li { margin:6px 0; line-height:1.6 }
  .callout { background:#0f172a; border-left:4px solid #3b82f6; padding:14px 18px; border-radius:6px; margin:16px 0; font-size:14px; color:#cbd5e1 }
</style>
${NAV}
<main>
  <h1>Documentação</h1>
  <p class="sub">Tudo o que você precisa pra integrar seu curso à Askine.</p>

  <div class="toc">
    <h3>Sumário</h3>
    <ul>
      <li><a href="#what">1. O que é a Askine</a></li>
      <li><a href="#onboarding">2. Onboarding do infoprodutor</a></li>
      <li><a href="#student">3. Como o aluno se conecta</a></li>
      <li><a href="#oauth">4. OAuth 2.1 + magic link</a></li>
      <li><a href="#tools">5. Catálogo de tools MCP</a></li>
      <li><a href="#webhooks">6. Webhooks</a></li>
      <li><a href="#limits">7. Rate limits e cotas</a></li>
    </ul>
  </div>

  <section id="what">
    <h2>1. O que é a Askine</h2>
    <p>Askine transforma teu curso em vídeo num <strong>tutor agêntico</strong> que vive dentro do Claude.ai e do ChatGPT. O aluno conversa naturalmente sobre o conteúdo do curso — pergunta, pede explicação, pede pra ver um trecho específico — e a IA responde com base nas aulas reais (transcritas com OpenAI Whisper) e mostra o vídeo no ponto certo.</p>
    <p>Tu vende pelo Hotmart normalmente. A Askine ouve o webhook de compra e libera acesso ao tutor.</p>
  </section>

  <section id="onboarding">
    <h2>2. Onboarding do infoprodutor</h2>
    <ol>
      <li><strong>Cadastro:</strong> <code>${esc(base)}/signup</code>. Você cria a conta com nome do produto, slug (vira parte da URL), email de contato, CPF/CNPJ.</li>
      <li><strong>Plano + pagamento:</strong> ValidaPay processa o checkout. Trial de 14 dias.</li>
      <li><strong>Integrar Panda Video:</strong> em <code>/t/{seu-slug}/admin/integrations</code>, cola a API key do Panda (vídeos das aulas ficam no Panda; nós só consumimos via API).</li>
      <li><strong>Integrar Hotmart:</strong> mesma página, gera ou cola o Hottok. Configura o webhook em "Configurações → Postback URL" no Painel do Produtor pra <code>${esc(base)}/webhooks/hotmart/{seu-slug}</code>.</li>
      <li><strong>Criar curso:</strong> <code>/t/{seu-slug}/admin/courses</code>. Aponta pra uma pasta do Panda + IDs de produto Hotmart associados.</li>
      <li><strong>Iniciar ingest:</strong> botão "Iniciar ingest Panda + Whisper". A gente baixa cada vídeo da pasta, transcreve via Whisper, gera embeddings, indexa.</li>
      <li><strong>Importar alunos existentes</strong> (opcional): se você já vendia antes, cola o CSV em <code>/t/{seu-slug}/admin/students/import</code>.</li>
    </ol>
  </section>

  <section id="student">
    <h2>3. Como o aluno se conecta</h2>
    <p>O aluno só precisa do email com que comprou no Hotmart.</p>
    <ol>
      <li>No Claude.ai: <strong>Settings → Connectors → Add custom connector</strong>. URL: <code>${esc(base)}/mcp</code>. (No ChatGPT, usar <code>${esc(base)}/mcp-gpt</code>.)</li>
      <li>O cliente MCP abre uma janela de login. O aluno digita o email.</li>
      <li>Mandamos um magic link pelo email. Aluno clica.</li>
      <li>Conectado. Todos os cursos comprados — em qualquer infoprodutor da plataforma — aparecem no <code>list_courses</code>.</li>
    </ol>
    <div class="callout">
      <strong>Importante:</strong> a conexão é <em>global</em>, não por infoprodutor. Um aluno que compra de você e de outro produtor vê os dois cursos no mesmo conector. Cada um se autoriza pela compra no Hotmart, não pela URL.
    </div>
  </section>

  <section id="oauth">
    <h2>4. OAuth 2.1 + magic link</h2>
    <p>Implementação RFC-compliant pra rodar em Claude.ai e ChatGPT sem configuração adicional.</p>
    <ul style="list-style:none;padding:0;font-size:14px;color:#cbd5e1;line-height:1.8">
      <li>Discovery (RFC 8414): <code>${esc(base)}/.well-known/oauth-authorization-server</code></li>
      <li>PRM (RFC 9728): <code>${esc(base)}/.well-known/oauth-protected-resource</code></li>
      <li>DCR (RFC 7591): <code>POST ${esc(base)}/oauth/register</code></li>
      <li>Authorize: <code>${esc(base)}/oauth/authorize</code> (PKCE S256 obrigatório)</li>
      <li>Token: <code>POST ${esc(base)}/oauth/token</code></li>
      <li>Revoke: <code>POST ${esc(base)}/oauth/revoke</code></li>
    </ul>
    <p>Identidade do aluno = email. Tokens carregam o <code>mcp_user_id</code> (uma identidade global por email); o servidor resolve quais cursos o aluno acessa juntando <code>mcp_users → students → course_access</code> em todos os tenants.</p>
  </section>

  <section id="tools">
    <h2>5. Catálogo de tools MCP</h2>
    <p>Tools disponíveis depois do aluno autenticar:</p>

    <div class="tool">
      <h3>list_courses</h3>
      <div class="sig">() → { courses: Course[] }</div>
      <p>Lista todos os cursos que o aluno tem acesso. Cada item traz <code>courseId</code> (UUID), <code>name</code>, <code>displayName</code> formatado como "Infoprodutor — Curso". <strong>Sempre use isto antes</strong> de outras tools pra pegar o <code>courseId</code> certo.</p>
    </div>

    <div class="tool">
      <h3>list_lessons</h3>
      <div class="sig">({ courseId }) → { lessons: Lesson[] }</div>
      <p>Lista as aulas do curso, com número, título, duração.</p>
    </div>

    <div class="tool">
      <h3>get_lesson</h3>
      <div class="sig">({ courseId, lessonNumber | lessonId }) → { lesson, transcript? }</div>
      <p>Retorna detalhes de uma aula específica, opcionalmente com transcript completo.</p>
    </div>

    <div class="tool">
      <h3>search_course</h3>
      <div class="sig">({ courseId, query, limit?, lessonNumber? }) → { results: Chunk[] }</div>
      <p>Busca semântica nos transcripts (pgvector + embeddings). Use pra responder perguntas do aluno com trechos reais.</p>
    </div>

    <div class="tool">
      <h3>play_lesson</h3>
      <div class="sig">({ courseId, lessonNumber | lessonId, startSec? }) → { video, transcript }</div>
      <p>Tool com widget. Mostra o vídeo da aula no chat, opcionalmente começando num timestamp específico.</p>
    </div>

    <div class="tool">
      <h3>excerpt_transcript</h3>
      <div class="sig">({ courseId, lessonNumber | lessonId, startSec, endSec }) → { excerpt }</div>
      <p>Retorna o trecho do transcript entre dois timestamps. Use pra citar exatamente o que o professor falou.</p>
    </div>

    <div class="tool">
      <h3>get_my_progress</h3>
      <div class="sig">({ courseId }) → { lessons, completionPct }</div>
      <p>Mostra ao aluno o que ele já tocou no chat, em qual minuto parou, e % de avanço.</p>
    </div>
  </section>

  <section id="webhooks">
    <h2>6. Webhooks</h2>
    <h3>Hotmart (por tenant)</h3>
    <p>URL: <code>${esc(base)}/webhooks/hotmart/{seu-slug}</code></p>
    <p>Configure no Painel do Produtor → Configurações → Postback URL. Coloca o Hottok que você gerou no <code>/admin/integrations</code>. Eventos tratados: <code>PURCHASE_APPROVED</code>, <code>PURCHASE_REFUNDED</code>, <code>PURCHASE_CHARGEBACK</code>.</p>

    <h3>ValidaPay (global)</h3>
    <p>Você não configura — já é gerenciado pela plataforma. Eventos de assinatura ativam/pausam tua conta automaticamente.</p>
  </section>

  <section id="limits">
    <h2>7. Rate limits e cotas</h2>
    <ul style="font-size:14px;color:#cbd5e1;line-height:1.8">
      <li><strong>Rate limit por aluno:</strong> 200 chamadas/h em tools normais, 60/h em <code>search_course</code> (embedder é caro). Limite por aluno × tool, janela horária.</li>
      <li><strong>Cota por plano:</strong> número de cursos, horas Whisper/mês, alunos ativos, KB. Consulta em <a href="/pricing" style="color:#3b82f6">/pricing</a>.</li>
      <li><strong>Excesso de cota:</strong> tools retornam erro friendly em pt-BR. Admin vê banner pra subir de plano.</li>
    </ul>
  </section>

</main>${FOOTER}`;
}

// ---------- Status page (Phase 5.6.a) ---------------------------------

interface CheckResult {
  service: string;
  status: "up" | "degraded" | "down" | "skipped";
  latencyMs?: number;
  error?: string;
}

let statusCache: { results: CheckResult[]; expires: number } | null = null;
const STATUS_CACHE_MS = 30_000;

async function check(service: string, fn: () => Promise<void>, timeoutMs = 5000): Promise<CheckResult> {
  const t0 = Date.now();
  try {
    await Promise.race([
      fn(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timeout ${timeoutMs}ms`)), timeoutMs)),
    ]);
    return { service, status: "up", latencyMs: Date.now() - t0 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status: CheckResult["status"] = msg.includes("timeout") ? "degraded" : "down";
    return { service, status, latencyMs: Date.now() - t0, error: msg };
  }
}

async function runChecks(): Promise<CheckResult[]> {
  if (statusCache && statusCache.expires > Date.now()) return statusCache.results;

  const { sb } = await import("./lib/db-api.ts");
  const results = await Promise.all([
    check("Database (Supabase)", async () => {
      await sb.selectOne("tenants", "limit=1&select=id");
    }),
    check("Email (Resend)", async () => {
      if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY not configured");
      // Resend keys are commonly restricted (send-only), so a probe
      // against /domains or /api-keys returns 401 even with a valid
      // production key. Hitting root / does an unauthenticated
      // reachability check — 200 = service alive.
      const r = await fetch("https://api.resend.com/");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    }),
    check("AI (OpenAI Whisper)", async () => {
      if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");
      // Same reachability strategy as Resend. /v1/models requires auth
      // and we don't want every status hit to bill the org or expose
      // the key prefix in case the request logs upstream.
      const r = await fetch("https://api.openai.com/");
      if (r.status >= 500) throw new Error(`HTTP ${r.status}`);
    }),
    check("MCP server", async () => {
      // Self-loop: the fact that this handler runs proves it's up. The
      // explicit check is a noop that always passes; it shows green on
      // the page rather than omitting the row.
    }),
  ]);
  statusCache = { results, expires: Date.now() + STATUS_CACHE_MS };
  return results;
}

function overallStatus(results: CheckResult[]): { label: string; color: string } {
  if (results.some((r) => r.status === "down")) return { label: "Incidente em andamento", color: "#dc2626" };
  if (results.some((r) => r.status === "degraded")) return { label: "Performance degradada", color: "#f59e0b" };
  return { label: "Todos os sistemas operacionais", color: "#10b981" };
}

async function statusJsonPage(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const results = await runChecks();
  const overall = overallStatus(results);
  res.setHeader("Cache-Control", `public, max-age=${STATUS_CACHE_MS / 1000}`);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    overall: overall.label,
    checks: results,
    updated_at: new Date().toISOString(),
  }, null, 2));
}

async function statusPage(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const results = await runChecks();
  const overall = overallStatus(results);
  res.setHeader("Cache-Control", `public, max-age=${STATUS_CACHE_MS / 1000}`);
  html(res, 200, statusHtml(results, overall));
}

function statusBadge(status: CheckResult["status"]): string {
  const colors: Record<CheckResult["status"], string> = {
    up: "#10b981", degraded: "#f59e0b", down: "#dc2626", skipped: "#64748b",
  };
  const labels: Record<CheckResult["status"], string> = {
    up: "Operacional", degraded: "Degradado", down: "Fora do ar", skipped: "—",
  };
  return `<span style="background:${colors[status]};color:#fff;padding:4px 10px;border-radius:12px;font-size:12px;font-weight:500">${labels[status]}</span>`;
}

function statusHtml(results: CheckResult[], overall: { label: string; color: string }): string {
  const rows = results.map((r) => `
    <tr>
      <td><strong>${esc(r.service)}</strong></td>
      <td>${statusBadge(r.status)}</td>
      <td style="color:#94a3b8;font-size:13px">${r.latencyMs != null ? `${r.latencyMs}ms` : "—"}</td>
      <td style="color:#94a3b8;font-size:12px">${r.error ? esc(r.error) : ""}</td>
    </tr>`).join("");
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Status — Askine</title>
<style>${CSS}
  .overall { background:#1e293b; border-radius:16px; padding:32px; text-align:center; margin-bottom:24px; border-left:6px solid ${overall.color} }
  .overall h2 { font-size:24px; color:#f1f5f9; margin:0 0 8px }
  .overall .dot { display:inline-block; width:12px; height:12px; border-radius:50%; background:${overall.color}; margin-right:8px; vertical-align:middle }
  table { width:100%; border-collapse:collapse; background:#1e293b; border-radius:12px; overflow:hidden }
  th, td { padding:14px 18px; text-align:left; border-bottom:1px solid #334155; color:#e2e8f0 }
  th { background:#0f172a; color:#94a3b8; font-size:12px; font-weight:500; text-transform:uppercase; letter-spacing:0.5px }
  tr:last-child td { border-bottom:0 }
  .meta { color:#64748b; font-size:13px; margin-top:24px; text-align:center }
</style>
${NAV}
<main>
  <h1>Status do sistema</h1>
  <div class="overall">
    <h2><span class="dot"></span>${esc(overall.label)}</h2>
    <p style="color:#94a3b8;margin:0">Checagem ao vivo, cacheada por ${STATUS_CACHE_MS / 1000}s</p>
  </div>
  <table>
    <thead><tr><th>Serviço</th><th>Status</th><th>Latência</th><th>Detalhes</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="meta">
    Atualizado: ${new Date().toLocaleString("pt-BR")} ·
    <a href="/status.json" style="color:#3b82f6">JSON</a>
  </p>
</main>${FOOTER}`;
}
