export const CONTACT_STATUSES = [
  "New",
  "Active",
  "Missed Call",
  "Follow Up",
  "Closed",
] as const;

export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export interface Contact {
  id: string;
  name: string;
  phone: string;
  email: string;
  status: ContactStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface Settings {
  missedCallReplyTemplate: string;
  fcmToken: string;
}

export interface ClientProfile {
  name: string;
  phone: string;
  address: string;
  email: string;
  createdAt: string;
}

export interface ActivityLog {
  id: string;
  contactId: string;
  type: "call" | "sms" | "missed_call";
  message: string;
  createdAt: string;
}

export const CALL_STATUSES = [
  "answered",
  "missed",
  "busy",
  "failed",
  "voicemail_left",
] as const;

export type CallStatus = (typeof CALL_STATUSES)[number];

/** Normalized Callflow outcome derived from the Dograh call disposition.
 * - booked:   the agent booked an appointment
 * - callback: the caller asked to be called back
 * - voicemail: a voicemail was captured/transcribed
 * - handled:  the agent answered/handled the call without booking
 * - other:    anything we could not map */
export const CALL_OUTCOMES = [
  "booked",
  "callback",
  "voicemail",
  "handled",
  "other",
] as const;

export type CallOutcome = (typeof CALL_OUTCOMES)[number];

/** Owner-facing follow-up workflow state for a call.
 * - none:    no action taken yet (default for every inbound call)
 * - needed:  the owner marked this call for follow-up
 * - resolved: the owner closed it out (notes record what happened) */
export const FOLLOW_UP_STATUSES = [
  "none",
  "needed",
  "resolved",
] as const;

export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

export interface Call {
  id: string;
  businessId: string | null;
  callerNumber: string;
  businessNumber: string;
  callStatus: CallStatus;
  callStartedAt: string;
  callEndedAt: string | null;
  durationSeconds: number | null;
  textBackSent: boolean;
  textBackSentAt: string | null;
  signalwireCallSid: string | null;
  recordingUrl: string | null;
  transcript: string | null;
  /** Dograh workflow run id — idempotency key for webhook ingestion. */
  dograhRunId: string | null;
  /** X-Dograh-Delivery-Id of the delivery that created this row. */
  dograhDeliveryId: string | null;
  /** Raw Dograh call_disposition as delivered, kept beside the mapped
   * `outcome` so unmapped/renamed dispositions are diagnosable from the DB. */
  dograhDisposition: string | null;
  outcome: CallOutcome | null;
  customerName: string | null;
  /** Number to call the customer back on — the caller number itself when the
   * webhook sent no separate callback number (see dograh-webhook.ts). */
  callbackNumber: string | null;
  calendarEventId: string | null;
  /** Structured job details the agent gathered, when available. Each stays
   * null when the call never captured it — the UI says so honestly. */
  serviceRequested: string | null;
  urgency: string | null;
  preferredCallbackTime: string | null;
  /** Owner's follow-up workflow state (see FOLLOW_UP_STATUSES). */
  followUpStatus: FollowUpStatus;
  followUpNotes: string;
  followUpUpdatedAt: string | null;
  /** Public Dograh URL for the call transcript JSON file. */
  transcriptUrl: string | null;
  /** Exact webhook payload as delivered (JSON string) — kept beside the
   * parsed row for debugging and replay. Null for rows created outside the
   * Dograh webhook. */
  rawPayload: string | null;
  createdAt: string;
  updatedAt: string;
}


export const CARRIERS = [
  "verizon",
  "att",
  "tmobile",
  "other",
  "airtel",
  "jio",
  "vi",
] as const;

export type Carrier = (typeof CARRIERS)[number];

export const FORWARDING_STATUSES = [
  "not_started",
  "pending",
  "active",
  "failed",
] as const;

export type ForwardingStatus = (typeof FORWARDING_STATUSES)[number];

export interface Business {
  id: string;
  /**
   * Permanent public identifier, "TE-" + 8 lowercase hex chars (e.g.
   * "TE-9a8b7c6d"), assigned once at creation and never rotated — the stable
   * handle for support and billing conversations. All businesses are enrolled
   * through the trial onboarding flow, so every row carries the TE- prefix.
   */
  clientUid: string;
  phoneNumber: string;
  carrier: Carrier;
  forwardingStatus: ForwardingStatus;
  lastVerifiedAt: string | null;
  pendingVerificationFor: string | null;
  pendingVerificationExpiresAt: string | null;
  billingName: string | null;
  billingEmail: string | null;
  billingCountry: string | null;
  trialStartedAt: string | null;
  dodoCustomerId: string | null;
  dodoSubscriptionId: string | null;
  /** Dodo checkout session behind the last hosted-checkout link we issued. */
  dodoCheckoutSessionId: string | null;
  subscriptionStatus: string;
  subscriptionPaymentId: string | null;
  /** 6-digit code for SMS-based forwarding verification (Phase 5). */
  smsVerificationCode: string | null;
  smsVerificationExpiresAt: string | null;
  /** Owner alert email (Settings → Business information → Email). New-call
   * alert emails go here; null until the owner saves one. */
  notificationEmail: string | null;
  /** Business address (Settings → Business information → Address). Free-form
   * text; null in SQLite until the owner saves one. */
  address?: string;
  createdAt: string;
  updatedAt: string;
}