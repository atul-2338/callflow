// Dry-run the wire logic against the saved workflow code (no network calls).
import fs from "node:fs";
import path from "node:path";

const code = fs.readFileSync(path.resolve("f:/callflow/scripts/wf-11661.ts"), "utf8");

const endpointUrl = "https://expanse-grunge-glass.ngrok-free.dev/api/webhooks/dograh";
const secret = "TEST-SECRET";
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

let out = code;
if (!/import\s*\{[^}]*\bwebhook\b/.test(out)) {
  out = out.replace(
    /import\s*\{([^}]*)\}\s*from\s*"@dograh\/sdk\/typed"/,
    (m, names) => `import {${names.trim()}, webhook} from "@dograh/sdk/typed"`
  );
}

const nodeBlock = `const notify_callflow = wf.addTyped(webhook({
    name: "Callflow end-of-call",
    enabled: true,
    http_method: "POST",
    endpoint_url: ${JSON.stringify(endpointUrl)},
    custom_headers: [
        { key: "X-Callflow-Secret", value: ${JSON.stringify(secret)} },
        { key: "Content-Type", value: "application/json" },
    ],
    payload_template: ${JSON.stringify(payloadTemplate, null, 4)},
}));`;

const existing = out.match(/const\s+\w+\s*=\s*wf\.addTyped\(webhook\([\s\S]*?\n\}\)\);/);
if (existing) {
  out = out.replace(existing[0], nodeBlock);
  console.log("replaced existing webhook node");
} else {
  const edgeIdx = out.indexOf("wf.edge(");
  if (edgeIdx === -1) {
    out += "\n\n" + nodeBlock + "\n";
  } else {
    out = out.slice(0, edgeIdx) + nodeBlock + "\n\n" + out.slice(edgeIdx);
  }
  console.log("added webhook node");
}

fs.writeFileSync(path.resolve("f:/callflow/scripts/wf-11661-wired.ts"), out, "utf8");
console.log("wrote f:/callflow/scripts/wf-11661-wired.ts");
console.log("--- first 40 lines of result ---");
console.log(out.split("\n").slice(0, 40).join("\n"));
