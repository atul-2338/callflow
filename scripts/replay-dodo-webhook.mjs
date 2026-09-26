/**
 * One-off recovery: replay the `subscription.active` event Dodo sent for the
 * Reeves Plumbing checkout (sub_0NoDyjK3snxzBEH2yugYm) but which was delivered
 * to the bare ngrok root (POST / 200) instead of /api/webhooks/dodo because the
 * dashboard webhook URL was missing the path.
 *
 * The event is signed with the real DODO_PAYMENTS_WEBHOOK_SECRET and POSTed to
 * the live endpoint, so it exercises the exact same code path as a genuine
 * delivery (signature verification → normalization → DB application).
 */
import fs from "node:fs";
import path from "node:path";
import { Webhook } from "standardwebhooks";

const envPath = path.resolve("f:/callflow/.env.local");
const env = fs.readFileSync(envPath, "utf8");
// .env.local wraps values in double quotes; @next/env strips them at runtime,
// so mirror that here.
const secret = env
  .match(/^DODO_PAYMENTS_WEBHOOK_SECRET=(.*)$/m)?.[1]
  ?.trim()
  .replace(/^"(.*)"$/, "$1");
if (!secret) {
  console.error("DODO_PAYMENTS_WEBHOOK_SECRET not found in .env.local");
  process.exit(1);
}

const webhookId = `evt_replay_${Date.now()}`;
const timestamp = new Date();
const payload = JSON.stringify({
  business_id: "bus_merchant",
  type: "subscription.active",
  timestamp: timestamp.toISOString(),
  data: {
    subscription_id: "sub_0NoDyjK3snxzBEH2yugYm",
    status: "active",
    customer: {
      customer_id: "cus_0NoDyOBmZfgMb4TkhUsDF",
      email: "reevs@y.com",
      name: "Reeves Plumbing",
    },
    metadata: { callflow_business_id: "c121fa31-8e20-41c8-950f-29706d801add" },
  },
});

const signature = new Webhook(secret).sign(webhookId, timestamp, payload);
const tsSeconds = Math.floor(timestamp.getTime() / 1000);

const url = "https://expanse-grunge-glass.ngrok-free.dev/api/webhooks/dodo";
const response = await fetch(url, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "webhook-id": webhookId,
    "webhook-timestamp": String(tsSeconds),
    "webhook-signature": signature,
  },
  body: payload,
});

console.log("webhookId:", webhookId);
console.log("signature:", signature);
console.log("status:", response.status);
console.log("body:", await response.text());
