"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

/**
 * Paste new pool numbers, one per line (E.164, "+1" + 10 digits). The server
 * validates every line, skips duplicates, and reports added vs skipped.
 */
export default function AddNumbersForm() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || !text.trim()) return;
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/admin/numbers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numbers: text }),
      });
      const data = (await response.json()) as {
        added?: string[];
        skippedInvalid?: string[];
        skippedDuplicate?: string[];
        error?: string;
      };
      if (!response.ok) {
        setError(data.error || "Could not add numbers. Try again.");
        return;
      }
      const added = data.added?.length ?? 0;
      const invalid = data.skippedInvalid?.length ?? 0;
      const dupes = data.skippedDuplicate?.length ?? 0;
      setResult(
        `Added ${added} number${added === 1 ? "" : "s"} · skipped ${invalid} invalid, ${dupes} duplicate.`
      );
      if (added > 0) {
        setText("");
        router.refresh();
      }
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-ink">Add numbers to the pool</h2>
      <p className="mt-1 text-xs text-ink-3">
        One number per line, exactly +1 followed by 10 digits (e.g. +15550100001).
        Duplicates already in the pool — or already on a business — are skipped.
      </p>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={4}
        placeholder={"+15550100001\n+15550100002"}
        className="mt-3 w-full rounded-xl border border-separator bg-white px-3 py-2.5 font-mono text-xs text-ink outline-none transition focus:border-wire"
      />
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      {result && <p className="mt-2 text-sm text-[#1f8a3b]">{result}</p>}
      <button
        type="submit"
        disabled={submitting || !text.trim()}
        className="mt-3 rounded-full bg-[#0b1f3a] px-4 py-2 text-sm font-semibold text-white transition active:scale-[0.98] disabled:opacity-50"
      >
        {submitting ? "Adding…" : "Save numbers"}
      </button>
    </form>
  );
}