"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Bell,
  Building2,
  Check,
  Copy,
  CreditCard,
  ExternalLink,
  Loader2,
  Mail,
  MessageSquare,
  Phone,
  PhoneForwarded,
  Save,
} from "lucide-react";
import { saveClientSettings } from "@/lib/api";
import type { BillingAccessState } from "@/lib/billing";

interface BillingState {
  subscriptionStatus: string;
  trialEndsAt: string | null;
  access: { state: BillingAccessState; entitled: boolean };
  hasSubscription: boolean;
}

const BILLING_COPY: Record<BillingAccessState, string> = {
  trialing: "Free trial running",
  active: "Subscribed",
  past_due: "Payment overdue — update your card to keep service on",
  on_hold: "On hold — update your card to resume",
  awaiting_checkout: "Awaiting checkout",
  lapsed: "Cancelled or expired",
};

interface BusinessInfo {
  name: string;
  phone: string;
  address: string;
  email: string;
}

interface Prefs {
  notifyEmail: boolean;
  notifySms: boolean;
}

const DEFAULT_INFO: BusinessInfo = {
  name: "",
  phone: "",
  address: "",
  email: "",
};

const STORAGE_INFO = "callflow_business_info";
const STORAGE_PREFS = "callflow_notification_prefs";

function load<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

/** E.164 → "+1 (928) 331-9394" for US numbers; the raw value otherwise. */
function formatForwardNumber(value: string | null | undefined): string {
  if (!value) return "—";
  const match = /^1?(\d{3})(\d{3})(\d{4})$/.exec(value.replace(/\D/g, ""));
  return match ? `+1 (${match[1]}) ${match[2]}-${match[3]}` : value;
}

export default function SettingsPanel({
  forwardTo,
  clientUid,
}: {
  /** The signed-in business's assigned CallFlow number (E.164), from the DB. */
  forwardTo?: string | null;
  /**
   * The business's permanent public identifier ("TE-…"), assigned once at
   * signup and never rotated. Shown read-only with a copy button.
   */
  clientUid?: string | null;
}) {
  const [info, setInfo] = useState<BusinessInfo>(DEFAULT_INFO);
  const [prefs, setPrefs] = useState<Prefs>({ notifyEmail: true, notifySms: false });
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [billing, setBilling] = useState<BillingState | null>(null);
  const [billingError, setBillingError] = useState("");
  const [openingPortal, setOpeningPortal] = useState(false);
  // Transient "Copied" feedback for the read-only Client ID row.
  const [uidCopied, setUidCopied] = useState(false);

  useEffect(() => {
    // TODO(Phase 5): replace localStorage-backed panel with DB-backed settings;
    // the effect-load avoids hydration mismatches with server-rendered defaults.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInfo(load(STORAGE_INFO, DEFAULT_INFO));
    setPrefs(load(STORAGE_PREFS, { notifyEmail: true, notifySms: false }));

    // Billing state comes from the server (it reflects Dodo's webhooks), not
    // from localStorage. 401/404 simply means this browser has no trial session.
    void (async () => {
      try {
        const response = await fetch("/api/me", { cache: "no-store" });
        if (!response.ok) return;
        setBilling((await response.json()) as BillingState);
      } catch {
        // leave the billing card hidden
      }
    })();

    // The owner alert email and business address live in the business record
    // (DB). The server value wins over the localStorage draft so the panel
    // shows what is really saved for this business.
    void (async () => {
      try {
        const response = await fetch("/api/settings", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as {
          notificationEmail?: string | null;
          address?: string | null;
        };
        if (data.notificationEmail) {
          setInfo((current) => ({
            ...current,
            email: data.notificationEmail as string,
          }));
        }
        if (data.address) {
          setInfo((current) => ({
            ...current,
            address: data.address as string,
          }));
        }
      } catch {
        // offline — keep the localStorage draft
      }
    })();
  }, []);

  async function openBillingPortal() {
    setBillingError("");
    setOpeningPortal(true);
    try {
      const response = await fetch("/api/billing/portal", { method: "POST" });
      const data = (await response.json()) as { link?: string; error?: string };
      if (!response.ok || !data.link) {
        throw new Error(data.error || "Unable to open Dodo billing.");
      }
      window.location.assign(data.link);
    } catch (error) {
      setBillingError(error instanceof Error ? error.message : "Unable to open Dodo billing.");
      setOpeningPortal(false);
    }
  }

  async function save() {
    try {
      window.localStorage.setItem(STORAGE_INFO, JSON.stringify(info));
      window.localStorage.setItem(STORAGE_PREFS, JSON.stringify(prefs));
      // No authToken/fcmToken args: those Settings fields were removed, and
      // omitting them leaves the stored tokens untouched (the API keeps the
      // previously saved values when the keys are absent).
      await saveClientSettings({
        notificationEmail: info.email.trim(),
        address: info.address.trim(),
      });
      setSaveError("");
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setSaveError("Could not save — check your connection and try again.");
    }
  }

  const field = "ios-field";

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold tracking-tight text-ink">Settings</h1>
      <p className="mt-1 text-sm text-ink-3">
        Keep your business details and preferences up to date.
      </p>

      <div className="mt-8 space-y-6">
        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2.5">
            <Building2 className="h-5 w-5 text-wire" />
            <h2 className="text-base font-semibold text-ink">Business information</h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium text-ink-2">
                Business name
              </label>
              <input
                className={field}
                value={info.name}
                onChange={(e) => setInfo({ ...info, name: e.target.value })}
                placeholder="Acme Plumbing"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink-2">
                Business phone
              </label>
              <input
                className={field}
                value={info.phone}
                onChange={(e) => setInfo({ ...info, phone: e.target.value })}
                placeholder="+1 555 123 4567"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink-2">Email</label>
              <input
                className={field}
                type="email"
                value={info.email}
                onChange={(e) => setInfo({ ...info, email: e.target.value })}
                placeholder="you@company.com"
              />
              <p className="mt-1 text-xs text-ink-3">
                New-call alert emails are sent here.
              </p>
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium text-ink-2">
                Address
              </label>
              <input
                className={field}
                value={info.address}
                onChange={(e) => setInfo({ ...info, address: e.target.value })}
                placeholder="Street, City, State"
              />
            </div>
            {/* Permanent client UID — read-only. Assigned by the server at
                signup and never rotated. */}
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium text-ink-2">
                Client ID
              </label>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  className={`${field} min-w-0 flex-1 font-mono font-semibold tracking-wide`}
                  value={clientUid ?? ""}
                  placeholder="—"
                />
                {clientUid && (
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(clientUid);
                      setUidCopied(true);
                      setTimeout(() => setUidCopied(false), 2000);
                    }}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg border border-separator bg-white px-3 py-2 text-xs font-medium text-ink-2 transition-colors hover:bg-black/[0.03]"
                  >
                    {uidCopied ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    {uidCopied ? "Copied" : "Copy"}
                  </button>
                )}
              </div>
              <p className="mt-1 text-xs text-ink-3">
                Your permanent CallFlow reference — include it when contacting support.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2.5">
            <PhoneForwarded className="h-5 w-5 text-wire" />
            <h2 className="text-base font-semibold text-ink">Call forwarding</h2>
          </div>
          <div className="flex items-center justify-between gap-4 rounded-xl bg-[#fafafa] p-4">
            <div>
              <p className="text-sm font-medium text-ink-2">Forward missed calls to</p>
              <p className="text-lg font-bold tracking-tight text-ink">
                {formatForwardNumber(forwardTo)}
              </p>
            </div>
            <div className="hidden items-center gap-2 text-xs text-ink-3 sm:flex">
              <Phone className="h-4 w-4" />
              Status: active
            </div>
          </div>
          <p className="mt-3 text-xs text-ink-3">
            Set this number as your “when unanswered / busy” forwarding target in your
            phone&apos;s call settings.
          </p>
        </section>

        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2.5">
            <Bell className="h-5 w-5 text-wire" />
            <h2 className="text-base font-semibold text-ink">Notifications</h2>
          </div>
          <div className="space-y-3">
            <label className="flex items-center justify-between gap-4 rounded-xl border border-separator bg-white p-4 transition-colors hover:bg-black/[0.03]">
              <div className="flex items-center gap-3">
                <Mail className="h-5 w-5 text-ink-3" />
                <div>
                  <p className="text-sm font-medium text-ink">Email me on missed calls</p>
                  <p className="text-xs text-ink-3">
                    A transcript lands in your inbox the moment a voicemail is recorded.
                  </p>
                </div>
              </div>
              <input
                type="checkbox"
                checked={prefs.notifyEmail}
                onChange={(e) => setPrefs({ ...prefs, notifyEmail: e.target.checked })}
                className="h-5 w-5 accent-gold"
              />
            </label>
            <label className="flex items-center justify-between gap-4 rounded-xl border border-separator bg-white p-4 transition-colors hover:bg-black/[0.03]">
              <div className="flex items-center gap-3">
                <MessageSquare className="h-5 w-5 text-ink-3" />
                <div>
                  <p className="text-sm font-medium text-ink">Text me a summary</p>
                  <p className="text-xs text-ink-3">
                    Get the caller number and a short summary as an SMS.
                  </p>
                </div>
              </div>
              <input
                type="checkbox"
                checked={prefs.notifySms}
                onChange={(e) => setPrefs({ ...prefs, notifySms: e.target.checked })}
                className="h-5 w-5 accent-gold"
              />
            </label>
          </div>
        </section>

        {billing && (
          <section className="rounded-2xl bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-2.5">
              <CreditCard className="h-5 w-5 text-wire" />
              <h2 className="text-base font-semibold text-ink">Plan &amp; billing</h2>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-ink">CallFlow Solo</p>
              <p className="text-xs text-ink-3">$49 / month after the trial</p>
            </div>
            <p className="mt-2 text-sm text-ink-2">
              {BILLING_COPY[billing.access.state]}
              {billing.trialEndsAt
                ? ` · through ${new Date(billing.trialEndsAt).toLocaleDateString()}`
                : ""}
            </p>
            {billing.hasSubscription ? (
              <button
                type="button"
                onClick={openBillingPortal}
                disabled={openingPortal}
                className="ios-pill-primary mt-4 px-4 py-2.5 text-sm disabled:opacity-50"
              >
                {openingPortal ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ExternalLink className="h-4 w-4" />
                )}
                Manage payment method or cancel
              </button>
            ) : (
              <Link
                href="/onboarding"
                className="ios-pill-primary mt-4 px-4 py-2.5 text-sm"
              >
                Continue checkout
              </Link>
            )}
            {billingError && <p className="mt-3 text-sm text-danger">{billingError}</p>}
            <p className="mt-3 text-xs leading-relaxed text-ink-3">
              Billing runs through Dodo Payments. Cancelling stops future charges
              and keeps access until the end of any period already paid for.
            </p>
          </section>
        )}

        <div className="flex items-center justify-end gap-3">
          {saveError && (
            <span className="text-sm font-medium text-danger">{saveError}</span>
          )}
          {saved && (
            <span className="flex items-center gap-1.5 text-sm font-medium text-wire">
              <Save className="h-4 w-4" />
              Saved
            </span>
          )}
          <button
            type="button"
            onClick={save}
            className="ios-pill-primary px-5 py-2.5 text-sm"
          >
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}
