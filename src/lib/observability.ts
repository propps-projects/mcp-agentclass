/**
 * Observability — Sentry init + a thin capture helper.
 *
 * Sentry is OPTIONAL. When SENTRY_DSN isn't set, init() does nothing and
 * captureError() falls through to console.error. Lets local dev and
 * cost-sensitive deploys skip the integration entirely.
 *
 * Environment is read at init time, NOT lazily, so make sure init() is
 * called AFTER dotenv.config() in the entry script.
 */

import * as Sentry from "@sentry/node";

let initialized = false;

export function initObservability(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    console.error("[observability] SENTRY_DSN unset — error capture disabled, logs only.");
    return;
  }
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    release: process.env.GIT_SHA,
    // Capture 100% of errors; sample 10% of normal transactions.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1"),
    integrations: [
      Sentry.httpIntegration(),
      Sentry.consoleIntegration(),
    ],
  });
  initialized = true;
  console.error("[observability] Sentry initialized.");
}

export function captureError(err: unknown, context?: Record<string, unknown>): void {
  if (!initialized) {
    console.error("[observability] captureError:", err, context ?? {});
    return;
  }
  Sentry.captureException(err, { extra: context });
}

export function captureMessage(msg: string, context?: Record<string, unknown>): void {
  if (!initialized) {
    console.error("[observability] captureMessage:", msg, context ?? {});
    return;
  }
  Sentry.captureMessage(msg, { extra: context });
}
