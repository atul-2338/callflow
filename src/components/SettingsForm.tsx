"use client";

import { useEffect, useState } from "react";
import { CheckCircle, Key, MessageSquare, Save } from "lucide-react";
import { apiFetch, getAuthToken, setAuthToken } from "@/lib/api";

interface SettingsData {
  missedCallReplyTemplate: string;
  isConfigured: boolean;
  credentialsSource?: string;
  configErrors?: string[];
  smsProvider?: string;
  smsConfigured?: boolean;
  smsNote?: string;
  hasFcmToken?: boolean;
  firebaseConfigured?: boolean;
  businessOwnerNumber?: string;
  ivrWebhookUrl?: string;
}

export default function SettingsForm() {
  const [settings, setSettings] = useState<SettingsData>({
    missedCallReplyTemplate: "",
    isConfigured: false,
  });
  const [fcmToken, setFcmToken] = useState("");
  const [authToken, setAuthTokenInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data) => {
        setSettings(data);
        setFcmToken(data.fcmToken || "");
        setAuthTokenInput(getAuthToken());
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);

    try {
      setAuthToken(authToken.trim());
      const res = await apiFetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          missedCallReplyTemplate: settings.missedCallReplyTemplate,
          fcmToken,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setSettings(data);
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-slate-400">
        Loading settings...
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="rounded-xl border border-navy-700 bg-navy-900 p-6 shadow-sm">
        <div className="mb-2 flex items-center gap-3">
          <div className="rounded-lg bg-gold-500/15 p-2">
            <MessageSquare className="h-5 w-5 text-gold-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">SignalWire SMS</h2>
            <p className="text-sm text-slate-400">
              Active provider:{" "}
              <strong className="uppercase text-gold-400">{settings.smsProvider || "signalwire"}</strong>
              {settings.smsConfigured ? " (ready)" : " (not ready)"}
            </p>
          </div>
        </div>
        <p className="text-sm text-slate-400">
          {settings.smsNote || "Using SignalWire SMS for outbound messages."}
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Configure in <code className="rounded bg-navy-800 px-1">.env.local</code>:{" "}
          <code className="rounded bg-navy-800 px-1">SIGNALWIRE_PROJECT_ID</code>,{" "}
          <code className="rounded bg-navy-800 px-1">SIGNALWIRE_API_TOKEN</code>,{" "}
          <code className="rounded bg-navy-800 px-1">SIGNALWIRE_SPACE_URL</code>, and{" "}
          <code className="rounded bg-navy-800 px-1">SIGNALWIRE_FROM_NUMBER</code>
        </p>
      </div>

      <div className="rounded-xl border border-navy-700 bg-navy-900 p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-lg bg-gold-500/15 p-2">
            <MessageSquare className="h-5 w-5 text-gold-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Default SMS Message</h2>
            <p className="text-sm text-slate-400">
              Used as the default body for outbound SMS from the contact actions.
              Use {"{{name}}"} and {"{{phone}}"} as placeholders.
            </p>
          </div>
        </div>
        <textarea
          value={settings.missedCallReplyTemplate}
          onChange={(e) =>
            setSettings({ ...settings, missedCallReplyTemplate: e.target.value })
          }
          rows={4}
          className="w-full rounded-lg border border-navy-600 bg-navy-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-gold-400 focus:outline-none focus:ring-2 focus:ring-gold-400/20"
          placeholder="Hi {{name}}, sorry we missed your call! We'll get back to you shortly."
        />
      </div>

      <div className="rounded-xl border border-navy-700 bg-navy-900 p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-lg bg-red-500/15 p-2">
            <MessageSquare className="h-5 w-5 text-red-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Firebase Push Notifications</h2>
            <p className="text-sm text-slate-400">
              The business owner&apos;s FCM device token. A push notification is sent
              the moment a call goes unanswered (in parallel with voicemail).
            </p>
          </div>
          {settings.hasFcmToken && (
            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-green-500/15 px-3 py-1 text-xs font-medium text-green-400">
              <CheckCircle className="h-3.5 w-3.5" />
              Token set
            </span>
          )}
        </div>
        <input
          type="text"
          value={fcmToken}
          onChange={(e) => setFcmToken(e.target.value)}
          className="w-full rounded-lg border border-navy-600 bg-navy-800 px-3 py-2 font-mono text-sm text-white placeholder-slate-500 focus:border-gold-400 focus:outline-none focus:ring-2 focus:ring-gold-400/20"
          placeholder="Paste FCM device token"
        />
        <p className="mt-2 text-xs text-slate-500">
          Firebase service account:{" "}
          <strong className={settings.firebaseConfigured ? "text-green-400" : "text-red-400"}>
            {settings.firebaseConfigured ? "configured" : "not configured"}
          </strong>
          {" "}— set <code className="rounded bg-navy-800 px-1">FIREBASE_SERVICE_ACCOUNT</code> in .env.local
        </p>
      </div>

      <div className="rounded-xl border border-navy-700 bg-navy-900 p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-lg bg-gold-500/15 p-2">
            <Key className="h-5 w-5 text-gold-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">API Access Token</h2>
            <p className="text-sm text-slate-400">
              Optional shared secret for write operations. Set the same value in{" "}
              <code className="rounded bg-navy-800 px-1">APP_AUTH_TOKEN</code> in
              .env.local to protect mutations; leave empty to keep APIs open.
            </p>
          </div>
        </div>
        <input
          type="password"
          value={authToken}
          onChange={(e) => setAuthTokenInput(e.target.value)}
          className="w-full rounded-lg border border-navy-600 bg-navy-800 px-3 py-2 font-mono text-sm text-white placeholder-slate-500 focus:border-gold-400 focus:outline-none focus:ring-2 focus:ring-gold-400/20"
          placeholder="Paste the API token (stored in your browser)"
        />
      </div>

      <div className="rounded-xl border border-navy-700 bg-navy-800/50 p-4">
        <h3 className="mb-2 text-sm font-semibold text-white">SignalWire Voice Webhook</h3>
        <p className="mb-2 text-sm text-slate-400">
          Set this as the SignalWire number&apos;s voice webhook URL (incoming call handler)
          in the SignalWire dashboard:
        </p>
        <code className="block rounded-lg bg-navy-900 px-3 py-2 text-sm text-gold-400 ring-1 ring-navy-700">
          {typeof window !== "undefined"
            ? `${window.location.origin}${settings.ivrWebhookUrl || "/api/ivr/incoming-call"}`
            : settings.ivrWebhookUrl || "/api/ivr/incoming-call"}
        </code>
        <p className="mt-2 text-xs text-slate-500">
          Incoming calls are forwarded to{" "}
          <code className="rounded bg-navy-800 px-1">BUSINESS_OWNER_NUMBER</code>
          {" "}({settings.businessOwnerNumber || "not set"}) via{" "}
          <code className="rounded bg-navy-800 px-1">&lt;Dial&gt;</code>, and fall back
          to voicemail + push notification on no-answer.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-2 rounded-lg bg-gold-500 px-6 py-2.5 text-sm font-medium text-navy-950 hover:bg-gold-400 disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {saving ? "Saving..." : "Save Settings"}
        </button>
        {saved && (
          <span className="flex items-center gap-1 text-sm text-green-400">
            <CheckCircle className="h-4 w-4" />
            Template saved successfully
          </span>
        )}
      </div>
    </form>
  );
}
