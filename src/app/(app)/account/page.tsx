import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import ChangePasswordForm from "@/components/owner/ChangePasswordForm";
import { trialEndsAt } from "@/lib/billing";
import { getBusinessPasswordHash } from "@/lib/business-password";
import {
  businessSessionCookieName,
  verifyBusinessSessionToken,
} from "@/lib/business-session";
import { getBusinessById } from "@/lib/db";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Account — CallFlow",
  description: "Your CallFlow login email, password and client ID.",
};

/**
 * Owner account page — the only place a signed-in owner changes their password.
 *
 * Guarded twice: src/proxy.ts redirects a signed-out visitor to /login before
 * this ever renders (an optimistic gate), and the page resolves the session
 * itself, redirecting to /login when there is no business (the authority).
 *
 * Read-only facts only: the sign-in email (businesses.billingEmail — the column
 * login matches on), the business name, and the permanent client UID ("TE-…")
 * support asks for. The password hash itself is never rendered, only whether
 * one exists.
 */
export default async function AccountPage() {
  const cookieStore = await cookies();
  const businessId = verifyBusinessSessionToken(
    cookieStore.get(businessSessionCookieName())?.value
  );
  const business = businessId ? await getBusinessById(businessId) : undefined;
  if (!business) redirect("/login");

  const hasPassword = !!getBusinessPasswordHash(business.id);
  const trialEnd = business.trialStartedAt ? trialEndsAt(business.trialStartedAt) : null;

  return (
    <div className="mx-auto w-full max-w-md space-y-6 px-4 pb-16 pt-10 sm:pt-14">
      <div>
        <Link href="/app" className="text-sm font-medium text-ink-2 hover:text-ink">
          ← Dashboard
        </Link>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-ink">Account</h1>
        <p className="mt-1.5 text-sm text-ink-2">
          Your login details and password. Nothing here changes your phone setup.
        </p>
      </div>

      <section className="rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-ink">Your login</h2>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-ink-3">Email</dt>
            <dd className="min-w-0 truncate font-medium text-ink">
              {business.billingEmail ?? "—"}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-ink-3">Business</dt>
            <dd className="min-w-0 truncate font-medium text-ink">
              {business.billingName ?? "—"}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-ink-3">Client ID</dt>
            <dd className="font-mono text-xs text-ink-2">{business.clientUid}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-ink-3">Trial ends</dt>
            <dd className="text-ink-2">
              {trialEnd ? new Date(trialEnd).toLocaleDateString() : "—"}
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-xs leading-relaxed text-ink-3">
          CallFlow support asks for the client ID — quote it and nothing else.
          Plan and billing live in{" "}
          <Link href="/settings" className="font-medium text-wire underline">
            Settings
          </Link>
          .
        </p>
      </section>

      <section className="rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-ink">
          {hasPassword ? "Change password" : "Create a password"}
        </h2>
        <p className="mt-1 text-sm text-ink-2">
          {hasPassword
            ? "At least 8 characters. You stay signed in here after changing it."
            : "You have been signing in with a login link. Set a password to sign in with email and password from now on."}
        </p>
        <ChangePasswordForm hasPassword={hasPassword} />
      </section>
    </div>
  );
}
