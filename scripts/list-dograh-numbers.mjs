// List Dograh telephony configurations and their phone numbers, including the
// inbound workflow bound to each number — that binding is what makes a number
// "the agent's number" (the value for the carrier forward-to setting).
//
// Usage: node scripts/list-dograh-numbers.mjs
import fs from "node:fs";

const env = fs.readFileSync("f:/callflow/.env.local", "utf8");
const key = (env.match(/^DOGRAH_API_KEY=(.*)$/m) || [])[1]?.trim();
if (!key) {
  console.error("DOGRAH_API_KEY must be set in .env.local");
  process.exit(1);
}
const base = "https://app.dograh.com/api/v1";

async function get(path) {
  const r = await fetch(`${base}${path}`, { headers: { "x-api-key": key } });
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status}: ${await r.text()}`);
  return r.json();
}

const { configurations } = await get("/organizations/telephony-configs");
for (const cfg of configurations) {
  console.log(`\n${cfg.name} (id ${cfg.id}, provider ${cfg.provider}, default_outbound=${cfg.is_default_outbound})`);
  const { phone_numbers } = await get(
    `/organizations/telephony-configs/${cfg.id}/phone-numbers`
  );
  for (const pn of phone_numbers) {
    console.log(
      `  ${pn.address}  [${pn.label}]  -> inbound workflow ${pn.inbound_workflow_id} "${pn.inbound_workflow_name}"`
    );
  }
}


