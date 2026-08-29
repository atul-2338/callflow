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
  createdAt: string;
  updatedAt: string;
}
