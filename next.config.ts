import type { NextConfig } from "next";

/**
 * Next.js 16 blocks cross-origin requests to dev assets (JS chunks, HMR) by
 * default. When testing through an ngrok tunnel the browser origin is the
 * ngrok domain, so it must be allow-listed or the app renders without
 * JavaScript (e.g. the checkout return page never finishes polling).
 *
 * Derived from DODO_PAYMENTS_RETURN_URL — which is already kept in sync with
 * the current tunnel — so a tunnel restart that changes the URL doesn't break
 * the app again.
 */
function allowedDevOrigins(): string[] {
  const returnUrl = process.env.DODO_PAYMENTS_RETURN_URL?.trim();
  if (!returnUrl) return [];
  try {
    return [new URL(returnUrl).hostname];
  } catch {
    return [];
  }
}

const nextConfig: NextConfig = {
  // Pin Turbopack's watch/resolve root to this repo. Without it, Next sees a
  // stray F:\pnpm-lock.yaml above the project, infers root = F:\, and scans
  // the entire drive on startup (Watchpack EINVAL on pagefile.sys etc.), which
  // makes `next dev` crawl or hang. See worklog-2026-09-12 §3.1.
  turbopack: {
    root: __dirname,
  },
  // better-sqlite3 is a native module — keep it external so it is required at
  // runtime instead of being bundled/transpiled by the Next.js build.
  serverExternalPackages: ["better-sqlite3"],
  allowedDevOrigins: allowedDevOrigins(),
};

export default nextConfig;
