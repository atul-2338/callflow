"use client";

import { useState } from "react";
import { CircleAlert, Clock, CreditCard, Loader2 } from "lucide-react";

import type { BillingAccessState } from "@/lib/billing";

/**
 * Trial banner + paywall for the owner dashboard (/app).
 *
 * The state is computed SERVER-side by `describeBillingAccess()` in
 * src/lib/billing.ts and handed in as props, so this component never decides
 * anyone's entitlement — it only renders it and drives the two CTAs:
 *
 *   - `checkout` → POST /api/billing/checkout, which mints a fresh, single-use
 *     Dodo hosted-checkout URL for THIS business (never a static env var).
 *   - `portal`   → POST /api/billing/portal, Dodo's customer portal, for a
 *     business that already has a subscription.
 *
 * Both land on an absolute https URL, so a full-page navigation is correct
 * (relative destinations never appear here — same pattern as
 * src/components/onboarding/CheckoutReturn.tsx).
 */
interface BillingNoticeProps {
  /** "paywall" replaces the dashboard; "banner" sits above it. */
  variant: "banner" | "paywall";
  state: BillingAccessState;
  /** Whole days left in the trial (0 = ends today); null when there is no trial. */
  trialDaysLeft: number | null;
  /** True when a Dodo subscription exists (including a cancelled one). */
  hasSubscription: boolean;
}

const PRICE_LINE = "$49 per month, cancel any time.";

function trialLine(days: number | null): string {
  if (days === null) return "Your free trial is running.";
  if (days <= 0) return "Your free trial ends today.";
  if (days === 1) return "1 day left in your free trial.";
  return `${days} days left in your free trial.`;
}

export default function BillingNotice({
  variant,
  state,
  trialDaysLeft,
  hasSubscription,
}: BillingNoticeProps) {
  const [busy, setBusy] = useState<"checkout" | "portal" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function go(path: string, key: "checkout" | "portal", field: "checkoutUrl" | "link") {
    if (busy) return;
    setBusy(key);
    setError(null);
    try {
      const response = await fetch(path, { method: "POST" });
      const data = (await response.json().catch(() => null)) as
        | (Record<string, unknown> & { error?: string })
        | null;
      const url = typeof data?.[field] === "string" ? (data[field] as string) : "";
      if (!response.ok || !/^https?:\/\//.test(url)) {
        setError(data?.error || "Could not open billing. Please try again.");
        return;
      }
      window.location.assign(url);
    } catch {
      setError("Could not reach CallFlow. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  if (variant === "paywall") {
    // Three honest cases, never one blanket sentence:
    //   - a subscription exists but is no longer active → the portal fixes it;
    //   - checkout was never completed (pending_checkout / not_started) →
    //     "finish setting up", NOT "your trial ended";
    //   - a trial that did run and lapsed → subscribe again.
    const title = hasSubscription
      ? "Your CallFlow plan is not active"
      : state === "awaiting_checkout"
        ? "Finish setting up your CallFlow plan"
        : "Your free trial has ended";
    const body = hasSubscription
      ? "Update your payment method to turn answering back on. Your call log and transcripts are safe and waiting."
      : state === "awaiting_checkout"
        ? `Your account is ready — the last step is the paid plan. ${PRICE_LINE}`
        : `Subscribe to keep CallFlow answering your missed calls. ${PRICE_LINE}`;

    return (
      <section className="rounded-2xl border border-danger/25 bg-danger/[0.06] p-6 text-center shadow-sm">
        <CircleAlert className="mx-auto h-8 w-8 text-danger" />
        <h1 className="mt-3 text-xl font-bold tracking-tight text-ink">{title}</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-ink-2">{body}</p>

        <div className="mt-5 flex flex-col items-center gap-3">
          {hasSubscription ? (
            <button
              type="button"
              onClick={() => go("/api/billing/portal", "portal", "link")}
              disabled={busy !== null}
              className="ios-pill-primary px-5 py-2.5 text-sm disabled:opacity-50"
            >
              {busy === "portal" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CreditCard className="h-4 w-4" />
              )}
              Manage billing
            </button>
          ) : (
            <button
              type="button"
              onClick={() => go("/api/billing/checkout", "checkout", "checkoutUrl")}
              disabled={busy !== null}
              className="ios-pill-primary px-5 py-2.5 text-sm disabled:opacity-50"
            >
              {busy === "checkout" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CreditCard className="h-4 w-4" />
              )}
              Subscribe — $49/month
            </button>
          )}
          <p className="text-xs text-ink-3">
            Need help?{" "}
            <a href="mailto:atul@callflow.biz" className="font-medium underline">
              Email support
            </a>
            .
          </p>
        </div>

        {error && (
          <p role="alert" className="mt-4 text-sm font-medium text-danger">
            {error}
          </p>
        )}
      </section>
    );
  }

  // Banner: only a trial, or a payment problem, is worth interrupting the
  // dashboard for. A healthy subscription renders nothing at all.
  const paymentTrouble = state === "past_due" || state === "on_hold";
  if (state !== "trialing" && !paymentTrouble) return null;

  return (
    <section
      className={`rounded-2xl border p-4 shadow-sm ${
        paymentTrouble
          ? "border-danger/25 bg-danger/[0.06]"
          : "border-callback/30 bg-callback/[0.10]"
      }`}
    >
      <div className="flex items-start gap-3">
        {paymentTrouble ? (
          <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
        ) : (
          <Clock className="mt-0.5 h-5 w-5 shrink-0 text-[#b25e00]" />
        )}
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">
            {paymentTrouble ? "Payment problem — action needed" : trialLine(trialDaysLeft)}
          </p>
          <p className="mt-1 text-sm text-ink-2">
            {paymentTrouble
              ? state === "on_hold"
                ? "Your last payment did not go through, so answering may stop soon. Update your card to keep it on."
                : "Your card was declined. Update it now to avoid an interruption."
              : `Subscribe before it ends and CallFlow keeps answering. ${PRICE_LINE}`}
          </p>

          <button
            type="button"
            onClick={
              paymentTrouble
                ? () => go("/api/billing/portal", "portal", "link")
                : () => go("/api/billing/checkout", "checkout", "checkoutUrl")
            }
            disabled={busy !== null}
            className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[#0b1f3a] px-4 py-2 text-xs font-semibold text-white transition active:scale-[0.98] disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CreditCard className="h-3.5 w-3.5" />
            )}
            {paymentTrouble ? "Update payment method" : "Subscribe — $49/month"}
          </button>

          {error && (
            <p role="alert" className="mt-2 text-sm font-medium text-danger">
              {error}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
