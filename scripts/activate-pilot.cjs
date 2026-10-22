/* eslint-disable @typescript-eslint/no-require-imports -- plain CommonJS node script */
// Local-only pilot activation: marks a business as if the Dodo
// `subscription.active` webhook had already landed, so the dashboard unlocks
// without completing checkout. This writes exactly what the verified webhook
// writes (see applyDodoWebhookEvent in src/lib/db.ts) with two differences:
//   - the subscription id is a clearly-local marker ("sub_local_pilot_…"),
//     never a real Dodo id, so live/test webhook data can never be confused
//     with this row
//   - no payment id is recorded (a trial start has no payment yet)
//
// Fields written:
//   subscriptionStatus = "active"
//   trialStartedAt     = now  (starts the 3-day trial window, DODO_TRIAL_DAYS)
//   dodoSubscriptionId = "sub_local_pilot_<timestamp>"  (only if unclaimed)
//   updatedAt          = now
//
// Safety:
//   - refuses to run when NODE_ENV=production unless --force is passed
//   - changes only this one database row; no Dodo API calls, no payment code,
//     no webhook history, nothing deleted
//
// Usage: npm run activate-pilot -- --business <id> [--force]
//        (<id> may be the full id or a unique prefix, e.g. aad54d41)
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const args = process.argv.slice(2);
function argValue(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}
const businessIdArg = argValue("--business");
const force = args.includes("--force");

if (!businessIdArg) {
  console.log("Usage: npm run activate-pilot -- --business <id> [--force]");
  process.exit(1);
}

// Guard rail: production data must never be flipped open by a pilot script.
if (process.env.NODE_ENV === "production" && !force) {
  console.log(
    "Refusing to run: NODE_ENV=production. This script grants access without payment.\n" +
      "If you really mean it, re-run with --force."
  );
  process.exit(1);
}

const dbPath =
  (process.env.DATABASE_PATH && process.env.DATABASE_PATH.trim()) ||
  path.join(__dirname, "..", "data", "callflow.db");

if (!fs.existsSync(dbPath)) {
  console.log(`No database found at: ${dbPath}`);
  process.exit(1);
}

let db;
try {
  db = new Database(dbPath);
} catch (err) {
  console.log(`Could not open the database (${err.message}). Is another program using it?`);
  process.exit(1);
}

// Resolve the target: exact id first, then a unique prefix match.
const businesses = db.prepare("SELECT id, billingName, subscriptionStatus FROM businesses").all();
const exact = businesses.find((b) => b.id === businessIdArg);
const matches = exact
  ? [exact]
  : businesses.filter((b) => b.id.startsWith(businessIdArg));

if (matches.length === 0) {
  console.log(`No business matches "${businessIdArg}". Current businesses:`);
  businesses.forEach((b) =>
    console.log(`  ${b.id}  ${b.billingName || "(no name)"}  ${b.subscriptionStatus}`)
  );
  db.close();
  process.exit(1);
}
if (matches.length > 1) {
  console.log(`"${businessIdArg}" matches ${matches.length} businesses — be more specific:`);
  matches.forEach((b) => console.log(`  ${b.id}  ${b.billingName || "(no name)"}`));
  db.close();
  process.exit(1);
}

const target = matches[0];
const now = new Date().toISOString();

if (target.subscriptionStatus === "active") {
  console.log(
    `Business ${target.id} (${target.billingName || "unnamed"}) is already active — nothing to do.`
  );
  db.close();
  process.exit(0);
}

// The subscription-id claim mirrors the webhook's rule: only attach when this
// row has none. The timestamped marker cannot collide with real Dodo ids.
const localSubscriptionId = `sub_local_pilot_${Date.now()}`;
const info = db
  .prepare(
    `UPDATE businesses
     SET subscriptionStatus = 'active',
         trialStartedAt = ?,
         dodoSubscriptionId = COALESCE(dodoSubscriptionId, ?),
         updatedAt = ?
     WHERE id = ?`
  )
  .run(now, localSubscriptionId, now, target.id);

if (info.changes !== 1) {
  console.log(`Unexpected: update affected ${info.changes} row(s) — nothing changed.`);
  db.close();
  process.exit(1);
}

const after = db
  .prepare(
    "SELECT id, billingName, subscriptionStatus, trialStartedAt, dodoSubscriptionId FROM businesses WHERE id = ?"
  )
  .get(target.id);

console.log(`Activated business ${after.id} (${after.billingName || "unnamed"}):`);
console.log(`  subscriptionStatus: ${target.subscriptionStatus} -> ${after.subscriptionStatus}`);
console.log(`  trialStartedAt:     ${after.trialStartedAt} (3-day trial window)`);
console.log(`  dodoSubscriptionId: ${after.dodoSubscriptionId} (local pilot marker)`);
console.log(
  "The dashboard now reports access state 'trialing' / entitled, so billing cards say\n" +
    "'Trial active' and /checkout/return shows the success screen. This is local-only:\n" +
    "Dodo's dashboard still shows no subscription. To undo, set subscriptionStatus\n" +
    "back and clear trialStartedAt/dodoSubscriptionId for this row."
);
db.close();