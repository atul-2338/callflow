/* eslint-disable @typescript-eslint/no-require-imports -- plain CommonJS node script */
// Inserts 3 sample calls (call_id prefix "test-") so the dashboard can be
// tried without a real phone call. Local testing only — refuses to run when
// NODE_ENV=production. Remove them again with: npm run clear-test
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const Database = require("better-sqlite3");

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to seed test data: NODE_ENV is 'production'.");
  process.exit(1);
}

const dbPath =
  (process.env.DATABASE_PATH && process.env.DATABASE_PATH.trim()) ||
  path.join(__dirname, "..", "data", "callflow.db");

if (!fs.existsSync(dbPath)) {
  console.log(`No database found at: ${dbPath} — start the dev server once, then retry.`);
  process.exit(1);
}

let db;
try {
  db = new Database(dbPath);
} catch (err) {
  console.log(`Could not open the database (${err.message}). Is another program using it?`);
  process.exit(1);
}

const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();

// One emergency callback, one booked job, one voicemail — enough to see every
// badge colour, a tap-to-call number, and both "today" and older calls.
const SAMPLES = [
  {
    runId: "test-seed-1",
    customerName: "Maria Lopez",
    callerNumber: "+12125550143",
    callbackNumber: "+12125550143",
    serviceRequested: "Kitchen sink backed up, water spreading",
    urgency: "emergency",
    outcome: "callback",
    disposition: "callback_requested",
    callStatus: "answered",
    durationSeconds: 96,
    transcript:
      "Caller: My kitchen sink is overflowing, I need someone today.\nAgent: I can have a plumber call you right back.",
    startedHoursAgo: 0.2,
  },
  {
    runId: "test-seed-2",
    customerName: "Dan Whitfield",
    callerNumber: "+13105550170",
    callbackNumber: "+13105550190",
    serviceRequested: "Water heater replacement quote",
    urgency: "today",
    outcome: "booked",
    disposition: "appointment_booked",
    callStatus: "answered",
    durationSeconds: 210,
    transcript:
      "Caller: Can I get a quote for a new water heater?\nAgent: Booked Thursday at 3pm.",
    startedHoursAgo: 1.5,
  },
  {
    runId: "test-seed-3",
    customerName: "Sam Torres",
    callerNumber: "+14155550101",
    callbackNumber: "+14155550101",
    serviceRequested: "Faucet leak from last week",
    urgency: "this_week",
    outcome: "voicemail",
    disposition: "voicemail_detected",
    callStatus: "voicemail_left",
    durationSeconds: 47,
    transcript:
      "Hi, this is Sam — calling about the faucet leak from last week, please call back.",
    startedHoursAgo: 26,
  },
];

const insert = db.prepare(
  `INSERT OR IGNORE INTO calls (
     id, businessId, callerNumber, businessNumber, callStatus,
     callStartedAt, callEndedAt, durationSeconds,
     textBackSent, textBackSentAt, signalwireCallSid,
     recordingUrl, transcript, dograhRunId, dograhDeliveryId,
     dograhDisposition, outcome, customerName, callbackNumber,
     calendarEventId, transcriptUrl, serviceRequested, urgency,
     preferredCallbackTime, createdAt, updatedAt
   ) VALUES (?, NULL, ?, '', ?, ?, ?, ?, 0, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, ?, ?)`
);

let seeded = 0;
for (const s of SAMPLES) {
  const startedAt = hoursAgo(s.startedHoursAgo);
  const endedAt = new Date(
    new Date(startedAt).getTime() + s.durationSeconds * 1000
  ).toISOString();
  const info = insert.run(
    `test-${randomUUID()}`,
    s.callerNumber,
    s.callStatus,
    startedAt,
    endedAt,
    s.durationSeconds,
    `https://example.com/test-recording-${s.runId}.mp3`,
    s.transcript,
    s.runId,
    `test-delivery-${s.runId}`,
    s.disposition,
    s.outcome,
    s.customerName,
    s.callbackNumber,
    `https://example.com/test-transcript-${s.runId}.txt`,
    s.serviceRequested,
    s.urgency,
    startedAt,
    startedAt
  );
  seeded += info.changes;
}

console.log(
  `Seeded ${seeded} test call(s) (${SAMPLES.length - seeded} already existed). call_ids: ${SAMPLES.map((s) => s.runId).join(", ")}`
);
console.log('They appear on the dashboard as rows whose call_id starts with "test-".');
console.log("Remove them again with: npm run clear-test");
db.close();