/**
 * Phase 1 live test: trial-to-paid transition — "charge fires correctly and is
 * logged".
 *
 * Requires the app to be running locally (dev or prod) with a throwaway
 * DATABASE_PATH, and the real Dodo test-mode keys in .env.local.
 *
 * The first charge is fired by Dodo's billing engine at the trial end date, so
 * it cannot be triggered on demand. This test verifies both halves of the item:
 *
 *   A. "Charge fires correctly" — Dodo's checkoutSessions.preview confirms the
 *      recurring amount that will be charged at trial end and the next billing
 *      date (test-mode price is $45; launch price is $49).
 *   B. "…and is logged" — the charge events are driven through the exact signed
 *      webhook path a real delivery uses (signature verification → normalization
 *      → DB application), with the trial window backdated so the local state
 *      matches a real post-transition business:
 *        1. signup → subscription.active (trial starts)
 *        2. trialStartedAt backdated 4 days (trial elapsed)
 *        3. payment.succeeded  → subscriptionPaymentId logged, status unchanged
 *        4. subscription.renewed → status stays active
 *        5. every delivery recorded in dodo_webhook_events (audit log)
 *        6. /api/me reports active (not trialing), trialExpired, hasSubscription
 *
 * Usage: node scripts/test-trial-to-paid.mjs <path-to-throwaway-db>
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import DodoPayments from "dodopayments";
import { Webhook } from "standardwebhooks";

const BASE_URL = process.env.CALLFLOW_BASE_URL ?? "http://localhost:3000";
const dbPath = process.argv[2];
if (!dbPath) {
  console.error("usage: node scripts/test-trial-to-paid.mjs <path-to-throwaway-db>");
  process.exit(1);
}

// --- Load the real Dodo test-mode values from .env.local. ---
const envPath = path.resolve("f:/callflow/.env.local");
const env = fs.readFileSync(envPath, "utf8");
function envValue(name) {
  const value = env.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1]?.trim();
  return value ? value.replace(/^"(.*)"$/, "$1") : "";
}
const apiKey = envValue("DODO_PAYMENTS_API_KEY");
const environment = envValue("DODO_PAYMENTS_ENVIRONMENT") || "test_mode";
const productId = envValue("DODO_SOLO_PRODUCT_ID");
const webhookSecret = envValue("DODO_PAYMENTS_WEBHOOK_SECRET");
if (!apiKey || !productId || !webhookSecret) {
  console.error("DODO_PAYMENTS_API_KEY / DODO_SOLO_PRODUCT_ID / DODO_PAYMENTS_WEBHOOK_SECRET must be set in .env.local");
  process.exit(1);
}

let failures = 0;
function check(label, condition, detail = "") {
  const ok = Boolean(condition);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const client = new DodoPayments({ bearerToken: apiKey, environment });

/** Signs and delivers a webhook exactly as Dodo would (standardwebhooks). */
async function deliverWebhook(event) {
  const webhookId = `evt_t2p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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

// A fresh, valid US test number + email so the business row is unique.
const phoneNumber = `+1415555${String(Date.now()).slice(-4)}`;
const name = "Trial To Paid Test";
const email = `trial-to-paid-${Date.now()}@test.com`;
const country = "US";

console.log(`\n== A. Charge amount & timing (Dodo checkoutSessions.preview) ==`);
const preview = await client.checkoutSessions.preview({
  product_cart: [{ product_id: productId, quantity: 1 }],
  billing_address: { country },
  subscription_data: { trial_period_days: 3 },
});
console.log("recurring_breakup:", JSON.stringify(preview.recurring_breakup));
console.log("next_billing_date:", preview.next_billing_date);
check("recurring charge amount is present and > 0", preview.recurring_breakup?.total_amount > 0, `$${(preview.recurring_breakup?.total_amount ?? 0) / 100} (test-mode price; launch price is $49)`);
check("next billing date is present (trial end)", typeof preview.next_billing_date === "string", `got ${preview.next_billing_date}`);
check("trial is 3 days", preview.trial_period_days === 3, `got ${preview.trial_period_days}`);
console.log(`\n== B.1 Signup + subscription.active (trial starts) ==`);
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

const subscriptionId = `sub_t2p_${Date.now()}`;
const active = await deliverWebhook({
  business_id: "bus_merchant",
  type: "subscription.active",
  timestamp: new Date().toISOString(),
  data: {
    subscription_id: subscriptionId,
    status: "active",
    customer: { customer_id: customerId, email, name },
    metadata: { callflow_business_id: businessId },
  },
});
check("subscription.active webhook returns 200", active.status === 200, `got ${active.status}`);

console.log(`\n== B.2 Backdate trialStartedAt 4 days (trial elapsed) ==`);
const db = new Database(dbPath);
const backdated = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
db.prepare("UPDATE businesses SET trialStartedAt = ? WHERE id = ?").run(backdated, businessId);
const beforeCharge = db
  .prepare("SELECT trialStartedAt, subscriptionStatus, subscriptionPaymentId FROM businesses WHERE id = ?")
  .get(businessId);
db.close();
console.log("row before charge:", JSON.stringify(beforeCharge));
check("trialStartedAt backdated", beforeCharge.trialStartedAt === backdated);
check("status still active before charge", beforeCharge.subscriptionStatus === "active");
check("no payment logged yet", beforeCharge.subscriptionPaymentId === null);

console.log(`\n== B.3 payment.succeeded (the charge fires) ==`);
const paymentId = `pay_t2p_${Date.now()}`;
const paid = await deliverWebhook({
  business_id: "bus_merchant",
  type: "payment.succeeded",
  timestamp: new Date().toISOString(),
  data: {
    payment_id: paymentId,
    status: "succeeded",
    amount: preview.recurring_breakup.total_amount,
    currency: "USD",
    subscription_id: subscriptionId,
    customer: { customer_id: customerId, email, name },
  },
});
check("payment.succeeded webhook returns 200", paid.status === 200, `got ${paid.status}`);

console.log(`\n== B.4 subscription.renewed (billing period rolls over) ==`);
const renewed = await deliverWebhook({
  business_id: "bus_merchant",
  type: "subscription.renewed",
  timestamp: new Date().toISOString(),
  data: {
    subscription_id: subscriptionId,
    status: "active",
    customer: { customer_id: customerId, email, name },
    metadata: { callflow_business_id: businessId },
  },
});
check("subscription.renewed webhook returns 200", renewed.status === 200, `got ${renewed.status}`);

console.log(`\n== B.5 Server-side state after the transition ==`);
const db2 = new Database(dbPath);
const after = db2
  .prepare(
    "SELECT trialStartedAt, subscriptionStatus, subscriptionPaymentId, dodoSubscriptionId FROM businesses WHERE id = ?"
  )
  .get(businessId);
const loggedEvents = db2
  .prepare("SELECT eventType FROM dodo_webhook_events WHERE webhookId IN (?, ?, ?) ORDER BY receivedAt")
  .all(active.webhookId, paid.webhookId, renewed.webhookId);
db2.close();
console.log("business row:", JSON.stringify(after));
console.log("logged events:", JSON.stringify(loggedEvents));
check("charge is logged: subscriptionPaymentId set", after.subscriptionPaymentId === paymentId, `got ${after.subscriptionPaymentId}`);
check("subscriptionStatus still active after charge", after.subscriptionStatus === "active", `got ${after.subscriptionStatus}`);
check("trialStartedAt unchanged by charge events", after.trialStartedAt === backdated);
check("subscription still linked", after.dodoSubscriptionId === subscriptionId);
check("all 3 deliveries recorded in dodo_webhook_events (audit log)", loggedEvents.length === 3, `got ${loggedEvents.length}`);

console.log(`\n== B.6 /api/me after the transition (what the app sees) ==`);
const meResponse = await fetch(`${BASE_URL}/api/me`, {
  headers: sessionCookie ? { cookie: sessionCookie } : {},
});
const meBody = await meResponse.json();
console.log("body:", JSON.stringify(meBody, null, 2));
check("/api/me returns 200", meResponse.status === 200, `got ${meResponse.status}`);
check("state is active (not trialing) after trial elapsed", meBody.access?.state === "active", `got ${meBody.access?.state}`);
check("still entitled", meBody.access?.entitled === true);
check("trialExpired is true", meBody.trialExpired === true, `got ${meBody.trialExpired}`);
check("hasSubscription is true", meBody.hasSubscription === true, `got ${meBody.hasSubscription}`);
check("subscriptionStatus is active", meBody.subscriptionStatus === "active", `got ${meBody.subscriptionStatus}`);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exitCode = failures === 0 ? 0 : 1;

