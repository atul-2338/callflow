// Live end-to-end simulation: POST the exact payload the published webhook
// node would render (based on real completed run 700924) to the Callflow
// endpoint through the ngrok tunnel. Verifies auth -> parse -> dedupe ->
// match -> persist with realistic Dograh data.
import fs from "node:fs";

const env = fs.readFileSync("f:/callflow/.env.local", "utf8");
const envValue = (name) =>
  env.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1]?.trim()?.replace(/^"(.*)"$/, "$1") ?? "";
const secret = envValue("DOGRAH_WEBHOOK_SECRET");
const returnUrl = envValue("DODO_PAYMENTS_RETURN_URL");
const tunnelHost = returnUrl ? new URL(returnUrl).host : "expanse-grunge-glass.ngrok-free.dev";
const endpoint = `https://${tunnelHost}/api/webhooks/dograh`;

// Real data from completed run 700924 (mode: smallwebrtc, inbound).
const initialContext = {
  direction: "inbound",
  mps_correlation_id: "f6bcf3ad-67b6-458e-b655-d617de9065ba",
  workflow_run_id: 700924,
  runtime_configuration: {
    stt_provider: "dograh",
    stt_model: "default",
    tts_provider: "dograh",
    tts_model: "default",
    llm_provider: "dograh",
    llm_model: "default",
  },
};
const gatheredContext = {
  nodes_visited: ["start call", "Main Agenda and Questions", "End Call"],
  call_status: "end_call",
  call_disposition: "end_call",
  mapped_call_disposition: "end_call",
  call_tags: ["end_call", "user_speech"],
  agent_visits: [
    {
      visit_id: "visit-02957975dddb",
      workflow_id: 11661,
      workflow_name: "Restaurant Table Reservation - inbound",
      definition_id: 33695,
      entered_at: 1789637465.9280572,
      exited_at: 1789637555.6611497,
      exit_reason: "end_call",
      error: null,
      node: "End Call",
    },
  ],
  trace_url:
    "https://langfuse.dograh.com/project/cmb7xqh4a0006pd07xuof6juc/traces/28c438635db4859f6fe7371cd768f618",
};

// The webhook node renderer stringifies EVERY value, so nested dicts arrive
// as JSON-encoded strings and numbers as strings.
const payload = {
  workflow_run_id: "700924",
  workflow_name: "Restaurant Table Reservation - inbound",
  call_time: "2026-09-17T09:31:01.165897Z",
  direction: "inbound",
  caller_number: "+12137771234",
  called_number: "+12137771235",
  call_disposition: "end_call",
  mapped_call_disposition: "end_call",
  duration_seconds: "91",
  recording_url:
    "https://api.dograh.com/api/v1/public/download/workflow/6e7bbd93-363a-4315-8e28-008eebd045e3/recording",
  transcript_url:
    "https://api.dograh.com/api/v1/public/download/workflow/6e7bbd93-363a-4315-8e28-008eebd045e3/transcript",
  customer_name: "",
  calendar_event_id: "",
  initial_context: JSON.stringify(initialContext),
  gathered_context: JSON.stringify(gatheredContext),
};

const deliveryId = `sim-${Date.now()}`;
const res = await fetch(endpoint, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-callflow-secret": secret,
    "x-dograh-delivery-id": deliveryId,
    "x-dograh-workflow-run-id": "700924",
    "x-dograh-delivery-attempt": "1",
  },
  body: JSON.stringify(payload),
});
const text = await res.text();
console.log(`endpoint: ${endpoint}`);
console.log(`deliveryId: ${deliveryId}`);
console.log(`status: ${res.status}`);
console.log(text.slice(0, 2000));

// Second identical POST with the same delivery id -> must be a duplicate (200, duplicate: true).
const res2 = await fetch(endpoint, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-callflow-secret": secret,
    "x-dograh-delivery-id": deliveryId,
    "x-dograh-workflow-run-id": "700924",
    "x-dograh-delivery-attempt": "2",
  },
  body: JSON.stringify(payload),
});
const text2 = await res2.text();
console.log(`\nretry status: ${res2.status}`);
console.log(text2.slice(0, 2000));
