// Poll a Dograh run until it reaches a terminal state, then print the record.
import fs from "node:fs";

const env = fs.readFileSync("f:/callflow/.env.local", "utf8");
const key = (env.match(/^DOGRAH_API_KEY=(.*)$/m) || [])[1]?.trim();
const base = "https://app.dograh.com/api/v1";
const runId = process.argv[2] ?? "712741";

for (let i = 0; i < 30; i++) {
  const r = await fetch(`${base}/workflow/11661/runs/${runId}`, {
    headers: { "x-api-key": key },
  });
  const j = await r.json();
  const status = j.status ?? j.run_status ?? "?";
  console.log(`[${i}] status=${status}`);
  if (["completed", "failed", "cancelled", "canceled"].includes(status)) {
    fs.writeFileSync("f:/callflow/scripts/run-712741.json", JSON.stringify(j, null, 2), "utf8");
    console.log(JSON.stringify(j, null, 2).slice(0, 4000));
    process.exit(0);
  }
  await new Promise((res) => setTimeout(res, 5000));
}
console.log("timed out waiting for terminal state");
