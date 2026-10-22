/* eslint-disable @typescript-eslint/no-require-imports -- plain CommonJS node script */
// Prints the newest rows of the calls table, with phone numbers partly masked.
// Usage: npm run last-calls
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dbPath =
  (process.env.DATABASE_PATH && process.env.DATABASE_PATH.trim()) ||
  path.join(__dirname, '..', 'data', 'callflow.db');

if (!fs.existsSync(dbPath)) {
  console.log(`No database found at: ${dbPath}`);
  process.exit(0);
}

let db;
try {
  db = new Database(dbPath, { readonly: true });
} catch (err) {
  console.log(`Could not open the database (${err.message}). Is another program using it?`);
  process.exit(0);
}

// Keep the first 4 and last 2 characters of a phone number, hide the middle.
const mask = (value) => {
  if (typeof value !== 'string' || !value) return value;
  return value.length > 6 ? `${value.slice(0, 4)}****${value.slice(-2)}` : '****';
};

let rows = [];
try {
  rows = db
    .prepare(
      `SELECT createdAt, dograhRunId, callerNumber, callbackNumber,
              customerName, serviceRequested, urgency, durationSeconds, outcome
         FROM calls
        ORDER BY createdAt DESC
        LIMIT 5`
    )
    .all();
} catch (err) {
  console.log(`Could not read the calls table: ${err.message}`);
  process.exit(0);
}

if (rows.length === 0) {
  console.log('The calls table is empty - no calls saved yet.');
} else {
  console.log('Most recent calls (up to 5, phone numbers partly masked):');
  for (const row of rows) {
    const parts = [
      `at ${row.createdAt}`,
      `call_id ${row.dograhRunId ?? '(none)'}`,
      `from ${mask(row.callerNumber) || '(unknown)'}`,
      `callback ${mask(row.callbackNumber) || '(none)'}`,
      row.customerName ? `name "${row.customerName}"` : null,
      row.serviceRequested ? `reason "${row.serviceRequested}"` : null,
      row.urgency ? `urgency ${row.urgency}` : null,
      row.durationSeconds != null ? `duration ${row.durationSeconds}s` : null,
      `outcome ${row.outcome ?? 'unknown'}`,
    ].filter(Boolean);
    console.log(parts.join(' | '));
  }
}

db.close();