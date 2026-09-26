"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import type { BillingAccessState } from "@/lib/billing";

/**
 * Landing point for `DODO_PAYMENTS_RETURN_URL`.
 *
 * Dodo appends `?status=success|failed&session_id=...` to the return URL, and
 * that is treated as a *display hint only*: nothing here grants access. The
 * single source of truth is `/api/me`, which reports what the signature-verified
 * webhook has already written to the database. So this page polls it.
 *
 * The webhook usually wins the race within a couple of seconds; if it has not
 * arrived by the timeout we say so honestly instead of pretending the trial
 * started, and offer a retry plus a link back into checkout.
 */

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 60_000;

type MeResponse = {
  subscriptionStatus: string;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  access: { state: BillingAccessState; entitled: boolean };
  hasSubscription: boolean;
  checkoutSessionId: string | null;
};

type Phase = "verifying" | "confirmed" | "unconfirmed" | "declined" | "signed_out";

function formatDate(value: string | null): string {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? ""
    : parsed.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

export default function CheckoutReturn() {
  const [phase, setPhase] = useState<Phase>("verifying");
  const [me, setMe] = useState<MeResponse | null>(null);
  const [attemptedSessionId, setAttemptedSessionId] = useState<string | null>(null);
  // Fixed when the component mounts: polling gives up after the timeout and then
  // tells the truth instead of spinning forever.
  const [deadline] = useState(() => Date.now() + POLL_TIMEOUT_MS);

  const check = useCallback(async () => {
    const response = await fetch("/api/me", { cache: "no-store" });

    // Dodo's query params are read after the await: they only inform the copy,
    // and touching them here keeps server and client markup identical.
    const params = new URLSearchParams(window.location.search);
    setAttemptedSessionId(params.get("session_id"));
    const declinedByRedirect = params.get("status") === "failed";

    if (response.status === 401 || response.status === 404) {
      setPhase("signed_out");
      return;
    }
    if (!response.ok) {
      setPhase(Date.now() < deadline ? "verifying" : "unconfirmed");
      return;
    }

    const data = (await response.json()) as MeResponse;
    setMe(data);

    if (data.access.entitled && data.hasSubscription) {
      setPhase("confirmed");
      return;
    }
    if (
      declinedByRedirect ||
      data.subscriptionStatus === "cancelled" ||
      data.subscriptionStatus === "failed"
    ) {
      setPhase("declined");
      return;
    }
    setPhase(Date.now() < deadline ? "verifying" : "unconfirmed");
  }, [deadline]);

  useEffect(() => {
    if (phase !== "verifying") return;
    let cancelled = false;

    // The first poll runs immediately; `check` is async (its setState calls
    // happen after an await), so this is not a synchronous setState-in-effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void check();
    const timer = setInterval(() => {
      if (cancelled) return;
      void check();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [phase, check]);

  const trialEndsAt = me?.trialEndsAt ?? null;

  if (phase === "confirmed") {
    return (
      <Shell
        tone="success"
        title="You're in."
        body={
          trialEndsAt ? (
            <>
              Your 3-day free trial runs until{" "}
              <b className="text-ink">{formatDate(trialEndsAt)}</b>, then Solo bills
              $49/month. Cancel any time before then and you are never charged.
            </>
          ) : (
            <>Your subscription is active. Head to your dashboard to finish setup.</>
          )
        }
      >
        <Link href="/app" className="ios-pill-primary w-full px-4 py-3.5 text-[15px]">
          Go to my dashboard
        </Link>
        <Link
          href="/setup"
          className="mt-3 inline-flex w-full items-center justify-center rounded-full border border-separator px-4 py-3 text-[15px] font-medium text-ink-2 hover:bg-black/[0.03]"
        >
          Set up call forwarding
        </Link>
      </Shell>
    );
  }

  if (phase === "declined") {
    return (
      <Shell
        tone="danger"
        title="That payment didn't go through"
        body="No charge was made. Your details are still here — start checkout again and try a different card or payment method."
      >
        <Link href="/onboarding" className="ios-pill-primary w-full px-4 py-3.5 text-[15px]">
          Try checkout again
        </Link>
      </Shell>
    );
  }

  if (phase === "signed_out") {
    return (
      <Shell
        tone="warning"
        title="We can't match this browser to your checkout"
        body="Dodo sent you back to us, but the trial session cookie isn't in this browser. Finish checkout in the same tab or device you started it from, or sign up again below."
      >
        <Link href="/onboarding" className="ios-pill-primary w-full px-4 py-3.5 text-[15px]">
          Back to signup
        </Link>
      </Shell>
    );
  }

  if (phase === "unconfirmed") {
    return (
      <Shell
        tone="warning"
        title="Still waiting on Dodo's confirmation"
        body={
          <>
            Your payment page closed, but the signed confirmation webhook has not
            reached CallFlow yet, so your trial is not active. If you already paid,
            we will switch you on the moment it lands — check back in a minute.
            {attemptedSessionId && me?.checkoutSessionId &&
            attemptedSessionId !== me.checkoutSessionId
              ? " (Note: this return link belongs to an earlier checkout attempt.)"
              : ""}
          </>
        }
        actionLabel="Check again"
        actionIcon={<RefreshCw className="h-4 w-4" />}
        onAction={() => {
          setPhase("verifying");
        }}
      >
        <Link
          href="/onboarding"
          className="mt-3 inline-flex w-full items-center justify-center rounded-full border border-separator px-4 py-3 text-[15px] font-medium text-ink-2 hover:bg-black/[0.03]"
        >
          Return to checkout
        </Link>
      </Shell>
    );
  }

  return (
    <Shell
      tone="pending"
      title="Confirming your payment"
      body="Dodo is finalizing your subscription. This usually takes a few seconds — access switches on as soon as we have the signed confirmation, not before."
    >
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/10">
        <div className="h-full w-1/2 animate-pulse rounded-full bg-gold" />
      </div>
    </Shell>
  );
}

function Shell({
  tone,
  title,
  body,
  actionLabel,
  actionIcon,
  onAction,
  children,
}: {
  tone: "pending" | "success" | "warning" | "danger";
  title: string;
  body: React.ReactNode;
  actionLabel?: string;
  actionIcon?: React.ReactNode;
  onAction?: () => void;
  children?: React.ReactNode;
}) {
  const icon =
    tone === "success" ? (
      <CheckCircle2 className="h-7 w-7 text-booked" />
    ) : tone === "pending" ? (
      <Loader2 className="h-7 w-7 animate-spin text-gold-strong" />
    ) : (
      <AlertCircle className={`h-7 w-7 ${tone === "danger" ? "text-danger" : "text-callback"}`} />
    );

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-16">
      <div className="ios-card w-full max-w-md p-7 sm:p-9">
        <div className="flex items-start gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-black/[0.04]">
            {icon}
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-ink">{title}</h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">{body}</p>
          </div>
        </div>

        {actionLabel && onAction && (
          <button
            type="button"
            onClick={onAction}
            className="ios-pill-primary mt-7 w-full px-4 py-3.5 text-[15px]"
          >
            {actionIcon}
            {actionLabel}
          </button>
        )}

        {children ? <div className={tone === "pending" ? "mt-7" : "mt-4"}>{children}</div> : null}
      </div>
    </div>
  );
}

