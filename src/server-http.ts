// Anchor cwd + .env to the project root.
import { fileURLToPath } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";
import dotenv from "dotenv";
const __projectRoot = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(__projectRoot);
dotenv.config({ path: resolvePath(__projectRoot, ".env") });

import http, { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { buildServer } from "./build-server.ts";
import { resolveTenantBySlug, type Tenant } from "./lib/tenant.ts";
import type { AdapterMode } from "./ui/player.ts";

const PORT = Number(process.env.PORT || 3333);

// Path → adapter mode map. Each session lives at one of these paths; the
// adapter determines MCP-UI MIME type emitted by play_lesson.
//
//   /mcp           → mcpApps  (Claude)         — legacy single-tenant
//   /mcp-gpt       → appsSdk  (ChatGPT)        — legacy single-tenant
//   /t/:slug/mcp     → mcpApps + resolved tenant
//   /t/:slug/mcp-gpt → appsSdk + resolved tenant
const ENDPOINT_SUFFIXES = {
  "/mcp": "mcpApps" as AdapterMode,
  "/mcp-gpt": "appsSdk" as AdapterMode,
};
type RouteMatch = { adapterMode: AdapterMode; tenantSlug: string | null };

function matchRoute(url: string): RouteMatch | null {
  // Strip query string first
  const pathOnly = url.split("?")[0];

  // Multi-tenant: /t/:slug/<suffix>
  const tenantMatch = pathOnly.match(/^\/t\/([a-z0-9][a-z0-9-]{0,62})(\/.*)$/i);
  if (tenantMatch) {
    const suffix = tenantMatch[2] as keyof typeof ENDPOINT_SUFFIXES;
    if (suffix in ENDPOINT_SUFFIXES) {
      return { adapterMode: ENDPOINT_SUFFIXES[suffix], tenantSlug: tenantMatch[1] };
    }
    return null;
  }

  // Legacy single-tenant
  if (pathOnly in ENDPOINT_SUFFIXES) {
    return { adapterMode: ENDPOINT_SUFFIXES[pathOnly as keyof typeof ENDPOINT_SUFFIXES], tenantSlug: null };
  }
  return null;
}

// Optional bearer token to gate the endpoint. Required for any public deploy
// (VPS, Cloudflare, etc.) — Claude.ai sends it via Authorization header.
// Phase 1 will replace this with real OAuth.
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN || "";

const transports = new Map<string, StreamableHTTPServerTransport>();

function setCORS(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id, mcp-session-id, MCP-Protocol-Version, Last-Event-ID");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (!chunks.length) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function unauthorized(res: ServerResponse) {
  res.writeHead(401, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null }));
}

const httpServer = http.createServer(async (req, res) => {
  try {
    setCORS(res);
    if (req.method === "OPTIONS") { res.writeHead(204).end(); return; }

    // Lightweight health check, no auth.
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true, name: "agentclass" }));
      return;
    }

    if (!req.url) { res.writeHead(404).end("not found"); return; }
    const route = matchRoute(req.url);
    if (!route) { res.writeHead(404).end("not found"); return; }
    const { adapterMode, tenantSlug } = route;

    if (AUTH_TOKEN) {
      const got = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (got !== AUTH_TOKEN) return unauthorized(res);
    }

    // Resolve tenant when present. Suspended/canceled tenants 404
    // (don't leak existence). Phase 1 swaps the legacy MCP_AUTH_TOKEN
    // gate above for full OAuth, and this resolution is driven by the
    // student's access token rather than the URL slug alone.
    let tenant: Tenant | null = null;
    if (tenantSlug) {
      tenant = await resolveTenantBySlug(tenantSlug);
      if (!tenant) { res.writeHead(404).end("tenant not found"); return; }
    }

    const sessionId = (req.headers["mcp-session-id"] as string | undefined)?.toString();

    // POST: client sends a JSON-RPC message. New session is created when the
    // first message is `initialize` and no Mcp-Session-Id is present.
    if (req.method === "POST") {
      const body = await readJsonBody(req);
      let transport = sessionId ? transports.get(sessionId) : undefined;

      if (!transport) {
        if (!isInitializeRequest(body)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "No session — first request must be initialize" }, id: null }));
          return;
        }
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => { transports.set(id, transport!); },
        });
        transport.onclose = () => {
          if (transport!.sessionId) transports.delete(transport!.sessionId);
        };
        const server = buildServer(adapterMode, tenant);
        await server.connect(transport);
      }

      await transport.handleRequest(req, res, body);
      return;
    }

    // GET (SSE stream) and DELETE (terminate) require an existing session.
    if (req.method === "GET" || req.method === "DELETE") {
      if (!sessionId || !transports.has(sessionId)) {
        res.writeHead(400).end("missing or invalid Mcp-Session-Id");
        return;
      }
      await transports.get(sessionId)!.handleRequest(req, res);
      return;
    }

    res.writeHead(405).end("method not allowed");
  } catch (err) {
    console.error("Request error:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null }));
    }
  }
});

httpServer.listen(PORT, () => {
  const auth = AUTH_TOKEN ? "with bearer auth" : "WITHOUT auth (set MCP_AUTH_TOKEN for public deploys)";
  const legacy = Object.entries(ENDPOINT_SUFFIXES).map(([p, m]) => `${p} (${m})`).join(", ");
  console.error(`askine MCP HTTP server listening on :${PORT}`);
  console.error(`  Legacy single-tenant: ${legacy}`);
  console.error(`  Multi-tenant:         /t/:slug/{mcp,mcp-gpt}`);
  console.error(`  Auth: ${auth}`);
});
