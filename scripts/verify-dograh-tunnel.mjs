// Live verification of the Dograh webhook through the Cloudflare quick tunnel
// (or against localhost when no tunnel is running).
//
// Uses the real WEBHOOK_SECRET from .env.local. Base URL comes from
// data/tunnel-url.txt (written by scripts/tunnel.mjs), or BASE_URL env.
//
// Checks, in order:
//   1. GET  /api/webhooks/dograh/health -> 200 {"ok":true} (no secret)
//   2. GET  /api/webhooks/dograh        -> 405 (POST-only)
//   3. POST with x-webhook-secret       -> 200 {"ok":true}
//   4. Replay of the same callId        -> 200, still ONE row (idempotent upsert)
//   5. Wrong secret                     -> 401
//   6. Missing secret                   -> 401
//   7. GET /api/calls                   -> rows visible
// Cleanup afterwards: npm run clear-test (removes callId "test-*" rows).
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

let BASE = process.env.BASE_URL ?? "";
if (!BASE) {
  try {
    const tunnelUrl = fs
      .readFileSync(path.resolve("data/tunnel-url.txt"), "utf8")
      .trim();
    BASE = new URL(tunnelUrl).origin;
  } catch {
    BASE = "http://localhost:3000";
  }
}

// --- Load the real WEBHOOK_SECRET from .env.local. ---
const env = fs.readFileSync(path.resolve(".env.local"), "utf8");
function envValue(name) {
  const value = env.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1]?.trim();
  return value ? value.replace(/^"(.*)"/, "$1") : "";
}
const secret = envValue("WEBHOOK_SECRET");
if (!secret) {
  console.error("WEBHOOK_SECRET must be set in .env.local");
  process.exit(1);
}

// Fixture shaped exactly like the wired Dograh webhook node renders it
// (template in scripts/wire-dograh-webhook.mjs: every value is stringified,
// nested contexts arrive as JSON strings). called_number is the live Telnyx
// DID — the only number in use.
const TELNYX_DID = "+18885459969";
function buildFixture(callId) {
  return {
    callId,
    status: "callback_requested",
    duration: "184",
    caller_number: "+15550000123",
    called_number: TELNYX_DID,
    gathered: JSON.stringify({
      customer_name: "Priya Raman",
      call_status: "end_call",
    }),
    initial_context: JSON.stringify({
      direction: "inbound",
      caller_number: "+15550000123",
      called_number: TELNYX_DID,
    }),
  };
}

async function get(path) {
  const res = await fetch(BASE + path);
  const text = await res.text();
  console.log(`GET ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return { status: res.status, text };
}

async function post(path, body, headers = {}) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  console.log(`POST ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return { status: res.status, text };
}

const runId = Date.now();

// 1. Liveness — no secret needed.
await get("/api/webhooks/dograh/health");

// 2. GET on the webhook itself — POST-only, expect 405.
await get("/api/webhooks/dograh");

// 3. The REAL path: signed POST exactly as the Dograh webhook node sends it.
const callId = `test-tunnel-live-${runId}`;
const fixture = buildFixture(callId);
await post("/api/webhooks/dograh", fixture, { "x-webhook-secret": secret });

// 4. Replay the same callId -> idempotent upsert (200, still ONE row).
await post("/api/webhooks/dograh", fixture, { "x-webhook-secret": secret });

// 5. Wrong secret -> 401.
await post("/api/webhooks/dograh", buildFixture(`test-tunnel-badauth-${runId}`), {
  "x-webhook-secret": "wrong-secret",
});

// 6. Missing secret -> 401.
await post("/api/webhooks/dograh", buildFixture(`test-tunnel-noauth-${runId}`), {});

// 7. Confirm the calls landed (the tunnel-live row; the 401s must not exist).
await get("/api/calls");

console.log(`\nCleanup: npm run clear-test  (removes callId "test-*" rows)`);