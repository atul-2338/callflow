"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * "Copy new login link" (admin Customers list): mints a fresh one-time owner
 * login link for this business and copies it to the clipboard. The link is
 * also shown here, selectable, in case the clipboard is unavailable or the
 * admin needs to send it somewhere else. Minting a new link never invalidates
 * an older, still-unexpired one.
 */
export default function NewLoginLinkButton({
  businessId,
}: {
  businessId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function mint() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const response = await fetch(
        `/api/admin/customers/${businessId}/login-link`,
        { method: "POST" }
      );
      const data = (await response.json().catch(() => null)) as {
        loginUrl?: string;
        error?: string;
      } | null;
      if (!response.ok || !data?.loginUrl) {
        setLink(null);
        setError(data?.error || "Could not create a login link.");
        return;
      }
      setLink(data.loginUrl);
      try {
        await navigator.clipboard.writeText(data.loginUrl);
        setCopied(true);
      } catch {
        setCopied(false);
      }
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex max-w-xs flex-col items-start gap-1">
      <button
        type="button"
        onClick={mint}
        disabled={busy}
        className="rounded-full border border-separator bg-white px-3 py-1.5 text-xs font-medium text-ink-2 transition hover:border-wire hover:text-wire disabled:opacity-50"
      >
        {busy ? "Creating…" : "Copy new login link"}
      </button>
      {copied && (
        <span className="text-[11px] text-[#1f8a3b]">
          Copied — one use, expires in 7 days.
        </span>
      )}
      {link && (
        <code className="break-all rounded-lg bg-black/[0.04] px-2 py-1 font-mono text-[11px] text-ink-2">
          {link}
        </code>
      )}
      {error && <span className="text-xs text-danger">{error}</span>}
    </span>
  );
}
