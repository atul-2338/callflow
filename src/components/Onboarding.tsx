"use client";

import { useState } from "react";
import { ArrowRight, Building2, Loader2, Phone } from "lucide-react";
import { isValidPhone } from "@/lib/util";
import type { ClientProfile } from "@/lib/types";

interface OnboardingProps {
  onComplete: (profile: ClientProfile) => void;
}

export default function Onboarding({ onComplete }: OnboardingProps) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [email, setEmail] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [createdName, setCreatedName] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!isValidPhone(phone)) {
      setError("Phone number must be at least 10 digits.");
      return;
    }

    setCreating(true);
    setCreatedName(name.trim());

    try {
      const res = await fetch("/api/client", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim(),
          address: address.trim(),
          email: email.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to save your details");
        setCreating(false);
        return;
      }

      // Brief "Creating dashboard for X" pause, then reveal the dashboard.
      setTimeout(() => {
        onComplete(data);
      }, 1600);
    } catch {
      setError("Something went wrong. Please try again.");
      setCreating(false);
    }
  }

  if (creating) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center text-center">
        <Loader2 className="h-10 w-10 animate-spin text-wire" />
        <h2 className="mt-6 text-2xl font-semibold text-ink">
          Creating dashboard for {createdName}
        </h2>
        <p className="mt-2 text-sm text-ink-2">
          Setting up your call & messaging workspace...
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-wire/10 text-wire">
            <Building2 className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-ink">Welcome to CallFlow</h1>
            <p className="text-sm text-ink-2">Set up your workspace to get started</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-ink-2">Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="ios-field"
              placeholder="e.g. Acme Consulting"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-ink-2">Phone Number</label>
            <input
              type="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="ios-field"
              placeholder="+1 555 123 4567"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-ink-2">
              Address <span className="text-ink-3">(optional)</span>
            </label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="ios-field"
              placeholder="Street, City, State"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-ink-2">Email ID</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="ios-field"
              placeholder="you@company.com"
            />
          </div>

          {error && (
            <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
          )}

          <button
            type="submit"
            className="ios-pill-primary w-full px-4 py-2.5 text-sm"
          >
            <Phone className="h-4 w-4" />
            Get Started
            <ArrowRight className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
