/**
 * Phase 2 item 1: wire the Dograh end-of-call webhook node to POST to
 * /api/webhooks/dograh.
 *
 * The Callflow endpoint is already live and verified (see
 * scripts/verify-dograh-tunnel.mjs). This script performs the Dograh-side
 * half of the wiring: it finds the workflow's webhook node and points it at
 * Callflow with the shared secret and the Callflow payload template, then
 * publishes the workflow.
 *
 * Usage:
 *   $env:DOGRAH_API_KEY="dg_..." ; $env:DOGRAH_WORKFLOW_ID="123"
 *   node scripts/wire-dograh-webhook.mjs
 *
 * Or pass them as args:
 *   node scripts/wire-dograh-webhook.mjs dg_... 123
 *
 * The script is idempotent: re-running it just re-applies the same node
 * config. It never touches any other node in the workflow.
 */
import fs from "node:fs";
import path from "node:path";

const API_BASE = process.env.DOGRAH_API_BASE ?? "https://app.dograh.com/api/v1";

const apiKey = process.argv[2] ?? process.env.DOGRAH_API_KEY;
const workflowId = process.argv[3] ?? process.env.DOGRAH_WORKFLOW_ID;
if (!apiKey || !workflowId) {
  console.error(
    "usage: node scripts/wire-dograh-webhook.mjs <DOGRAH_API_KEY> <DOGRAH_WORKFLOW_ID>"
  );
  process.exit(1);
}

// --- Load the real DOGRAH_WEBHOOK_SECRET and tunnel URL from .env.local. ---
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
const returnUrl = envValue("DODO_PAYMENTS_RETURN_URL");
const tunnelHost = returnUrl ? new URL(returnUrl).host : "expanse-grunge-glass.ngrok-free.dev";
const endpointUrl = `https://${tunnelHost}/api/webhooks/dograh`;

// --- The Callflow payload template (README "Dograh workflow configuration"). ---
const payloadTemplate = {
  workflow_run_id: "{{workflow_run_id}}",
  workflow_name: "{{workflow_name}}",
  call_time: "{{call_time}}",
  direction: "{{initial_context.direction}}",
  caller_number: "{{initial_context.caller_number}}",
  called_number: "{{initial_context.called_number}}",
  call_disposition: "{{gathered_context.call_disposition}}",
  mapped_call_disposition: "{{gathered_context.mapped_call_disposition}}",
  duration_seconds: "{{cost_info.call_duration_seconds}}",
  recording_url: "{{recording_url}}",
  transcript_url: "{{transcript_url}}",
  customer_name: "{{gathered_context.customer_name}}",
  calendar_event_id: "{{gathered_context.calendar_event_id}}",
  initial_context: "{{initial_context}}",
  gathered_context: "{{gathered_context}}",
};

const NODE_ID = "webhook-callflow";

async function dograh(method, urlPath, body) {
  const res = await fetch(API_BASE + urlPath, {
    method,
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    throw new Error(
      `Dograh ${method} ${urlPath} -> ${res.status}: ${text.slice(0, 500)}`
    );
  }
  return json;
}

// 1. Fetch the current workflow (read-only).
const workflow = await dograh("GET", `/workflow/fetch/${workflowId}`);
console.log(`workflow: id=${workflow.id} name="${workflow.name}" status=${workflow.status}`);

const definition = workflow.workflow_definition ?? { nodes: [], edges: [] };
const nodes = Array.isArray(definition.nodes) ? definition.nodes : [];
const existing = nodes.find((n) => n.id === NODE_ID);
console.log(
  existing
    ? `found existing webhook node "${NODE_ID}" -> ${existing.data?.endpoint_url ?? "(no url)"}`
    : `no webhook node "${NODE_ID}" yet — will add one`
);

// 2. Build the webhook node.
const webhookNode = {
  id: NODE_ID,
  type: "webhook",
  position: existing?.position ?? { x: 600, y: 0 },
  data: {
    name: "Callflow end-of-call",
    enabled: true,
    http_method: "POST",
    endpoint_url: endpointUrl,
    credential_uuid: null,
    custom_headers: [
      { key: "X-Callflow-Secret", value: secret },
      { key: "Content-Type", value: "application/json" },
    ],
    payload_template: payloadTemplate,
  },
};

const nextNodes = existing
  ? nodes.map((n) => (n.id === NODE_ID ? webhookNode : n))
  : [...nodes, webhookNode];

// 3. Update the workflow.
const updated = await dograh("PUT", `/workflow/${workflowId}`, {
  workflow_definition: { ...definition, nodes: nextNodes },
});
console.log(`updated workflow: version_status=${updated.version_status}`);

// 4. Publish so the change goes live.
const published = await dograh("POST", `/workflow/${workflowId}/publish`);
console.log(`published: ${JSON.stringify(published).slice(0, 300)}`);

console.log("\nDONE — Dograh webhook node now POSTs to:");
console.log(`  ${endpointUrl}`);
console.log("with header X-Callflow-Secret and the Callflow payload template.");
