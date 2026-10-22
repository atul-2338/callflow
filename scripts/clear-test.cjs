/* eslint-disable @typescript-eslint/no-require-imports -- plain CommonJS node script */
// Deletes ONLY the seeded test rows (call_id / dograhRunId starting with
// "test-"). Real call rows are never touched. Usage: npm run clear-test
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const dbPath =
  (process.env.DATABASE_PATH && process.env.DATABASE_PATH.trim()) ||
  path.join(__dirname, "..", "data", "callflow.db");

if (!fs.existsSync(dbPath)) {
  console.log(`No database found at: ${dbPath}`);
  process.exit(0);
}

let db;
try {
  db = new Database(dbPath);
} catch (err) {
  console.log(`Could not open the database (${err.message}). Is another program using it?`);
  process.exit(0);
}

const info = db.prepare("DELETE FROM calls WHERE dograhRunId LIKE 'test-%'").run();
console.log(
  `Deleted ${info.changes} test call row(s) (call_id starting with "test-"). No other rows were touched.`
);
db.close();