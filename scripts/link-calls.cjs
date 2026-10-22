/* eslint-disable @typescript-eslint/no-require-imports -- plain CommonJS node script */
// One-time pilot fix-up: links calls that were saved with businessId = NULL
// (no business matched called_number) to a business.
//
// Target resolution:
//   --phone <E.164>    link to the business whose phoneNumber matches
//   --business <id>    link to this business id
//   (no args)          link to the sole business — only when exactly one exists
//
// Usage: npm run link-calls [-- --phone +19283319394]
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const args = process.argv.slice(2);
function argValue(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}
const phoneArg = argValue("--phone");
const businessIdArg = argValue("--business");

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

const businesses = db
  .prepare("SELECT id, phoneNumber FROM businesses ORDER BY createdAt ASC")
  .all();
const digits = (value) => String(value || "").replace(/[^\d]/g, "");

let target = null;
if (businessIdArg) {
  target = businesses.find((b) => b.id === businessIdArg) || null;
  if (!target) {
    console.log(`No business with id ${businessIdArg}. Nothing linked.`);
    db.close();
    process.exit(0);
  }
} else if (phoneArg) {
  const wanted = digits(phoneArg);
  target = businesses.find((b) => digits(b.phoneNumber) === wanted) || null;
  if (!target) {
    console.log(`No business has the number ${phoneArg}. Current businesses:`);
    businesses.forEach((b) => console.log(`  ${b.id}  ${b.phoneNumber}`));
    console.log('Nothing linked. Re-run with --business <id> to pick one explicitly.');
    db.close();
    process.exit(0);
  }
} else if (businesses.length === 1) {
  target = businesses[0];
} else {
  console.log(
    `${businesses.length} businesses exist — the default single-business fallback needs exactly one.`
  );
  console.log("Re-run with --phone <E.164> or --business <id> to pick a target. Current businesses:");
  businesses.forEach((b) => console.log(`  ${b.id}  ${b.phoneNumber}`));
  db.close();
  process.exit(0);
}

const info = db
  .prepare("UPDATE calls SET businessId = ?, updatedAt = ? WHERE businessId IS NULL")
  .run(target.id, new Date().toISOString());
console.log(
  `Linked ${info.changes} previously-unlinked call(s) to business ${target.id} (${target.phoneNumber}).`
);
db.close();