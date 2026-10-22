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
  dograhRunId TEXT,
  dograhDeliveryId TEXT,
  dograhDisposition TEXT,
  outcome TEXT,
  customerName TEXT,
  callbackNumber TEXT,
  calendarEventId TEXT,
  transcriptUrl TEXT,
  serviceRequested TEXT,
  urgency TEXT,
  preferredCallbackTime TEXT,
  followUpStatus TEXT NOT NULL DEFAULT 'none',
  followUpNotes TEXT NOT NULL DEFAULT '',
  followUpUpdatedAt TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

-- Call-forwarding onboarding/verification per business. phoneNumber is the
-- "Destination Number": the owner's personal phone that their carrier
-- forwards unanswered calls FROM, to the CallFlow number.
CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY,
  -- Permanent public identifier ("TE-" + 8 hex chars) assigned once at
  -- creation and never rotated (generateClientUid in src/lib/util.ts).
  clientUid TEXT,
  phoneNumber TEXT NOT NULL,
  carrier TEXT NOT NULL DEFAULT 'other',
  forwardingStatus TEXT NOT NULL DEFAULT 'not_started',
  lastVerifiedAt TEXT,
  pendingVerificationFor TEXT,
  pendingVerificationExpiresAt TEXT,
  billingName TEXT,
  billingEmail TEXT,
  billingCountry TEXT,
  trialStartedAt TEXT,
  dodoCustomerId TEXT,
  dodoSubscriptionId TEXT,
  dodoCheckoutSessionId TEXT,
  subscriptionStatus TEXT NOT NULL DEFAULT 'not_started',
  subscriptionPaymentId TEXT,
  smsVerificationCode TEXT,
  smsVerificationExpiresAt TEXT,
  -- Business address (Settings → Business information → Address). Free-form
  -- text; NULL until the owner saves one.
  address TEXT,
  -- Owner alert email (Settings → Business information → Email). New-call
  -- alert emails are sent here (src/lib/email.ts + dograh-webhook.ts).
  notificationEmail TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

-- Landing-page waitlist signups (Phase 6 tester acquisition).
CREATE TABLE IF NOT EXISTS waitlist (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL DEFAULT 'landing',
  createdAt TEXT NOT NULL
);

-- Dodo's webhook-id header is globally unique for a delivery. This table makes
-- the signature-verified handler idempotent even if Dodo retries concurrently.
CREATE TABLE IF NOT EXISTS dodo_webhook_events (
  webhookId TEXT PRIMARY KEY,
  eventType TEXT NOT NULL,
  receivedAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone);
CREATE INDEX IF NOT EXISTS idx_activity_contact ON activity_logs(contactId);
CREATE INDEX IF NOT EXISTS idx_calls_status ON calls(callStatus);
CREATE INDEX IF NOT EXISTS idx_calls_started ON calls(callStartedAt);
CREATE INDEX IF NOT EXISTS idx_calls_followup ON calls(followUpStatus);
CREATE INDEX IF NOT EXISTS idx_businesses_phone ON businesses(phoneNumber);
CREATE INDEX IF NOT EXISTS idx_businesses_status ON businesses(forwardingStatus);
-- One client UID per business. Partial so legacy NULL rows (before the
-- backfill in src/lib/database.ts) can coexist during the migration window.
CREATE UNIQUE INDEX IF NOT EXISTS idx_businesses_client_uid
  ON businesses(clientUid) WHERE clientUid IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_businesses_dodo_customer
  ON businesses(dodoCustomerId) WHERE dodoCustomerId IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_businesses_dodo_subscription
  ON businesses(dodoSubscriptionId) WHERE dodoSubscriptionId IS NOT NULL;

-- Dograh webhook idempotency keys. Partial unique indexes so legacy rows
-- (NULL keys) never collide, and duplicate webhook deliveries are rejected at
-- the storage layer, not just in handler code.
CREATE UNIQUE INDEX IF NOT EXISTS idx_calls_dograh_run ON calls(dograhRunId)
  WHERE dograhRunId IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_calls_dograh_delivery ON calls(dograhDeliveryId)
  WHERE dograhDeliveryId IS NOT NULL;