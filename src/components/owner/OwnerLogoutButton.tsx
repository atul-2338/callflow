"use client";

import { useState } from "react";

/**
 * Clears the owner session cookie server-side, then hard-navigates to /login
 * (a full reload, so no client router cache can keep showing dashboard
 * content). Mirrors AdminLogoutButton — the same pattern the admin panel uses.
 */
export default function OwnerLogoutButton() {
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Network trouble: still leave the page — /dashboard is gated, so the
      // next navigation bounces to /login regardless.
    } finally {
      window.location.assign("/login");
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className="rounded-full border border-separator bg-white px-4 py-2 text-sm font-medium text-ink-2 shadow-sm transition hover:bg-black/[0.03] disabled:opacity-50"
    >
      {busy ? "Signing out…" : "Log out"}
    </button>
  );
}
