// Dump the full REST workflow object for 11661 to inspect version/status fields.
import fs from "node:fs";

const env = fs.readFileSync("f:/callflow/.env.local", "utf8");
const key = (env.match(/^DOGRAH_API_KEY=(.*)$/m) || [])[1]?.trim();

const r = await fetch("https://app.dograh.com/api/v1/workflow/fetch/11661", {
  headers: { "x-api-key": key },
});
const j = await r.json();
fs.writeFileSync("f:/callflow/scripts/wf-11661-rest.json", JSON.stringify(j, null, 2), "utf8");
console.log(`status: ${r.status}`);
console.log("top-level keys:", Object.keys(j).join(", "));
for (const k of Object.keys(j)) {
  const v = j[k];
  if (typeof v === "object" && v !== null && !Array.isArray(v)) {
    console.log(`  ${k}: {${Object.keys(v).join(", ")}}`);
  } else if (Array.isArray(v)) {
    console.log(`  ${k}: array[${v.length}]`);
  } else {
    console.log(`  ${k}: ${JSON.stringify(v)}`);
  }
}
