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
  outcome: CallOutcome | null;
  customerName: string | null;
  calendarEventId: string | null;
  /** Public Dograh URL for the call transcript JSON file. */
  transcriptUrl: string | null;
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
  phoneNumber: string;
  carrier: Carrier;
  forwardingStatus: ForwardingStatus;
  lastVerifiedAt: string | null;
  pendingVerificationFor: string | null;
  pendingVerificationExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}
