/**
 * Formulário de contato "Falar com Askine™" da landing page.
 *
 * POST /contato  { nome, email, assunto, mensagem }
 *   → envia um e-mail via Resend para a caixa de contato (mesma infra dos
 *     magic links — RESEND_API_KEY já configurada em prod).
 *   → reply_to aponta para o e-mail do visitante (responde direto na sua caixa).
 *
 * Env:
 *   RESEND_API_KEY       (obrigatório) — já usado pelo login mágico
 *   CONTACT_TO_EMAIL     (default askinellc@gmail.com) — destino das mensagens
 *   CONTACT_FROM         (default RESEND_FROM ou "Askine <login@askine.cc>")
 *                        — remetente com domínio verificado no Resend
 */

import type { IncomingMessage, ServerResponse } from "node:http";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_ENDPOINT = "https://api.resend.com/emails";

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const c of req) {
    total += (c as Buffer).length;
    if (total > 64 * 1024) throw new Error("payload_too_large"); // 64KB de teto
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

export type ContatoRoute = { kind: "submit" };

export function matchContatoRoute(path: string, method: string): ContatoRoute | null {
  if (path === "/contato" && method === "POST") return { kind: "submit" };
  return null;
}

export async function handleContatoRoute(
  _route: ContatoRoute,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let raw: string;
  try {
    raw = await readBody(req);
  } catch {
    return json(res, 413, { ok: false, error: "Mensagem muito longa." });
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw || "{}");
  } catch {
    return json(res, 400, { ok: false, error: "Requisição inválida." });
  }

  const nome = String(data.nome ?? "").trim().slice(0, 120);
  const email = String(data.email ?? "").trim().slice(0, 160);
  const assunto = String(data.assunto ?? "").trim().slice(0, 140);
  const mensagem = String(data.mensagem ?? "").trim().slice(0, 2000);

  if (!nome || !assunto || !mensagem) return json(res, 400, { ok: false, error: "Preencha todos os campos." });
  if (!EMAIL_RE.test(email)) return json(res, 400, { ok: false, error: "E-mail inválido." });

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn(`[contato] Sem RESEND_API_KEY — mensagem de ${email} (${assunto}) não enviada.`);
    return json(res, 503, { ok: false, error: "Envio indisponível no momento." });
  }

  const to = process.env.CONTACT_TO_EMAIL ?? "askinellc@gmail.com";
  const from = process.env.CONTACT_FROM ?? process.env.RESEND_FROM ?? "Askine <login@askine.cc>";

  const html =
    `<!doctype html><html><body style="font-family:system-ui,Arial,sans-serif;max-width:560px;margin:24px auto;color:#111">` +
    `<h2 style="margin:0 0 12px">Nova mensagem — Falar com Askine™</h2>` +
    `<p><strong>Nome:</strong> ${esc(nome)}</p>` +
    `<p><strong>E-mail:</strong> ${esc(email)}</p>` +
    `<p><strong>Assunto:</strong> ${esc(assunto)}</p>` +
    `<p><strong>Mensagem:</strong></p>` +
    `<p style="white-space:pre-wrap;background:#f6f5f1;padding:14px;border-radius:8px">${esc(mensagem)}</p>` +
    `<p style="font-size:13px;color:#666">Responda este e-mail para falar direto com ${esc(nome)}.</p>` +
    `</body></html>`;
  const text = `Nova mensagem — Falar com Askine\n\nNome: ${nome}\nE-mail: ${email}\nAssunto: ${assunto}\n\n${mensagem}`;

  try {
    const r = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to,
        reply_to: email,
        subject: `[Contato LP] ${assunto}`,
        html,
        text,
      }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      console.error(`[contato] Resend respondeu ${r.status}: ${detail.slice(0, 400)}`);
      return json(res, 502, { ok: false, error: "Não foi possível enviar agora." });
    }
  } catch (err) {
    console.error("[contato] falha ao chamar Resend:", err);
    return json(res, 502, { ok: false, error: "Não foi possível enviar agora." });
  }

  return json(res, 200, { ok: true });
}
