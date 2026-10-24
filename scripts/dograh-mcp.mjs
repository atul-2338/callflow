/**
 * Drive the Dograh MCP server (https://api.dograh.com/api/v1/mcp/) to inspect
 * and edit workflows programmatically.
 *
 * Requires a Dograh API key (create one at https://app.dograh.com/api-keys).
 *
 * Usage:
 *   $env:DOGRAH_API_KEY="dg_..."
 *   node scripts/dograh-mcp.mjs list
 *   node scripts/dograh-mcp.mjs get <workflow_id>
 *   node scripts/dograh-mcp.mjs wire <workflow_id>   # point webhook node at Callflow
*   node scripts/dograh-mcp.mjs publish <workflow_id> # publish the draftt (REST)

 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import fs from "node:fs";
import path from "node:path";

const MCP_URL = process.env.DOGRAH_MCP_URL ?? "https://api.dograh.com/api/v1/mcp/";

// --- Load secrets from .env.local (project convention). ---
const env = fs.readFileSync(path.resolve("f:/callflow/.env.local"), "utf8");
function envValue(name) {
  const value = env.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1]?.trim();
  return value ? value.replace(/^"(.*)"$/, "$1") : "";
}

const apiKey = process.env.DOGRAH_API_KEY ?? envValue("DOGRAH_API_KEY");
if (!apiKey) {
  console.error("DOGRAH_API_KEY must be set (create one at https://app.dograh.com/api-keys)");
  process.exit(1);
}

const [cmd, arg, ...rest] = process.argv.slice(2);

const secret = envValue("WEBHOOK_SECRET");
const returnUrl = envValue("DODO_PAYMENTS_RETURN_URL");
const tunnelHost = returnUrl ? new URL(returnUrl).host : "expanse-grunge-glass.ngrok-free.dev";
const endpointUrl = `https://${tunnelHost}/api/webhooks/dograh`;

const payloadTemplate = {
  callId: "{{workflow_run_id}}",
  status: "{{gathered_context.call_status}}",
  duration: "{{cost_info.call_duration_seconds}}",
  caller_number: "{{initial_context.caller_number}}",
  called_number: "{{initial_context.called_number}}",
  gathered: "{{gathered_context}}",
  initial_context: "{{initial_context}}",
};

const client = new Client(
  { name: "callflow", version: "1.0.0" },
  { capabilities: {} }
);
const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
  requestInit: { headers: { "x-api-key": apiKey } },
});
await client.connect(transport);

async function callTool(name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content?.find((c) => c.type === "text")?.text ?? JSON.stringify(res);
  if (res.isError) throw new Error(text);
  return text;
}

switch (cmd) {
  case "list": {
    const text = await callTool("list_workflows", {});
    console.log(text);
    break;
  }
  case "get": {
    if (!arg) throw new Error("usage: dograh-mcp.mjs get <workflow_id>");
    const text = await callTool("get_workflow_code", { workflow_id: arg });
    try {
      const parsed = JSON.parse(text);
      console.log(`workflow_id: ${parsed.workflow_id}`);
      console.log(`name: ${parsed.name}`);
      console.log(`version: ${parsed.version}`);
      console.log("--- code ---");
      console.log(parsed.code);
    } catch {
      console.log(text);
    }
    break;
  }
case "tools": {
    const res = await client.listTools();
    for (const t of res.tools) {
      console.log(`- ${t.name}: ${(t.description ?? "").split("\n")[0]}`);
      if (t.inputSchema?.properties) {
        console.log(`    params: ${Object.keys(t.inputSchema.properties).join(", ")}`);
      }
    }
    break;
  }
case "docs": {
    if (!arg) throw new Error("usage: dograh-mcp.mjs docs <query>");
    const text = await callTool("search_docs", { query: arg, limit: 8 });
    console.log(text);
    break;
  }
  case "node-types": {
    const text = await callTool("list_node_types", {});
    console.log(text);
    break;
  }
case "save-code": {
    if (!arg) throw new Error("usage: dograh-mcp.mjs save-code <workflow_id>");
    const text = await callTool("get_workflow_code", { workflow_id: arg });
    let code;
    try {
      const parsed = JSON.parse(text);
      code = parsed.code;
    } catch {
      code = text;
    }
    const outFile = path.resolve(`f:/callflow/scripts/wf-${arg}.ts`);
    fs.writeFileSync(outFile, code, "utf8");
    console.log(`wrote ${outFile} (${code.length} chars)`);
    break;
  }
case "node-type": {
    if (!arg) throw new Error("usage: dograh-mcp.mjs node-type <name>");
    const text = await callTool("get_node_type", { name: arg });
    console.log(text);
    break;
  }
  case "wire": {
    if (!arg) throw new Error("usage: dograh-mcp.mjs wire <workflow_id>");
    const text = await callTool("get_workflow_code", { workflow_id: arg });
    let code;
    try {
      const parsed = JSON.parse(text);
      code = parsed.code;
    } catch {
      code = text;
    }
    if (!code) throw new Error(`no code returned for workflow ${arg}`);

    // 1. Ensure `webhook` is imported from @dograh/sdk/typed.
    if (!/import\s*\{[^}]*\bwebhook\b/.test(code)) {
      code = code.replace(
        /import\s*\{([^}]*)\}\s*from\s*"@dograh\/sdk\/typed"/,
        (m, names) => `import {${names.trim()}, webhook} from "@dograh/sdk/typed"`
      );
    }

    // 2. Build the webhook node block (idempotent: same node every run).
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

    // 3. Replace an existing webhook node, else insert before the first edge.
    const existing = code.match(/const\s+\w+\s*=\s*wf\.addTyped\(webhook\([\s\S]*?\n\}\)\);/);
    if (existing) {
      code = code.replace(existing[0], nodeBlock);
      console.log("replaced existing webhook node");
    } else {
      const edgeIdx = code.indexOf("wf.edge(");
      if (edgeIdx === -1) {
        code += "\n\n" + nodeBlock + "\n";
      } else {
        code = code.slice(0, edgeIdx) + nodeBlock + "\n\n" + code.slice(edgeIdx);
      }
      console.log("added webhook node");
    }

    // 4. Save as a draft (published version keeps serving until you publish).
    const saveText = await callTool("save_workflow", { workflow_id: arg, code });
    console.log("save_workflow ->", saveText);
    break;
  }
  case "search-docs": {
    if (!arg) throw new Error("usage: dograh-mcp.mjs search-docs <query> [limit]");
    const text = await callTool(
      "search_docs",
      { query: arg, limit: rest[0] ? Number(rest[0]) : 6 }
    );
    console.log(text);
    break;
  }
  case "read-doc": {
    if (!arg) throw new Error("usage: dograh-mcp.mjs read-doc <path> [section]");
    const text = await callTool(
      "read_doc",
      rest[0] ? { path: arg, section: rest[0] } : { path: arg }
    );
    console.log(text);
    break;
  }
  case "list-docs": {
    const text = await callTool(
      "list_docs",
      arg ? { path: arg, depth: rest[0] ? Number(rest[0]) : 2 } : { depth: 2 }
    );
    console.log(text);
    break;
  }
  case "publish": {
    if (!arg) throw new Error("usage: dograh-mcp.mjs publish <workflow_id>");
    // Publishing is a REST endpoint (the MCP server has no publish tool).
    const r = await fetch(`https://app.dograh.com/api/v1/workflow/${arg}/publish`, {
      method: "POST",
      headers: { "x-api-key": apiKey, "content-type": "application/json" },
      body: "{}",
    });
    const text = await r.text();
    console.log(`publish -> ${r.status}`);
    console.log(text.slice(0, 1000));
    break;
  }
  default:
    console.error("usage: dograh-mcp.mjs <list|get|wire|publish> [workflow_id]");
    process.exit(1);
}

await client.close();

