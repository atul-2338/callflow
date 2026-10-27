"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Lock,
  Phone,
} from "lucide-react";
import { toE164InternationalPhone } from "@/lib/util";

const INDUSTRIES = [
  "Plumbing",
  "HVAC",
  "Electrical",
  "Salon / Spa",
  "Dental",
  "Medical / Clinic",
  "Restaurant",
  "Automotive",
  "Real estate",
  "Other",
];

const CARRIERS = [
  "Verizon",
  "T-Mobile",
  "AT&T",
  "UScellular",
  "Other / MVNO",
];

const COUNTRIES = ["US", "CA", "GB", "AU", "IN", "DE", "FR"];

interface FormState {
  name: string;
  industry: string;
  carrier: string;
  phone: string;
  email: string;
  country: string;
}

type Errors = Partial<Record<keyof FormState, string>>;

function validate(f: FormState): Errors {
  const e: Errors = {};
  if (f.name.trim().length < 2) e.name = "Enter your business name.";
  if (!f.industry) e.industry = "Select your industry.";
  if (!f.carrier) e.carrier = "Select your carrier.";
  try {
    toE164InternationalPhone(f.phone, f.country);
  } catch {
    e.phone = "Enter a valid business number with country code (e.g. +1 555 123 4567).";
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim()))
    e.email = "Enter a valid email address.";
  return e;
}

/*
 * Phase 2 — onboarding wizard. Step 1 collects the business profile; step 2
 * POSTs /api/billing/signup, which creates the Dodo customer and a hosted
 * Checkout Session for the Solo plan (3-day trial, $49/mo) and returns its URL.
 * trial_started_at is stamped by the /api/webhooks/dodo handler when Dodo
 * reports `subscription.active`, so our trial window matches Dodo's billing.
 */
export default function OnboardingWizard() {
  const [step, setStep] = useState<1 | 2>(1);
  const [form, setForm] = useState<FormState>({
    name: "",
    industry: "",
    carrier: "",
    phone: "",
    email: "",
    country: "US",
  });
  const [errors, setErrors] = useState<Errors>({});
  // True while the Step-1 name pre-check round-trip is in flight.
  const [checkingName, setCheckingName] = useState(false);

  function update<K extends keyof FormState>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  }

  // Step-1 → Step-2 transition. Local validation only: the authoritative
  // duplicate-name check runs in createBillingSignup on /api/billing/signup
  // before anything is created (a taken name is routed back to Step 1).
  async function handleContinue(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate(form);
    setErrors(errs);
    if (!Object.values(errs).every((v) => v === undefined)) return;
    setCheckingName(true);
    try {
      // Tiny yield so the button's disabled state paints before the heavier
      // step-2 render — behavior otherwise identical to a plain setStep.
      await Promise.resolve();
      setStep(2);
    } finally {
      setCheckingName(false);
    }
  }

  // The authoritative duplicate-name check in /api/billing/signup rejected
  // the name after Step 1: send the owner back to Step 1 and surface it
  // under the name field.
  function handleNameTaken(message: string) {
    setErrors((current) => ({ ...current, name: message }));
    setStep(1);
  }

  return (
    <div className="flex min-h-screen flex-col px-4 pb-16">
      <header className="mx-auto flex w-full max-w-md items-center gap-2.5 py-6">
        <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-gold text-[#0b1f3a] shadow-[var(--shadow-pill)]">
          <Phone className="h-4.5 w-4.5" />
        </div>
        <span className="text-lg font-semibold tracking-tight">CallFlow</span>
      </header>

      <div className="mx-auto w-full max-w-md">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-semibold text-gold">Step {step} of 2</span>
          {step === 2 && (
            <button
              type="button"
              onClick={() => setStep(1)}
              className="inline-flex items-center gap-1 text-white/60 hover:text-white"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </button>
          )}
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gold transition-all duration-300"
            style={{ width: step === 1 ? "50%" : "100%" }}
          />
        </div>

        {step === 1 ? (
          <StepOne
            form={form}
            errors={errors}
            onChange={update}
            onSubmit={handleContinue}
            checking={checkingName}
          />
        ) : (
          <StepTwo form={form} onNameTaken={handleNameTaken} />
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-ink">{label}</label>
      {children}
      {error && <p className="mt-1.5 text-sm text-danger">{error}</p>}
    </div>
  );
}

function StepOne({
  form,
  errors,
  onChange,
  onSubmit,
  checking,
}: {
  form: FormState;
  errors: Errors;
  onChange: <K extends keyof FormState>(key: K, value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  /** True while the name pre-check round-trip is in flight. */
  checking?: boolean;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="ios-card mt-6 space-y-5 p-6 sm:p-8"
      noValidate
    >
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">
          Tell us about your business
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-2">
          We use this to set up your AI receptionist and missed-call line.
        </p>
      </div>

      <Field label="Business name" error={errors.name}>
        <input
          type="text"
          autoFocus
          value={form.name}
          onChange={(e) => onChange("name", e.target.value)}
          placeholder="e.g. Reeves Plumbing"
          className="ios-field"
        />
      </Field>

      <Field label="Industry" error={errors.industry}>
        <select
          value={form.industry}
          onChange={(e) => onChange("industry", e.target.value)}
          className="ios-field appearance-none"
        >
          <option value="">Select your industry…</option>
          {INDUSTRIES.map((i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Mobile carrier" error={errors.carrier}>
        <select
          value={form.carrier}
          onChange={(e) => onChange("carrier", e.target.value)}
          className="ios-field appearance-none"
        >
          <option value="">Select your carrier…</option>
          {CARRIERS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-xs text-ink-3">
          We generate the exact call-forwarding code for your carrier.
        </p>
      </Field>

      <Field label="Business phone number" error={errors.phone}>
        <input
          type="tel"
          value={form.phone}
          onChange={(e) => onChange("phone", e.target.value)}
          placeholder="+1 555 123 4567"
          className="ios-field"
        />
      </Field>

      <Field label="Owner email" error={errors.email}>
        <input
          type="email"
          value={form.email}
          onChange={(e) => onChange("email", e.target.value)}
          placeholder="you@business.com"
          className="ios-field"
        />
      </Field>

      <button
        type="submit"
        disabled={checking}
        className="ios-pill-primary w-full px-4 py-3.5 text-[15px] disabled:opacity-60"
      >
        {checking ? "Checking availability…" : "Continue"}
        <ArrowRight className="h-4 w-4" />
      </button>
    </form>
  );
}

const PLAN_FEATURES = [
  "24/7 AI answering & message taking",
  "Appointment booking for your business",
  "Call log with full transcripts",
  "Instant push notification per call",
  "Your own dedicated number",
  "Cancel anytime",
];

function StepTwo({
  form,
  onNameTaken,
}: {
  form: FormState;
  /** Called when signup rejects the name as taken; the parent returns to Step 1. */
  onNameTaken: (message: string) => void;
}) {
  const [country, setCountry] = useState("US");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function startCheckout() {
    setError("");
    setSubmitting(true);
    try {
      const response = await fetch("/api/billing/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumber: form.phone.replace(/[^\d+]/g, ""),
          name: form.name.trim(),
          email: form.email.trim(),
          country,
        }),
      });
      const data = (await response.json()) as {
        checkoutUrl?: string | null;
        alreadySubscribed?: boolean;
        businessId?: string | null;
        error?: string;
        code?: string;
      };
      if (!response.ok) {
        // A different business claimed the name between the Step-1
        // pre-check and this checkout — route the message back to the
        // name field instead of the step-level error.
        if (data.code === "business_name_taken") {
          onNameTaken(
            data.error ||
              "This business name is already taken. Please choose another."
          );
          setSubmitting(false);
          return;
        }
        throw new Error(data.error || "Unable to start your trial.");
      }

      if (data.checkoutUrl) {
        window.location.assign(data.checkoutUrl);
        return;
      }
      // No URL means a verified Dodo webhook already linked a subscription to
      // this business: go to the page that reports the server-side state.
      if (data.alreadySubscribed) {
        window.location.assign("/checkout/return");
        return;
      }
      throw new Error("Dodo did not return a checkout URL. Your trial has not started yet.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to start your trial.");
      setSubmitting(false);
    }
  }

  return (
    <div className="ios-card mt-6 p-6 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-ink">
          Start your free trial
        </h1>
        <span className="rounded-full bg-booked/10 px-3 py-1 text-xs font-semibold text-booked">
          3-day free trial
        </span>
      </div>
      {form.name && (
        <p className="mt-1.5 text-sm text-ink-2">
          Setting things up for <b className="text-ink">{form.name.trim()}</b>.
        </p>
      )}

      <div className="mt-6 rounded-2xl border border-separator p-5">
        <div className="flex items-baseline justify-between">
          <p className="text-base font-semibold text-ink">CallFlow Solo</p>
          <p className="text-sm text-ink-3">$49 / month</p>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-4xl font-bold tracking-tight text-ink">$0</span>
          <span className="text-sm text-ink-2">due today</span>
        </div>
        <ul className="mt-5 space-y-2.5">
          {PLAN_FEATURES.map((f) => (
            <li key={f} className="flex items-start gap-2.5 text-sm text-ink-2">
              <CheckCircle2 className="mt-0.5 h-4.5 w-4.5 shrink-0 text-booked" />
              {f}
            </li>
          ))}
        </ul>
      </div>

      <Field label="Billing country" error={error || undefined}>
        <select
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          className="ios-field mt-5 appearance-none"
        >
          {COUNTRIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Field>
      <button
        type="button"
        onClick={startCheckout}
        disabled={submitting}
        className="ios-pill-primary mt-6 w-full px-4 py-3.5 text-[15px] disabled:opacity-60"
      >
        <Lock className="h-4 w-4" />
        {submitting ? "Opening secure checkout…" : "Start free trial — secure checkout"}
      </button>
      <p className="mt-3 text-center text-xs leading-relaxed text-ink-3">
        Checkout is powered by Dodo Payments: $0 today, then $49/month after
        your 3-day trial. Cancel anytime.
      </p>

      <div className="mt-5 text-center text-sm">
        <Link href="/" className="font-medium text-gold-strong hover:underline">
          Cancel and go home
        </Link>
      </div>
    </div>
  );
}

