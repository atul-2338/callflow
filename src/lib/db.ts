import { randomUUID } from "crypto";
import type {
  ActivityLog,
  Call,
  CallStatus,
  ClientProfile,
  Contact,
  ContactStatus,
  Settings,
} from "./types";
import { getDb } from "./database";

const DEFAULT_SETTINGS: Settings = {
  missedCallReplyTemplate:
    "Sorry we missed your call! We'll get back to you shortly.",
  fcmToken: "",
};

type ContactRow = Omit<Contact, "status"> & { status: string };
type CallRow = Omit<Call, "callStatus" | "textBackSent"> & {
  callStatus: string;
  textBackSent: number;
};

function mapContact(row: ContactRow): Contact {
  return { ...row, status: row.status as Contact["status"] };
}

function mapCall(row: CallRow): Call {
  return {
    ...row,
    callStatus: row.callStatus as Call["callStatus"],
    textBackSent: Boolean(row.textBackSent),
  };
}

export async function getContacts(): Promise<Contact[]> {
  const rows = getDb()
    .prepare("SELECT * FROM contacts ORDER BY createdAt DESC")
    .all() as unknown as ContactRow[];
  return rows.map(mapContact);
}

export async function getContactById(id: string): Promise<Contact | undefined> {
  const row = getDb()
    .prepare("SELECT * FROM contacts WHERE id = ?")
    .get(id) as ContactRow | undefined;
  return row ? mapContact(row) : undefined;
}

export async function getContactByPhone(phone: string): Promise<Contact | undefined> {
  const normalized = normalizePhone(phone);
  const rows = getDb()
    .prepare("SELECT * FROM contacts")
    .all() as unknown as ContactRow[];
  return rows
    .map(mapContact)
    .find((c) => normalizePhone(c.phone) === normalized);
}

export async function createContact(
  data: Omit<Contact, "id" | "createdAt" | "updatedAt">
): Promise<Contact> {
  const now = new Date().toISOString();
  const contact: Contact = {
    ...data,
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
  };
  getDb()
    .prepare(
      `INSERT INTO contacts (id, name, phone, email, status, notes, createdAt, updatedAt)
       VALUES (@id, @name, @phone, @email, @status, @notes, @createdAt, @updatedAt)`
    )
    .run(contact);
  return contact;
}

export async function updateContact(
  id: string,
  data: Partial<Omit<Contact, "id" | "createdAt">>
): Promise<Contact | null> {
  const existing = await getContactById(id);
  if (!existing) return null;

  const updated: Contact = {
    ...existing,
    ...data,
    updatedAt: new Date().toISOString(),
  };
  getDb()
    .prepare(
      `UPDATE contacts
       SET name = @name, phone = @phone, email = @email, status = @status,
           notes = @notes, updatedAt = @updatedAt
       WHERE id = @id`
    )
    .run(updated);
  return updated;
}

export async function deleteContact(id: string): Promise<boolean> {
  const result = getDb().prepare("DELETE FROM contacts WHERE id = ?").run(id);
  return result.changes > 0;
}

export async function upsertContactByPhone(
  phone: string,
  status: ContactStatus,
  name?: string
): Promise<Contact> {
  const existing = await getContactByPhone(phone);
  const now = new Date().toISOString();

  if (existing) {
    return (
      (await updateContact(existing.id, { status })) ?? existing
    );
  }

  const contact: Contact = {
    id: randomUUID(),
    name: name || phone,
    phone,
    email: "",
    status,
    notes: "",
    createdAt: now,
    updatedAt: now,
  };
  getDb()
    .prepare(
      `INSERT INTO contacts (id, name, phone, email, status, notes, createdAt, updatedAt)
       VALUES (@id, @name, @phone, @email, @status, @notes, @createdAt, @updatedAt)`
    )
    .run(contact);
  return contact;
}

export async function getSettings(): Promise<Settings> {
  const row = getDb()
    .prepare("SELECT missedCallReplyTemplate, fcmToken FROM settings WHERE id = 1")
    .get() as { missedCallReplyTemplate: string; fcmToken: string } | undefined;
  return row
    ? { missedCallReplyTemplate: row.missedCallReplyTemplate, fcmToken: row.fcmToken }
    : { ...DEFAULT_SETTINGS };
}

export async function saveSettings(settings: Settings): Promise<Settings> {
  getDb()
    .prepare(
      `INSERT INTO settings (id, missedCallReplyTemplate, fcmToken)
       VALUES (1, @missedCallReplyTemplate, @fcmToken)
       ON CONFLICT(id) DO UPDATE SET
         missedCallReplyTemplate = excluded.missedCallReplyTemplate,
         fcmToken = excluded.fcmToken`
    )
    .run(settings);
  return settings;
}

export async function getBusinessFcmToken(): Promise<string> {
  const settings = await getSettings();
  return settings.fcmToken?.trim() || "";
}

export async function getClientProfile(): Promise<ClientProfile | null> {
  const row = getDb()
    .prepare("SELECT name, phone, address, email, createdAt FROM client_profile WHERE id = 1")
    .get() as ClientProfile | undefined;
  return row ?? null;
}

export async function saveClientProfile(
  profile: Omit<ClientProfile, "createdAt">
): Promise<ClientProfile> {
  const full: ClientProfile = {
    ...profile,
    createdAt: new Date().toISOString(),
  };
  getDb()
    .prepare(
      `INSERT INTO client_profile (id, name, phone, address, email, createdAt)
       VALUES (1, @name, @phone, @address, @email, @createdAt)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         phone = excluded.phone,
         address = excluded.address,
         email = excluded.email,
         createdAt = excluded.createdAt`
    )
    .run(full);
  return full;
}

export async function getActivityLogs(): Promise<ActivityLog[]> {
  return getDb()
    .prepare("SELECT * FROM activity_logs ORDER BY createdAt DESC LIMIT 500")
    .all() as unknown as ActivityLog[];
}

export async function getActivityLogsByContact(
  contactId: string
): Promise<ActivityLog[]> {
  return getDb()
    .prepare("SELECT * FROM activity_logs WHERE contactId = ? ORDER BY createdAt DESC")
    .all(contactId) as unknown as ActivityLog[];
}

export async function addActivityLog(
  data: Omit<ActivityLog, "id" | "createdAt">
): Promise<ActivityLog> {
  const log: ActivityLog = {
    ...data,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  getDb()
    .prepare(
      `INSERT INTO activity_logs (id, contactId, type, message, createdAt)
       VALUES (@id, @contactId, @type, @message, @createdAt)`
    )
    .run(log);
  return log;
}

export async function getCalls(): Promise<Call[]> {
  const rows = getDb()
    .prepare("SELECT * FROM calls ORDER BY callStartedAt DESC")
    .all() as unknown as CallRow[];
  return rows.map(mapCall);
}

export async function addCall(
  data: Omit<Call, "id" | "createdAt" | "updatedAt">
): Promise<Call> {
  const now = new Date().toISOString();
  const call: Call = {
    ...data,
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
  };
  const params = {
    ...call,
    textBackSent: call.textBackSent ? 1 : 0,
  };
  getDb()
    .prepare(
      `INSERT INTO calls (
         id, businessId, callerNumber, businessNumber, callStatus,
         callStartedAt, callEndedAt, durationSeconds, textBackSent,
         textBackSentAt, signalwireCallSid, recordingUrl, transcript,
         createdAt, updatedAt
       ) VALUES (
         @id, @businessId, @callerNumber, @businessNumber, @callStatus,
         @callStartedAt, @callEndedAt, @durationSeconds, @textBackSent,
         @textBackSentAt, @signalwireCallSid, @recordingUrl, @transcript,
         @createdAt, @updatedAt
       )`
    )
    .run(params);
  return call;
}

export async function updateCall(
  id: string,
  data: Partial<Omit<Call, "id" | "createdAt">>
): Promise<Call | null> {
  const existing = await getCallById(id);
  if (!existing) return null;

  const updated: Call = {
    ...existing,
    ...data,
    updatedAt: new Date().toISOString(),
  };
  const params = {
    ...updated,
    textBackSent: updated.textBackSent ? 1 : 0,
  };
  getDb()
    .prepare(
      `UPDATE calls SET
         businessId = @businessId, callerNumber = @callerNumber,
         businessNumber = @businessNumber, callStatus = @callStatus,
         callStartedAt = @callStartedAt, callEndedAt = @callEndedAt,
         durationSeconds = @durationSeconds, textBackSent = @textBackSent,
         textBackSentAt = @textBackSentAt, signalwireCallSid = @signalwireCallSid,
         recordingUrl = @recordingUrl, transcript = @transcript,
         updatedAt = @updatedAt
       WHERE id = @id`
    )
    .run(params);
  return updated;
}

async function getCallById(id: string): Promise<Call | null> {
  const row = getDb()
    .prepare("SELECT * FROM calls WHERE id = ?")
    .get(id) as CallRow | undefined;
  return row ? mapCall(row) : null;
}

export async function getCallBySignalwireSid(
  signalwireCallSid: string
): Promise<Call | null> {
  if (!signalwireCallSid) return null;
  const row = getDb()
    .prepare("SELECT * FROM calls WHERE signalwireCallSid = ?")
    .get(signalwireCallSid) as CallRow | undefined;
  return row ? mapCall(row) : null;
}

export async function getCallsByStatus(
  status: CallStatus,
  since?: string
): Promise<Call[]> {
  const rows = getDb()
    .prepare(
      "SELECT * FROM calls WHERE callStatus = ? AND (? IS NULL OR callStartedAt >= ?) ORDER BY callStartedAt DESC"
    )
    .all(status, since ?? null, since ?? null) as unknown as CallRow[];
  return rows.map(mapCall);
}

export function normalizePhone(phone: string): string {
  const cleaned = phone.replace(/[^\d+]/g, "");
  if (cleaned.startsWith("+")) return cleaned;
  return cleaned;
}

export function toE164(phone: string): string {
  const cleaned = phone.replace(/[^\d+]/g, "");
  return cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
}
