#!/usr/bin/env bash
# CallFlow — routine deploy after pushing to GitHub.
#
#   sudo bash /srv/callflow/deploy/vps-deploy.sh
#
# Pulls origin/main, reinstalls deps, rebuilds, restarts the service, and rolls
# back to the previous commit if the new build or boot fails.
#
# The database is NOT touched: it lives in /var/data, outside the checkout, which
# is exactly why `git reset --hard` here is safe.

set -euo pipefail

APP_NAME=callflow
APP_USER=callflow
APP_DIR=/srv/callflow
BRANCH="${BRANCH:-main}"
KEEP_ROLLBACK=1

PREV_SHA="$(git -C "$APP_DIR" rev-parse HEAD)"
echo "==> Current commit: ${PREV_SHA}"

# All git work happens as $APP_USER: /srv/callflow is owned by the service user, so
# objects written by root would leave the next `npm ci`/`git pull` unable to run.
g() { runuser -u "$APP_USER" -- git -C "$APP_DIR" "$@"; }

if [[ -n "$(g status --porcelain)" ]]; then
  echo "!!  Working tree is dirty on the server. Investigate before deploying:" >&2
  g status --porcelain >&2
  exit 1
fi

echo "==> Fetch + build"
g fetch origin "$BRANCH"
g reset --hard "origin/${BRANCH}"
NEW_SHA="$(g rev-parse --short HEAD)"
echo "    Deploying ${NEW_SHA}"

if ! runuser -u "$APP_USER" -- bash -c "cd '$APP_DIR' && npm ci && npm run build"; then
  echo "==> Build FAILED — restoring ${PREV_SHA:0:7} and rebuilding" >&2
  g reset --hard "$PREV_SHA"
  runuser -u "$APP_USER" -- bash -c "cd '$APP_DIR' && npm ci && npm run build"
  systemctl restart "$APP_NAME"
  exit 1
fi

echo "==> Restart ${APP_NAME}"
systemctl restart "$APP_NAME"
sleep 4

# Health gate: /pricing is static and never touches SQLite, so it proves the
# process is serving. /api/contacts is the DB round-trip that proves the guard
# is satisfied and the data directory is readable.
HTTP_APP="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/pricing || echo 000)"
HTTP_DB="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/contacts || echo 000)"
echo "    /pricing -> ${HTTP_APP}   /api/contacts -> ${HTTP_DB}"

if [[ "$HTTP_APP" != "200" || "$HTTP_DB" != "200" ]]; then
  echo "==> Health check FAILED — rolling back to ${PREV_SHA:0:7}" >&2
  g reset --hard "$PREV_SHA"
  runuser -u "$APP_USER" -- bash -c "cd '$APP_DIR' && npm ci && npm run build"
  systemctl restart "$APP_NAME"
  echo "    Rolled back. Read the failure with:  journalctl -u ${APP_NAME} -n 80 --no-pager" >&2
  exit 1
fi

echo "==> Deployed ${NEW_SHA} successfully."
echo "    Logs:      journalctl -u ${APP_NAME} -f"
echo "    Nginx log: tail -f /var/log/nginx/callflow.error.log"
