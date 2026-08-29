/**
 * One-time migration: imports existing data/*.json files into the SQLite database.
 *
 * Usage:
 *   node scripts/migrate-json-to-sqlite.mjs
 *
 * Honors DATABASE_PATH if set, otherwise defaults to ./data/callflow.db
 * (same default as src/lib/database.ts).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const SCHEMA_PATH = path.join(ROOT, "migrations", "schema.sql");

const DB_PATH =
  process.env.DATABASE_PATH?.trim() || path.join(DATA_DIR, "callflow.db");

function readJson(name) {
  const file = path.join(DATA_DIR, name);
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

function main() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(fs.readFileSync(SCHEMA_PATH, "utf-8"));

  // ---- contacts ----
  const contacts = readJson("contacts.json") || [];
  const insContact = db.prepare(
    `INSERT OR REPLACE INTO contacts (id, name, phone, email, status, notes, createdAt, updatedAt)
     VALUES (@id, @name, @phone, @email, @status, @notes, @createdAt, @updatedAt)`
  );
  const tContacts = db.transaction((rows) => {
    for (const r of rows) insContact.run(r);
  });
  tContacts(contacts);
  console.log(`contacts: imported ${contacts.length}`);

  // ---- settings (single row) ----
  const settings = readJson("settings.json");
  if (settings) {
    db.prepare(
      `INSERT INTO settings (id, missedCallReplyTemplate, fcmToken)
       VALUES (1, @missedCallReplyTemplate, @fcmToken)
       ON CONFLICT(id) DO UPDATE SET
         missedCallReplyTemplate = excluded.missedCallReplyTemplate,
         fcmToken = excluded.fcmToken`
    ).run({
      missedCallReplyTemplate: settings.missedCallReplyTemplate || "",
      fcmToken: settings.fcmToken || "",
    });
    console.log("settings: imported");
  } else {
    console.log("settings: no file, skipped");
  }

  // ---- client profile (single row) ----
  const client = readJson("client.json");
  if (client) {
    db.prepare(
      `INSERT INTO client_profile (id, name, phone, address, email, createdAt)
       VALUES (1, @name, @phone, @address, @email, @createdAt)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, phone = excluded.phone,
         address = excluded.address, email = excluded.email,
         createdAt = excluded.createdAt`
    ).run(client);
    console.log("client: imported");
  } else {
    console.log("client: no file, skipped");
  }

  // ---- activity logs ----
  const activity = readJson("activity.json") || [];
  const insActivity = db.prepare(
    `INSERT OR REPLACE INTO activity_logs (id, contactId, type, message, createdAt)
     VALUES (@id, @contactId, @type, @message, @createdAt)`
  );
  const tActivity = db.transaction((rows) => {
    for (const r of rows) insActivity.run(r);
  });
  tActivity(activity);
  console.log(`activity: imported ${activity.length}`);

  // ---- calls (boolean -> int; older records may lack newer fields) ----
  const calls = readJson("calls.json") || [];
  const insCall = db.prepare(
    `INSERT OR REPLACE INTO calls (
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
  );
  const tCalls = db.transaction((rows) => {
    for (const r of rows) {
      insCall.run({
        ...r,
        businessId: r.businessId ?? null,
        businessNumber: r.businessNumber ?? "",
        callEndedAt: r.callEndedAt ?? null,
        durationSeconds: r.durationSeconds ?? null,
        textBackSent: r.textBackSent ? 1 : 0,
        textBackSentAt: r.textBackSentAt ?? null,
        signalwireCallSid: r.signalwireCallSid ?? null,
        recordingUrl: r.recordingUrl ?? null,
        transcript: r.transcript ?? null,
      });
    }
  });
  tCalls(calls);
  console.log(`calls: imported ${calls.length}`);

  db.close();
  console.log(`\nDone. Database written to: ${DB_PATH}`);
}

main();
