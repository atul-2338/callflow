"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  Loader2,
  PartyPopper,
  Phone,
  PhoneForwarded,
} from "lucide-react";
import {
  carrierForwarding,
  formatUsNumber,
  telHref,
} from "@/lib/forwarding-codes";

/**
 * The ONE linear onboarding flow (steps 1–4), rendered at /onboarding for a
 * signed-in business whose onboardingStep is not "done". No branching: every
 * step either advances or stays. Resumes at the saved step (the server
 * renders the right step from businesses.onboardingStep) and step 4 polls
 * /api/onboarding/state so the Dograh webhook's automatic "done" advance
 * shows up without a manual refresh.
 */

const CARRIER_OPTIONS = [
  { value: "att", label: "AT&T" },
  { value: "verizon", label: "Verizon" },
  { value: "tmobile", label: "T-Mobile" },
  { value: "other", label: "Other" },
];

export interface OwnerOnboardingBusiness {
  id: string;
  name: string | null;
  ownerPhone: string;
  carrier: string;
  assignedNumber: string | null;
  onboardingStep: string;
}

interface StartResponse {
  assignedNumber?: string | null;
  pending?: boolean;
  onboardingStep?: string;
  error?: string;
}

const inputClass =
  "w-full rounded-xl border border-separator bg-white px-4 py-3 text-[15px] text-ink outline-none transition focus:border-wire";

function formatPhoneInput(value: string): string {
  const digits = value.replace(/\D/g, "").replace(/^1/, "").slice(0, 10);
  if (!digits) return "";
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
}

function StepIndicator({ step }: { step: string }) {
  const current = step === "done" ? 5 : Number(step) || 1;
  return (
    <div className="mb-6">
      <p className="text-xs font-semibold uppercase tracking-widest text-ink-3">
        Step {Math.min(current, 4)} of 4
      </p>
      <div className="mt-2 flex gap-1.5">
        {[1, 2, 3, 4].map((s) => (
          <div
            key={s}
            className={`h-1 flex-1 rounded-full transition-colors ${
              s <= current ? "bg-wire" : "bg-black/[0.08]"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

export default function OwnerOnboarding({
  business,
}: {
  business: OwnerOnboardingBusiness;
}) {
  const router = useRouter();
  const [step, setStep] = useState(business.onboardingStep);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Step 1 fields, prefilled from the business row.
  const [name, setName] = useState(business.name ?? "");
  const [ownerPhone, setOwnerPhone] = useState(
    formatPhoneInput(business.ownerPhone)
  );
  const [carrier, setCarrier] = useState(business.carrier || "other");

  // Step 2 state: the assigned number (null while the pool is empty).
  const [assignedNumber, setAssignedNumber] = useState(
    business.assignedNumber
  );
  const [copied, setCopied] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // Poll while waiting: an empty pool (step 2) until the admin adds numbers,
  // and step 4 until the first attributed call flips the flow to done.
  useEffect(() => {
    const waiting = (step === "2" && !assignedNumber) || step === "4";
    if (!waiting || pollRef.current) return;
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch("/api/onboarding/state", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as {
          onboardingStep?: string;
          assignedNumber?: string | null;
        };
        if (data.assignedNumber) setAssignedNumber(data.assignedNumber);
        if (data.onboardingStep === "done") {
          stopPolling();
          setStep("done");
        }
      } catch {
        // Transient — keep polling.
      }
    }, 5000);
    return stopPolling;
  }, [step, assignedNumber, stopPolling]);

  async function submitStepOne(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/onboarding/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          ownerPhone: ownerPhone.replace(/\D/g, ""),
          carrier,
        }),
      });
      const data = (await res.json()) as StartResponse;
      if (!res.ok) {
        setError(data.error || "Could not save your business info.");
        return;
      }
      setAssignedNumber(data.assignedNumber ?? null);
      setStep(data.onboardingStep || "2");
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function advanceStep(next: string) {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/onboarding/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: next }),
      });
      const data = (await res.json()) as {
        onboardingStep?: string;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error || "Could not save the step.");
        return;
      }
      setStep(data.onboardingStep ?? next);
      if (next === "done") router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function copyNumber() {
    if (!assignedNumber) return;
    void navigator.clipboard?.writeText(assignedNumber).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  }

  if (step === "done") {
    return (
      <div className="ios-card mt-6 p-8 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-booked/10 text-booked">
          <PartyPopper className="h-8 w-8" />
        </div>
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-ink">
          You&apos;re all set!
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">
          Your missed calls now reach the CallFlow AI on{" "}
          <b className="text-ink">
            {assignedNumber
              ? formatUsNumber(assignedNumber)
              : "your Callflow number"}
          </b>
          .
        </p>
        <button
          type="button"
          onClick={() => router.push("/app")}
          className="ios-pill-primary mt-6 w-full px-4 py-3.5 text-[15px]"
        >
          Go to my dashboard
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="ios-card mt-6 p-6 sm:p-8">
      <StepIndicator step={step} />
      {error && <p className="mb-4 text-sm text-danger">{error}</p>}

      {step === "1" && (
        <form onSubmit={submitStepOne} className="space-y-5" noValidate>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink">
              Tell us about your business
            </h1>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-2">
              This sets up your Callflow number and the AI that answers your
              missed calls.
            </p>
          </div>
          <div>
            <label
              htmlFor="ob-name"
              className="mb-1.5 block text-sm font-medium text-ink"
            >
              Business name
            </label>
            <input
              id="ob-name"
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Reeves Plumbing"
              className={inputClass}
            />
          </div>
          <div>
            <label
              htmlFor="ob-phone"
              className="mb-1.5 block text-sm font-medium text-ink"
            >
              Owner&apos;s phone number
            </label>
            <input
              id="ob-phone"
              type="tel"
              value={ownerPhone}
              onChange={(e) => setOwnerPhone(formatPhoneInput(e.target.value))}
              placeholder="(555) 123-4567"
              className={inputClass}
            />
            <p className="mt-1.5 text-xs text-ink-3">
              The number your customers dial today — the one whose missed calls
              will be forwarded.
            </p>
          </div>
          <div>
            <label
              htmlFor="ob-carrier"
              className="mb-1.5 block text-sm font-medium text-ink"
            >
              Carrier
            </label>
            <select
              id="ob-carrier"
              value={carrier}
              onChange={(e) => setCarrier(e.target.value)}
              className={`${inputClass} appearance-none`}
            >
              {CARRIER_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={busy}
            className="ios-pill-primary flex w-full items-center justify-center px-4 py-3.5 text-[15px] disabled:opacity-60"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Saving…
              </>
            ) : (
              <>
                Continue <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </form>
      )}

      {step === "2" && (
        <div className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-wire/10 text-wire">
            <Phone className="h-7 w-7" />
          </div>
          {assignedNumber ? (
            <>
              <h1 className="mt-4 text-2xl font-bold tracking-tight text-ink">
                Your Callflow number
              </h1>
              <div className="mt-4 flex items-center justify-center gap-3">
                <span className="text-3xl font-bold tracking-tight text-ink">
                  {formatUsNumber(assignedNumber)}
                </span>
                <button
                  type="button"
                  onClick={copyNumber}
                  aria-label="Copy your Callflow number"
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-separator bg-white text-ink-2 transition hover:text-ink active:scale-95"
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-booked" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-ink-2">
                This is the number your missed calls will be forwarded to.
              </p>
              <button
                type="button"
                onClick={() => advanceStep("3")}
                disabled={busy}
                className="ios-pill-primary mt-6 flex w-full items-center justify-center px-4 py-3.5 text-[15px] disabled:opacity-60"
              >
                Continue <ArrowRight className="h-4 w-4" />
              </button>
            </>
          ) : (
            <>
              <h1 className="mt-4 text-2xl font-bold tracking-tight text-ink">
                Your number is being prepared
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-ink-2">
                We&apos;ll email you within 24 h — as soon as your number is
                ready this page updates automatically.
              </p>
              <div className="mt-4 flex items-center justify-center gap-2 text-xs text-ink-3">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Waiting for a
                number…
              </div>
            </>
          )}
        </div>
      )}

      {step === "3" && assignedNumber && (
        <ForwardingStep
          carrier={carrier}
          assignedNumber={assignedNumber}
          busy={busy}
          onDone={() => advanceStep("4")}
        />
      )}

      {step === "4" && (
        <div className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-booked/10 text-booked">
            <PhoneForwarded className="h-7 w-7" />
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-ink">
            Test it now
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-ink-2">
            Call your business number from another phone and let it ring
            unanswered — the Callflow AI picks it up and this page advances to
            done automatically.
          </p>
          <div className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-wire/10 px-4 py-3 text-xs font-medium text-wire">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Listening for your
            first call…
          </div>
          <button
            type="button"
            onClick={() => advanceStep("done")}
            disabled={busy}
            className="mt-6 w-full rounded-full border border-separator bg-white px-4 py-3 text-sm font-medium text-ink-2 transition hover:text-ink disabled:opacity-60"
          >
            Skip — I&apos;ll test later
          </button>
        </div>
      )}
    </div>
  );
}

function ForwardingStep({
  carrier,
  assignedNumber,
  busy,
  onDone,
}: {
  carrier: string;
  assignedNumber: string;
  busy: boolean;
  onDone: () => void;
}) {
  const forwarding = carrierForwarding(carrier, assignedNumber);
  const manualOnly = carrier === "other";
  return (
    <div>
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight text-ink">
          Turn on forwarding
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-2">
          Dial this code on your phone ({forwarding.label}) — your unanswered
          calls then ring the Callflow AI.
        </p>
      </div>

      <a
        href={telHref(carrier, assignedNumber)}
        className="mt-5 flex items-center justify-center gap-2 rounded-2xl bg-[#0b1f3a] px-4 py-5 text-lg font-bold tracking-tight text-white shadow-sm transition active:scale-[0.99]"
      >
        <PhoneForwarded className="h-5 w-5" />
        {forwarding.dialString}
      </a>
      <p className="mt-2 text-center text-xs text-ink-3">
        Tap to dial · forwards after {forwarding.ringSeconds} seconds of
        ringing
      </p>

      {manualOnly && (
        <p className="mt-4 rounded-xl bg-callback/10 p-3 text-xs leading-relaxed text-callback">
          Other carrier? Contact them and ask them to forward unanswered calls
          to <b>{formatUsNumber(assignedNumber)}</b> if the code is rejected.
        </p>
      )}

      <ol className="mt-4 list-inside list-decimal space-y-1.5 text-sm leading-relaxed text-ink-2">
        <li>Tap the code above — your dialer opens with it pre-filled.</li>
        <li>Press call and wait for the confirmation tone or message.</li>
        <li>Confirm below once your phone shows the forward is on.</li>
      </ol>
      {forwarding.note && (
        <p className="mt-3 text-xs leading-relaxed text-ink-3">
          {forwarding.note}
        </p>
      )}

      <button
        type="button"
        onClick={onDone}
        disabled={busy}
        className="ios-pill-primary mt-6 flex w-full items-center justify-center gap-2 px-4 py-3.5 text-[15px] disabled:opacity-60"
      >
        <CheckCircle2 className="h-4 w-4" /> I&apos;ve dialed it — continue
      </button>
    </div>
  );
}