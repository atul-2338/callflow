"use client";

import { useState } from "react";

/**
 * Clears the admin session server-side, then hard-navigates to the login page
 * (a full reload, so no client router cache can keep showing guarded content).
 */
export default function AdminLogoutButton() {
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/admin/logout", { method: "POST" });
    } catch {
      // Network trouble: still leave the page — the next guarded request will
      // bounce to the login page anyway.
    } finally {
      window.location.assign("/admin/login");
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className="rounded-full border border-separator bg-white px-4 py-2 text-sm font-medium text-ink-2 shadow-sm transition hover:bg-black/[0.03] disabled:opacity-50"
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}