"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Bell,
  Building2,
  CreditCard,
  ExternalLink,
  KeyRound,
  Loader2,
  Mail,
  MessageSquare,
  Phone,
  PhoneForwarded,
  Save,
  Smartphone,
} from "lucide-react";
import { getAuthToken, getFcmToken, saveClientSettings, setAuthToken, setFcmToken } from "@/lib/api";
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

export default function SettingsPanel() {
  const [info, setInfo] = useState<BusinessInfo>(DEFAULT_INFO);
  const [prefs, setPrefs] = useState<Prefs>({ notifyEmail: true, notifySms: false });
  const [authToken, setAuthTokenInput] = useState("");
  const [fcmToken, setFcmTokenInput] = useState("");
  const [saved, setSaved] = useState(false);
  const [billing, setBilling] = useState<BillingState | null>(null);
  const [billingError, setBillingError] = useState("");
  const [openingPortal, setOpeningPortal] = useState(false);

  useEffect(() => {
    // TODO(Phase 5): replace localStorage-backed panel with DB-backed settings;
    // the effect-load avoids hydration mismatches with server-rendered defaults.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInfo(load(STORAGE_INFO, DEFAULT_INFO));
    setPrefs(load(STORAGE_PREFS, { notifyEmail: true, notifySms: false }));
    setAuthTokenInput(getAuthToken());
    setFcmTokenInput(getFcmToken());

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
      setAuthToken(authToken);
      setFcmToken(fcmToken);
      await saveClientSettings({ authToken, fcmToken });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      // ignore
    }
  }

  const field =
    "w-full rounded-lg border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30";

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold tracking-tight text-white">Settings</h1>
      <p className="mt-1 text-sm text-slate-500">
        Keep your business details and preferences up to date.
      </p>

      <div className="mt-8 space-y-6">
        <section className="rounded-2xl border border-white/10 bg-[#161a24] p-6 shadow-lg shadow-black/20">
          <div className="mb-4 flex items-center gap-2.5">
            <Building2 className="h-5 w-5 text-brand-400" />
            <h2 className="text-base font-semibold text-white">Business information</h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium text-slate-300">
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
              <label className="mb-1 block text-sm font-medium text-slate-300">
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
              <label className="mb-1 block text-sm font-medium text-slate-300">Email</label>
              <input
                className={field}
                type="email"
                value={info.email}
                onChange={(e) => setInfo({ ...info, email: e.target.value })}
                placeholder="you@company.com"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium text-slate-300">
                Address
              </label>
              <input
                className={field}
                value={info.address}
                onChange={(e) => setInfo({ ...info, address: e.target.value })}
                placeholder="Street, City, State"
              />
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-[#161a24] p-6 shadow-lg shadow-black/20">
          <div className="mb-4 flex items-center gap-2.5">
            <PhoneForwarded className="h-5 w-5 text-brand-400" />
            <h2 className="text-base font-semibold text-white">Call forwarding</h2>
          </div>
          <div className="flex items-center justify-between gap-4 rounded-xl bg-white/5 p-4">
            <div>
              <p className="text-sm font-medium text-slate-300">Forward missed calls to</p>
              <p className="text-lg font-bold tracking-tight text-white">
                +1 (888) 545-9969
              </p>
            </div>
            <div className="hidden items-center gap-2 text-xs text-slate-500 sm:flex">
              <Phone className="h-4 w-4" />
              Status: active
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Set this number as your “when unanswered / busy” forwarding target in your
            phone&apos;s call settings.
          </p>
        </section>

        <section className="rounded-2xl border border-white/10 bg-[#161a24] p-6 shadow-lg shadow-black/20">
          <div className="mb-4 flex items-center gap-2.5">
            <Bell className="h-5 w-5 text-brand-400" />
            <h2 className="text-base font-semibold text-white">Notifications</h2>
          </div>
          <div className="space-y-3">
            <label className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/5 p-4 transition-colors hover:bg-white/[0.07]">
              <div className="flex items-center gap-3">
                <Mail className="h-5 w-5 text-slate-500" />
                <div>
                  <p className="text-sm font-medium text-slate-200">Email me on missed calls</p>
                  <p className="text-xs text-slate-500">
                    A transcript lands in your inbox the moment a voicemail is recorded.
                  </p>
                </div>
              </div>
              <input
                type="checkbox"
                checked={prefs.notifyEmail}
                onChange={(e) => setPrefs({ ...prefs, notifyEmail: e.target.checked })}
                className="h-5 w-5 accent-brand-500"
              />
            </label>
            <label className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/5 p-4 transition-colors hover:bg-white/[0.07]">
              <div className="flex items-center gap-3">
                <MessageSquare className="h-5 w-5 text-slate-500" />
                <div>
                  <p className="text-sm font-medium text-slate-200">Text me a summary</p>
                  <p className="text-xs text-slate-500">
                    Get the caller number and a short summary as an SMS.
                  </p>
                </div>
              </div>
              <input
                type="checkbox"
                checked={prefs.notifySms}
                onChange={(e) => setPrefs({ ...prefs, notifySms: e.target.checked })}
                className="h-5 w-5 accent-brand-500"
              />
            </label>
          </div>
        </section>

        {billing && (
          <section className="rounded-2xl border border-white/10 bg-[#161a24] p-6 shadow-lg shadow-black/20">
            <div className="mb-4 flex items-center gap-2.5">
              <CreditCard className="h-5 w-5 text-brand-400" />
              <h2 className="text-base font-semibold text-white">Plan &amp; billing</h2>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-slate-200">CallFlow Solo</p>
              <p className="text-xs text-slate-500">$49 / month after the trial</p>
            </div>
            <p className="mt-2 text-sm text-slate-400">
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
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand-500/20 transition-colors hover:bg-brand-400 disabled:opacity-50"
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
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand-500/20 transition-colors hover:bg-brand-400"
              >
                Continue checkout
              </Link>
            )}
            {billingError && <p className="mt-3 text-sm text-red-400">{billingError}</p>}
            <p className="mt-3 text-xs leading-relaxed text-slate-500">
              Billing runs through Dodo Payments. Cancelling stops future charges
              and keeps access until the end of any period already paid for.
            </p>
          </section>
        )}

        <section className="rounded-2xl border border-white/10 bg-[#161a24] p-6 shadow-lg shadow-black/20">
          <div className="mb-4 flex items-center gap-2.5">
            <Smartphone className="h-5 w-5 text-brand-400" />
            <h2 className="text-base font-semibold text-white">Device credentials</h2>
          </div>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">
                App auth token
              </label>
              <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5">
                <KeyRound className="h-4 w-4 text-slate-500" />
                <input
                  className="w-full bg-transparent text-sm text-white placeholder-slate-500 focus:outline-none"
                  type="password"
                  value={authToken}
                  onChange={(e) => setAuthTokenInput(e.target.value)}
                  placeholder="Bearer token for protected writes"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">
                FCM device token
              </label>
              <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5">
                <Smartphone className="h-4 w-4 text-slate-500" />
                <input
                  className="w-full bg-transparent text-sm text-white placeholder-slate-500 focus:outline-none"
                  value={fcmToken}
                  onChange={(e) => setFcmTokenInput(e.target.value)}
                  placeholder="Firebase push token"
                />
              </div>
            </div>
          </div>
        </section>

        <div className="flex items-center justify-end gap-3">
          {saved && (
            <span className="flex items-center gap-1.5 text-sm font-medium text-brand-400">
              <Save className="h-4 w-4" />
              Saved
            </span>
          )}
          <button
            type="button"
            onClick={save}
            className="rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand-500/20 transition-colors hover:bg-brand-400"
          >
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}
