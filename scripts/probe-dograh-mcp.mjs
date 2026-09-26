// Full MCP handshake against the Dograh MCP server, then list tools.
const url = "https://api.dograh.com/api/v1/mcp/";

async function post(body) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, ctype: res.headers.get("content-type"), text };
}

// Parse SSE frames into JSON-RPC messages.
function parseSse(text) {
  const out = [];
  for (const block of text.split("\n\n")) {
    const dataLine = block.split("\n").find((l) => l.startsWith("data: "));
    if (dataLine) out.push(JSON.parse(dataLine.slice(6)));
  }
  return out;
}

// 1. initialize
let r = await post({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "callflow-probe", version: "1.0.0" },
  },
});
console.log(`initialize -> ${r.status} ${r.ctype}`);
const init = parseSse(r.text)[0];
console.log("serverInfo:", JSON.stringify(init?.result?.serverInfo));
console.log("protocolVersion:", init?.result?.protocolVersion);

// 2. initialized notification
await post({
  jsonrpc: "2.0",
  method: "notifications/initialized",
  params: {},
});

// 3. tools/list
r = await post({
  jsonrpc: "2.0",
  id: 2,
  method: "tools/list",
  params: {},
});
console.log(`tools/list -> ${r.status}`);
const tools = parseSse(r.text)[0]?.result?.tools ?? [];
console.log(`\n${tools.length} tools:`);
for (const t of tools) {
  console.log(`- ${t.name}: ${(t.description ?? "").split("\n")[0]}`);
  if (t.inputSchema?.properties) {
    console.log(`    params: ${Object.keys(t.inputSchema.properties).join(", ")}`);
  }
}

// 4. list_workflows — does it need auth? what's in the org?
r = await post({
  jsonrpc: "2.0",
  id: 3,
  method: "tools/call",
  params: { name: "list_workflows", arguments: {} },
});
console.log(`\nlist_workflows -> ${r.status}`);
const lw = parseSse(r.text)[0];
console.log(JSON.stringify(lw, null, 2).slice(0, 3000));


