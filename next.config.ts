import type { NextConfig } from "next";

// `watchOptions.ignored` is applied by the dev bundler but is not part of the
// published NextConfig type (which only declares `pollIntervalMs`), so the
// local type is widened for the Windows-only block below. This keeps
// `next build` type-checking clean on Linux, where the block is never set.
type NextConfigWithWatchIgnore = NextConfig & {
  watchOptions?: { pollIntervalMs?: number; ignored?: string[] };
};

const nextConfig: NextConfigWithWatchIgnore = {};

if (process.platform === "win32") {
  // Windows-only dev workaround: Watchpack's initial scan of the F:\ drive
  // root hits locked system files (pagefile.sys, System Volume Information,
  // ...) and logs EINVAL warnings on every `next dev` start. They are
  // non-fatal, and these paths are meaningless on Linux (the Vultr VPS), so
  // the ignore list is applied only on Windows; the Linux config stays `{}`.
  nextConfig.watchOptions = {
    ignored: [
      "F:\\pagefile.sys",
      "F:\\DumpStack.log.tmp",
      "F:\\System Volume Information",
      "F:\\WindowsApps",
      "F:\\New",
    ],
  };
}

export default nextConfig;
