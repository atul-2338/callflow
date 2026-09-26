/**
 * Phase 1 live test: signup flow — "$0 due at signup, trial start timestamp
 * saved server-side".
 *
 * Requires the app to be running locally (dev or prod) with a throwaway
 * DATABASE_PATH, and the real Dodo test-mode keys in .env.local. It:
 *
 *   1. POSTs /api/billing/signup with a fresh test business and asserts the
 *      checkout session is created (pending_checkout, no trial yet).
 *   2. Calls Dodo's checkoutSessions.preview with the same cart + trial and
 *      asserts $0 is due at signup (free trial: trial_amount null,
 *      payment_method_required false, current total 0).
 *   3. Signs a `subscription.active` webhook with the real webhook secret and
 *      POSTs it to /api/webhooks/dodo — the exact code path of a genuine
 *      delivery (signature verification → normalization → DB application).
 *   4. Asserts the trial start timestamp was saved server-side in the
 *      businesses table and that /api/me reports the trial.
 *
 * Usage: node scripts/test-signup-flow.mjs <path-to-throwaway-db>
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import DodoPayments from "dodopayments";
import { Webhook } from "standardwebhooks";

const BASE_URL = process.env.CALLFLOW_BASE_URL ?? "http://localhost:3000";
const dbPath = process.argv[2];
if (!dbPath) {
  console.error("usage: node scripts/test-signup-flow.mjs <path-to-throwaway-db>");
  process.exit(1);
}

// --- Load the real Dodo test-mode values from .env.local (mirrors how
// @next/env strips the surrounding double quotes at runtime). ---
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

// A fresh, valid US test number + email so the business row is unique.
const phoneNumber = `+1415555${String(Date.now()).slice(-4)}`;
const name = "Signup Flow Test";
const email = `signup-flow-${Date.now()}@test.com`;
const country = "US";

console.log(`\n== 1. POST ${BASE_URL}/api/billing/signup ==`);
const signupResponse = await fetch(`${BASE_URL}/api/billing/signup`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ phoneNumber, name, email, country }),
});
const signupBody = await signupResponse.json();
console.log("status:", signupResponse.status);
console.log("body:", JSON.stringify(signupBody, null, 2));

check("signup returns 201", signupResponse.status === 201, `got ${signupResponse.status}`);
check("checkout URL is present", typeof signupBody.checkoutUrl === "string" && signupBody.checkoutUrl.length > 0);
check("checkout session id is present", typeof signupBody.checkoutSessionId === "string");
check("subscriptionStatus is pending_checkout", signupBody.subscriptionStatus === "pending_checkout");
check("trialStartedAt is null before the webhook", signupBody.trialStartedAt === null);
check("access is awaiting_checkout / not entitled", signupBody.access?.state === "awaiting_checkout" && signupBody.access?.entitled === false);

const businessId = signupBody.businessId;
const customerId = signupBody.dodoCustomerId ?? null;
const sessionCookie = signupResponse.headers.get("set-cookie")?.split(";")[0] ?? "";

console.log(`\n== 2. Dodo checkoutSessions.preview — amount due at signup ==`);
const preview = await client.checkoutSessions.preview({
  product_cart: [{ product_id: productId, quantity: 1 }],
  billing_address: { country },
  subscription_data: { trial_period_days: 3 },
});
console.log("preview:", JSON.stringify(preview, null, 2));
check("preview trial_period_days is 3", preview.trial_period_days === 3, `got ${preview.trial_period_days}`);
check("preview trial_amount is absent/null (free trial)", !preview.trial_amount, `got ${preview.trial_amount}`);
check("preview payment_method_required is false ($0 due, no card)", preview.payment_method_required === false, `got ${preview.payment_method_required}`);
check("preview current total due is 0", preview.current_breakup?.total_amount === 0, `got ${preview.current_breakup?.total_amount}`);

console.log(`\n== 3. Simulate the signed subscription.active webhook ==`);
const webhookId = `evt_signup_test_${Date.now()}`;
const timestamp = new Date();
const payload = JSON.stringify({
  business_id: "bus_merchant",
  type: "subscription.active",
  timestamp: timestamp.toISOString(),
  data: {
    subscription_id: `sub_signup_test_${Date.now()}`,
    status: "active",
    customer: { customer_id: customerId, email, name },
    metadata: { callflow_business_id: businessId },
  },
});
const signature = new Webhook(webhookSecret).sign(webhookId, timestamp, payload);
const webhookResponse = await fetch(`${BASE_URL}/api/webhooks/dodo`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "webhook-id": webhookId,
    "webhook-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
    "webhook-signature": signature,
  },
  body: payload,
});
const webhookBody = await webhookResponse.json();
console.log("status:", webhookResponse.status);
console.log("body:", JSON.stringify(webhookBody));
check("webhook returns 200", webhookResponse.status === 200, `got ${webhookResponse.status}`);

console.log(`\n== 4. Server-side state in ${dbPath} ==`);
const db = new Database(dbPath, { readonly: true });
const row = db
  .prepare(
    "SELECT id, phoneNumber, billingName, billingEmail, trialStartedAt, dodoCustomerId, dodoSubscriptionId, dodoCheckoutSessionId, subscriptionStatus FROM businesses WHERE id = ?"
  )
  .get(businessId);
db.close();
console.log("business row:", JSON.stringify(row, null, 2));
check("business row exists", !!row);
check("trialStartedAt was saved server-side", typeof row?.trialStartedAt === "string" && !Number.isNaN(Date.parse(row.trialStartedAt)), `got ${row?.trialStartedAt}`);
check("subscriptionStatus is active", row?.subscriptionStatus === "active", `got ${row?.subscriptionStatus}`);
check("dodoSubscriptionId is linked", typeof row?.dodoSubscriptionId === "string" && row.dodoSubscriptionId.startsWith("sub_"), `got ${row?.dodoSubscriptionId}`);
check("dodoCustomerId is linked", typeof row?.dodoCustomerId === "string" && row.dodoCustomerId.startsWith("cus_"), `got ${row?.dodoCustomerId}`);

console.log(`\n== 5. /api/me reports the trial (what the return page polls) ==`);
const meResponse = await fetch(`${BASE_URL}/api/me`, {
  headers: sessionCookie ? { cookie: sessionCookie } : {},
});
const meBody = await meResponse.json();
console.log("status:", meResponse.status);
console.log("body:", JSON.stringify(meBody, null, 2));
check("/api/me returns 200", meResponse.status === 200, `got ${meResponse.status}`);
check("/api/me reports trialStartedAt", typeof meBody.trialStartedAt === "string", `got ${meBody.trialStartedAt}`);
check("/api/me reports trialEndsAt (start + 3 days)", typeof meBody.trialEndsAt === "string", `got ${meBody.trialEndsAt}`);
check("/api/me access is trialing / entitled", meBody.access?.state === "trialing" && meBody.access?.entitled === true, `got ${JSON.stringify(meBody.access)}`);
check("/api/me hasSubscription is true", meBody.hasSubscription === true, `got ${meBody.hasSubscription}`);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exitCode = failures === 0 ? 0 : 1;

