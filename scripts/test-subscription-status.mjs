/**
 * Phase 1 live test: "Confirm the calls/user table shows correct subscription
 * status after each step."
 *
 * The `calls` table stores call records and has no billing columns; the user
 * table is `businesses`, which carries `subscriptionStatus`. This test walks one
 * business through the full Dodo lifecycle and, after every step, confirms:
 *   - the `businesses` row shows the expected subscriptionStatus (+ billing ids)
 *   - /api/me (the user-facing view) reflects the same state
 *   - a `calls` row for the business links to a business whose status is correct
 *
 * Steps: signup → subscription.active (trial) → payment.succeeded (charge) →
 * subscription.renewed → past_due → on_hold → cancelled → expired → failed.
 *
 * Usage: node scripts/test-subscription-status.mjs <path-to-throwaway-db>
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { Webhook } from "standardwebhooks";

const BASE_URL = process.env.CALLFLOW_BASE_URL ?? "http://localhost:3000";
const dbPath = process.argv[2];
if (!dbPath) {
  console.error("usage: node scripts/test-subscription-status.mjs <path-to-throwaway-db>");
  process.exit(1);
}

// --- Load the real Dodo test-mode values from .env.local. ---
const envPath = path.resolve("f:/callflow/.env.local");
const env = fs.readFileSync(envPath, "utf8");
function envValue(name) {
  const value = env.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1]?.trim();
  return value ? value.replace(/^"(.*)"$/, "$1") : "";
}
const webhookSecret = envValue("DODO_PAYMENTS_WEBHOOK_SECRET");
if (!webhookSecret) {
  console.error("DODO_PAYMENTS_WEBHOOK_SECRET must be set in .env.local");
  process.exit(1);
}

let failures = 0;
function check(label, condition, detail = "") {
  const ok = Boolean(condition);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

/** Signs and delivers a webhook exactly as Dodo would (standardwebhooks). */
async function deliverWebhook(event) {
  const webhookId = `evt_st_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const timestamp = new Date();
  const payload = JSON.stringify(event);
  const signature = new Webhook(webhookSecret).sign(webhookId, timestamp, payload);
  const response = await fetch(`${BASE_URL}/api/webhooks/dodo`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-id": webhookId,
      "webhook-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
      "webhook-signature": signature,
    },
    body: payload,
  });
  const body = await response.json();
  return { webhookId, status: response.status, body };
}

function businessRow(id) {
  const db = new Database(dbPath);
  const row = db
    .prepare(
      "SELECT subscriptionStatus, trialStartedAt, dodoSubscriptionId, dodoCustomerId, subscriptionPaymentId FROM businesses WHERE id = ?"
    )
    .get(id);
  db.close();
  return row;
}

async function me(cookie) {
  const response = await fetch(`${BASE_URL}/api/me`, {
    headers: cookie ? { cookie } : {},
  });
  return { status: response.status, body: await response.json() };
}

// A fresh, valid US test number + email so the business row is unique.
const phoneNumber = `+1415555${String(Date.now()).slice(-4)}`;
const name = "Status Lifecycle Test";
const email = `status-lifecycle-${Date.now()}@test.com`;
const country = "US";

console.log(`\n== Step 0: signup (pending_checkout) ==`);
const signupResponse = await fetch(`${BASE_URL}/api/billing/signup`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ phoneNumber, name, email, country }),
});
const signupBody = await signupResponse.json();
const businessId = signupBody.businessId;
const customerId = signupBody.dodoCustomerId;
const sessionCookie = signupResponse.headers.get("set-cookie")?.split(";")[0] ?? "";
check("signup returns 201", signupResponse.status === 201, `got ${signupResponse.status}`);

let row = businessRow(businessId);
check("businesses.subscriptionStatus is pending_checkout", row?.subscriptionStatus === "pending_checkout", `got ${row?.subscriptionStatus}`);
check("trialStartedAt is null", row?.trialStartedAt === null);
check("no subscription linked yet", row?.dodoSubscriptionId === null);
check("no payment logged yet", row?.subscriptionPaymentId === null);
let meBody = (await me(sessionCookie)).body;
check("/api/me state is awaiting_checkout", meBody.access?.state === "awaiting_checkout", `got ${meBody.access?.state}`);
check("/api/me not entitled", meBody.access?.entitled === false);
check("/api/me hasSubscription false", meBody.hasSubscription === false);

const subscriptionId = `sub_st_${Date.now()}`;
const subscriptionEvent = (type, status) => ({
  business_id: "bus_merchant",
  type,
  timestamp: new Date().toISOString(),
  data: {
    subscription_id: subscriptionId,
    status,
    customer: { customer_id: customerId, email, name },
    metadata: { callflow_business_id: businessId },
  },
});

console.log(`\n== Step 1: subscription.active (trial starts) ==`);
let res = await deliverWebhook(subscriptionEvent("subscription.active", "active"));
check("webhook returns 200", res.status === 200, `got ${res.status}`);
row = businessRow(businessId);
check("businesses.subscriptionStatus is active", row?.subscriptionStatus === "active", `got ${row?.subscriptionStatus}`);
check("trialStartedAt saved server-side", typeof row?.trialStartedAt === "string" && !Number.isNaN(Date.parse(row.trialStartedAt)), `got ${row?.trialStartedAt}`);
check("dodoSubscriptionId linked", row?.dodoSubscriptionId === subscriptionId);
meBody = (await me(sessionCookie)).body;
check("/api/me state is trialing", meBody.access?.state === "trialing", `got ${meBody.access?.state}`);
check("/api/me entitled", meBody.access?.entitled === true);
check("/api/me hasSubscription true", meBody.hasSubscription === true);
check("/api/me trialExpired false", meBody.trialExpired === false);

console.log(`\n== Step 2: payment.succeeded (charge fires) ==`);
const paymentId = `pay_st_${Date.now()}`;
res = await deliverWebhook({
  business_id: "bus_merchant",
  type: "payment.succeeded",
  timestamp: new Date().toISOString(),
  data: {
    payment_id: paymentId,
    status: "succeeded",
    amount: 4500,
    currency: "USD",
    subscription_id: subscriptionId,
    customer: { customer_id: customerId, email, name },
  },
});
check("webhook returns 200", res.status === 200, `got ${res.status}`);
row = businessRow(businessId);
check("businesses.subscriptionStatus still active", row?.subscriptionStatus === "active", `got ${row?.subscriptionStatus}`);
check("charge logged: subscriptionPaymentId set", row?.subscriptionPaymentId === paymentId, `got ${row?.subscriptionPaymentId}`);
meBody = (await me(sessionCookie)).body;
check("/api/me state still trialing", meBody.access?.state === "trialing", `got ${meBody.access?.state}`);
check("/api/me still entitled", meBody.access?.entitled === true);

console.log(`\n== Step 3: subscription.renewed (billing period rolls over) ==`);
res = await deliverWebhook(subscriptionEvent("subscription.renewed", "active"));
check("webhook returns 200", res.status === 200, `got ${res.status}`);
row = businessRow(businessId);
check("businesses.subscriptionStatus still active", row?.subscriptionStatus === "active", `got ${row?.subscriptionStatus}`);
meBody = (await me(sessionCookie)).body;
check("/api/me state still trialing", meBody.access?.state === "trialing", `got ${meBody.access?.state}`);

console.log(`\n== Step 4: subscription.past_due (charge failed, grace period) ==`);
res = await deliverWebhook(subscriptionEvent("subscription.past_due", "past_due"));
check("webhook returns 200", res.status === 200, `got ${res.status}`);
row = businessRow(businessId);
check("businesses.subscriptionStatus is past_due", row?.subscriptionStatus === "past_due", `got ${row?.subscriptionStatus}`);
meBody = (await me(sessionCookie)).body;
check("/api/me state is past_due", meBody.access?.state === "past_due", `got ${meBody.access?.state}`);
check("/api/me still entitled", meBody.access?.entitled === true);

console.log(`\n== Step 5: subscription.on_hold (dunning hold) ==`);
res = await deliverWebhook(subscriptionEvent("subscription.on_hold", "on_hold"));
check("webhook returns 200", res.status === 200, `got ${res.status}`);
row = businessRow(businessId);
check("businesses.subscriptionStatus is on_hold", row?.subscriptionStatus === "on_hold", `got ${row?.subscriptionStatus}`);
meBody = (await me(sessionCookie)).body;
check("/api/me state is on_hold", meBody.access?.state === "on_hold", `got ${meBody.access?.state}`);
check("/api/me still entitled (trial window)", meBody.access?.entitled === true);

console.log(`\n== Step 6: subscription.cancelled ==`);
res = await deliverWebhook(subscriptionEvent("subscription.cancelled", "cancelled"));
check("webhook returns 200", res.status === 200, `got ${res.status}`);
row = businessRow(businessId);
check("businesses.subscriptionStatus is cancelled", row?.subscriptionStatus === "cancelled", `got ${row?.subscriptionStatus}`);
meBody = (await me(sessionCookie)).body;
check("/api/me state is lapsed", meBody.access?.state === "lapsed", `got ${meBody.access?.state}`);
check("/api/me not entitled", meBody.access?.entitled === false);

console.log(`\n== Step 7: subscription.expired ==`);
res = await deliverWebhook(subscriptionEvent("subscription.expired", "expired"));
check("webhook returns 200", res.status === 200, `got ${res.status}`);
row = businessRow(businessId);
check("businesses.subscriptionStatus is expired", row?.subscriptionStatus === "expired", `got ${row?.subscriptionStatus}`);
meBody = (await me(sessionCookie)).body;
check("/api/me state is lapsed", meBody.access?.state === "lapsed", `got ${meBody.access?.state}`);
check("/api/me not entitled", meBody.access?.entitled === false);

console.log(`\n== Step 8: subscription.failed ==`);
res = await deliverWebhook(subscriptionEvent("subscription.failed", "failed"));
check("webhook returns 200", res.status === 200, `got ${res.status}`);
row = businessRow(businessId);
check("businesses.subscriptionStatus is failed", row?.subscriptionStatus === "failed", `got ${row?.subscriptionStatus}`);
meBody = (await me(sessionCookie)).body;
check("/api/me state is lapsed", meBody.access?.state === "lapsed", `got ${meBody.access?.state}`);
check("/api/me not entitled", meBody.access?.entitled === false);

console.log(`\n== Step 9: calls table links to the business with the right status ==`);
const db = new Database(dbPath);
const callId = `call_st_${Date.now()}`;
db.prepare(
  `INSERT INTO calls (id, businessId, callerNumber, callStatus, callStartedAt, createdAt, updatedAt)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
).run(callId, businessId, "+14155550101", "completed", new Date().toISOString(), new Date().toISOString(), new Date().toISOString());
const joined = db
  .prepare(
    "SELECT c.id AS callId, b.subscriptionStatus AS status FROM calls c JOIN businesses b ON b.id = c.businessId WHERE c.id = ?"
  )
  .get(callId);
db.close();
check("call row exists", !!joined);
check("call links to business with subscriptionStatus failed", joined?.status === "failed", `got ${joined?.status}`);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
