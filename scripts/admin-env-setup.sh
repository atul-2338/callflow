#!/usr/bin/env bash
# admin-env-setup.sh — one-time setup of the CallFlow admin credentials on the
# VPS (root@45.76.252.174, /srv/callflow/.env). Run from the repo root in Git
# Bash:
#
#   bash scripts/admin-env-setup.sh
#
# What it does:
#   1. Mints ADMIN_PASSWORD_HASH locally (scripts/admin-hash.mjs prompts twice,
#      input hidden — asterisks only; never echoed, never stored anywhere).
#   2. Backs up /srv/callflow/.env and aborts if ADMIN_ lines already exist.
#   3. Appends ADMIN_PASSWORD_HASH=<value> with every '$' backslash-escaped
#      as '\$'. Verified against the real loader this repo ships (@next/env
#      16.3.2, the exact call Next's boot makes, production file set): it
#      strips quotes BEFORE dotenv-expand, so single quotes do NOT protect
#      '$' — a live test mangled 'scrypt$16384$8$1$...' into "scrypt6384" —
#      while 'scrypt\$16384\$8\$1\$...' loads intact, byte for byte.
#   4. Generates ADMIN_SESSION_SECRET=<openssl base64> ON the VPS — the value
#      is never displayed anywhere, on any screen.
#   5. Prints only names, line lengths and counts of the two ADMIN_ lines —
#      never their values — and confirms owner/permissions callflow:callflow,
#      600.
#
# Secrets never transit this script or the chat: the password is typed
# interactively into the minting tool, the hash travels to the VPS via ssh
# STDIN (not argv), and the session secret is minted server-side.

set -euo pipefail

# --- 0. Preflight -----------------------------------------------------------
[ -f scripts/admin-hash.mjs ] || {
  echo "ABORT: scripts/admin-hash.mjs not found — run this from the repo root (F:\callflow)" >&2
  exit 1
}

# --- 1. Mint the hash (two hidden prompts; stdout = the hash line only) -----
ADMIN_HASH="$(node scripts/admin-hash.mjs)"

# The minted format is scrypt$16384$8$1$<32 hex>$<128 hex> = exactly 178 chars.
[ "${#ADMIN_HASH}" -eq 178 ] || {
  echo "ABORT: minted hash has length ${#ADMIN_HASH}, expected 178 — nothing was appended." >&2
  exit 1
}
echo "hash-minted (178 chars)"

# --- 2. Dollar/apostrophe safety checks -------------------------------------
# '$' in an unquoted .env value is expanded by dotenv-expand (quotes do NOT
# disable that — verified against the real loader), so every '$' is
# backslash-escaped below; this check just reports which case applies.
case "$ADMIN_HASH" in
  *'$'*) echo "dollar-check: hash contains \$ — backslash-escaping applied (required)" ;;
  *)     echo "dollar-check: hash contains no \$ — appended as-is" ;;
esac
case "$ADMIN_HASH" in
  *"'"*)
    echo "ABORT: hash contains an apostrophe — unexpected for the scrypt hex format; refusing to append." >&2
    exit 1
    ;;
esac

# Escape every $ as \$ so @next/env's dotenv-expand leaves the value intact.
ADMIN_ESCAPED="${ADMIN_HASH//\$/\\$}"

# --- 3. Backup + ALREADY-PRESENT abort (ssh -n: this call reads no stdin) ---
ssh -n root@45.76.252.174 'cp /srv/callflow/.env "/srv/callflow/.env.bak-admin-$(date +%Y%m%d-%H%M%S)"; if grep -q "^ADMIN_" /srv/callflow/.env; then echo "ALREADY-PRESENT-ABORT: /srv/callflow/.env already has ADMIN_ lines — ask the agent to clear them first; nothing was appended"; exit 1; fi; echo backup-ok'

# --- 4. Append ADMIN_PASSWORD_HASH=<\$-escaped value> ------------------------
# The hash value travels via ssh STDIN (never argv, never printed), so this
# ssh call deliberately has NO -n — it must read the piped value.
printf "\nADMIN_PASSWORD_HASH=%s\n" "$ADMIN_ESCAPED" | ssh root@45.76.252.174 'cat >> /srv/callflow/.env'
echo "hash-line-appended"
unset ADMIN_HASH ADMIN_ESCAPED

# --- 5. Session secret: minted ON the VPS, never displayed -------------------
# Written unquoted: openssl base64 can only contain [A-Za-z0-9+/=], never '$',
# and the loader test confirmed such values load intact unquoted. Then restore
# owner/permissions: callflow:callflow, 600.
ssh -n root@45.76.252.174 'printf "\nADMIN_SESSION_SECRET=%s\n" "$(openssl rand -base64 32)" >> /srv/callflow/.env && chown callflow:callflow /srv/callflow/.env && chmod 600 /srv/callflow/.env && echo append-ok'

# --- 6. Final check: NAMES + LINE LENGTHS + COUNTS only — never values ------
ssh -n root@45.76.252.174 'awk -F= "/^ADMIN_PASSWORD_HASH=|^ADMIN_SESSION_SECRET=/ {print \$1 \" line_len=\" length(\$0)}" /srv/callflow/.env; printf "count_ADMIN_PASSWORD_HASH="; grep -c "^ADMIN_PASSWORD_HASH=" /srv/callflow/.env; printf "count_ADMIN_SESSION_SECRET="; grep -c "^ADMIN_SESSION_SECRET=" /srv/callflow/.env; stat -c "perms=%a owner=%U:%G" /srv/callflow/.env'

echo "DONE: admin env vars are set on the VPS. Tell the agent 'deploy' to ship the admin panel."