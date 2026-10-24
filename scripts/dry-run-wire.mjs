// Dry-run the wire logic against the saved workflow code (no network calls).
import fs from "node:fs";
import path from "node:path";

const code = fs.readFileSync(path.resolve("f:/callflow/scripts/wf-11661.ts"), "utf8");

const endpointUrl = "https://expanse-grunge-glass.ngrok-free.dev/api/webhooks/dograh";
const secret = "TEST-SECRET";
const payloadTemplate = {
  callId: "{{workflow_run_id}}",
  status: "{{gathered_context.call_status}}",
  duration: "{{cost_info.call_duration_seconds}}",
  caller_number: "{{initial_context.caller_number}}",
  called_number: "{{initial_context.called_number}}",
  gathered: "{{gathered_context}}",
  initial_context: "{{initial_context}}",
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
        { key: "x-webhook-secret", value: ${JSON.stringify(secret)} },
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
