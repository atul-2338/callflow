"use client";

import { useState } from "react";

import { passwordPolicyError } from "@/lib/password-policy";

/**
 * "Change your password" form on /account.
 *
 * The owning rule (8+ characters, both fields equal) is shared with
 * /setup-password via src/lib/password-policy.ts and checked HERE for instant
 * feedback and again in POST /api/auth/change-password, which is the authority.
 *
 * `hasPassword` (resolved server-side) decides whether the current password is
 * asked for: an owner who has only ever signed in with a login link has no
 * password to confirm yet.
 */
export default function ChangePasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    if (hasPassword && !currentPassword) {
      setError("Enter your current password.");
      return;
    }
    const localError = passwordPolicyError(newPassword, confirm);
    if (localError) {
      setError(localError);
      return;
    }

    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, confirm }),
      });
      if (response.ok) {
        setSaved(true);
        setCurrentPassword("");
        setNewPassword("");
        setConfirm("");
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
    <form onSubmit={handleSubmit} className="mt-4 space-y-4" noValidate>
      {hasPassword && (
        <div>
          <label htmlFor="current-password" className="block text-sm font-medium text-ink">
            Current password
          </label>
          <input
            id="current-password"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            className="mt-1.5 w-full rounded-[10px] border border-separator bg-white px-3 py-2.5 text-ink outline-none focus:border-wire"
          />
        </div>
      )}

      <div>
        <label htmlFor="account-new-password" className="block text-sm font-medium text-ink">
          New password
        </label>
        <input
          id="account-new-password"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={8}
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          className="mt-1.5 w-full rounded-[10px] border border-separator bg-white px-3 py-2.5 text-ink outline-none focus:border-wire"
        />
      </div>

      <div>
        <label htmlFor="account-confirm-password" className="block text-sm font-medium text-ink">
          Confirm new password
        </label>
        <input
          id="account-confirm-password"
          name="confirm"
          type="password"
          autoComplete="new-password"
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
      {saved && (
        <p role="status" className="text-sm font-medium text-[#1f8a3b]">
          Password updated. Use it the next time you log in.
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-[10px] bg-gold px-4 py-2.5 text-sm font-semibold text-[#0b1f3a] shadow-[var(--shadow-pill)] disabled:opacity-60"
      >
        {busy ? "Saving…" : hasPassword ? "Change password" : "Create password"}
      </button>
    </form>
  );
}
