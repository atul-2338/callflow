"use client";

import { useState } from "react";
import {
  History,
  Pencil,
  Phone,
  PhoneMissed,
  Trash2,
} from "lucide-react";
import type { Contact } from "@/lib/types";

const statusColors: Record<string, string> = {
  New: "bg-wire/10 text-[#0062cc]",
  Active: "bg-booked/10 text-[#1f8a3b]",
  "Missed Call": "bg-danger/10 text-danger",
  "Follow Up": "bg-callback/12 text-[#b25e00]",
  Closed: "bg-ink/6 text-ink-3",
};

interface ContactRowProps {
  contact: Contact;
  onEdit: (contact: Contact) => void;
  onDelete: (id: string) => void;
  onAction: (id: string, action: string) => Promise<void>;
  onViewHistory: (contact: Contact) => void;
}

export default function ContactRow({
  contact,
  onEdit,
  onDelete,
  onAction,
  onViewHistory,
}: ContactRowProps) {
  const [loading, setLoading] = useState<string | null>(null);

  async function handleAction(action: string) {
    setLoading(action);
    try {
      await onAction(contact.id, action);
    } finally {
      setLoading(null);
    }
  }

  return (
    <tr className="border-b border-separator hover:bg-black/[0.02]">
      <td className="px-4 py-4">
        <div className="font-medium text-ink">{contact.name}</div>
        {contact.email && (
          <div className="text-sm text-ink-2">{contact.email}</div>
        )}
      </td>
      <td className="px-4 py-4 text-sm text-ink-2">{contact.phone}</td>
      <td className="px-4 py-4">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
            statusColors[contact.status] || "bg-ink/6 text-ink-3"
          }`}
        >
          {contact.status === "Missed Call" && <PhoneMissed className="h-3 w-3" />}
          {contact.status}
        </span>
      </td>
      <td className="px-4 py-4 text-sm text-ink-3">
        {new Date(contact.updatedAt).toLocaleDateString()}
      </td>
      <td className="px-4 py-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => handleAction("log-call")}
            disabled={loading !== null}
            title="Log Call"
            className="inline-flex items-center gap-1 rounded-lg border border-separator bg-white px-2.5 py-1.5 text-xs font-medium text-ink-2 hover:bg-black/[0.03] disabled:opacity-50"
          >
            <Phone className="h-3.5 w-3.5" />
            {loading === "log-call" ? "..." : "Log Call"}
          </button>
          <button
            onClick={() => onViewHistory(contact)}
            title="View History"
            className="inline-flex items-center gap-1 rounded-lg border border-separator bg-white px-2.5 py-1.5 text-xs font-medium text-ink-2 hover:bg-black/[0.03]"
          >
            <History className="h-3.5 w-3.5" />
            History
          </button>
          <button
            onClick={() => onEdit(contact)}
            title="Edit"
            className="rounded-lg p-1.5 text-ink-3 hover:bg-black/[0.04] hover:text-ink"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            onClick={() => onDelete(contact.id)}
            title="Delete"
            className="rounded-lg p-1.5 text-ink-3 hover:bg-danger/10 hover:text-danger"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}
