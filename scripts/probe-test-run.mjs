// Create a test run with simulated telephony context for workflow 11661.
import fs from "node:fs";

const env = fs.readFileSync("f:/callflow/.env.local", "utf8");
const key = (env.match(/^DOGRAH_API_KEY=(.*)$/m) || [])[1]?.trim();
const base = "https://app.dograh.com/api/v1";

const r = await fetch(`${base}/workflow/11661/runs`, {
  method: "POST",
  headers: { "x-api-key": key, "content-type": "application/json" },
  body: JSON.stringify({
    mode: "test",
    name: "callflow e2e v2",
    initial_context: {
      direction: "inbound",
      caller_number: "+12137771234",
      called_number: "+12137771235",
    },
  }),
});
const text = await r.text();
console.log(`status: ${r.status}`);
console.log(text.slice(0, 2000));


