// Live verification of the Dograh webhook through the ngrok tunnel.
// Uses the real DOGRAH_WEBHOOK_SECRET and a throwaway DB (DATABASE_PATH set by the server script).
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const BASE = "https://expanse-grunge-glass.ngrok-free.dev";

// --- Load the real DOGRAH_WEBHOOK_SECRET from .env.local. ---
const env = fs.readFileSync(path.resolve("f:/callflow/.env.local"), "utf8");
function envValue(name) {
  const value = env.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1]?.trim();
  return value ? value.replace(/^"(.*)"$/, "$1") : "";
}
const secret = envValue("DOGRAH_WEBHOOK_SECRET");
if (!secret) {
  console.error("DOGRAH_WEBHOOK_SECRET must be set in .env.local");
  process.exit(1);
}

// --- Build a fixture payload shaped exactly like the Dograh webhook node sends. ---
function buildFixture(runId, callerNumber, calledNumber) {
  const gathered = {
    call_disposition: "callback_requested",
    mapped_call_disposition: "callback_requested",
    caller_number: callerNumber,
    customer_name: "Priya Raman",
  };
  return {
    payload: {
      workflow_run_id: runId,
      workflow_name: "Callflow pilot agent",
      call_time: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      direction: "inbound",
      caller_number: callerNumber,
      called_number: calledNumber,
      call_disposition: "callback_requested",
      mapped_call_disposition: "callback_requested",
      duration_seconds: "184",
      recording_url: `https://app.dograh.com/public/download/workflow/${runId}/recording`,
      transcript_url: `https://app.dograh.com/public/download/workflow/${runId}/transcript`,
      initial_context: JSON.stringify({
        direction: "inbound",
        caller_number: callerNumber,
        called_number: calledNumber,
      }),
      gathered_context: JSON.stringify(gathered),
      cost_info: JSON.stringify({ call_duration_seconds: "184" }),
    },
    headers: {
      "x-dograh-delivery-id": randomUUID(),
      "x-dograh-workflow-run-id": runId,
      "x-dograh-delivery-attempt": "1",
    },
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
  console.log(`POST ${path} -> ${res.status} ${text.slice(0, 500)}`);
  return { status: res.status, text };
}

// 1. Liveness probe through the tunnel.
await get("/api/webhooks/dograh");

// 2. Full pipeline via the fixture test route (parse -> dedupe -> match -> DB write -> push).
await post("/api/webhooks/dograh/test", { fixture: "booked", workflow_run_id: "tunnel-live-1" });

// 3. The REAL endpoint path: signed payload with X-Callflow-Secret header,
//    exactly as the Dograh workflow's send-webhook node will send it.
const fixture = buildFixture("tunnel-live-2", "+15550000123", "+15559998888");
await post("/api/webhooks/dograh", fixture.payload, {
  "x-callflow-secret": secret,
  ...fixture.headers,
});

// 4. Replay the same run id -> must be a duplicate (idempotency through the tunnel).
await post("/api/webhooks/dograh", fixture.payload, {
  "x-callflow-secret": secret,
  "x-dograh-delivery-id": randomUUID(),
  "x-dograh-workflow-run-id": fixture.headers["x-dograh-workflow-run-id"],
  "x-dograh-delivery-attempt": "2",
});

// 5. Wrong secret -> must be rejected (401).
await post("/api/webhooks/dograh", fixture.payload, {
  "x-callflow-secret": "wrong-secret",
  "x-dograh-delivery-id": randomUUID(),
  "x-dograh-workflow-run-id": "bad-auth-run",
});

// 6. Confirm the calls landed in the throwaway DB via the API.
await get("/api/calls");
