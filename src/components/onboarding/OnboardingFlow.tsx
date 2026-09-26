"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Copy,
  Loader2,
  PartyPopper,
  Phone,
  PhoneForwarded,
  Settings2,
} from "lucide-react";
import { toE164InternationalPhone } from "@/lib/util";

const CALLFLOW_NUMBER = "+1 (888) 545-9969";

function normalizePhone(v: string) {
  return v.replace(/[^\d+]/g, "");
}

export default function OnboardingFlow() {
  const [step, setStep] = useState(1);
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [billingName, setBillingName] = useState("");
  const [billingEmail, setBillingEmail] = useState("");
  const [billingCountry, setBillingCountry] = useState("");
  const [billingError, setBillingError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [trial, setTrial] = useState<{ start: string; end: string } | null>(null);

  useEffect(() => {
    async function loadBillingConfirmation() {
      const response = await fetch("/api/me", { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as {
        trialStartedAt: string | null;
        trialEndsAt: string | null;
        hasSubscription: boolean;
      };
      // Only a verified Dodo webhook can put a subscription id on this business,
      // so that — not the checkout redirect — is what completes the flow.
      if (data.hasSubscription) {
        if (data.trialStartedAt && data.trialEndsAt) {
          setTrial({ start: data.trialStartedAt, end: data.trialEndsAt });
        }
        setStep(3);
      }
    }
    void loadBillingConfirmation();
  }, []);

  function continueToInstructions(e: React.FormEvent) {
    e.preventDefault();
    try {
      toE164InternationalPhone(phone, billingCountry || "US");
    } catch {
      setPhoneError(
        "Please enter a valid phone number with country code (e.g. +1 555 123 4567)."
      );
      return;
    }
    setPhoneError("");
    setStep(2);
  }

  async function confirmSetup() {
    setBillingError("");
    setConfirming(true);
    try {
      const response = await fetch("/api/billing/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumber: normalizePhone(phone),
          name: billingName,
          email: billingEmail,
          country: billingCountry,
        }),
      });
      const data = (await response.json()) as {
        checkoutUrl?: string | null;
        alreadySubscribed?: boolean;
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "Unable to start your subscription.");

      if (!data.checkoutUrl) {
        if (data.alreadySubscribed) {
          window.location.assign("/checkout/return");
          return;
        }
        throw new Error("Dodo did not return a checkout URL. Your subscription has not been confirmed.");
      }
      window.location.assign(data.checkoutUrl);
    } catch (error) {
      setBillingError(error instanceof Error ? error.message : "Unable to start your subscription.");
      setConfirming(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-white/10 bg-white/5 px-3.5 py-3 text-base text-white placeholder-slate-500 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30";

  if (step === 1) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4">
        <span className="mb-3 text-sm font-semibold text-brand-400">Step 1 of 3</span>
        <h1 className="text-2xl font-bold tracking-tight text-white">
          What&apos;s your business phone number?
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          This is the number that will forward missed calls to CallFlow.
        </p>
        <form onSubmit={continueToInstructions} className="mt-6 space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">
              Business phone number
            </label>
            <input
              type="tel"
              autoFocus
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1 555 123 4567"
              className={inputClass}
            />
            {phoneError && <p className="mt-1.5 text-sm text-red-400">{phoneError}</p>}
          </div>
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-500/20 transition-colors hover:bg-brand-400"
          >
            Continue
            <ArrowRight className="h-4 w-4" />
          </button>
        </form>
      </div>
    );
  }

  if (step === 2) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-xl flex-col justify-center px-4 py-10">
        <span className="mb-3 text-sm font-semibold text-brand-400">Step 2 of 3</span>
        <h1 className="text-2xl font-bold tracking-tight text-white">
          Enable call forwarding on your phone
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          Route calls that reach your number to CallFlow so we can catch the ones
          you miss.
        </p>

        <div className="mt-6 rounded-2xl border border-white/10 bg-[#161a24] p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500/10 text-brand-400">
              <PhoneForwarded className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Forward to CallFlow</p>
              <p className="text-xs text-slate-500">When unanswered or busy</p>
            </div>
          </div>

          <div className="mt-4 rounded-lg bg-white/5 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Forwarding number
            </p>
            <div className="mt-1 flex items-center justify-between gap-3">
              <span className="text-lg font-bold tracking-tight text-white">
                {CALLFLOW_NUMBER}
              </span>
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText("+18885459969")}
                className="flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-white/10"
              >
                <Copy className="h-3.5 w-3.5" />
                Copy
              </button>
            </div>
          </div>

          <ol className="mt-4 list-inside list-decimal space-y-1.5 text-sm text-slate-400">
            <li>Open your phone&apos;s Settings</li>
            <li>
              Find <b className="text-slate-200">Call Forwarding</b> (often under “Phone” or
              “Call”)
            </li>
            <li>
              Forward <b className="text-slate-200">unanswered</b> and{" "}
              <b className="text-slate-200">busy</b> calls to {CALLFLOW_NUMBER}
            </li>
          </ol>

          <div className="mt-4 flex items-start gap-2 rounded-lg bg-brand-500/10 p-3 text-xs text-brand-300">
            <Settings2 className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              If you&apos;re just testing, you can skip forwarding — CallFlow catches
              calls made to its own number too.
            </p>
          </div>
        </div>

        <div className="mt-6 space-y-3 rounded-2xl border border-white/10 bg-[#161a24] p-5">
          <p className="text-sm font-semibold text-white">Start your 3-day free trial</p>
          <p className="text-xs text-slate-400">
            A payment method is collected securely by Dodo Payments. You will not be charged today.
          </p>
          <input
            value={billingName}
            onChange={(e) => setBillingName(e.target.value)}
            placeholder="Your name"
            autoComplete="name"
            className={inputClass}
          />
          <input
            type="email"
            value={billingEmail}
            onChange={(e) => setBillingEmail(e.target.value)}
            placeholder="Email address"
            autoComplete="email"
            className={inputClass}
          />
          <input
            value={billingCountry}
            onChange={(e) => setBillingCountry(e.target.value.toUpperCase())}
            placeholder="Billing country (2-letter code, e.g. US)"
            autoComplete="country"
            maxLength={2}
            className={inputClass}
          />
          {billingError && <p className="text-sm text-red-400">{billingError}</p>}
        </div>

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={() => setStep(1)}
            className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:bg-white/10"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <button
            type="button"
            onClick={confirmSetup}
            disabled={confirming}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand-500/20 transition-colors hover:bg-brand-400 disabled:opacity-50"
          >
            {confirming ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Opening secure checkout…
              </>
            ) : (
              <>
                Continue to secure checkout
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center px-4 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-500/10 text-brand-400">
        <PartyPopper className="h-8 w-8" />
      </div>
      <h1 className="mt-6 text-2xl font-bold tracking-tight text-white">
        You&apos;re all set!
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-slate-400">
        Your free trial began on{" "}
        <b className="text-slate-200">
          {trial ? new Date(trial.start).toLocaleDateString() : "the server-confirmed date"}
        </b>{" "}
        and ends on{" "}
        <b className="text-slate-200">
          {trial ? new Date(trial.end).toLocaleDateString() : "the server-confirmed date"}
        </b>
        . CallFlow is now watching <b className="text-slate-200">{CALLFLOW_NUMBER}</b>.
      </p>
      <div className="mt-8 flex w-full flex-col gap-3 sm:flex-row sm:justify-center">
        <Link
          href="/calls"
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-500/20 transition-colors hover:bg-brand-400"
        >
          <Phone className="h-4 w-4" />
          Go to dashboard
        </Link>
        <Link
          href="/"
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-6 py-3 text-sm font-medium text-slate-300 transition-colors hover:bg-white/10"
        >
          <CheckCircle2 className="h-4 w-4" />
          Back to home
        </Link>
      </div>
    </div>
  );
}
