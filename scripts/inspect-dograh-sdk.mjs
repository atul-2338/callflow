// Download and extract @dograh/sdk tarball to inspect typed exports.
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = os.tmpdir();
const tgz = path.join(tmp, "dograh-sdk.tgz");
const out = path.join(tmp, "dograh-sdk-pkg");

fs.rmSync(out, { recursive: true, force: true });
const res = await fetch("https://registry.npmjs.org/@dograh/sdk/-/sdk-0.1.7.tgz");
fs.writeFileSync(tgz, Buffer.from(await res.arrayBuffer()));
console.log("downloaded", fs.statSync(tgz).size, "bytes");

fs.mkdirSync(out, { recursive: true });
execSync(`tar -xzf "${tgz}" -C "${out}"`, { stdio: "inherit" });

const typedDts = path.join(out, "package", "dist", "typed", "index.d.ts");
console.log("--- typed/index.d.ts ---");
console.log(fs.readFileSync(typedDts, "utf8"));

const webhookDts = path.join(out, "package", "dist", "typed", "webhook.d.ts");
console.log("--- typed/webhook.d.ts ---");
console.log(fs.readFileSync(webhookDts, "utf8"));

const webhookJs = path.join(out, "package", "dist", "typed", "webhook.js");
console.log("--- typed/webhook.js ---");
console.log(fs.readFileSync(webhookJs, "utf8"));
