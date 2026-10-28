#!/usr/bin/env bash
# CallFlow — online SQLite backup.
#
#   sudo bash /srv/callflow/deploy/backup.sh
#
# Installed as a daily timer by deploy/vps-bootstrap.sh, or run by hand before
# anything risky. Uses SQLite's backup API so it is safe against a live database
# in WAL mode — copying callflow.db alone would miss whatever is still sitting in
# callflow.db-wal.
#
# Retention: daily copies for 14 days, weekly copies for 8 weeks.
#   /var/backups/callflow/daily/callflow-2026-09-14.zstd
#   /var/backups/callflow/weekly/callflow-2026-09-07.zstd
# Those directories are on the same disk as the database, so the last step here
# hands them to deploy/backup-offsite.sh, which pushes them off-server.

set -euo pipefail

DB_PATH="${DB_PATH:-/var/data/callflow.db}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/callflow}"
KEEP_DAILY=14
KEEP_WEEKLY=8

if [[ ! -f "$DB_PATH" ]]; then
  echo "No database at ${DB_PATH} — nothing to back up." >&2
  exit 1
fi

TODAY="$(date +%F)"
STAMP="$(date +%F_%H%M%S)"
DAILY_DIR="${BACKUP_ROOT}/daily"
WEEKLY_DIR="${BACKUP_ROOT}/weekly"
mkdir -p "$DAILY_DIR" "$WEEKLY_DIR"

TMP="${DAILY_DIR}/.staging-${STAMP}.db"
trap 'rm -f "$TMP"' EXIT

# `VACUUM INTO` produces a single self-contained file (WAL folded in) and does not
# require the sqlite3 CLI, so it works on a bare box with only better-sqlite3.
node -e '
const Database = require("/srv/callflow/node_modules/better-sqlite3");
const [src, dst] = process.argv.slice(1);
const db = new Database(src, { readonly: true });
db.pragma("busy_timeout = 5000");
db.prepare("VACUUM INTO ?").run(dst);
db.close();
' "$DB_PATH" "$TMP"

OUT="${DAILY_DIR}/callflow-${TODAY}.zstd"
if command -v zstd >/dev/null 2>&1; then
  zstd -q -f -o "$OUT" "$TMP"
else
  OUT="${DAILY_DIR}/callflow-${TODAY}.gz"
  gzip -c "$TMP" >"$OUT"
fi
rm -f "$TMP"
trap - EXIT

chmod 600 "$OUT"

# Sunday's daily copy is promoted to the weekly archive, keeping the same
# compression extension the daily copy actually got (zstd if present, else gz).
if [[ "$(date +%u)" == "7" ]]; then
  cp -a "$OUT" "${WEEKLY_DIR}/$(basename "$OUT")"
fi

find "$DAILY_DIR"  -name 'callflow-*' -mtime +"$KEEP_DAILY" -delete
find "$WEEKLY_DIR" -name 'callflow-*' -mtime +"$((KEEP_WEEKLY * 7))" -delete

echo "==> ${OUT}  ($(du -h "$OUT" | cut -f1))"

# --- Off-server copy -----------------------------------------------------------
# A backup on the same disk as the database is not a backup, and this box has no
# platform snapshot layer. deploy/backup-offsite.sh pushes ${BACKUP_ROOT} to a
# destination configured in /etc/callflow/backup.env (RUNBOOK.md §13.3):
#
#   OFFSITE_DEST=/mnt/nas/callflow | user@host:/srv/backups/callflow
#   OFFSITE_DEST=s3://YOUR-BUCKET/callflow | rclone-remote:callflow
#   OFFSITE_BACKUP_TOOL=auto|rclone|aws|rsync|cp   OFFSITE_REQUIRED=0|1
#
# Credentials stay in that root-only env file, never in this repo. With
# OFFSITE_DEST unset the step logs a notice and succeeds, so the nightly timer
# stays green until a destination exists; a real push failure obeys
# OFFSITE_REQUIRED (1 = fail the unit so nobody misses it).
bash "$(dirname "${BASH_SOURCE[0]}")/backup-offsite.sh"
