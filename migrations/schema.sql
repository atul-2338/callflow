-- CallFlow SQLite schema
-- Applied idempotently at startup via src/lib/database.ts (CREATE ... IF NOT EXISTS).
-- Mirrors the previous data/*.json structures exactly.

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'New',
  notes TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

-- Single-row settings table (id is always 1).
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  missedCallReplyTemplate TEXT NOT NULL,
  fcmToken TEXT NOT NULL DEFAULT ''
);

-- Single-row client/business profile table (id is always 1).
CREATE TABLE IF NOT EXISTS client_profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id TEXT PRIMARY KEY,
  contactId TEXT NOT NULL,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS calls (
  id TEXT PRIMARY KEY,
  businessId TEXT,
  callerNumber TEXT NOT NULL,
  businessNumber TEXT NOT NULL DEFAULT '',
  callStatus TEXT NOT NULL,
  callStartedAt TEXT NOT NULL,
  callEndedAt TEXT,
  durationSeconds INTEGER,
  textBackSent INTEGER NOT NULL DEFAULT 0,
  textBackSentAt TEXT,
  signalwireCallSid TEXT,
  recordingUrl TEXT,
  transcript TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

-- Call-forwarding onboarding/verification per business.
CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY,
  phoneNumber TEXT NOT NULL,
  carrier TEXT NOT NULL DEFAULT 'other',
  forwardingStatus TEXT NOT NULL DEFAULT 'not_started',
  lastVerifiedAt TEXT,
  pendingVerificationFor TEXT,
  pendingVerificationExpiresAt TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone);
CREATE INDEX IF NOT EXISTS idx_activity_contact ON activity_logs(contactId);
CREATE INDEX IF NOT EXISTS idx_calls_status ON calls(callStatus);
CREATE INDEX IF NOT EXISTS idx_calls_started ON calls(callStartedAt);
CREATE INDEX IF NOT EXISTS idx_businesses_phone ON businesses(phoneNumber);
CREATE INDEX IF NOT EXISTS idx_businesses_status ON businesses(forwardingStatus);
