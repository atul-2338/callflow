#!/usr/bin/env bash
# dodo-env-setup.sh — one-time setup of the Dodo Payments env vars on the VPS
# (root@45.76.252.174, /srv/callflow/.env). Run from the repo root in Git Bash:
#
#   bash scripts/dodo-env-setup.sh
#
# Git Bash ONLY. In PowerShell/CMD a bare `bash` resolves to WSL's shim
# (C:\Windows\System32\bash.exe) and fails with "execvpe(/bin/bash) failed"
# when no WSL distro is installed. From PowerShell instead use:
#   & "C:\Program Files\Git\bin\bash.exe" scripts/dodo-env-setup.sh
#
# You type the values yourself; they never pass through chat, the VPS command
# line (argv), or the screen:
#   1. DODO test-mode API key        -> hidden prompt (read -s)
#   2. DODO webhook signing secret   -> hidden prompt (read -s)
#   3. Dodo Solo product ID          -> normal visible prompt (not a secret)
#
# Steps (BACKLOG "Step 3 — Dodo keys on the VPS"):
#   1. Backs up /srv/callflow/.env with a timestamp (cp -p keeps owner/mode).
#   2. Deletes every existing ^DODO_ line and appends exactly five lines, in
#      one ssh stdin transaction:
#        DODO_PAYMENTS_API_KEY=<key>
#        DODO_PAYMENTS_ENVIRONMENT=test_mode
#        DODO_SOLO_PRODUCT_ID=<pdt_...>
#        DODO_PAYMENTS_WEBHOOK_SECRET=<whsec_...>
#        DODO_PAYMENTS_RETURN_URL=https://callflow.biz/checkout/return
#   3. Every '$' in a typed value is backslash-escaped to '\$' BEFORE it is
#      written. Verified against the real loader this repo ships (@next/env
#      16.3.2, the exact call Next's boot makes, production file set): it
#      strips quotes BEFORE dotenv-expand, so single quotes do NOT protect
#      '$' — a live test mangled 'scrypt$16384$8$1$...' into "scrypt6384" —
#      while 'scrypt\$16384\$8\$1\$...' loads intact, byte for byte. Values
#      are therefore written UNQUOTED with '\$' escapes. The loader unescapes
#      '\$' back to '$', so the stored value equals what you typed.
#   4. Restores owner/permissions (callflow:callflow, 600), restarts the
#      systemd service, smoke-checks /pricing + the Dograh health endpoint.
#   5. Prints ONLY names, counts and lengths of the DODO_ lines — never values.
#
# Transport: read -s -> local shell variable -> heredoc piped over ssh STDIN.
# Bash does NOT re-expand substituted heredoc content, so an escaped '\$'
# survives the trip byte-for-byte, and no value ever appears in argv.

set -euo pipefail

VPS=root@45.76.252.174
RETURN_URL="https://callflow.biz/checkout/return"

echo "== Dodo Payments env setup -> /srv/callflow/.env on $VPS =="
echo "Two hidden prompts (API key, webhook secret) + one visible (product ID)."
echo

# --- 1. Timestamped backup + preflight (ssh -n: this call reads no stdin) ---
ssh -n "$VPS" 'set -e; F=/srv/callflow/.env; B="/srv/callflow/.env.bak-dodo-$(date +%Y%m%d-%H%M%S)"; cp -p "$F" "$B"; echo "backup: $B"; printf "old_DODO_line_count: "; grep -c "^DODO_" "$F" || true; if grep -q "^DODO_" "$F"; then echo "old_DODO_names:"; grep -o "^DODO_[A-Z_]*" "$F" | sed "s/^/  /"; else echo "old_DODO_names: (none)"; fi; stat -c "perms_before=%a owner=%U:%G" "$F"'

# --- 2. Prompts (2 hidden, 1 visible) ----------------------------------------
read -rs -p "DODO test-mode API key   (input hidden): " API_KEY; echo
read -rs -p "DODO webhook secret      (input hidden): " WEBHOOK_SECRET; echo
read -r  -p "Dodo Solo product ID     (visible): " PRODUCT_ID; echo

# --- 3. Value hygiene (messages carry names only, never values) --------------
abort() { echo "ABORT: $1 — nothing was changed on the VPS; the backup above is harmless." >&2; exit 1; }

check_value() { # $1 = display name, $2 = value
  local n="$1" v="$2" c1 c2
  [ -n "$v" ] || abort "$n is empty"
  case "$v" in *[$' \t\r']*) abort "$n contains a space/tab/CR — paste the raw value again" ;; esac
  c1="${v:0:1}"; c2="${v: -1}"
  { [ "$c1" != "'" ] && [ "$c1" != '"' ] && [ "$c2" != "'" ] && [ "$c2" != '"' ]; } \
    || abort "$n starts or ends with a quote — the loader strips quotes; paste the raw value"
}

check_value "API key" "$API_KEY"
check_value "webhook secret" "$WEBHOOK_SECRET"
check_value "product ID" "$PRODUCT_ID"

case "$API_KEY" in
  dodo_test_*) echo "api-key prefix: dodo_test_ (matches test_mode)" ;;
  dodo_live_*) echo "WARN: API key looks like a LIVE key (dodo_live_) but ENVIRONMENT will be test_mode — checkout will fail" ;;
  *) echo "WARN: API key prefix is unexpected (expected dodo_test_...)" ;;
esac
case "$PRODUCT_ID" in
  pdt_*) echo "product-id prefix: pdt_ (expected shape)" ;;
  *) echo "WARN: product ID prefix is unexpected (expected pdt_...)" ;;
esac
case "$WEBHOOK_SECRET" in
  whsec_*) echo "webhook-secret prefix: whsec_ (expected shape)" ;;
  *) echo "WARN: webhook-secret prefix is unexpected (expected whsec_... — continuing anyway)" ;;
esac

# --- 4. Escape every $ as \$ (loader-proven) + length report ------------------
API_ESC="${API_KEY//\$/\\$}"
SECRET_ESC="${WEBHOOK_SECRET//\$/\\$}"
PROD_ESC="${PRODUCT_ID//\$/\\$}"
dcount() { local v="$1" n=0; while [[ "$v" == *\$* ]]; do v="${v#*\$}"; n=$((n+1)); done; echo "$n"; }

echo
echo "length report (names + lengths only, values never printed):"
printf "  DODO_PAYMENTS_API_KEY         typed_len=%-5s dollar_chars=%-4s stored_len=%s\n" "${#API_KEY}" "$(dcount "$API_KEY")" "${#API_KEY}"
printf "  DODO_SOLO_PRODUCT_ID          typed_len=%-5s dollar_chars=%-4s stored_len=%s\n" "${#PRODUCT_ID}" "$(dcount "$PRODUCT_ID")" "${#PRODUCT_ID}"
printf "  DODO_PAYMENTS_WEBHOOK_SECRET  typed_len=%-5s dollar_chars=%-4s stored_len=%s\n" "${#WEBHOOK_SECRET}" "$(dcount "$WEBHOOK_SECRET")" "${#WEBHOOK_SECRET}"
echo "  (stored_len == typed_len: the loader unescapes \\$ back to a single \$)"

# --- 5. Remove old DODO_ lines + append the new block (ssh stdin, no argv) ----
echo
echo "removing old DODO_ lines + appending the new block (one ssh stdin transaction)..."
cat <<EOF | ssh "$VPS" 'set -e; F=/srv/callflow/.env; sed -i "/^DODO_/d" "$F" && cat >> "$F" && chown callflow:callflow "$F" && chmod 600 "$F" && echo append-ok'

DODO_PAYMENTS_API_KEY=$API_ESC
DODO_PAYMENTS_ENVIRONMENT=test_mode
DODO_SOLO_PRODUCT_ID=$PROD_ESC
DODO_PAYMENTS_WEBHOOK_SECRET=$SECRET_ESC
DODO_PAYMENTS_RETURN_URL=$RETURN_URL
EOF

# --- 6. Verify + restart service (ssh -n again) --------------------------------
ssh -n "$VPS" 'set -e; F=/srv/callflow/.env; C=$(grep -c "^DODO_" "$F" || true); echo "total_DODO_count: $C"; if [ "$C" -ne 5 ]; then echo "ABORT: expected 5 DODO_ lines, found $C — service NOT restarted; restore from the backup above if needed"; exit 1; fi; echo "DODO lines in file (names + file_line_len only; each \\$ counts as 2 chars):"; grep "^DODO_" "$F" | awk -F= "{print \"  \" \$1 \" file_line_len=\" length(\$0)}"; for n in DODO_PAYMENTS_API_KEY DODO_PAYMENTS_ENVIRONMENT DODO_SOLO_PRODUCT_ID DODO_PAYMENTS_WEBHOOK_SECRET DODO_PAYMENTS_RETURN_URL; do printf "count_%s=" "$n"; grep -c "^$n=" "$F" || true; done; stat -c "perms_after=%a owner=%U:%G" "$F"; systemctl reset-failed callflow 2>/dev/null || true; echo "restarting systemd service..."; systemctl restart callflow; sleep 3; printf "service: "; systemctl is-active callflow || true; printf "pricing_http: "; curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/pricing; printf "dograh_health_http: "; curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/api/webhooks/dograh/health'

# --- 7. Done -------------------------------------------------------------------
unset API_KEY WEBHOOK_SECRET PRODUCT_ID API_ESC SECRET_ESC PROD_ESC
echo
echo "DONE: Dodo env vars are set in /srv/callflow/.env and the service restarted."
echo "Next (when you are ready): register https://callflow.biz/api/webhooks/dodo in"
echo "the Dodo dashboard (Developer -> Webhooks) and subscribe to subscription.* and"
echo "payment.* events, then run the checkout smoke test."