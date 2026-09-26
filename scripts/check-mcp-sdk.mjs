import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const p = require("@modelcontextprotocol/sdk/package.json");
console.log("version:", p.version);
console.log("exports:", Object.keys(p.exports ?? {}).join(", "));
