"use client";

import { useState, type FormEvent } from "react";

/**
 * Password-only admin sign-in, rendered by the /admin entry page when signed
 * out. On success the server sets the HttpOnly admin session cookie and we
 * hard-navigate to /admin (full reload, so no client router cache can keep
 * showing the sign-in form — the freshly rendered /admin is the overview);
 * every failure shows the server's generic message (the login API never
 * distinguishes causes).
 */
export default function AdminLoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (response.ok) {
        // window.location.replace, not router.replace: the cookie was set on
        // the server, so the next request must actually re-fetch /admin from
        // scratch — and replace() keeps the form out of the back-button
        // history, matching the old router.replace semantics.
        window.location.replace("/admin");
        return;
      }
      const data: unknown = await response.json().catch(() => null);
      const message =
        data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
          ? (data as { error: string }).error
          : "Sign-in failed. Try again.";
      setError(message);
    } catch {
      setError("Sign-in failed. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-4">
      <div>
        <label htmlFor="admin-password" className="mb-1 block text-sm font-medium text-ink-2">
          Admin password
        </label>
        <input
          id="admin-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          autoFocus
          className="ios-field"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <button
        type="submit"
        disabled={submitting || password.length === 0}
        className="w-full rounded-full bg-[#0b1f3a] px-4 py-2.5 text-sm font-semibold text-white transition active:scale-[0.98] disabled:opacity-50"
      >
        {submitting ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}