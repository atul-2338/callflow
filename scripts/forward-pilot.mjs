#!/usr/bin/env node
/**
 * Phase 2 item 4 — manual forwarding tooling.
 *
 * Seeds (or updates) one pilot business row in the local SQLite database and
 * prints the exact steps to forward that number to CallFlow by hand — no
 * wizard, no MMI codes. This is the "manually forward one pilot business's
 * number" step; the live call test is Phase 2 item 5.
 *
 * Usage:
 *   node scripts/forward-pilot.mjs "+15551234567" verizon
 *   node scripts/forward-pilot.mjs "+15551234567" other
 *
 * Env:
 *   DATABASE_PATH              optional; defaults to ./data/callflow.db
 *   CALLFLOW_FORWARDING_DID    optional; the CallFlow forwarding DID shown in
 *                              the printed steps (defaults to the original
 *                              number; keep it equal to the server's env value)
 */
import Database from "better-sqlite3";
import { randomBytes, randomUUID } from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, "..", "data", "callflow.db");

const phone = process.argv[2];
const carrier = (process.argv[3] || "other").toLowerCase();

// The CallFlow forwarding DID — must match the server's CALLFLOW_FORWARDING_DID.
const CALLFLOW_NUMBER = process.env.CALLFLOW_FORWARDING_DID || "+19283319394";

if (!phone || !/^\+?\d{10,15}$/.test(phone.replace(/[^\d+]/g, ""))) {
  console.error("Usage: node scripts/forward-pilot.mjs \"+15551234567\" [carrier]");
  process.exit(1);
}

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

const normalized = phone.replace(/[^\d+]/g, "");
const e164 = normalized.startsWith("+") ? normalized : `+${normalized}`;

const existing = db
  .prepare("SELECT id FROM businesses WHERE phoneNumber = ?")
  .get(e164);

let businessId;
let clientUid;
if (existing) {
  db.prepare(
    "UPDATE businesses SET carrier = ?, forwardingStatus = 'pending', updatedAt = ? WHERE id = ?"
  ).run(carrier, new Date().toISOString(), existing.id);
  businessId = existing.id;
  console.log(`Updated pilot business ${businessId} (${e164}, ${carrier}).`);
} else {
  const now = new Date().toISOString();
  businessId = randomUUID();
  // Permanent public client UID — same shape the server assigns at signup
  // (generateClientUid in src/lib/util.ts): "TE-" + 8 hex chars.
  clientUid = `TE-${randomBytes(4).toString("hex")}`;
  db.prepare(
    `INSERT INTO businesses (
       id, clientUid, phoneNumber, carrier, forwardingStatus, lastVerifiedAt,
       pendingVerificationFor, pendingVerificationExpiresAt,
       subscriptionStatus, createdAt, updatedAt
     ) VALUES (?, ?, ?, ?, 'pending', NULL, NULL, NULL, 'not_started', ?, ?)`
  ).run(businessId, clientUid, e164, carrier, now, now);
  console.log(`Created pilot business ${businessId} (${e164}, ${carrier}, ${clientUid}).`);
}

db.close();

console.log(`
────────────────────────────────────────────────────────────
  MANUAL FORWARDING — do this on the pilot phone
────────────────────────────────────────────────────────────
  1. Open the phone's Settings app.
  2. Find "Call Forwarding" (often under Phone / Call).
  3. Forward UNANSWERED and BUSY calls to:  ${CALLFLOW_NUMBER}
  4. (Optional) Verify by calling ${CALLFLOW_NUMBER} from the
     pilot line — CallFlow answers and logs the call.

  Business row:  ${businessId}
${clientUid ? `  Client ID:     ${clientUid}\n` : ""}  Number:        ${e164}
  Carrier:       ${carrier}
  Status:        pending  →  flips to "active" on verification
────────────────────────────────────────────────────────────
`);