// Check whether the Dograh REST API (app.dograh.com) accepts the same API key,
// and whether a publish endpoint exists for workflow 11661.
import fs from "node:fs";

const env = fs.readFileSync("f:/callflow/.env.local", "utf8");
const key = (env.match(/^DOGRAH_API_KEY=(.*)$/m) || [])[1]?.trim();

// Tunnel liveness.
try {
  const lr = await fetch("https://expanse-grunge-glass.ngrok-free.dev/api/webhooks/dograh");
  console.log(`tunnel liveness: ${lr.status} ${await lr.text()}`);
} catch (err) {
  console.log(`tunnel liveness: ERROR ${err.message}`);
}

const base = "https://app.dograh.com/api/v1";
const r = await fetch(`${base}/workflow/fetch/11661`, {
  headers: { "x-api-key": key },
});
const wf = await r.json();
console.log(`status: ${r.status}, workflow status: ${wf.status}`);
const nodes = wf.workflow_definition?.nodes ?? [];
console.log(`nodes: ${nodes.length}`);
for (const n of nodes) {
  console.log(`  - ${n.type} "${n.data?.name ?? n.id}"`);
}
const webhookNode = nodes.find((n) => n.type === "webhook");
if (webhookNode) {
  console.log("webhook node present:");
  console.log(JSON.stringify(webhookNode.data, null, 2).slice(0, 1200));
} else {
  console.log("NO webhook node in REST workflow_definition");
}
