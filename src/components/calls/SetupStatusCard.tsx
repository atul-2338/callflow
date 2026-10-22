"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CircleAlert, CircleCheck, Loader2, PhoneForwarded, Settings2 } from "lucide-react";

interface MeResponse {
  businessId: string;
  access: { state: string; entitled: boolean };
  trialEndsAt: string | null;
}

interface ForwardingStatusResponse {
  forwarding_status: string;
  last_verified_at: string | null;
}

type LoadState = "loading" | "signed-out" | "ready" | "error";

/** Honest billing copy — never implies entitlement the webhook hasn't granted. */
const BILLING_COPY: Record<string, string> = {
  awaiting_checkout: "Checkout not completed — the 3-day trial hasn't started.",
  trialing: "Trial active",
  active: "Subscription active",
  past_due: "Payment retrying — service continues meanwhile",
  on_hold: "Payment issue — recover the subscription in the billing portal",
  lapsed: "Subscription ended — restart billing from Settings",
};

/** What forwarding state means and the manual step attached to each. */
const FORWARDING_COPY: Record<string, string> = {
  not_started: "Forwarding not set up yet — dial your carrier's forwarding code from the setup page, then confirm.",
  pending: "Forwarding pending — dial the carrier forwarding code from the setup page and confirm it.",
  failed: "Forwarding setup failed — open the setup page, dial the carrier code again, and confirm.",
  active: "Call forwarding active — AI backup answers your missed calls",
};

export default function SetupStatusCard() {
  const [state, setState] = useState<LoadState>("loading");
  const [me, setMe] = useState<MeResponse | null>(null);
  const [forwarding, setForwarding] = useState<ForwardingStatusResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/me")
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json() as Promise<MeResponse>;
      })
      .then(async (data) => {
        if (cancelled) return;
        setMe(data);
        setState("ready");
        try {
          const res = await fetch(`/api/onboarding/status/${data.businessId}`);
          if (res.ok && !cancelled) setForwarding((await res.json()) as ForwardingStatusResponse);
        } catch {
          // Leave forwarding null — the card says "unknown" instead of guessing.
        }
      })
      .catch(() => {
        if (!cancelled) setState("signed-out");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "loading") {
    return (
      <div className="ios-card flex items-center gap-3 px-4 py-4 text-sm text-ink-3">
        <Loader2 className="h-4 w-4 animate-spin text-wire" /> Checking your setup…
      </div>
    );
  }

  if (state === "signed-out") {
    return (
      <div className="ios-card px-4 py-4">
        <p className="text-[13px] font-semibold text-ink">No business session on this device</p>
        <p className="mt-1 text-[13px] text-ink-2">
          Open setup to create your business (or sign in again) — calls below are shown without your account context.
        </p>
        <Link href="/setup" className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-semibold text-wire">
          Open setup →
        </Link>
      </div>
    );
  }

  if (state === "error" || !me) {
    return (
      <div className="ios-card px-4 py-4 text-[13px] text-ink-2">
        Couldn&apos;t load your setup status right now.
      </div>
    );
  }

  const forwardingStatus = forwarding?.forwarding_status ?? null;
  const forwardingCopy =
    forwardingStatus !== null
      ? (FORWARDING_COPY[forwardingStatus] ?? "Setup status unknown — open setup to check.")
      : "Setup status unknown right now — open setup to check.";
  const forwardingLive = forwardingStatus === "active";
  const billingState = me.access?.state ?? "unknown";
  const billingCopy = BILLING_COPY[billingState] ?? "Billing state unknown — check Settings.";
  const trialEnds = me.trialEndsAt ? new Date(me.trialEndsAt) : null;

  return (
    <div className="ios-card px-4 py-4">
      <p className="text-[11px] font-bold uppercase tracking-widest text-ink-3">Setup status</p>

      <div className="mt-2 flex items-start gap-2.5">
        {forwardingLive ? (
          <CircleCheck className="mt-0.5 h-4.5 w-4.5 shrink-0 text-booked" />
        ) : (
          <CircleAlert className="mt-0.5 h-4.5 w-4.5 shrink-0 text-callback" />
        )}
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-ink">
            {forwardingCopy}
            {forwardingLive && forwarding?.last_verified_at
              ? ` (verified ${new Date(forwarding.last_verified_at).toLocaleDateString([], {
                  month: "short",
                  day: "numeric",
                })})`
              : ""}
          </p>
          {!forwardingLive && (
            <p className="mt-1 text-[12px] text-ink-3">
              Manual step: dial your carrier&apos;s forwarding code (setup page) and confirm, or run the test call.
            </p>
          )}
        </div>
      </div>

      <div className="mt-2 flex items-start gap-2.5 border-t border-separator pt-2">
        <PhoneForwarded className="mt-0.5 h-4.5 w-4.5 shrink-0 text-ink-3" />
        <p className="min-w-0 text-[13px] text-ink-2">
          Billing: {billingCopy}
          {billingState === "trialing" && trialEnds
            ? ` — ends ${trialEnds.toLocaleDateString([], { month: "short", day: "numeric" })}.`
            : "."}
        </p>
      </div>

      <div className="mt-3 flex items-center gap-4">
        <Link
          href="/setup"
          className="ios-pill-primary px-4 py-2 text-[13px]"
        >
          <Settings2 className="h-3.5 w-3.5" /> Open setup
        </Link>
        <Link href="/settings" className="text-[13px] font-semibold text-wire">
          Settings →
        </Link>
      </div>
    </div>
  );
}