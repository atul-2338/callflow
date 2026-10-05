"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import type { Contact, ContactStatus } from "@/lib/types";
import { CONTACT_STATUSES } from "@/lib/types";
import { isValidPhone } from "@/lib/util";

interface ContactFormProps {
  onSubmit: (data: Omit<Contact, "id" | "createdAt" | "updatedAt">) => Promise<void>;
  onCancel?: () => void;
  initial?: Partial<Contact>;
  submitLabel?: string;
}

export default function ContactForm({
  onSubmit,
  onCancel,
  initial,
  submitLabel = "Add Contact",
}: ContactFormProps) {
  const [name, setName] = useState(initial?.name || "");
  const [phone, setPhone] = useState(initial?.phone || "");
  const [email, setEmail] = useState(initial?.email || "");
  const [status, setStatus] = useState<ContactStatus>(initial?.status || "New");
  const [notes, setNotes] = useState(initial?.notes || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!isValidPhone(phone)) {
      setError("Phone number must be at least 10 digits.");
      return;
    }

    setLoading(true);
    try {
      await onSubmit({ name, phone, email, status, notes });
      if (!initial) {
        setName("");
        setPhone("");
        setEmail("");
        setStatus("New");
        setNotes("");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-ink">
          {initial ? "Edit Contact" : "Add New Contact"}
        </h2>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg p-1 text-ink-3 hover:bg-black/[0.04] hover:text-ink"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-ink-2">Name</label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="ios-field"
            placeholder="John Doe"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-ink-2">Phone</label>
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
          <label className="mb-1 block text-sm font-medium text-ink-2">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="ios-field"
            placeholder="john@example.com"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-ink-2">Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as ContactStatus)}
            className="ios-field"
          >
            {CONTACT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm font-medium text-ink-2">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="ios-field"
            placeholder="Additional notes..."
          />
        </div>
      </div>
      {error && (
        <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-separator bg-white px-4 py-2 text-sm font-medium text-ink-2 hover:bg-black/[0.03]"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={loading}
          className="ios-pill-primary px-5 py-2.5 text-sm disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          {loading ? "Saving..." : submitLabel}
        </button>
      </div>
    </form>
  );
}
