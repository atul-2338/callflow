"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import type { BillingAccessState } from "@/lib/billing";

/**
 * Landing point for `DODO_PAYMENTS_RETURN_URL`.
 *
 * Dodo appends `?status=success|failed&session_id=...` to the return URL, and
 * that is treated as a *display hint only*: nothing here grants access. The
 * source of truth is `POST /api/billing/confirm`, which reports what the
 * signature-verified webhook has already written to the database and — while a
 * checkout is still unconfirmed — double-checks the subscription's status
 * against Dodo's own API and applies it through the same trusted webhook write
 * path. So a webhook that loses the race against the redirect (or is lost
 * entirely) cannot leave a paying customer guessing. This page polls it.
 *
 * The webhook usually wins within a couple of seconds; if nothing has confirmed
 * by the timeout we say so honestly instead of pretending the trial started,
 * and offer a retry (which re-asks Dodo directly) plus a link back into
 * checkout.
 */

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 60_000;
/** After this many polls (~16s) the pending card admits it is taking long. */
const SLOW_AFTER_POLLS = 8;
/** Once confirmed, hand the owner to the final forwarding step automatically. */
const REDIRECT_DELAY_MS = 2000;

type MeResponse = {
  subscriptionStatus: string;
  subscriptionId: string | null;
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
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("verifying");
  const [me, setMe] = useState<MeResponse | null>(null);
  const [attemptedSessionId, setAttemptedSessionId] = useState<string | null>(null);
  // Fixed when the component mounts: polling gives up after the timeout and then
  // tells the truth instead of spinning forever. A manual "Check again" resets
  // it, so retrying always gets a full fresh window.
  const [deadline, setDeadline] = useState(() => Date.now() + POLL_TIMEOUT_MS);
  // Poll counter: drives the "this is taking longer than usual" copy. Setting
  // state on every poll also forces a render so that copy can appear even while
  // the phase itself is unchanged.
  const [attempts, setAttempts] = useState(0);

  const check = useCallback(async () => {
    // Dodo's query params are read inside this client-only callback (never
    // during render), so server and client markup stay identical. The
    // redirect's `session_id` also travels in the POST body: it lets the
    // server bind the checkout-bound signup handoff cookie to the exact
    // checkout Dodo redirected us back from.
    const params = new URLSearchParams(window.location.search);
    const response = await fetch("/api/billing/confirm", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checkoutSessionId: params.get("session_id") }),
    });

    setAttemptedSessionId(params.get("session_id"));
    setAttempts((count) => count + 1);
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

  // Confirmed → go to the wizard's final forwarding step automatically — the
  // dashboard is only reachable after the owner interacts with that step
  // (they must dial the forwarding code and confirm). ?forwarding=1 tells the
  // wizard to resume from its saved signup state instead of restarting.
  // Only on success: pending, declined, unconfirmed, and signed-out owners
  // stay on this page. The explicit link below remains as a fallback.
  useEffect(() => {
    if (phase !== "confirmed") return;
    const timer = setTimeout(
      () => router.push("/onboarding?forwarding=1"),
      REDIRECT_DELAY_MS
    );
    return () => clearTimeout(timer);
  }, [phase, router]);

  const trialEndsAt = me?.trialEndsAt ?? null;
  const slow = attempts >= SLOW_AFTER_POLLS;

  if (phase === "confirmed") {
    return (
      <Shell
        tone="success"
        title="Payment confirmed"
        body={
          <>
            Your Solo plan is active — $49/month.{" "}
            {trialEndsAt ? (
              <>
                Your 3-day free trial runs until{" "}
                <b className="text-ink">{formatDate(trialEndsAt)}</b>; cancel any
                time before then and you are never charged.
              </>
            ) : (
              <>You can start using Callflow right away.</>
            )}
          </>
        }
      >
        {me?.subscriptionId ? (
          <p className="text-xs text-ink-2">
            Subscription <span className="font-mono">{me.subscriptionId}</span> · verified with
            Dodo
          </p>
        ) : null}
        <p className="text-sm font-medium text-ink" aria-live="polite">
          Payment confirmed — taking you to your final setup step…
        </p>
        <Link
          href="/onboarding"
          className="ios-pill-primary w-full px-4 py-3.5 text-[15px]"
        >
          Finish setting up your Callflow number
        </Link>
      </Shell>
    );
  }

  if (phase === "declined") {
    return (
      <Shell
        tone="danger"
        title="That payment didn't go through"
        body="Dodo reported the payment as unsuccessful, so your trial was not started and you have not been charged. Your details are still saved — start checkout again and try a different card or payment method."
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
            Your payment page closed, but the signed confirmation has not reached
            CallFlow yet, so your trial is not active. If you already paid, your
            subscription switches on the moment it lands — checking again asks
            Dodo&apos;s servers directly.
            {attemptedSessionId && me?.checkoutSessionId &&
            attemptedSessionId !== me.checkoutSessionId
              ? " (Note: this return link belongs to an earlier checkout attempt.)"
              : ""}
          </>
        }
        actionLabel="Check again"
        actionIcon={<RefreshCw className="h-4 w-4" />}
        onAction={() => {
          setDeadline(Date.now() + POLL_TIMEOUT_MS);
          setAttempts(0);
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
      body={
        slow ? (
          <>
            Dodo is finalizing your subscription. This is taking longer than usual — we keep
            verifying directly against Dodo&apos;s servers, and your trial is anchored to when you
            paid, so nothing is lost by waiting.
          </>
        ) : (
          "Dodo is finalizing your subscription. This usually takes a few seconds — access switches on as soon as we have the signed confirmation, not before."
        )
      }
      actionLabel={slow ? "Check again" : undefined}
      actionIcon={slow ? <RefreshCw className="h-4 w-4" /> : undefined}
      onAction={
        slow
          ? () => {
              setAttempts(0);
              void check();
            }
          : undefined
      }
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