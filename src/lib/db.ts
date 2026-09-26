import { randomUUID } from "crypto";
import type {
  ActivityLog,
  Business,
  Call,
  CallOutcome,
  CallStatus,
  Carrier,
  ClientProfile,
  Contact,
  ContactStatus,
  ForwardingStatus,
  Settings,
} from "./types";
import { CALL_OUTCOMES } from "./types";
import { getDb } from "./database";

const DEFAULT_SETTINGS: Settings = {
  missedCallReplyTemplate:
    "Sorry we missed your call! We'll get back to you shortly.",
  fcmToken: "",
};

type ContactRow = Omit<Contact, "status"> & { status: string };
type CallRow = Omit<Call, "callStatus" | "textBackSent" | "outcome"> & {
  callStatus: string;
  textBackSent: number;
  outcome: string | null;
};

function mapContact(row: ContactRow): Contact {
  return { ...row, status: row.status as Contact["status"] };
}

function mapCall(row: CallRow): Call {
  return {
    ...row,
    callStatus: row.callStatus as Call["callStatus"],
    textBackSent: Boolean(row.textBackSent),
    outcome: CALL_OUTCOMES.includes(row.outcome as CallOutcome)
      ? (row.outcome as CallOutcome)
      : "other",
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

/** Forgets a dead FCM token (device uninstalled / token rotated) so webhooks
 * stop attempting pushes to it. No-op when the settings row doesn't exist. */
export async function clearBusinessFcmToken(): Promise<void> {
  getDb().prepare("UPDATE settings SET fcmToken = '' WHERE id = 1").run();
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
         dograhRunId, dograhDeliveryId, dograhDisposition, outcome,
         customerName, calendarEventId, transcriptUrl,
         createdAt, updatedAt
       ) VALUES (
         @id, @businessId, @callerNumber, @businessNumber, @callStatus,
         @callStartedAt, @callEndedAt, @durationSeconds, @textBackSent,
         @textBackSentAt, @signalwireCallSid, @recordingUrl, @transcript,
         @dograhRunId, @dograhDeliveryId, @dograhDisposition, @outcome,
         @customerName, @calendarEventId, @transcriptUrl,
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

/** Dograh webhook idempotency lookups (backed by partial unique indexes). */
export async function getCallByDograhRunId(runId: string): Promise<Call | null> {
  if (!runId) return null;
  const row = getDb()
    .prepare("SELECT * FROM calls WHERE dograhRunId = ?")
    .get(runId) as CallRow | undefined;
  return row ? mapCall(row) : null;
}

export async function getCallByDograhDeliveryId(
  deliveryId: string
): Promise<Call | null> {
  if (!deliveryId) return null;
  const row = getDb()
    .prepare("SELECT * FROM calls WHERE dograhDeliveryId = ?")
    .get(deliveryId) as CallRow | undefined;
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

// ---- Businesses (call-forwarding onboarding/verification) ----

type BusinessRow = Omit<Business, "carrier" | "forwardingStatus"> & {
  carrier: string;
  forwardingStatus: string;
};

function mapBusiness(row: BusinessRow): Business {
  return {
    ...row,
    carrier: row.carrier as Business["carrier"],
    forwardingStatus: row.forwardingStatus as Business["forwardingStatus"],
  };
}

export async function getBusinessById(
  id: string
): Promise<Business | undefined> {
  const row = getDb()
    .prepare("SELECT * FROM businesses WHERE id = ?")
    .get(id) as BusinessRow | undefined;
  return row ? mapBusiness(row) : undefined;
}

export async function getBusinessByPhone(
  phone: string
): Promise<Business | undefined> {
  const normalized = normalizePhone(phone);
  const rows = getDb()
    .prepare("SELECT * FROM businesses")
    .all() as unknown as BusinessRow[];
  return rows.map(mapBusiness).find((b) => normalizePhone(b.phoneNumber) === normalized);
}

export async function createBusiness(
  data: Omit<
    Business,
    | "id"
    | "createdAt"
    | "updatedAt"
    | "billingName"
    | "billingEmail"
    | "billingCountry"
    | "trialStartedAt"
    | "dodoCustomerId"
    | "dodoSubscriptionId"
    | "dodoCheckoutSessionId"
    | "subscriptionStatus"
    | "subscriptionPaymentId"
    | "smsVerificationCode"
    | "smsVerificationExpiresAt"
    | "whatsappNumber"
  > &
    Partial<
      Pick<
        Business,
        | "billingName"
        | "billingEmail"
        | "billingCountry"
        | "trialStartedAt"
        | "dodoCustomerId"
        | "dodoSubscriptionId"
        | "dodoCheckoutSessionId"
        | "subscriptionStatus"
        | "subscriptionPaymentId"
        | "smsVerificationCode"
        | "smsVerificationExpiresAt"
        | "whatsappNumber"
      >
    >
): Promise<Business> {
  const now = new Date().toISOString();
  const business: Business = {
    ...data,
    billingName: data.billingName ?? null,
    billingEmail: data.billingEmail ?? null,
    billingCountry: data.billingCountry ?? null,
    trialStartedAt: data.trialStartedAt ?? null,
    dodoCustomerId: data.dodoCustomerId ?? null,
    dodoSubscriptionId: data.dodoSubscriptionId ?? null,
    dodoCheckoutSessionId: data.dodoCheckoutSessionId ?? null,
    subscriptionStatus: data.subscriptionStatus ?? "not_started",
    subscriptionPaymentId: data.subscriptionPaymentId ?? null,
    smsVerificationCode: data.smsVerificationCode ?? null,
    smsVerificationExpiresAt: data.smsVerificationExpiresAt ?? null,
    whatsappNumber: data.whatsappNumber ?? null,
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
  };
  getDb()
    .prepare(
      `INSERT INTO businesses (
         id, phoneNumber, carrier, forwardingStatus, lastVerifiedAt,
         pendingVerificationFor, pendingVerificationExpiresAt, billingName,
         billingEmail, billingCountry, trialStartedAt, dodoCustomerId,
         dodoSubscriptionId, dodoCheckoutSessionId, subscriptionStatus,
         subscriptionPaymentId, smsVerificationCode, smsVerificationExpiresAt,
         whatsappNumber, createdAt, updatedAt
       ) VALUES (
         @id, @phoneNumber, @carrier, @forwardingStatus, @lastVerifiedAt,
         @pendingVerificationFor, @pendingVerificationExpiresAt, @billingName,
         @billingEmail, @billingCountry, @trialStartedAt, @dodoCustomerId,
         @dodoSubscriptionId, @dodoCheckoutSessionId, @subscriptionStatus,
         @subscriptionPaymentId, @smsVerificationCode, @smsVerificationExpiresAt,
         @whatsappNumber, @createdAt, @updatedAt
       )`
    )
    .run(business);
  return business;
}

export async function updateBusiness(
  id: string,
  data: Partial<Omit<Business, "id" | "createdAt">>
): Promise<Business | null> {
  const existing = await getBusinessById(id);
  if (!existing) return null;

  const updated: Business = {
    ...existing,
    ...data,
    updatedAt: new Date().toISOString(),
  };
  getDb()
    .prepare(
      `UPDATE businesses SET
         phoneNumber = @phoneNumber, carrier = @carrier,
         forwardingStatus = @forwardingStatus, lastVerifiedAt = @lastVerifiedAt,
         pendingVerificationFor = @pendingVerificationFor,
         pendingVerificationExpiresAt = @pendingVerificationExpiresAt,
         billingName = @billingName, billingEmail = @billingEmail,
         billingCountry = @billingCountry, trialStartedAt = @trialStartedAt,
         dodoCustomerId = @dodoCustomerId, dodoSubscriptionId = @dodoSubscriptionId,
         dodoCheckoutSessionId = @dodoCheckoutSessionId,
         subscriptionStatus = @subscriptionStatus,
         subscriptionPaymentId = @subscriptionPaymentId,
         smsVerificationCode = @smsVerificationCode,
         smsVerificationExpiresAt = @smsVerificationExpiresAt,
         whatsappNumber = @whatsappNumber, updatedAt = @updatedAt
        WHERE id = @id`
    )
    .run(updated);
  return updated;
}

export async function getBusinessesByStatus(
  status: ForwardingStatus
): Promise<Business[]> {
  const rows = getDb()
    .prepare("SELECT * FROM businesses WHERE forwardingStatus = ?")
    .all(status) as unknown as BusinessRow[];
  return rows.map(mapBusiness);
}

export async function getAllBusinesses(): Promise<Business[]> {
  const rows = getDb()
    .prepare("SELECT * FROM businesses ORDER BY createdAt ASC")
    .all() as unknown as BusinessRow[];
  return rows.map(mapBusiness);
}

export async function setBusinessForwardingStatus(
  id: string,
  status: ForwardingStatus,
  lastVerifiedAt?: string
): Promise<Business | null> {
  return updateBusiness(id, {
    forwardingStatus: status,
    lastVerifiedAt: lastVerifiedAt ?? null,
  });
}

export async function setPendingVerification(
  id: string,
  phone: string,
  expiresAt: string
): Promise<Business | null> {
  return updateBusiness(id, {
    pendingVerificationFor: phone,
    pendingVerificationExpiresAt: expiresAt,
  });
}

export async function clearPendingVerification(id: string): Promise<Business | null> {
  return updateBusiness(id, {
    pendingVerificationFor: null,
    pendingVerificationExpiresAt: null,
  });
}

export async function getBusinessByDodoSubscriptionId(
  subscriptionId: string
): Promise<Business | undefined> {
  const row = getDb()
    .prepare("SELECT * FROM businesses WHERE dodoSubscriptionId = ?")
    .get(subscriptionId) as BusinessRow | undefined;
  return row ? mapBusiness(row) : undefined;
}

export interface DodoWebhookUpdate {
  webhookId: string;
  eventType: string;
  /** Our business id, echoed back from the checkout session metadata. A hint. */
  businessHint?: string | null;
  customerId?: string | null;
  subscriptionId?: string | null;
  subscriptionStatus?: string | null;
  paymentId?: string | null;
  /** Stamp `trialStartedAt` (set for the `subscription.active` event). */
  startTrialAt?: string | null;
}

/**
 * Record a signature-verified Dodo webhook and apply its billing effect.
 *
 * Idempotency: Dodo's `webhook-id` header is globally unique per delivery, so
 * the insert into `dodo_webhook_events` claims the event. Claim and fulfillment
 * share one transaction — if the update throws, both roll back, so Dodo's retry
 * can process the event again instead of being told "already seen".
 *
 * Matching never uses Dodo's `business_id` (that identifies the Dodo *merchant*
 * account, not a Callflow business). Resolution order: checkout metadata hint →
 * the customer id we created → the subscription id.
 */
export async function applyDodoWebhookEvent(
  input: DodoWebhookUpdate
): Promise<{ accepted: boolean; businessId: string | null }> {
  const db = getDb();
  const receivedAt = new Date().toISOString();
  const apply = db.transaction(() => {
    try {
      db.prepare(
        "INSERT INTO dodo_webhook_events (webhookId, eventType, receivedAt) VALUES (?, ?, ?)"
      ).run(input.webhookId, input.eventType, receivedAt);
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        typeof (error as { code?: unknown }).code === "string" &&
        (error as { code: string }).code.startsWith("SQLITE_CONSTRAINT")
      ) {
        return { accepted: false, businessId: null };
      }
      throw error;
    }

    let business: { id: string } | undefined;
    if (input.businessHint) {
      business = db
        .prepare("SELECT id FROM businesses WHERE id = ?")
        .get(input.businessHint) as { id: string } | undefined;
    }
    if (!business && input.customerId) {
      business = db
        .prepare("SELECT id FROM businesses WHERE dodoCustomerId = ?")
        .get(input.customerId) as { id: string } | undefined;
    }
    if (!business && input.subscriptionId) {
      business = db
        .prepare("SELECT id FROM businesses WHERE dodoSubscriptionId = ?")
        .get(input.subscriptionId) as { id: string } | undefined;
    }

    if (!business) return { accepted: true, businessId: null };

    const sets: string[] = [];
    const values: unknown[] = [];

    if (input.subscriptionStatus) {
      sets.push("subscriptionStatus = ?");
      values.push(input.subscriptionStatus);
    }
    if (input.paymentId) {
      sets.push("subscriptionPaymentId = ?");
      values.push(input.paymentId);
    }
    // A checkout session has no subscription id until the customer pays, so the
    // webhook is what links the two. Claim it only when this row has none and no
    // other row already owns it (the column has a partial unique index).
    if (input.subscriptionId) {
      sets.push(
        `dodoSubscriptionId = COALESCE(
           dodoSubscriptionId,
           (SELECT ? WHERE NOT EXISTS (
             SELECT 1 FROM businesses WHERE dodoSubscriptionId = ?
           ))
         )`
      );
      values.push(input.subscriptionId, input.subscriptionId);
    }
    if (input.startTrialAt) {
      sets.push("trialStartedAt = COALESCE(trialStartedAt, ?)");
      values.push(input.startTrialAt);
    }

    if (sets.length) {
      db.prepare(
        `UPDATE businesses SET ${sets.join(", ")}, updatedAt = ? WHERE id = ?`
      ).run(...values, receivedAt, business.id);
    }

    return { accepted: true, businessId: business.id };
  });

  return apply();
}

export async function getBusinessesByCarrier(
  carrier: Carrier
): Promise<Business[]> {
  const rows = getDb()
    .prepare("SELECT * FROM businesses WHERE carrier = ?")
    .all(carrier) as unknown as BusinessRow[];
  return rows.map(mapBusiness);
}

// ---- Waitlist (Phase 6 tester acquisition) ----

export interface WaitlistSignup {
  id: string;
  email: string;
  source: string;
  createdAt: string;
}

/**
 * Record a landing-page waitlist signup. Idempotent per email: a repeat signup
 * returns the existing row instead of inserting a duplicate (email is UNIQUE).
 */
export async function addWaitlistSignup(
  email: string,
  source = "landing"
): Promise<{ signup: WaitlistSignup; created: boolean }> {
  const normalized = email.trim().toLowerCase();
  const existing = getDb()
    .prepare("SELECT * FROM waitlist WHERE email = ?")
    .get(normalized) as WaitlistSignup | undefined;
  if (existing) return { signup: existing, created: false };

  const signup: WaitlistSignup = {
    id: randomUUID(),
    email: normalized,
    source,
    createdAt: new Date().toISOString(),
  };
  getDb()
    .prepare("INSERT INTO waitlist (id, email, source, createdAt) VALUES (?, ?, ?, ?)")
    .run(signup.id, signup.email, signup.source, signup.createdAt);
  return { signup, created: true };
}

export async function getWaitlistSignups(): Promise<WaitlistSignup[]> {
  return getDb()
    .prepare("SELECT * FROM waitlist ORDER BY createdAt DESC")
    .all() as unknown as WaitlistSignup[];
}

// ---- SMS forwarding verification (Phase 5) ----

export const SMS_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** Store a fresh 6-digit verification code for a business. */
export async function setSmsVerificationCode(
  businessId: string,
  code: string
): Promise<Business | null> {
  return updateBusiness(businessId, {
    smsVerificationCode: code,
    smsVerificationExpiresAt: new Date(Date.now() + SMS_CODE_TTL_MS).toISOString(),
  });
}

/**
 * Check a submitted code against the stored one. Returns true only when the
 * code matches and has not expired; on success the code is consumed (cleared)
 * so it cannot be replayed. The caller then marks forwarding active.
 */
export async function checkSmsVerificationCode(
  businessId: string,
  code: string
): Promise<boolean> {
  const business = await getBusinessById(businessId);
  if (!business?.smsVerificationCode || !business.smsVerificationExpiresAt) {
    return false;
  }
  const valid =
    business.smsVerificationCode === code.trim() &&
    new Date() <= new Date(business.smsVerificationExpiresAt);
  if (valid) {
    await updateBusiness(businessId, {
      smsVerificationCode: null,
      smsVerificationExpiresAt: null,
    });
  }
  return valid;
}
