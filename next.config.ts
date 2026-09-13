import type { NextConfig } from "next";

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
};

export default nextConfig;
