import { promises as fs } from "fs";
import path from "path";
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

const DATA_DIR = path.join(process.cwd(), "data");
const CONTACTS_FILE = path.join(DATA_DIR, "contacts.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const ACTIVITY_FILE = path.join(DATA_DIR, "activity.json");
const CALLS_FILE = path.join(DATA_DIR, "calls.json");
const CLIENT_FILE = path.join(DATA_DIR, "client.json");

const DEFAULT_SETTINGS: Settings = {
  missedCallReplyTemplate:
    "Sorry we missed your call! We'll get back to you shortly.",
  fcmToken: "",
};

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson<T>(filePath: string, data: T): Promise<void> {
  await ensureDataDir();
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

// Serialize all writes to avoid read-modify-write races across concurrent
// requests (e.g. simultaneous webhook callbacks). A per-process mutex is
// sufficient for the single-instance deployment this app targets.
let writeChain: Promise<unknown> = Promise.resolve();

function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = writeChain.then(fn, fn);
  writeChain = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

export async function getContacts(): Promise<Contact[]> {
  return readJson<Contact[]>(CONTACTS_FILE, []);
}

export async function getContactById(id: string): Promise<Contact | undefined> {
  const contacts = await getContacts();
  return contacts.find((c) => c.id === id);
}

export async function getContactByPhone(phone: string): Promise<Contact | undefined> {
  const normalized = normalizePhone(phone);
  const contacts = await getContacts();
  return contacts.find((c) => normalizePhone(c.phone) === normalized);
}

export async function createContact(
  data: Omit<Contact, "id" | "createdAt" | "updatedAt">
): Promise<Contact> {
  return withWriteLock(async () => {
    const contacts = await getContacts();
    const now = new Date().toISOString();
    const contact: Contact = {
      ...data,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    contacts.push(contact);
    await writeJson(CONTACTS_FILE, contacts);
    return contact;
  });
}

export async function updateContact(
  id: string,
  data: Partial<Omit<Contact, "id" | "createdAt">>
): Promise<Contact | null> {
  return withWriteLock(async () => {
    const contacts = await getContacts();
    const index = contacts.findIndex((c) => c.id === id);
    if (index === -1) return null;

    contacts[index] = {
      ...contacts[index],
      ...data,
      updatedAt: new Date().toISOString(),
    };
    await writeJson(CONTACTS_FILE, contacts);
    return contacts[index];
  });
}

export async function deleteContact(id: string): Promise<boolean> {
  return withWriteLock(async () => {
    const contacts = await getContacts();
    const filtered = contacts.filter((c) => c.id !== id);
    if (filtered.length === contacts.length) return false;
    await writeJson(CONTACTS_FILE, filtered);
    return true;
  });
}

export async function upsertContactByPhone(
  phone: string,
  status: ContactStatus,
  name?: string
): Promise<Contact> {
  return withWriteLock(async () => {
    const normalized = normalizePhone(phone);
    const contacts = await getContacts();
    const existing = contacts.find((c) => normalizePhone(c.phone) === normalized);
    const now = new Date().toISOString();

    if (existing) {
      existing.status = status;
      existing.updatedAt = now;
      await writeJson(CONTACTS_FILE, contacts);
      return existing;
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
    contacts.push(contact);
    await writeJson(CONTACTS_FILE, contacts);
    return contact;
  });
}

export async function getSettings(): Promise<Settings> {
  return readJson<Settings>(SETTINGS_FILE, DEFAULT_SETTINGS);
}

export async function saveSettings(settings: Settings): Promise<Settings> {
  return withWriteLock(async () => {
    await writeJson(SETTINGS_FILE, settings);
    return settings;
  });
}

export async function getBusinessFcmToken(): Promise<string> {
  const settings = await getSettings();
  return settings.fcmToken?.trim() || "";
}

export async function getClientProfile(): Promise<ClientProfile | null> {
  return readJson<ClientProfile | null>(CLIENT_FILE, null);
}

export async function saveClientProfile(
  profile: Omit<ClientProfile, "createdAt">
): Promise<ClientProfile> {
  return withWriteLock(async () => {
    const full: ClientProfile = {
      ...profile,
      createdAt: new Date().toISOString(),
    };
    await writeJson(CLIENT_FILE, full);
    return full;
  });
}

export async function getActivityLogs(): Promise<ActivityLog[]> {
  return readJson<ActivityLog[]>(ACTIVITY_FILE, []);
}

export async function getActivityLogsByContact(
  contactId: string
): Promise<ActivityLog[]> {
  const logs = await getActivityLogs();
  return logs.filter((l) => l.contactId === contactId);
}

export async function addActivityLog(
  data: Omit<ActivityLog, "id" | "createdAt">
): Promise<ActivityLog> {
  return withWriteLock(async () => {
    const logs = await getActivityLogs();
    const log: ActivityLog = {
      ...data,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    logs.unshift(log);
    await writeJson(ACTIVITY_FILE, logs.slice(0, 500));
    return log;
  });
}

export async function getCalls(): Promise<Call[]> {
  return readJson<Call[]>(CALLS_FILE, []);
}

export async function addCall(
  data: Omit<Call, "id" | "createdAt" | "updatedAt">
): Promise<Call> {
  return withWriteLock(async () => {
    const calls = await getCalls();
    const now = new Date().toISOString();
    const call: Call = {
      ...data,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    calls.unshift(call);
    await writeJson(CALLS_FILE, calls);
    return call;
  });
}

export async function updateCall(
  id: string,
  data: Partial<Omit<Call, "id" | "createdAt">>
): Promise<Call | null> {
  return withWriteLock(async () => {
    const calls = await getCalls();
    const index = calls.findIndex((c) => c.id === id);
    if (index === -1) return null;

    calls[index] = {
      ...calls[index],
      ...data,
      updatedAt: new Date().toISOString(),
    };
    await writeJson(CALLS_FILE, calls);
    return calls[index];
  });
}

export async function getCallBySignalwireSid(
  signalwireCallSid: string
): Promise<Call | null> {
  if (!signalwireCallSid) return null;
  const calls = await getCalls();
  return calls.find((c) => c.signalwireCallSid === signalwireCallSid) ?? null;
}

export async function getCallsByStatus(
  status: CallStatus,
  since?: string
): Promise<Call[]> {
  const calls = await getCalls();
  return calls.filter(
    (c) => c.callStatus === status && (!since || c.callStartedAt >= since)
  );
}

export function normalizePhone(phone: string): string {
  const cleaned = phone.replace(/[^\d+]/g, "");
  if (cleaned.startsWith("+")) return cleaned;
  // Keep the full national number instead of last-10-digits to avoid
  // collisions across country codes; fall back to stripping the leading 0.
  return cleaned;
}

export function toE164(phone: string): string {
  const cleaned = phone.replace(/[^\d+]/g, "");
  return cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
}
