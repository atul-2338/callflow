"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Release one assigned pool number back to "available" (admin Numbers page). */
export default function ReleaseNumberButton({
  businessId,
}: {
  businessId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function release() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/numbers/release", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(data?.error || "Could not release the number.");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={release}
        disabled={busy}
        className="rounded-full border border-separator bg-white px-3 py-1.5 text-xs font-medium text-ink-2 transition hover:border-danger hover:text-danger disabled:opacity-50"
      >
        {busy ? "Releasing…" : "Release"}
      </button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </span>
  );
}