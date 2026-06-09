/**
 * Global OAuth 2.1 + magic-link router (Phase 5+).
 *
 * Replaces the tenant-scoped /t/:slug/oauth/* with root-level routes so
 * Claude.ai / ChatGPT see a single global MCP connector with one auth
 * server. Tokens reference mcp_user_id (global identity by email), and
 * the same token unlocks every course the user has access to across
 * all tenants.
 *
 * Routes:
 *   GET  /.well-known/oauth-authorization-server   — RFC 8414 (root)
 *   GET  /.well-known/oauth-protected-resource     — RFC 9728 for /mcp
 *   POST /oauth/register                           — RFC 7591 DCR
 *   GET  /oauth/authorize                          — HTML form
 *   POST /oauth/authorize                          — send magic link
 *   GET  /auth/verify?token=xxx                    — magic link callback
 *   POST /oauth/token                              — code/refresh exchange
 *   POST /oauth/revoke                             — RFC 7009
 */

import { IncomingMessage, ServerResponse } from "node:http";
import {
  registerClient,
  findClientByClientId,
  issueAuthorizationCode,
  consumeAuthorizationCode,
  issueTokens,
  rotateRefreshToken,
  revokeAccessToken,
  revokeRefreshToken,
  verifyPkceS256,
} from "./lib/oauth.ts";
import { issueMagicLink, consumeMagicLink, sendMagicLinkEmail } from "./lib/magic-links.ts";
import { upsertMcpUser } from "./lib/mcp-users.ts";

function publicUrl(): string {
  return (process.env.PUBLIC_URL ?? "http://localhost:3333").replace(/\/+$/, "");
}

type OAuthState = {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
};

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
}
function html(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" }).end(body);
}
async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
async function readJson<T>(req: IncomingMessage): Promise<T> {
  return JSON.parse(await readBody(req)) as T;
}
async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  return new URLSearchParams(await readBody(req));
}
function getQuery(req: IncomingMessage): URLSearchParams {
  return new URL(req.url ?? "/", "http://x").searchParams;
}

// ---------- Handlers ----------

async function discoveryAS(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const base = publicUrl();
  json(res, 200, {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    revocation_endpoint: `${base}/oauth/revoke`,
    registration_endpoint: `${base}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_basic", "client_secret_post"],
    scopes_supported: ["mcp"],
    service_documentation: `${base}/docs`,
    // RFC 8414 §2: pointers to the authorization server's privacy
    // policy and terms of service. Apps Directory submissions require
    // these for legal review.
    op_policy_uri: `${base}/privacy`,
    op_tos_uri: `${base}/terms`,
  });
}

async function discoveryPRM(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const base = publicUrl();
  json(res, 200, {
    resource: `${base}/mcp`,
    authorization_servers: [base],
    scopes_supported: ["mcp"],
    bearer_methods_supported: ["header"],
    resource_documentation: `${base}/docs`,
    resource_policy_uri: `${base}/privacy`,
    resource_tos_uri: `${base}/terms`,
  });
}

async function register(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = await readJson<{
      client_name?: string;
      redirect_uris?: string[];
      scope?: string;
      grant_types?: string[];
      response_types?: string[];
      token_endpoint_auth_method?: string;
      application_type?: string;
    }>(req);
    const redirectUris = body.redirect_uris ?? [];
    if (!redirectUris.length) {
      return json(res, 400, { error: "invalid_redirect_uri", error_description: "redirect_uris required" });
    }
    const authMethod = body.token_endpoint_auth_method ?? "none";
    const isPublic = authMethod === "none";
    const { client, clientSecret } = await registerClient({
      tenantId: null,                            // global client, no tenant
      clientName: body.client_name,
      redirectUris,
      scopes: body.scope ? body.scope.split(/\s+/) : ["mcp"],
    });
    const issuedAt = Math.floor(Date.now() / 1000);
    const response: Record<string, unknown> = {
      client_id: client.clientId,
      client_id_issued_at: issuedAt,
      redirect_uris: client.redirectUris,
      grant_types: body.grant_types ?? ["authorization_code", "refresh_token"],
      response_types: body.response_types ?? ["code"],
      token_endpoint_auth_method: authMethod,
      scope: client.scopes.join(" "),
    };
    if (body.client_name) response.client_name = body.client_name;
    if (body.application_type) response.application_type = body.application_type;
    if (!isPublic) {
      response.client_secret = clientSecret;
      response.client_secret_expires_at = 0;
    }
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    json(res, 201, response);
  } catch (err) {
    console.error("DCR error:", err);
    json(res, 400, { error: "invalid_request", error_description: String(err) });
  }
}

async function authorizeGet(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const q = getQuery(req);
  const clientId = q.get("client_id") ?? "";
  const redirectUri = q.get("redirect_uri") ?? "";
  const scope = q.get("scope") ?? "mcp";
  const state = q.get("state") ?? "";
  const codeChallenge = q.get("code_challenge") ?? "";
  const codeChallengeMethod = q.get("code_challenge_method") ?? "";
  const responseType = q.get("response_type") ?? "";

  if (responseType !== "code") {
    return json(res, 400, { error: "unsupported_response_type" });
  }
  if (codeChallengeMethod !== "S256" || !codeChallenge) {
    return json(res, 400, { error: "invalid_request", error_description: "PKCE S256 required" });
  }
  const client = await findClientByClientId(clientId);
  if (!client || !client.redirectUris.includes(redirectUri)) {
    return json(res, 400, { error: "invalid_client", error_description: "Unknown client or redirect_uri" });
  }

  const oauthState: OAuthState = {
    clientId, redirectUri, scopes: scope.split(/\s+/), state, codeChallenge,
    codeChallengeMethod: "S256",
  };
  const encoded = Buffer.from(JSON.stringify(oauthState)).toString("base64url");
  html(res, 200, loginPageHtml({
    clientName: (client.metadata.clientName as string | null) ?? clientId,
    oauthState: encoded,
  }));
}

async function authorizePost(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const form = await readForm(req);
  const email = (form.get("email") ?? "").trim().toLowerCase();
  const oauthState = form.get("oauth_state") ?? "";
  if (!email || !email.includes("@")) {
    return html(res, 400, loginPageHtml({ clientName: "", oauthState, error: "Email inválido." }));
  }
  const token = await issueMagicLink({
    tenantId: null,
    email,
    intent: "oauth_login",
    oauthState,
  });
  const url = `${publicUrl()}/auth/verify?token=${encodeURIComponent(token)}`;
  try {
    await sendMagicLinkEmail({ to: email, url, tenantName: "Askine" });
  } catch (err) {
    console.error("Magic link send failed:", err);
    return html(res, 500, `<p>Não foi possível enviar o email agora. Tente de novo.</p>`);
  }
  html(res, 200, magicLinkSentHtml({ email }));
}

async function verify(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const q = getQuery(req);
  const token = q.get("token") ?? "";
  const claims = await consumeMagicLink(token);
  if (!claims || claims.intent !== "oauth_login") {
    return html(res, 400, `<p>Esse link expirou ou já foi usado. <a href="/oauth/authorize">Tentar novamente</a></p>`);
  }
  if (!claims.oauthState) {
    return html(res, 200, `<p>Login confirmado, ${claims.email}. Você pode fechar esta janela.</p>`);
  }
  const oauthState: OAuthState = JSON.parse(Buffer.from(claims.oauthState, "base64url").toString("utf8"));
  const user = await upsertMcpUser({ email: claims.email });
  const code = await issueAuthorizationCode({
    clientId: oauthState.clientId,
    mcpUserId: user.id,
    redirectUri: oauthState.redirectUri,
    scopes: oauthState.scopes,
    codeChallenge: oauthState.codeChallenge,
    codeChallengeMethod: "S256",
  });
  const target = new URL(oauthState.redirectUri);
  target.searchParams.set("code", code);
  if (oauthState.state) target.searchParams.set("state", oauthState.state);
  res.writeHead(302, { Location: target.toString() }).end();
}

async function token(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const form = await readForm(req);
  const grantType = form.get("grant_type") ?? "";

  if (grantType === "authorization_code") {
    const code = form.get("code") ?? "";
    const redirectUri = form.get("redirect_uri") ?? "";
    const clientId = form.get("client_id") ?? "";
    const codeVerifier = form.get("code_verifier") ?? "";
    if (!code || !codeVerifier) return json(res, 400, { error: "invalid_request" });
    const claims = await consumeAuthorizationCode(code);
    if (!claims) return json(res, 400, { error: "invalid_grant" });
    if (claims.clientId !== clientId) return json(res, 400, { error: "invalid_client" });
    if (claims.redirectUri !== redirectUri) return json(res, 400, { error: "invalid_grant" });
    if (!claims.codeChallenge || !verifyPkceS256(codeVerifier, claims.codeChallenge)) {
      return json(res, 400, { error: "invalid_grant", error_description: "PKCE verification failed" });
    }
    if (!claims.mcpUserId) return json(res, 400, { error: "invalid_grant", error_description: "code has no user" });
    const tokens = await issueTokens({
      clientId: claims.clientId,
      mcpUserId: claims.mcpUserId,
      scopes: claims.scopes,
    });
    return json(res, 200, {
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      token_type: "Bearer",
      expires_in: tokens.expiresIn,
      scope: claims.scopes.join(" "),
    });
  }

  if (grantType === "refresh_token") {
    const refreshToken = form.get("refresh_token") ?? "";
    if (!refreshToken) return json(res, 400, { error: "invalid_request" });
    const rotated = await rotateRefreshToken(refreshToken);
    if (!rotated) return json(res, 400, { error: "invalid_grant" });
    return json(res, 200, {
      access_token: rotated.accessToken,
      refresh_token: rotated.refreshToken,
      token_type: "Bearer",
      expires_in: rotated.expiresIn,
    });
  }
  json(res, 400, { error: "unsupported_grant_type" });
}

async function revoke(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const form = await readForm(req);
  const token = form.get("token") ?? "";
  const hint = form.get("token_type_hint") ?? "";
  if (!token) return json(res, 200, {});
  if (hint === "refresh_token") {
    await revokeRefreshToken(token);
  } else {
    await revokeAccessToken(token);
    await revokeRefreshToken(token);
  }
  json(res, 200, {});
}

// ---------- HTML ----------

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function loginPageHtml(args: { clientName: string; oauthState: string; error?: string }): string {
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Entrar — Askine</title>
<style>
  body { font-family: system-ui, sans-serif; background:#fafafa; color:#111; max-width:480px; margin:60px auto; padding:0 16px }
  h1 { font-size: 22px; margin: 0 0 8px }
  p { color:#444; line-height:1.5 }
  form { background:#fff; border:1px solid #e5e5e5; border-radius:12px; padding:24px; margin-top:24px }
  label { display:block; font-size:13px; color:#666; margin-bottom:6px }
  input[type=email] { width:100%; box-sizing:border-box; padding:12px; border:1px solid #ddd; border-radius:8px; font-size:15px }
  button { width:100%; margin-top:16px; padding:12px; background:#111; color:#fff; border:0; border-radius:8px; font-size:15px; cursor:pointer }
  .err { background:#fee; color:#900; padding:10px; border-radius:8px; margin-bottom:12px; font-size:14px }
  footer { margin-top:24px; color:#999; font-size:12px; text-align:center }
</style>
<h1>Askine</h1>
<p>${args.clientName ? `<strong>${esc(args.clientName)}</strong> quer acessar seus cursos. ` : ""}Entre com o email que você usou na compra dos cursos.</p>
<form method="POST" action="/oauth/authorize">
  ${args.error ? `<div class="err">${esc(args.error)}</div>` : ""}
  <label for="email">Email</label>
  <input id="email" name="email" type="email" required autofocus placeholder="voce@exemplo.com">
  <input type="hidden" name="oauth_state" value="${esc(args.oauthState)}">
  <button type="submit">Receber link de acesso</button>
</form>
<footer>Askine — tutor agêntico pros seus cursos</footer>`;
}

function magicLinkSentHtml(args: { email: string }): string {
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Verifique seu email</title>
<style>
  body { font-family: system-ui, sans-serif; background:#fafafa; color:#111; max-width:480px; margin:80px auto; padding:0 16px; text-align:center }
  .card { background:#fff; border:1px solid #e5e5e5; border-radius:12px; padding:32px }
  code { background:#f3f3f3; padding:2px 6px; border-radius:4px; font-size:13px }
</style>
<div class="card">
  <h1>📬 Confira seu email</h1>
  <p>Mandamos um link de acesso pra <code>${esc(args.email)}</code>.</p>
  <p>O link é válido por 15 minutos.</p>
</div>`;
}

// ---------- Router ----------

export type GlobalOAuthRouteMatch =
  | { type: "discovery-as" }
  | { type: "discovery-prm" }
  | { type: "register" }
  | { type: "authorize-get" }
  | { type: "authorize-post" }
  | { type: "verify" }
  | { type: "token" }
  | { type: "revoke" };

export function matchGlobalOAuthRoute(path: string, method: string): GlobalOAuthRouteMatch | null {
  const p = path.split("?")[0];
  if (method === "GET"  && p === "/.well-known/oauth-authorization-server") return { type: "discovery-as" };
  if (method === "GET"  && p === "/.well-known/oauth-protected-resource")   return { type: "discovery-prm" };
  if (method === "POST" && p === "/oauth/register")  return { type: "register" };
  if (method === "GET"  && p === "/oauth/authorize") return { type: "authorize-get" };
  if (method === "POST" && p === "/oauth/authorize") return { type: "authorize-post" };
  if (method === "GET"  && p === "/auth/verify")     return { type: "verify" };
  if (method === "POST" && p === "/oauth/token")     return { type: "token" };
  if (method === "POST" && p === "/oauth/revoke")    return { type: "revoke" };
  return null;
}

export async function handleGlobalOAuthRoute(
  match: GlobalOAuthRouteMatch,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  switch (match.type) {
    case "discovery-as":  return discoveryAS(req, res);
    case "discovery-prm": return discoveryPRM(req, res);
    case "register":      return register(req, res);
    case "authorize-get": return authorizeGet(req, res);
    case "authorize-post": return authorizePost(req, res);
    case "verify":        return verify(req, res);
    case "token":         return token(req, res);
    case "revoke":        return revoke(req, res);
  }
}
