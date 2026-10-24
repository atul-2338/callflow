#!/usr/bin/env node
/**
 * Wrapper around `cloudflared tunnel --url http://localhost:3000` that solves
 * quick-tunnel URL churn: every `cloudflared tunnel --url` run publishes a NEW
 * random *.trycloudflare.com hostname, so the URL pasted into the Dograh
 * dashboard dies the moment the tunnel restarts and end-of-call webhook
 * deliveries vanish at Cloudflare instead of reaching this server.
 *
 * On startup this script waits for cloudflared to announce the hostname, then:
 *   1. prints the exact webhook URL to paste into the Dograh workflow editor,
 *   2. writes it to <project>/data/tunnel-url.txt,
 *   3. rewrites the "Webhook URL" line in DOGRAH_SETUP.txt.
 * It then keeps streaming cloudflared output until stopped (Ctrl+C), exactly
 * like running cloudflared by hand.
 *
 * Env overrides:
 *   TUNNEL_TARGET   local origin to expose (default http://localhost:3000)
 *   CLOUDFLARED_BIN cloudflared binary (default: cloudflared on PATH)
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const TARGET = process.env.TUNNEL_TARGET || "http://localhost:3000";
const WEBHOOK_PATH = "/api/webhooks/dograh";
const URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

const projectDir = process.cwd();
const urlFile = path.join(projectDir, "data", "tunnel-url.txt");
const setupFile = path.join(projectDir, "DOGRAH_SETUP.txt");

const bin = process.env.CLOUDFLARED_BIN || "cloudflared";
const child = spawn(bin, ["tunnel", "--url", TARGET], {
  stdio: ["inherit", "pipe", "pipe"],
});

let announced = false;

function announce(url) {
  if (announced) return;
  announced = true;
  const webhookUrl = `${url}${WEBHOOK_PATH}`;

  try {
    fs.mkdirSync(path.dirname(urlFile), { recursive: true });
    fs.writeFileSync(urlFile, `${webhookUrl}\n`, "utf8");
  } catch (err) {
    console.warn(`[tunnel] could not write ${urlFile}: ${err?.message ?? err}`);
  }

  try {
    if (fs.existsSync(setupFile)) {
      const lines = fs.readFileSync(setupFile, "utf8").split(/\r?\n/);
      const idx = lines.findIndex((l) => l.toLowerCase().startsWith("webhook url"));
      if (idx !== -1) {
        lines[idx] = `Webhook URL to paste in Dograh: ${webhookUrl}`;
        fs.writeFileSync(setupFile, lines.join("\n"), "utf8");
      }
    }
  } catch (err) {
    console.warn(`[tunnel] could not update DOGRAH_SETUP.txt: ${err?.message ?? err}`);
  }

  console.log("");
  console.log("────────────────────────────────────────────────────────────");
  console.log("Tunnel is up. Paste this URL into the Dograh workflow editor");
  console.log("(End Call → send webhook node), method POST:");
  console.log("");
  console.log(`  ${webhookUrl}`);
  console.log("");
  console.log("Header: x-webhook-secret = the WEBHOOK_SECRET value from");
  console.log(".env.local (never commit or share it). Also saved to:");
  console.log(`  ${urlFile}`);
  console.log("and the URL line in DOGRAH_SETUP.txt was updated. This URL");
  console.log("changes on every restart — re-check it after each run.");
  console.log("────────────────────────────────────────────────────────────");
}

for (const stream of [child.stdout, child.stderr]) {
  if (!stream) continue;
  readline.createInterface({ input: stream }).on("line", (line) => {
    process.stdout.write(`${line}\n`);
    const match = URL_PATTERN.exec(line);
    if (match) announce(match[0]);
  });
}

child.on("error", (err) => {
  console.error(`[tunnel] failed to start cloudflared: ${err.message}`);
  console.error(
    "[tunnel] install it from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/ or set CLOUDFLARED_BIN."
  );
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (!announced) {
    console.error(
      `[tunnel] cloudflared exited before announcing a URL (code=${code}, signal=${signal}).`
    );
  }
  process.exitCode = code ?? 1;
});

// Make Ctrl+C tear the tunnel down with the wrapper instead of orphaning it.
process.on("SIGINT", () => {
  if (!child.killed) child.kill("SIGINT");
  process.exit(0);
});