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
    <form onSubmit={handleSubmit} className="rounded-xl border border-navy-700 bg-navy-900 p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">
          {initial ? "Edit Contact" : "Add New Contact"}
        </h2>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg p-1 text-slate-500 hover:bg-navy-800 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-300">Name</label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-navy-600 bg-navy-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-gold-400 focus:outline-none focus:ring-2 focus:ring-gold-400/20"
            placeholder="John Doe"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-300">Phone</label>
          <input
            type="tel"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full rounded-lg border border-navy-600 bg-navy-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-gold-400 focus:outline-none focus:ring-2 focus:ring-gold-400/20"
            placeholder="+1 555 123 4567"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-300">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-navy-600 bg-navy-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-gold-400 focus:outline-none focus:ring-2 focus:ring-gold-400/20"
            placeholder="john@example.com"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-300">Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as ContactStatus)}
            className="w-full rounded-lg border border-navy-600 bg-navy-800 px-3 py-2 text-sm text-white focus:border-gold-400 focus:outline-none focus:ring-2 focus:ring-gold-400/20"
          >
            {CONTACT_STATUSES.map((s) => (
              <option key={s} value={s} className="bg-navy-900 text-white">
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm font-medium text-slate-300">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-navy-600 bg-navy-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-gold-400 focus:outline-none focus:ring-2 focus:ring-gold-400/20"
            placeholder="Additional notes..."
          />
        </div>
      </div>
      {error && (
        <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-navy-600 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-navy-800"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={loading}
          className="flex items-center gap-2 rounded-lg bg-gold-500 px-4 py-2 text-sm font-medium text-navy-950 hover:bg-gold-400 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          {loading ? "Saving..." : submitLabel}
        </button>
      </div>
    </form>
  );
}
