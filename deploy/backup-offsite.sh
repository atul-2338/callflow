#!/usr/bin/env bash
# CallFlow — push the nightly SQLite snapshots off this server.
#
#   sudo bash /srv/callflow/deploy/backup-offsite.sh    # normally called by deploy/backup.sh
#
# Why this exists: deploy/backup.sh writes to /var/backups/callflow, which sits on the
# SAME disk as /var/data/callflow.db. A backup on the same disk is not a backup — this
# box has no platform snapshot layer, so the snapshots must leave the machine.
#
# Configure it with an env file only root can read (RUNBOOK.md §13.3):
#
#   /etc/callflow/backup.env      (chown root:root, chmod 600, never in the repo)
#
#   OFFSITE_BACKUP_TOOL=auto       # auto | rclone | aws | rsync | cp
#   OFFSITE_DEST=...               # shape decides the tool (table below)
#   OFFSITE_REQUIRED=0             # 1 -> a failed push fails callflow-backup.service
#   OFFSITE_PRUNE=0                # 1 -> delete remote files that are gone locally
#
#   OFFSITE_DEST shape                  tool    notes
#   /mnt/nas/callflow                   cp      any mounted path (NFS/SMB/USB)
#   user@host:/srv/backups/callflow     rsync   host key required for root
#   s3://my-bucket/callflow             aws     aws s3 sync; AWS_* creds in the env file
#   b2:callflow / r2:callflow           rclone  any rclone remote
#
# The local backup always works on its own: with OFFSITE_DEST unset this script says so
# and exits 0, so the nightly timer stays green until a destination is configured.

set -uo pipefail
# Deliberately NOT `set -e`: an unconfigured or failed push must be reported (and then
# governed by OFFSITE_REQUIRED), not thrown, so deploy/backup.sh keeps control.

BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/callflow}"
TOOL="${OFFSITE_BACKUP_TOOL:-auto}"
DEST="${OFFSITE_DEST:-}"
REQUIRED="${OFFSITE_REQUIRED:-0}"
PRUNE="${OFFSITE_PRUNE:-0}"

log() { echo "offsite: $*"; }

fail() {
  log "FAILED: $*"
  if [[ "$REQUIRED" == "1" ]]; then
    log "OFFSITE_REQUIRED=1 → failing callflow-backup.service so this is noticed."
    exit 1
  fi
  log "OFFSITE_REQUIRED=0 → local snapshots are intact; unit stays green."
  exit 0
}

if [[ -z "$DEST" ]]; then
  log "Offsite copy is NOT configured (OFFSITE_DEST is unset) — skipping the off-server copy."
  log "Local snapshots stay in ${BACKUP_ROOT} on the same disk as the database."
  log "Configure it via /etc/callflow/backup.env (RUNBOOK.md §13.3)."
  exit 0
fi

if [[ ! -d "$BACKUP_ROOT" ]]; then
  fail "no local backup root at ${BACKUP_ROOT} — run deploy/backup.sh first."
fi

# --- tool resolution ----------------------------------------------------------
if [[ "$TOOL" == "auto" ]]; then
  if [[ "$DEST" == s3://* ]] && command -v aws >/dev/null 2>&1; then
    TOOL="aws"
  elif [[ "$DEST" == *:* && "$DEST" != /* && "$DEST" != ./* ]] && command -v rclone >/dev/null 2>&1; then
    TOOL="rclone"
  elif [[ "$DEST" == *:* && "$DEST" != /* && "$DEST" != ./* ]] && command -v rsync >/dev/null 2>&1; then
    TOOL="rsync"
  else
    TOOL="cp"
  fi
  log "OFFSITE_BACKUP_TOOL=auto → chose '${TOOL}' for ${DEST}"
  log "(set OFFSITE_BACKUP_TOOL explicitly when 'host:path' could mean rsync or rclone)"
fi

case "$TOOL" in
  cp) : ;;
  rclone|aws|rsync)
    command -v "$TOOL" >/dev/null 2>&1 ||
      fail "'${TOOL}' is not installed on this box — install it or change OFFSITE_BACKUP_TOOL."
    ;;
  *) fail "unknown OFFSITE_BACKUP_TOOL='${TOOL}' (expected auto|rclone|aws|rsync|cp)." ;;
esac

# --- push ---------------------------------------------------------------------
case "$TOOL" in
  cp)
    mkdir -p "$DEST" || fail "cannot create ${DEST}."
    cp -a "${BACKUP_ROOT}/." "${DEST}/" || fail "cp to ${DEST} failed."
    ;;
  rsync)
    RSYNC_ARGS=(-a --no-owner --no-group)
    [[ "$PRUNE" == "1" ]] && RSYNC_ARGS+=(--delete-after)
    rsync "${RSYNC_ARGS[@]}" "${BACKUP_ROOT}/" "${DEST}/" || fail "rsync to ${DEST} failed."
    ;;
  aws)
    AWS_ARGS=(--storage-class STANDARD_IA)
    [[ "$PRUNE" == "1" ]] && AWS_ARGS+=(--delete)
    aws s3 sync "$BACKUP_ROOT" "$DEST" "${AWS_ARGS[@]}" || fail "aws s3 sync to ${DEST} failed."
    ;;
  rclone)
    RCLONE_ARGS=(--max-age 90d)
    [[ "$PRUNE" == "1" ]] && RCLONE_ARGS+=(--delete)
    rclone sync "$BACKUP_ROOT" "$DEST" "${RCLONE_ARGS[@]}" || fail "rclone sync to ${DEST} failed."
    ;;
esac

# --- report -------------------------------------------------------------------
LOCAL_N="$(find "$BACKUP_ROOT" -type f -name 'callflow-*' | wc -l | tr -d ' ')"
log "pushed with '${TOOL}' → ${DEST} (${LOCAL_N} local snapshot(s))"

case "$TOOL" in
  cp|rsync)
    OFFSITE_N="$(find "$DEST" -type f -name 'callflow-*' 2>/dev/null | wc -l | tr -d ' ')"
    log "offsite now holds ${OFFSITE_N} snapshot(s)"
    ;;
  aws)    aws s3 ls "$DEST" >/dev/null 2>&1 && log "destination listed OK" ;;
  rclone) rclone lsf --max-depth 2 "$DEST" >/dev/null 2>&1 && log "destination listed OK" ;;
esac

exit 0
