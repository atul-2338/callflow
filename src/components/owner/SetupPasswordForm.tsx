"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { passwordPolicyError } from "@/lib/password-policy";

/**
 * "Create your password" form for the one-time setup link.
 *
 * The rule (8+ characters, both fields equal) is checked HERE for instant
 * feedback and again in POST /api/auth/setup-password, which is the authority —
 * importing the shared rule from src/lib/password-policy.ts means the two can
 * never drift apart. On success the server has already consumed the link, so
 * the only thing left to do is send the owner to /login with the banner flag.
 */
export default function SetupPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const localError = passwordPolicyError(password, confirm);
    if (localError) {
      setError(localError);
      return;
    }

    setError(null);
    setBusy(true);
    try {
      const response = await fetch("/api/auth/setup-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password, confirm }),
      });
      if (response.ok) {
        router.replace("/login?setup=success");
        return;
      }
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "Could not save your password. Please try again.");
    } catch {
      setError("Could not reach CallFlow. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
      <div>
        <label htmlFor="new-password" className="block text-sm font-medium text-ink">
          New password
        </label>
        <input
          id="new-password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="mt-1.5 w-full rounded-[10px] border border-separator bg-white px-3 py-2.5 text-ink outline-none focus:border-wire"
        />
      </div>

      <div>
        <label htmlFor="confirm-password" className="block text-sm font-medium text-ink">
          Confirm password
        </label>
        <input
          id="confirm-password"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          className="mt-1.5 w-full rounded-[10px] border border-separator bg-white px-3 py-2.5 text-ink outline-none focus:border-wire"
        />
      </div>

      {error && (
        <p role="alert" className="text-sm font-medium text-[#c0392b]">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-[10px] bg-gold px-4 py-2.5 text-sm font-semibold text-[#0b1f3a] shadow-[var(--shadow-pill)] disabled:opacity-60"
      >
        {busy ? "Saving…" : "Create password"}
      </button>
    </form>
  );
}
