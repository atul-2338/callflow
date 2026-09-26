// List all runs for workflow 11661.
import fs from "node:fs";

const env = fs.readFileSync("f:/callflow/.env.local", "utf8");
const key = (env.match(/^DOGRAH_API_KEY=(.*)$/m) || [])[1]?.trim();
const base = "https://app.dograh.com/api/v1";

const r = await fetch(`${base}/workflow/11661/runs`, {
  headers: { "x-api-key": key },
});
const j = await r.json();
console.log(`status: ${r.status}`);
console.log(JSON.stringify(j, null, 2).slice(0, 4000));
