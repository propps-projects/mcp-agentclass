/**
 * Login único por e-mail — /entrar
 *
 * A landing page é pública e não conhece o slug de cada tenant, então o botão
 * "Entrar" aponta para /entrar. O usuário informa só o e-mail; nós resolvemos
 * em quais tenants ele é admin e enviamos um magic link:
 *   - 1 tenant  → link aponta direto para o verify existente do admin daquele
 *                 tenant (/t/<slug>/admin/verify), reaproveitando todo o fluxo.
 *   - 2+ tenants→ link aponta para /entrar/verify; ao clicar (e-mail provado)
 *                 mostramos um seletor com um link de acesso por tenant.
 *   - 0 tenant  → respondemos "enviado" do mesmo jeito (sem enumeração).
 *
 * Não há rota nova de sessão: o login efetivo acontece sempre no
 * /t/<slug>/admin/verify, que já emite o cookie askine_admin.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { issueMagicLink, consumeMagicLink, sendMagicLinkEmail } from "./lib/magic-links.ts";
import { listAdminTenantsByEmail } from "./lib/tenant-admin.ts";

// ----------------------------------------------------------------------------
// Helpers (locais — espelham os do admin-router)
// ----------------------------------------------------------------------------

function publicUrl(): string {
  return (process.env.PUBLIC_URL ?? "http://localhost:3333").replace(/\/+$/, "");
}

function html(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" }).end(body);
}

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { Location: location }).end();
}

async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function getQuery(req: IncomingMessage): URLSearchParams {
  return new URL(req.url ?? "/", "http://x").searchParams;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ----------------------------------------------------------------------------
// Páginas (HTML self-contained, estética Askine creme/preto + Aleo)
// ----------------------------------------------------------------------------

function shell(title: string, inner: string): string {
  return `<!doctype html><html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)} — Askine</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Aleo:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  :root{--bg:#faf8f2;--ink:#1a1a1a;--soft:#6b6b66;--border:rgba(26,26,26,.12);--card:#fff}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;background:var(--bg);color:var(--ink);
    font-family:'Aleo',Georgia,serif;display:grid;place-items:center;padding:24px;line-height:1.5}
  .card{width:100%;max-width:420px;background:var(--card);border:1px solid var(--border);
    border-radius:20px;padding:36px 32px;box-shadow:0 1px 2px rgba(0,0,0,.04),0 12px 32px rgba(0,0,0,.06)}
  .logo{height:22px;width:auto;display:block;margin:0 auto 22px}
  h1{font-size:22px;font-weight:700;letter-spacing:-.01em;margin:0 0 8px;text-align:center}
  p.sub{margin:0 0 24px;color:var(--soft);font-size:15px;text-align:center}
  label{display:block;font-size:13px;font-weight:500;color:var(--soft);margin:0 0 7px}
  input[type=email]{width:100%;font:inherit;font-size:16px;padding:12px 14px;border:1px solid var(--border);
    border-radius:12px;background:#fff;color:var(--ink);outline:none;transition:border-color .15s}
  input[type=email]:focus{border-color:var(--ink)}
  button{width:100%;font:inherit;font-size:16px;font-weight:700;margin-top:16px;padding:12px 14px;
    border:none;border-radius:12px;background:#111;color:#fff;cursor:pointer;transition:opacity .15s}
  button:hover{opacity:.88}
  .err{background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;font-size:13px;
    padding:10px 12px;border-radius:10px;margin:0 0 18px}
  .ok{text-align:center}
  .ok .badge{width:52px;height:52px;border-radius:50%;background:#dcfce7;display:grid;place-items:center;margin:0 auto 18px}
  .pick{display:grid;gap:10px;margin-top:8px}
  .pick a{display:flex;align-items:center;justify-content:space-between;gap:12px;text-decoration:none;
    color:var(--ink);border:1px solid var(--border);border-radius:12px;padding:14px 16px;
    font-weight:500;transition:border-color .15s,background .15s}
  .pick a:hover{border-color:var(--ink);background:#faf9f5}
  .pick a .arrow{color:var(--soft)}
  .foot{margin-top:22px;text-align:center;font-size:13px;color:var(--soft)}
  .foot a{color:var(--ink);text-decoration:underline}
  a.back{color:var(--soft);text-decoration:none;font-size:14px}
</style></head><body><main class="card">
<a href="/" aria-label="Askine"><img class="logo" src="/logo-black.svg" alt="Askine"></a>
${inner}
</main></body></html>`;
}

function formPage(opts: { error?: string; email?: string } = {}): string {
  const errMsg: Record<string, string> = {
    email_invalid: "E-mail inválido. Confira e tente novamente.",
    send_failed: "Não conseguimos enviar agora. Tente novamente em instantes.",
  };
  const err = opts.error ? `<div class="err">${esc(errMsg[opts.error] ?? "Algo deu errado.")}</div>` : "";
  return shell(
    "Entrar",
    `<h1>Entrar na Askine</h1>
<p class="sub">Informe o e-mail da sua conta. Enviaremos um link de acesso seguro.</p>
${err}
<form method="post" action="/entrar">
  <label for="email">Seu e-mail</label>
  <input id="email" name="email" type="email" required autofocus autocomplete="email"
    placeholder="voce@exemplo.com" value="${esc(opts.email ?? "")}">
  <button type="submit">Enviar link de acesso</button>
</form>
<p class="foot">Ainda não tem conta? <a href="/#planos">Conheça os planos</a></p>`,
  );
}

function sentPage(email: string): string {
  return shell(
    "Link enviado",
    `<div class="ok">
  <div class="badge"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#15803d" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></div>
  <h1>Verifique seu e-mail</h1>
  <p class="sub">Se houver uma conta para <strong>${esc(email)}</strong>, enviamos um link de acesso. Ele expira em alguns minutos.</p>
</div>
<p class="foot"><a class="back" href="/entrar">← Usar outro e-mail</a></p>`,
  );
}

function pickerPage(tenants: { name: string; url: string }[]): string {
  const items = tenants
    .map(
      (t) =>
        `<a href="${esc(t.url)}"><span>${esc(t.name)}</span><span class="arrow">→</span></a>`,
    )
    .join("");
  return shell(
    "Escolha o workspace",
    `<h1>Escolha o workspace</h1>
<p class="sub">Sua conta administra mais de um workspace. Selecione para entrar:</p>
<div class="pick">${items}</div>`,
  );
}

function invalidPage(): string {
  return shell(
    "Link inválido",
    `<h1>Link inválido ou expirado</h1>
<p class="sub">Este link de acesso não é mais válido. Solicite um novo.</p>
<p class="foot"><a class="back" href="/entrar">← Voltar para o login</a></p>`,
  );
}

// ----------------------------------------------------------------------------
// Roteamento
// ----------------------------------------------------------------------------

export type EntrarRoute = { kind: "form" } | { kind: "submit" } | { kind: "verify" };

export function matchEntrarRoute(path: string, method: string): EntrarRoute | null {
  if (path === "/entrar") return method === "POST" ? { kind: "submit" } : { kind: "form" };
  if (path === "/entrar/verify" && method === "GET") return { kind: "verify" };
  return null;
}

export async function handleEntrarRoute(
  route: EntrarRoute,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (route.kind === "form") {
    const q = getQuery(req);
    if (q.get("sent") === "1") return html(res, 200, sentPage(q.get("email") ?? ""));
    return html(res, 200, formPage({ error: q.get("error") ?? undefined }));
  }

  if (route.kind === "submit") {
    const form = await readForm(req);
    const email = (form.get("email") ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return redirect(res, "/entrar?error=email_invalid");

    try {
      const tenants = await listAdminTenantsByEmail(email);

      if (tenants.length === 1) {
        // Reaproveita o verify existente do admin daquele tenant.
        const t = tenants[0];
        const token = await issueMagicLink({
          tenantId: t.tenantId,
          email,
          intent: "admin_login",
          oauthState: null,
        });
        const url = `${publicUrl()}/t/${t.slug}/admin/verify?token=${encodeURIComponent(token)}`;
        await sendMagicLinkEmail({ to: email, url, tenantName: t.name });
      } else if (tenants.length > 1) {
        // Link global → seletor de workspace após provar o e-mail.
        const token = await issueMagicLink({
          tenantId: null,
          email,
          intent: "entrar",
          oauthState: null,
        });
        const url = `${publicUrl()}/entrar/verify?token=${encodeURIComponent(token)}`;
        await sendMagicLinkEmail({ to: email, url, tenantName: "sua conta Askine" });
      }
      // tenants.length === 0 → não envia nada, mas responde igual (sem enumeração).
    } catch (err) {
      console.error("[entrar] submit failed:", err);
      return redirect(res, "/entrar?error=send_failed");
    }

    return redirect(res, `/entrar?sent=1&email=${encodeURIComponent(email)}`);
  }

  // route.kind === "verify" — só usado no caso multi-tenant.
  const q = getQuery(req);
  const token = q.get("token") ?? "";
  const claims = token ? await consumeMagicLink(token) : null;
  if (!claims || claims.intent !== "entrar") return html(res, 200, invalidPage());

  // E-mail provado: lista os tenants e gera um link de acesso por workspace.
  const tenants = await listAdminTenantsByEmail(claims.email);
  if (tenants.length === 0) return html(res, 200, invalidPage());

  const picks: { name: string; url: string }[] = [];
  for (const t of tenants) {
    const linkToken = await issueMagicLink({
      tenantId: t.tenantId,
      email: claims.email,
      intent: "admin_login",
      oauthState: null,
    });
    picks.push({
      name: t.name,
      url: `${publicUrl()}/t/${t.slug}/admin/verify?token=${encodeURIComponent(linkToken)}`,
    });
  }
  return html(res, 200, pickerPage(picks));
}
