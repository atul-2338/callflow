// Fetch a run record and dump the raw JSON.
import fs from "node:fs";

const env = fs.readFileSync("f:/callflow/.env.local", "utf8");
const key = (env.match(/^DOGRAH_API_KEY=(.*)$/m) || [])[1]?.trim();
const base = "https://app.dograh.com/api/v1";
const runId = process.argv[2] ?? "700924";

const r = await fetch(`${base}/workflow/11661/runs/${runId}`, {
  headers: { "x-api-key": key },
});
const j = await r.json();
fs.writeFileSync(`f:/callflow/scripts/run-${runId}.json`, JSON.stringify(j, null, 2), "utf8");
console.log(`status: ${r.status}`);
console.log(JSON.stringify(j, null, 2).slice(0, 6000));

