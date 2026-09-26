// Probe candidate publish endpoints for workflow 11661 (dry-run: report status/body only).
import fs from "node:fs";

const env = fs.readFileSync("f:/callflow/.env.local", "utf8");
const key = (env.match(/^DOGRAH_API_KEY=(.*)$/m) || [])[1]?.trim();
const base = "https://app.dograh.com/api/v1";

async function tryReq(label, method, path, body) {
  try {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { "x-api-key": key, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    console.log(`\n### ${label}: ${method} ${path}`);
    console.log(`status: ${r.status}`);
    console.log(text.slice(0, 800));
  } catch (err) {
    console.log(`\n### ${label}: ${method} ${path}`);
    console.log(`ERROR: ${err.message}`);
  }
}

// 1. Dedicated publish endpoint (POST)
await tryReq("publish POST", "POST", "/workflow/11661/publish", {});

