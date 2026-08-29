"use client";

import { useState } from "react";
import {
  History,
  MessageSquare,
  Pencil,
  Phone,
  PhoneMissed,
  Trash2,
} from "lucide-react";
import type { Contact } from "@/lib/types";

const statusColors: Record<string, string> = {
  New: "bg-blue-500/15 text-blue-400",
  Active: "bg-green-500/15 text-green-400",
  "Missed Call": "bg-amber-500/15 text-amber-400",
  "Follow Up": "bg-purple-500/15 text-purple-400",
  Closed: "bg-slate-500/15 text-slate-400",
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
    <tr className="border-b border-navy-800 hover:bg-navy-800/40">
      <td className="px-4 py-4">
        <div className="font-medium text-white">{contact.name}</div>
        {contact.email && (
          <div className="text-sm text-slate-400">{contact.email}</div>
        )}
      </td>
      <td className="px-4 py-4 text-sm text-slate-300">{contact.phone}</td>
      <td className="px-4 py-4">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
            statusColors[contact.status] || "bg-slate-500/15 text-slate-400"
          }`}
        >
          {contact.status === "Missed Call" && <PhoneMissed className="h-3 w-3" />}
          {contact.status}
        </span>
      </td>
      <td className="px-4 py-4 text-sm text-slate-400">
        {new Date(contact.updatedAt).toLocaleDateString()}
      </td>
      <td className="px-4 py-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => handleAction("log-call")}
            disabled={loading !== null}
            title="Log Call"
            className="inline-flex items-center gap-1 rounded-lg border border-navy-600 bg-navy-800 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:bg-navy-700 disabled:opacity-50"
          >
            <Phone className="h-3.5 w-3.5" />
            {loading === "log-call" ? "..." : "Log Call"}
          </button>
          <button
            onClick={() => handleAction("send-sms")}
            disabled={loading !== null}
            title="Send SMS"
            className="inline-flex items-center gap-1 rounded-lg border border-gold-500/30 bg-gold-500/10 px-2.5 py-1.5 text-xs font-medium text-gold-400 hover:bg-gold-500/20 disabled:opacity-50"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            {loading === "send-sms" ? "..." : "SMS"}
          </button>
          <button
            onClick={() => onViewHistory(contact)}
            title="View History"
            className="inline-flex items-center gap-1 rounded-lg border border-navy-600 bg-navy-800 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:bg-navy-700"
          >
            <History className="h-3.5 w-3.5" />
            History
          </button>
          <button
            onClick={() => onEdit(contact)}
            title="Edit"
            className="rounded-lg p-1.5 text-slate-500 hover:bg-navy-700 hover:text-white"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            onClick={() => onDelete(contact.id)}
            title="Delete"
            className="rounded-lg p-1.5 text-slate-500 hover:bg-red-500/15 hover:text-red-400"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}
