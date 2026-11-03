"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Owner sign-in form (email + password).
 *
 * Deliberately dumb: it posts and displays exactly the message the server sent
 * back. The server owns the failure copy — one generic sentence for unknown
 * email or wrong password, and the "check your email" sentence only for an
 * account whose setup link has not been used yet — so this component can never
 * invent a field-specific hint of its own.
 */
export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }

    setError(null);
    setBusy(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (response.ok) {
        router.replace("/dashboard");
        return;
      }
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "Invalid email or password");
      setPassword("");
    } catch {
      setError("Could not reach CallFlow. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
      <div>
        <label htmlFor="login-email" className="block text-sm font-medium text-ink">
          Email
        </label>
        <input
          id="login-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="mt-1.5 w-full rounded-[10px] border border-separator bg-white px-3 py-2.5 text-ink outline-none focus:border-wire"
        />
      </div>

      <div>
        <label htmlFor="login-password" className="block text-sm font-medium text-ink">
          Password
        </label>
        <input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
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
        {busy ? "Signing in…" : "Log in"}
      </button>
    </form>
  );
}
