import type { MetadataRoute } from "next";

/**
 * First robots.txt in the repo. Nothing else changes crawlability: pages stay
 * indexable by default; only the admin panel (pages + APIs) is disallowed.
 * Belt-and-braces alongside the noindex metadata on app/admin/layout.tsx.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/api/admin"],
    },
  };
}