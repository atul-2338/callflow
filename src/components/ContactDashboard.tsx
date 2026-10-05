"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Search, Users, X } from "lucide-react";
import type { ActivityLog, Contact } from "@/lib/types";
import { apiFetch } from "@/lib/api";
import ContactForm from "./ContactForm";
import ContactRow from "./ContactRow";

export default function ContactDashboard() {
  const router = useRouter();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [historyContact, setHistoryContact] = useState<Contact | null>(null);
  const [historyLogs, setHistoryLogs] = useState<ActivityLog[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const showToast = useCallback((type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const loadContacts = useCallback(async (): Promise<Contact[]> => {
    const res = await fetch("/api/contacts");
    if (!res.ok) throw new Error("Failed to load contacts");
    return res.json();
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadContacts()
      .then((data) => {
        if (!cancelled) setContacts(data);
      })
      .catch(() => {
        if (!cancelled) showToast("error", "Failed to load contacts");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadContacts, showToast]);

  async function refresh() {
    setLoading(true);
    try {
      const data = await loadContacts();
      setContacts(data);
    } catch {
      showToast("error", "Failed to load contacts");
    } finally {
      setLoading(false);
    }
  }

  async function handleViewHistory(contact: Contact) {
    setHistoryContact(contact);
    setHistoryLoading(true);
    setHistoryLogs([]);
    try {
      const res = await fetch(`/api/contacts/${contact.id}/activity`);
      const data = await res.json();
      setHistoryLogs(data);
    } catch {
      setHistoryLogs([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function handleUpdate(data: Omit<Contact, "id" | "createdAt" | "updatedAt">) {
    if (!editingContact) return;
    const res = await apiFetch("/api/contacts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: editingContact.id, ...data }),
    });
    if (!res.ok) {
      showToast("error", "Failed to update contact");
      return;
    }
    setEditingContact(null);
    showToast("success", "Contact updated successfully");
    refresh();
  }

  async function handleDelete(id: string) {
    if (!confirm("Are you sure you want to delete this contact?")) return;
    const res = await apiFetch(`/api/contacts?id=${id}`, { method: "DELETE" });
    if (!res.ok) {
      showToast("error", "Failed to delete contact");
      return;
    }
    showToast("success", "Contact deleted");
    refresh();
  }

  async function handleAction(id: string, action: string) {
    const res = await apiFetch(`/api/contacts/${id}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast("error", data.error || "Action failed");
      return;
    }
    const labels: Record<string, string> = {
      "log-call": "Call logged",
    };
    showToast("success", labels[action] || "Action completed");
    refresh();
  }

  const filtered = contacts.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.phone.includes(search) ||
      c.status.toLowerCase().includes(search.toLowerCase())
  );

  const stats = {
    total: contacts.length,
    missed: contacts.filter((c) => c.status === "Missed Call").length,
    active: contacts.filter((c) => c.status === "Active").length,
  };

  return (
    <div className="space-y-6">
      {toast && (
        <div
          className={`fixed right-4 top-4 z-50 rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${
            toast.type === "success"
              ? "bg-booked text-white"
              : "bg-danger text-white"
          }`}
        >
          {toast.message}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-wire/10 p-2">
              <Users className="h-5 w-5 text-wire" />
            </div>
            <div>
              <p className="text-sm text-ink-3">Total Contacts</p>
              <p className="text-2xl font-bold text-ink">{stats.total}</p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-danger/10 p-2">
              <Users className="h-5 w-5 text-danger" />
            </div>
            <div>
              <p className="text-sm text-ink-3">Missed Calls</p>
              <p className="text-2xl font-bold text-ink">{stats.missed}</p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-booked/10 p-2">
              <Users className="h-5 w-5 text-booked" />
            </div>
            <div>
              <p className="text-sm text-ink-3">Active</p>
              <p className="text-2xl font-bold text-ink">{stats.active}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
          <input
            type="text"
            placeholder="Search contacts..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-separator bg-white py-2 pl-10 pr-4 text-sm text-ink placeholder:text-ink-3 focus:border-wire focus:outline-none focus:ring-2 focus:ring-wire/20"
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={refresh}
            className="flex items-center gap-2 rounded-lg border border-separator bg-white px-4 py-2 text-sm font-medium text-ink-2 transition hover:bg-black/[0.03]"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
          <button
            onClick={() => router.push("/contacts/new")}
            className="ios-pill-primary px-4 py-2 text-sm"
          >
            Add Contact
          </button>
        </div>
      </div>

      {editingContact && (
        <ContactForm
          initial={editingContact}
          submitLabel="Update Contact"
          onSubmit={handleUpdate}
          onCancel={() => setEditingContact(null)}
        />
      )}

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-separator bg-black/[0.02]">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-ink-3">
                  Contact
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-ink-3">
                  Phone
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-ink-3">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-ink-3">
                  Updated
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-ink-3">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-ink-3">
                    Loading contacts...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-ink-3">
                    {search ? "No contacts match your search." : "No contacts yet. Add your first contact!"}
                  </td>
                </tr>
              ) : (
                filtered.map((contact) => (
                  <ContactRow
                    key={contact.id}
                    contact={contact}
                    onEdit={setEditingContact}
                    onDelete={handleDelete}
                    onAction={handleAction}
                    onViewHistory={handleViewHistory}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {historyContact && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-ink">{historyContact.name}</h2>
                <p className="text-sm text-ink-2">{historyContact.phone}</p>
              </div>
              <button
                onClick={() => setHistoryContact(null)}
                className="rounded-lg p-1.5 text-ink-3 hover:bg-black/[0.04] hover:text-ink"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {historyLoading ? (
              <p className="py-8 text-center text-ink-3">Loading history...</p>
            ) : historyLogs.length === 0 ? (
              <p className="py-8 text-center text-ink-3">
                No activity recorded for this contact yet.
              </p>
            ) : (
              <ul className="max-h-96 space-y-3 overflow-y-auto">
                {historyLogs.map((log) => (
                  <li
                    key={log.id}
                    className="rounded-lg border border-separator bg-[#fafafa] px-4 py-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wide text-wire">
                        {log.type.replace("_", " ")}
                      </span>
                      <span className="text-xs text-ink-3">
                        {new Date(log.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-ink-2">{log.message}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
