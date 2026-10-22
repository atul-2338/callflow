#!/usr/bin/env node
/**
 * Local smoke test for the Telnyx answer endpoint.
 *
 * POSTs a realistic `call.initiated` webhook to the local server. The endpoint
 * only accepts it when TELNYX_PUBLIC_KEY is UNSET (the open-by-default local
 * dev mode) — a real Telnyx delivery carries an Ed25519 signature that only
 * Telnyx's private key can produce, so this script cannot forge one.
 *
 * Usage:
 *   node scripts/simulate-telnyx-call.mjs [baseUrl]
 *
 * Env:
 *   BASE_URL  optional; defaults to http://localhost:3000
 */
const baseUrl = process.argv[2] || process.env.BASE_URL || "http://localhost:3000";
const url = `${baseUrl}/api/v1/telephony/telnyx/answer`;

const body = {
  data: {
    record_type: "event",
    event_type: "call.initiated",
    id: `sim-${Date.now()}`,
    occurred_at: new Date().toISOString(),
    payload: {
      call_control_id: "v2:simulated-call-control-id",
      connection_id: "7267xxxxxxxxxxxxxx",
      call_leg_id: "sim-leg-1",
      call_session_id: "sim-session-1",
      from: "+15550001111",
      to: "+19283319394",
      direction: "inbound",
      state: "initiated",
    },
  },
};

const res = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

console.log(`POST ${url}`);
console.log(`  status: ${res.status}`);
console.log(`  body:   ${await res.text()}`);
console.log(`
Expect 200. With TELNYX_PUBLIC_KEY set, the endpoint rejects unsigned
deliveries with 403 — unset it in .env.local for this local smoke test.
`);
