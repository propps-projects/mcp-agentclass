/**
 * Serves brand assets from the on-disk /assets directory.
 *
 * Whitelisted exact filenames only — no path traversal possible since
 * we match against a fixed map.
 */

import { ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = join(__dirname, "..", "assets");

const ASSET_FILES: Record<string, { file: string; contentType: string }> = {
  // Real multi-purpose ICO at the canonical /favicon.ico path — this is where
  // browsers and connector-icon resolvers (Claude) look by default. Registered
  // here so server-http's early brand-route check serves it before any other
  // route. /brand/favicon.ico is the same file under the brand namespace.
  "/favicon.ico":              { file: "favicon.ico",        contentType: "image/x-icon" },
  "/brand/favicon.ico":        { file: "favicon.ico",        contentType: "image/x-icon" },
  // Social preview (Open Graph / Twitter) image — 1200×630. Served at the
  // canonical /og-image.jpg for the whole domain (landing + app pages).
  "/og-image.jpg":             { file: "OGG-IMG.jpg",        contentType: "image/jpeg" },
  "/brand/favicon.png":        { file: "favicon.png",        contentType: "image/png" },
  "/brand/logo-black.svg":     { file: "logo-black.svg",     contentType: "image/svg+xml" },
  "/brand/logo-white.svg":     { file: "logo-white.svg",     contentType: "image/svg+xml" },
  "/brand/logo-black.png":     { file: "logo-black.png",     contentType: "image/png" },
  "/brand/logo-white.png":     { file: "logo-white.png",     contentType: "image/png" },
  "/brand/ico-logo-black.svg": { file: "ico-logo-black.svg", contentType: "image/svg+xml" },
  "/brand/ico-logo-white.svg": { file: "ico-logo-white.svg", contentType: "image/svg+xml" },
  "/brand/ico-logo-black.png": { file: "ico-logo-black.png", contentType: "image/png" },
  "/brand/ico-logo-white.png": { file: "ico-logo-white.png", contentType: "image/png" },
};

export function isBrandRoute(path: string): boolean {
  return path in ASSET_FILES;
}

export async function handleBrandRoute(path: string, res: ServerResponse): Promise<void> {
  const meta = ASSET_FILES[path];
  if (!meta) { res.writeHead(404).end("not found"); return; }
  try {
    const body = await readFile(join(ASSETS_DIR, meta.file));
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.writeHead(200, { "Content-Type": meta.contentType });
    res.end(body);
  } catch (err) {
    console.error("[brand] failed to serve", path, err);
    res.writeHead(404).end("not found");
  }
}
