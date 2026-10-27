/* eslint-disable @typescript-eslint/no-require-imports -- plain CommonJS node script */
// Number-pool status report (the `npm run check-numbers` script).
//
//   node scripts/check-numbers.cjs
//
// Prints the pool's available/assigned counts (from data/phone_numbers.json,
// created as [] when missing) and every business still missing an
// assignedNumber. Honours DATABASE_PATH exactly like the app does, so it can
// run on the VPS as the callflow user:
//   DATABASE_PATH=/var/data/callflow.db node scripts/check-numbers.cjs
// Read-only on the database; secrets are never printed.
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const dbPath = process.env.DATABASE_PATH
  ? path.resolve(process.cwd(), process.env.DATABASE_PATH.trim())
  : path.join(process.cwd(), "data", "callflow.db");
const poolPath = process.env.NUMBERS_POOL_PATH
  ? path.resolve(process.cwd(), process.env.NUMBERS_POOL_PATH.trim())
  : path.join(process.cwd(), "data", "phone_numbers.json");

if (!fs.existsSync(dbPath)) {
  console.error(`check-numbers: database not found at ${dbPath}`);
  process.exit(1);
}

if (!fs.existsSync(poolPath)) {
  fs.mkdirSync(path.dirname(poolPath), { recursive: true });
  fs.writeFileSync(poolPath, "[]\n");
  console.log(`check-numbers: created empty pool file ${poolPath}`);
}

let pool;
try {
  pool = JSON.parse(fs.readFileSync(poolPath, "utf8"));
} catch (err) {
  console.error(`check-numbers: ${poolPath} is not valid JSON: ${err.message}`);
  process.exit(1);
}
if (!Array.isArray(pool)) {
  console.error(`check-numbers: ${poolPath} must contain a JSON array`);
  process.exit(1);
}

const available = pool.filter((e) => e && e.status === "available");
const assigned = pool.filter((e) => e && e.status === "assigned");

console.log(`Pool file: ${poolPath}`);
console.log(`  available: ${available.length}`);
console.log(`  assigned:  ${assigned.length}`);
if (available.length < 3) {
  console.log("  WARNING: fewer than 3 numbers available — add numbers in /admin/numbers");
}

const db = new Database(dbPath);
try {
  const rows = db
    .prepare(
      `SELECT id, clientUid, billingName, phoneNumber
       FROM businesses
       WHERE assignedNumber IS NULL
       ORDER BY createdAt ASC`
    )
    .all();
  console.log(`Businesses missing an assignedNumber: ${rows.length}`);
  for (const row of rows) {
    console.log(
      `  - ${row.clientUid ?? "(no uid)"} ${row.billingName ?? "(unnamed)"}` +
        ` (id ${row.id}, owner phone ${row.phoneNumber || "—"})`
    );
  }
} finally {
  db.close();
}