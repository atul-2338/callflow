// List all MCP tools with full input schemas (uses DOGRAH_API_KEY from .env.local).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import fs from "node:fs";
import path from "node:path";

const MCP_URL = process.env.DOGRAH_MCP_URL ?? "https://api.dograh.com/api/v1/mcp/";
const env = fs.readFileSync(path.resolve("f:/callflow/.env.local"), "utf8");
const envValue = (name) =>
  env.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1]?.trim()?.replace(/^"(.*)"$/, "$1") ?? "";
const apiKey = process.env.DOGRAH_API_KEY ?? envValue("DOGRAH_API_KEY");
if (!apiKey) {
  console.error("DOGRAH_API_KEY must be set");
  process.exit(1);
}

const client = new Client({ name: "callflow", version: "1.0.0" }, { capabilities: {} });
const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
  requestInit: { headers: { "x-api-key": apiKey } },
});
await client.connect(transport);

const { tools } = await client.listTools();
for (const t of tools) {
  console.log(`\n### ${t.name}`);
  console.log((t.description ?? "").split("\n")[0]);
  if (t.inputSchema?.properties) {
    for (const [k, v] of Object.entries(t.inputSchema.properties)) {
      console.log(`  - ${k} (${v.type ?? "?"})${v.description ? `: ${v.description}` : ""}`);
    }
  }
}
await client.close();
