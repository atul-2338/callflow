#!/usr/bin/env bash
# CallFlow — first-boot provisioning for a fresh Ubuntu 24.04 LTS VPS.
#
#   sudo bash deploy/vps-bootstrap.sh
#
# Reads these env vars (all optional except where noted):
#   DOMAIN          public hostname this box serves.  default: callflow.biz
#   SERVER_ALIAS    extra hostname in the same cert.  default: www.<DOMAIN>
#   REPO_URL        git URL to clone.  default: the public GitHub URL
#   GITHUB_TOKEN    REQUIRED if the repo is private (see note below the clone step)
#   RUN_CERTBOT     "1" to request TLS at the end.  default: 0 — do this AFTER the
#                   DNS A records point at this box, otherwise validation fails.
#   NODE_MAJOR      Node.js major version from NodeSource.  default: 24 (min. 22)
#
# Safe to re-run: every step is guarded. It never deletes an existing .env,
# database, or checkout.

set -euo pipefail

DOMAIN="${DOMAIN:-callflow.biz}"
SERVER_ALIAS="${SERVER_ALIAS:-www.${DOMAIN}}"
REPO_URL="${REPO_URL:-https://github.com/atul-2338/callflow.git}"
RUN_CERTBOT="${RUN_CERTBOT:-0}"

APP_NAME=callflow
APP_USER=callflow
APP_DIR=/srv/callflow
DATA_DIR=/var/data
# Next.js 16 requires Node >=22 (package.json "engines"); 24 matches .node-version
# and the runtime this README's instructions were verified against. Force another
# major with e.g. `sudo NODE_MAJOR=22 bash deploy/vps-bootstrap.sh`.
NODE_MAJOR="${NODE_MAJOR:-24}"

if [[ $EUID -ne 0 ]]; then
  echo "Run as root:  sudo bash deploy/vps-bootstrap.sh" >&2
  exit 1
fi

echo "==> 1/9  Base packages + swap"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git ca-certificates gnupg rsync \
  build-essential python3 ufw nginx certbot python3-certbot-nginx

# The 2 GB droplet is the single most likely reason a `next build` dies with an
# opaque "killed" message, so create swap before anything compiles.
if [[ ! -f /swapfile ]]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi

echo "==> 2/9  Node.js ${NODE_MAJOR}.x (NodeSource)"
# Matches the version pinned in .node-version and the runtime everything in
# README.md was verified on. Ubuntu 24.04's apt `nodejs` is far too old for Next 16.
if ! node -v 2>/dev/null | grep -q "^v${NODE_MAJOR}\."; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi
node -v
npm -v

echo "==> 3/9  Service user"
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  adduser --system --group --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
fi

# The database must live OUTSIDE $APP_DIR: src/lib/database.ts refuses to open it
# in production if DATABASE_PATH is inside the project directory.
echo "==> 4/9  Data directory ${DATA_DIR}"
mkdir -p "$DATA_DIR"
chown "${APP_USER}:${APP_USER}" "$DATA_DIR"
chmod 750 "$DATA_DIR"

echo "==> 5/9  Checkout ${APP_DIR}"
if [[ -d "$APP_DIR/.git" ]]; then
  echo "    existing checkout — fetching + resetting to origin/main"
  # If you cloned this repo as your own admin user (rather than letting the script
  # create the checkout), everything under $APP_DIR is owned by you and the service
  # user cannot write it. Normalise before touching git.
  chown -R "${APP_USER}:${APP_USER}" "$APP_DIR"
  # --hard is fine here: nothing live is edited on the server; .env is untracked
  # and gitignored, so it survives. The database is in $DATA_DIR, not here.
  runuser -u "$APP_USER" -- git -C "$APP_DIR" fetch origin
  runuser -u "$APP_USER" -- git -C "$APP_DIR" reset --hard origin/main
elif [[ -d "$APP_DIR" ]] && [[ -n "$(ls -A "$APP_DIR" 2>/dev/null)" ]]; then
  echo "    $APP_DIR exists and is not a git checkout — refusing to touch it." >&2
  exit 1
else
  # Private repo? Clone with a fine-grained PAT that has read-only Contents access:
  #   REPO_URL="https://x-access-token:${GITHUB_TOKEN}@github.com/atul-2338/callflow.git"
  mkdir -p "$APP_DIR"
  # Must be owned by the service user BEFORE the clone: this script runs as root,
  # but every later git/npm/build step runs as $APP_USER and needs to write here.
  chown "${APP_USER}:${APP_USER}" "$APP_DIR"
  runuser -u "$APP_USER" -- git clone "$REPO_URL" "$APP_DIR"
fi

echo "==> 6/9  Runtime env file"
# Created only if missing, and never overwritten: this file will hold real Plivo /
# Firebase credentials. Fill it in before the first start:  sudoedit $APP_DIR/.env
if [[ ! -f "$APP_DIR/.env" ]]; then
  cat >"$APP_DIR/.env" <<EOF
# Production runtime config for ${DOMAIN}. chmod 600, owned by ${APP_USER}.
# Next.js loads this file itself when \`next start\` boots.
DATABASE_PATH=${DATA_DIR}/callflow.db
CORS_ORIGINS=https://${DOMAIN},https://${SERVER_ALIAS}

# Fill these in with real values (see .env.example for descriptions):
# PLIVO_AUTH_ID=
# PLIVO_AUTH_TOKEN=
# PLIVO_NUMBER=
# FIREBASE_SERVICE_ACCOUNT=
# BUSINESS_OWNER_NUMBER=
EOF
  echo "    WROTE ${APP_DIR}/.env — edit it now, then re-run this script."
fi
chown "${APP_USER}:${APP_USER}" "$APP_DIR/.env"
chmod 600 "$APP_DIR/.env"

echo "==> 7/9  Install dependencies + production build"
runuser -u "$APP_USER" -- bash -c "cd '$APP_DIR' && npm ci && npm run build"

echo "==> 8/9  systemd + Nginx"
install -m 644 "$APP_DIR/deploy/systemd/callflow.service" "/etc/systemd/system/${APP_NAME}.service"
install -m 644 "$APP_DIR/deploy/systemd/callflow-backup.service" /etc/systemd/system/callflow-backup.service
install -m 644 "$APP_DIR/deploy/systemd/callflow-backup.timer" /etc/systemd/system/callflow-backup.timer
install -m 644 "$APP_DIR/deploy/nginx/callflow.conf" "/etc/nginx/sites-available/${APP_NAME}.conf"
ln -sf "/etc/nginx/sites-available/${APP_NAME}.conf" "/etc/nginx/sites-enabled/${APP_NAME}.conf"
rm -f /etc/nginx/sites-enabled/default
systemctl daemon-reload
systemctl enable --now "$APP_NAME"
# Nightly SQLite snapshot. Only useful once pushed off-box — see deploy/backup.sh.
systemctl enable --now callflow-backup.timer
nginx -t && systemctl reload nginx

echo "==> 9/9  Firewall"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo
echo "Local check (should print 200, proxied nothing yet):"
curl -sS -o /dev/null -w '  app      -> %{http_code}\n' "http://127.0.0.1:3000/pricing"
curl -sS -o /dev/null -w '  via 80   -> %{http_code}\n' -H "Host: ${DOMAIN}" "http://127.0.0.1/pricing"
echo "  DB routes must return 200. If they 500 with 'DATABASE_PATH', see README.md."

if [[ "$RUN_CERTBOT" == "1" ]]; then
  certbot --nginx --non-interactive --agree-tos -m "admin@${DOMAIN}" -d "$DOMAIN" -d "$SERVER_ALIAS" --redirect
else
  echo
  echo "Skipped TLS. Once ${DOMAIN} and ${SERVER_ALIAS} resolve to this box's IP:"
  echo "  sudo certbot --nginx -d ${DOMAIN} -d ${SERVER_ALIAS}"
fi
