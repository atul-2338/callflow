"use client";

import { useState } from "react";
import {
  CheckCircle2,
  Copy,
  Loader2,
  Phone,
  PhoneForwarded,
  Settings2,
} from "lucide-react";
import {
  carrierForwarding,
  generateSetupInstruction,
  telHref,
} from "@/lib/forwarding-codes";
import { useForwardingDid } from "./useForwardingDid";

const CARRIERS = [
  { value: "verizon", label: "Verizon" },
  { value: "tmobile", label: "T-Mobile" },
  { value: "att", label: "AT&T" },
  { value: "other", label: "Other / MVNO" },
];

const inputClass = "ios-field";

/**
 * Carrier forwarding instructions extracted from OnboardingFlow (/setup) so
 * OnboardingWizard (/onboarding) can offer the same final step after checkout
 * instead of skipping straight to the dashboard.
 *
 * Renders three cards, in order:
 *  1. Carrier dropdown + generated dial string + copy/dial affordances
 *  2. Owner-attested confirmation -> POST /api/onboarding/complete
 *  3. Manual fallback if the dial code is rejected
 *
 * Deliberately excludes the Plivo/SMS verification card — that stays
 * /setup-only.
 */
interface CarrierForwardingStepProps {
  /** Business row id; the confirm button stays disabled until one exists. */
  businessId: string | null;
  /** Owner's E.164 number — only used to keep the carrier in sync. */
  ownerPhoneE164: string | null;
  /** Controlled carrier selection (verizon | tmobile | att | other). */
  carrier: string;
  /** Parents seed it from saved state; changes re-sync the business row. */
  onCarrierChange?: (carrier: string) => void;
  /** True once onboarding is complete; parents may seed it from restore/poll. */
  confirmed: boolean;
  /** Called after /api/onboarding/complete succeeds. */
  onConfirmed?: () => void;
}

export default function CarrierForwardingStep({
  businessId,
  ownerPhoneE164,
  carrier,
  onCarrierChange,
  confirmed,
  onConfirmed,
}: CarrierForwardingStepProps) {
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState("");
  // The forwarding DID comes from the server (/api/setup/config). While it is
  // loading or unavailable, the cards show a placeholder/error instead of
  // dial codes built from a wrong number.
  const {
    forwardingDid,
    display,
    loading,
    error: configError,
  } = useForwardingDid();
  const forwarding = forwardingDid
    ? carrierForwarding(carrier, forwardingDid)
    : null;
  const carrierLabel =
    CARRIERS.find((c) => c.value === carrier)?.label ?? "your carrier";

  function handleCarrierChange(next: string) {
    onCarrierChange?.(next);
    // Keep the business row in sync so the dashboard and any future
    // instructions use the carrier the owner actually picked. Reuses the same
    // idempotent start endpoint as signup — it updates the row in place and
    // still places no live calls.
    const owner = ownerPhoneE164;
    if (!businessId || !owner) return;
    void (async () => {
      try {
        await fetch("/api/onboarding/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone_number: owner, carrier: next }),
        });
      } catch {
        // Non-fatal — the row keeps its previous carrier.
      }
    })();
  }

  // Owner-attested confirmation: the plumber dialed their carrier's forwarding
  // code and got the confirmation tone/message. /api/onboarding/complete marks
  // onboarding complete and switches the AI backup on for their number.
  async function confirmDialCode() {
    if (!businessId || activating) return;
    setActivateError("");
    setActivating(true);
    try {
      const response = await fetch("/api/onboarding/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Unable to finish setup. Try again.");
      }
      onConfirmed?.();
    } catch (error) {
      setActivateError(
        error instanceof Error ? error.message : "Unable to finish setup. Try again."
      );
    } finally {
      setActivating(false);
    }
  }

  return (
    <>
      <div className="mt-6 rounded-2xl border border-separator bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-wire/10 text-wire">
            <PhoneForwarded className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-ink">Your setup instruction</p>
            <p className="text-xs text-ink-3">
              Carrier-specific — generated for {carrierLabel}
            </p>
          </div>
        </div>

        <div className="mt-4">
          <label
            htmlFor="carrier-forwarding"
            className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-3"
          >
            Your carrier
          </label>
          <select
            id="carrier-forwarding"
            value={carrier}
            onChange={(e) => handleCarrierChange(e.target.value)}
            className={`${inputClass} appearance-none`}
          >
            {CARRIERS.map((c) => (
              <option key={c.value} value={c.value} className="bg-white">
                {c.label}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-4 rounded-lg bg-black/[0.03] p-4">
          {configError ? (
            <p className="text-sm font-medium leading-relaxed text-danger">
              Setup is temporarily unavailable. Please contact support.
            </p>
          ) : loading || !forwardingDid ? (
            <p className="text-sm font-medium leading-relaxed text-ink-3">
              Loading setup code…
            </p>
          ) : (
            <p className="text-sm font-medium leading-relaxed text-ink">
              {generateSetupInstruction(carrier, forwardingDid)}
            </p>
          )}
        </div>

        <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-separator bg-white p-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-3">
              Forwarding code (dial this)
            </p>
            <p className="truncate font-mono text-base font-bold tracking-tight text-ink">
              {forwarding ? forwarding.dialString : "…"}
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              forwarding && navigator.clipboard?.writeText(forwarding.dialString)
            }
            disabled={!forwarding}
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-separator bg-white px-2.5 py-1.5 text-xs font-medium text-ink-2 transition-colors hover:bg-black/[0.03] disabled:opacity-50"
          >
            <Copy className="h-3.5 w-3.5" />
            Copy
          </button>
        </div>

        <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-separator bg-white p-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-3">
              Our number
            </p>
            <p className="truncate font-mono text-base font-bold tracking-tight text-ink">
              {display ?? "…"}
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              forwardingDid && navigator.clipboard?.writeText(forwardingDid)
            }
            disabled={!forwardingDid}
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-separator bg-white px-2.5 py-1.5 text-xs font-medium text-ink-2 transition-colors hover:bg-black/[0.03] disabled:opacity-50"
          >
            <Copy className="h-3.5 w-3.5" />
            Copy
          </button>
        </div>

        {forwarding && forwardingDid && (
          <a
            href={telHref(carrier, forwardingDid)}
            className="ios-pill-primary mt-4 flex w-full items-center justify-center gap-2 px-4 py-2.5 text-sm"
          >
            <Phone className="h-4 w-4" />
            Dial it now
          </a>
        )}

        {forwarding && (
          <p className="mt-3 text-xs text-ink-2">{forwarding.note}</p>
        )}
      </div>

      {/* Owner-attested confirmation completes onboarding. */}
      <div className="mt-6 rounded-2xl border border-separator bg-white p-5 shadow-sm">
        <p className="text-sm font-semibold text-ink">Confirm to finish setup</p>
        {confirmed ? (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-booked/10 p-3 text-sm font-medium text-booked">
            <CheckCircle2 className="h-4 w-4" />
            Onboarding complete — AI backup is active for your number.
          </div>
        ) : (
          <>
            <p className="mt-1 text-xs text-ink-2">
              After you dial the code, your phone plays a tone or shows a
              confirmation. Once you have it, tap below — we&apos;ll mark your
              onboarding complete and switch on the AI backup for your number
              right away.
            </p>
            <button
              type="button"
              onClick={confirmDialCode}
              disabled={activating || !businessId}
              className="ios-pill-primary mt-4 flex w-full items-center justify-center gap-2 px-4 py-2.5 text-sm disabled:opacity-50"
            >
              {activating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Activating…
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  I&apos;ve dialed the code — activate my AI backup
                </>
              )}
            </button>
            {activateError && (
              <p className="mt-2 text-sm text-danger">{activateError}</p>
            )}
          </>
        )}
      </div>

      {/* Manual fallback if the carrier rejects the dial code. */}
      <div className="mt-6 rounded-2xl border border-separator bg-white p-5 shadow-sm">
        <p className="text-sm font-semibold text-ink">
          Code not working? Set it up manually
        </p>
        <ol className="mt-3 list-inside list-decimal space-y-1.5 text-sm text-ink-2">
          <li>Open your phone&apos;s Settings</li>
          <li>
            Find <b className="text-ink">Call Forwarding</b> (often under “Phone” or
            “Call”)
          </li>
          <li>
            Forward <b className="text-ink">unanswered</b> and{" "}
            <b className="text-ink">busy</b> calls to {display ?? "…"}
          </li>
        </ol>

        {forwardingDid && (
          <a
            href={`tel:${forwardingDid}`}
            className="mt-4 flex items-center justify-center gap-2 rounded-lg border border-separator bg-white px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-black/[0.03]"
          >
            <Phone className="h-4 w-4" />
            Test call — dial {display}
          </a>
        )}

        <div className="mt-4 flex items-start gap-2 rounded-lg bg-wire/10 p-3 text-xs text-wire">
          <Settings2 className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            If you&apos;re just testing, you can skip forwarding — CallFlow catches
            calls made to its own number too.
          </p>
        </div>
      </div>
    </>
  );
}