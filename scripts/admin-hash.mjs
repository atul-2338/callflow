#!/usr/bin/env node
/**
 * Generates the ADMIN_PASSWORD_HASH value for the CallFlow admin panel.
 *
 *   npm run admin:hash
 *
 * Asks for a password twice with hidden input (no echo; never logged or
 * written anywhere), then prints ONLY the scrypt hash line to stdout:
 *
 *   scrypt$N$r$p$<salt-hex>$<hash-hex>
 *
 * Paste that line into ADMIN_PASSWORD_HASH in /srv/callflow/.env.
 *
 * Prompts go to stderr so `npm run admin:hash > hash.txt` keeps stdout clean.
 * Piping stdin (tests/automation) falls back to plain line reading.
 *
 * The format is verified against src/lib/admin-password.ts (the verify side);
 * do not change one without the other.
 */

import { randomBytes, scryptSync } from "node:crypto";
import readline from "node:readline";

// Node's scrypt defaults, stored inside the hash string so verification stays
// correct even if these are raised later.
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;
const MIN_PASSWORD_LENGTH = 12;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/**
 * Reads one line without echoing it.
 * - TTY: raw-mode keypress capture, asterisks in place of characters.
 * - Piped stdin: pre-collected lines (used by tests and CI).
 */
let pipedLines = null;
let pipedIndex = 0;

if (!process.stdin.isTTY) {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  const lines = [];
  for await (const line of rl) lines.push(line);
  pipedLines = lines;
}

function readHidden(prompt) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    if (pipedLines) {
      process.stderr.write(prompt);
      resolve(pipedLines[pipedIndex] ?? "");
      pipedIndex += 1;
      return;
    }

    process.stderr.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";

    const onData = (chunk) => {
      for (const ch of String(chunk)) {
        if (ch === "\r" || ch === "\n") {
          cleanup();
          process.stderr.write("\n");
          resolve(value);
          return;
        }
        if (ch === "\u0003") {
          // Ctrl+C — abort without printing anything.
          cleanup();
          process.stderr.write("\n");
          process.exit(130);
        }
        if (ch === "\u007f" || ch === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        if (ch >= " " && ch <= "~") {
          value += ch;
          process.stderr.write("*");
        }
        // Non-printable / control bytes are ignored.
      }
    };

    function cleanup() {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
    }

    stdin.on("data", onData);
  });
}

const password = await readHidden("Admin password (min 12 chars): ");
if (!password) fail("No password entered. Nothing was hashed or written.");

const confirmed = await readHidden("Confirm admin password: ");
if (password !== confirmed) {
  fail("Passwords do not match. Nothing was hashed or written.");
}
if (password.length < MIN_PASSWORD_LENGTH) {
  fail(
    `Password must be at least ${MIN_PASSWORD_LENGTH} characters. Nothing was hashed or written.`
  );
}

const salt = randomBytes(SALT_BYTES);
const hash = scryptSync(password, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
process.stdout.write(
  `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${hash.toString("hex")}\n`
);