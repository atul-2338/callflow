# CallFlow Launch Runbook

This runbook is the operational checklist for taking CallFlow from a clean VPS to a verified production launch.

It is intentionally written as a step-by-step checklist so the app can be launched safely without skipping the critical deployment gates.

---

## 1. Scope and goals

This runbook covers the launch path for:

- Ubuntu 24.04 VPS
- Next.js production server
- SQLite database stored on a persistent disk
- Nginx reverse proxy
- Dograh webhook ingestion
- Telnyx call answering (Plivo is legacy and not in use)
- Firebase Cloud Messaging push notifications
- backup + rollback

Before launch, the app must be fully configured and verified for:

- production env values
- persistent database path
- service startup
- reverse proxy + TLS
- live webhook verification
- real Telnyx call validation
- FCM device registration

---

## 2. Required preflight

### 2.1 Confirm access

You need:

- SSH access to the target VPS as root or with sudo privileges
- DNS set for the production domain
- the production domain name, for example `callflow.biz`
- access to the GitHub repo or deployment target
- Telnyx credentials (TELNYX_PUBLIC_KEY, TELNYX_API_KEY, TELNYX_FORWARD_TO)
- Dograh webhook secret
- Firebase service account credentials if push is enabled

### 2.2 Confirm repo status

From the local repo:

```bash
cd /path/to/callflow
npm test
npm run build
```

Expected result:

- tests pass
- production build succeeds

---

## 3. Provision the VPS

Run the first-boot setup script as root:

```bash
sudo bash deploy/vps-bootstrap.sh
```

This script does the following:

- installs base packages
- creates a 2 GB swap file
- installs Node 24
- creates the `callflow` service user
- creates `/var/data`
- clones the repo into `/srv/callflow`
- creates `/srv/callflow/.env` if missing
- installs the app dependencies and runs `npm run build`
- installs the systemd service and Nginx config
- enables the backup timer
- opens firewall ports 80 and 443

Important:

- do not leave the app database inside the repo
- the DB must live in a persistent directory
- the service is configured to require a persistent DB path on the VPS

---

## 4. Configure production env

Edit the live runtime env file:

```bash
sudoedit /srv/callflow/.env
```

Set the values required by the app, for example:

```bash
DATABASE_PATH=/var/data/callflow.db
CORS_ORIGINS=https://your-domain.com,https://www.your-domain.com
TELNYX_PUBLIC_KEY=...
TELNYX_API_KEY=...
TELNYX_FORWARD_TO=+1...
WEBHOOK_SECRET=...
FIREBASE_SERVICE_ACCOUNT={...}
APP_AUTH_TOKEN=...
```

Notes:

- `DATABASE_PATH` must point to a persistent disk
- `WEBHOOK_SECRET` must match the secret configured in the Dograh workflow webhook node (sent in the `x-webhook-secret` header)
- if `APP_AUTH_TOKEN` is unset, write APIs remain open by design
- if you want FCM push notifications enabled, configure Firebase properly and store a valid device token

---

## 5. Validate the service definition

Review the systemd service:

```bash
sudo systemctl cat callflow
```

The service file is located at:

- `deploy/systemd/callflow.service`

Key requirements:

- runs as the `callflow` user
- runs from `/srv/callflow`
- binds to `127.0.0.1:3000`
- sets `DB_REQUIRE_PERSISTENT_PATH=1`
- uses `next start -H 127.0.0.1 -p 3000`

Start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now callflow
sudo systemctl status callflow
```

If there is a startup issue, inspect the logs:

```bash
journalctl -u callflow -n 80 --no-pager
```

---

## 6. Validate app health

Check the app:

```bash
curl -I http://127.0.0.1:3000/pricing
curl -I http://127.0.0.1:3000/api/contacts
```

Expected result:

- `/pricing` returns `200`
- `/api/contacts` returns `200`

If `/api/contacts` fails with a database-path message, fix the environment before continuing.

---

## 7. Validate Nginx and TLS

Check the Nginx config:

```bash
sudo nginx -t
sudo systemctl reload nginx
sudo systemctl status nginx
```

Then verify the public domain:

```bash
curl -I http://your-domain.com
curl -I https://your-domain.com
```

If TLS is not active yet:

```bash
sudo certbot --nginx -d your-domain.com -d www.your-domain.com
```

The Nginx template is in:

- `deploy/nginx/callflow.conf`

The runbook intentionally leaves the certbot step for after DNS is ready and the port 80 vhost is active.

---

## 8. Validate auth and settings flow

The app now stores the auth token in the client and posts it to `/api/settings` with the proper bearer auth header.

Verify manually in the browser:

1. Open the app settings page
2. Set a token in the App auth token field
3. Save the settings
4. Confirm the browser stores the token and subsequent API calls include the bearer header
5. Confirm a stale or missing token results in a `401` on protected writes

This closes the previous manual browser-console workaround described in the project docs.

---

## 9. Validate FCM readiness

To enable push for missed calls:

1. configure Firebase service account credentials in the env
2. save a valid FCM device token in Settings
3. confirm the token is stored in the app DB
4. trigger a webhook fixture or a real missed call
5. confirm the call creates a push notification result

Test the flow against the real endpoint (no fixture route exists anymore):

```bash
curl -sS -X POST http://127.0.0.1:3000/api/webhooks/dograh \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: $WEBHOOK_SECRET" \
  -d '{"callId":"launch-smoke-1","status":"answered","duration":"96","caller_number":"+15550000123","called_number":"+19283319394"}'
```

Expected result:

- `200 {"ok":true}` (wrong/missing secret = 401; missing callId = 400)
- the call is upserted into the `calls` table (check with `node scripts/last-calls.cjs`)
- a push is sent after the response if a valid FCM token is stored, else a
  clean "no FCM token registered" warning in the logs
- `journalctl -u callflow` shows the one-line `[dograh-webhook] POST callId=launch-smoke-1 -> 200`

Clean up afterwards with `npm run clear-test` (removes `test-*` rows; rename
the probe callId to `test-launch-smoke-1` to have it auto-removed).

---

## 10. Validate the Dograh webhook path

The real webhook endpoint is:

```text
POST /api/webhooks/dograh
```

Required header:

- `x-webhook-secret: <WEBHOOK_SECRET>` — constant-time compared; a wrong or
  missing secret answers 401 (fail closed)

Verify the endpoint:

1. configure the exact secret in Dograh
2. set the public URL in the Dograh workflow
3. trigger a test call or replay payload
4. confirm the app writes a `calls` row
5. confirm the call is matched or explicitly marked as unmatched
6. confirm the transcript is stored and the outcome is mapped correctly

---

## 11. Validate the Telnyx path

Before a production launch, confirm all Telnyx values are valid:

```bash
TELNYX_PUBLIC_KEY
TELNYX_API_KEY
TELNYX_FORWARD_TO
```

Then verify the forwarding flow:

1. configure the forwarded number in the business configuration
2. trigger a real missed call to the forwarding number
3. confirm the call reaches the AI answering flow
4. confirm the Dograh webhook fires
5. confirm the `calls` record is created in the DB
6. confirm the owner gets a push notification if FCM is active

This is the production-critical validation step and should happen only after all environment and app checks pass.

---

## 12. Smoke test the full end-to-end flow

Use this checklist before allowing real traffic:

- [ ] `.env` values are set on the VPS
- [ ] `DATABASE_PATH` points to persistent storage
- [ ] service is running
- [ ] app returns `200` on `/pricing`
- [ ] app returns `200` on `/api/contacts`
- [ ] auth token works for protected writes
- [ ] settings form saves FCM token
- [ ] Dograh webhook accepts the payload
- [ ] duplicate replay is detected
- [ ] DB row is created
- [ ] outcome is mapped correctly
- [ ] transcript is stored
- [ ] push result is recorded or skipped cleanly
- [ ] Nginx is serving the domain over HTTPS
- [ ] backup job is enabled and its off-site copy is configured (RUNBOOK §13.3)
- [ ] rollback plan is documented

---

## 13. Backup and rollback

The server-side deployment process is already scripted in:

- `deploy/vps-deploy.sh`
- `deploy/backup.sh`
- `deploy/backup-offsite.sh`
- `deploy/systemd/callflow-backup.service`
- `deploy/systemd/callflow-backup.timer`

To test the backup flow:

```bash
sudo systemctl status callflow-backup.timer
sudo journalctl -u callflow-backup.service -n 50 --no-pager
```

### 13.1 What the nightly job writes

- live database: `/var/data/callflow.db` (from `DATABASE_PATH` in `/srv/callflow/.env`)
- `deploy/backup.sh` snapshots it with SQLite's `VACUUM INTO` (the WAL is folded in)
  and compresses the snapshot with `zstd` (`gzip` if zstd is missing):
  - `/var/backups/callflow/daily/callflow-YYYY-MM-DD.zstd` — 14 daily copies kept
  - `/var/backups/callflow/weekly/callflow-YYYY-MM-DD.zstd` — 8 weekly copies kept
    (Sunday's daily copy is promoted)
- then it hands those directories to `deploy/backup-offsite.sh` (see 13.3).

`callflow-backup.timer` is the only scheduler: `OnCalendar=*-*-* 03:15:00`,
`Persistent=true` (a missed night runs as soon as the box is back). `crontab` is
intentionally empty on this box.

### 13.2 Restore

```bash
# 1. pick a snapshot and unpack it to a scratch file
sudo zstd -d -o /tmp/restore.db /var/backups/callflow/daily/callflow-YYYY-MM-DD.zstd
sudo sqlite3 /tmp/restore.db 'PRAGMA integrity_check;'      # must print: ok
sudo sqlite3 /tmp/restore.db 'SELECT count(*) FROM calls;'  # sanity-check the data

# 2. stop the app, replace the live DB (keep the current one as a rollback copy)
sudo systemctl stop callflow
sudo cp -p /var/data/callflow.db /var/data/callflow.db.before-restore
sudo install -o callflow -g callflow -m 644 /tmp/restore.db /var/data/callflow.db
sudo rm -f /var/data/callflow.db-wal /var/data/callflow.db-shm
sudo systemctl start callflow
curl -sS http://127.0.0.1:3000/api/webhooks/dograh/health   # {"ok":true,...}
```

Never restore from `/opt/callflow/backups/*.db`: that is the retired October 2026
`/opt/callflow` install, backed up from a dead database path by a leftover
`/etc/cron.d/callflow-backup` entry. Use `/var/backups/callflow` (above) only.

### 13.3 Off-server copy — required (same disk is not a backup)

`/var/backups/callflow` and `/var/data/callflow.db` share `/dev/vda2`, and this box
has no platform snapshot layer, so the snapshots must leave the machine.
`deploy/backup-offsite.sh` is the last step of `deploy/backup.sh` and is inert until
you give it a destination:

```bash
# 1. pick a destination and put the settings (plus any remote credentials) in a
#    root-only env file — never in the repo, never on the command line
sudo install -d -m 700 /etc/callflow
sudo tee /etc/callflow/backup.env >/dev/null <<'EOF'
OFFSITE_BACKUP_TOOL=auto
OFFSITE_DEST=rclone-remote:callflow
OFFSITE_REQUIRED=1
OFFSITE_PRUNE=0
EOF
sudo chown root:root /etc/callflow/backup.env && sudo chmod 600 /etc/callflow/backup.env

# 2. make the tool available (rclone is the most portable: one static binary and it
#    speaks B2 / S3 / R2 / SFTP / Drive alike)
curl -fsSL https://rclone.org/install.sh | sudo bash
sudo rclone config            # create the remote named in OFFSITE_DEST

# 3. prove it end-to-end (uploads tonight's snapshots and prints what landed)
sudo bash /srv/callflow/deploy/backup.sh
sudo journalctl -u callflow-backup.service -n 20 --no-pager   # after the next 03:15 run
```

Destination shapes and the tool each one selects:

| `OFFSITE_DEST` | tool | credentials |
| --- | --- | --- |
| `/mnt/nas/callflow` | `cp` | whatever mounts that path (NFS/SMB/USB) |
| `user@host:/srv/backups/callflow` | `rsync` | root's SSH key on that host |
| `s3://my-bucket/callflow` | `aws` | `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (add to `backup.env`) |
| `b2:callflow`, `r2:callflow`, … | `rclone` | the rclone remote |

Knobs: `OFFSITE_BACKUP_TOOL` (`auto` default; set it explicitly when a
`host:path` destination is ambiguous), `OFFSITE_REQUIRED=1` to make a failed push
fail `callflow-backup.service` instead of only logging (recommended once the
destination is proven), `OFFSITE_PRUNE=1` to delete remote files that no longer
exist locally (off by default — off-site copies are deliberately kept if local
retention is ever misconfigured).

Checklist-ready proof: step 3's output must contain
`offsite: pushed with '<tool>' → <dest>` and, for `cp`/`rsync`,
`offsite: now holds N snapshot(s)`. Until `OFFSITE_DEST` is set the nightly job
still succeeds but logs `Offsite copy is NOT configured` — treat that line as an
open launch item.

To trigger a manual deploy rollback if health checks fail, follow the logic in `deploy/vps-deploy.sh`.

---

## 14. Final go/no-go criteria

Proceed to launch only when all of the following are true:

- runtime secrets are configured
- DB path is durable
- service boots cleanly
- app responds over HTTP and HTTPS
- auth is working
- FCM token is working
- Dograh webhook is accepted and processed
- Telnyx answering is validated in a real call
- backup and rollback are ready
- there are no new test failures

If any box fails, do not ship production traffic.

---

## 15. Useful commands

```bash
# system status
sudo systemctl status callflow
sudo systemctl status nginx
sudo systemctl status callflow-backup.timer

# logs
journalctl -u callflow -n 80 --no-pager
journalctl -u nginx -n 80 --no-pager

# quick health checks
curl -I http://127.0.0.1:3000/pricing
curl -I http://127.0.0.1:3000/api/contacts
curl -I https://your-domain.com

# deploy
sudo bash /srv/callflow/deploy/vps-deploy.sh

# backup manual check
sudo bash /srv/callflow/deploy/backup.sh

# off-site copy on its own (prints whether a destination is configured)
sudo bash /srv/callflow/deploy/backup-offsite.sh
```

---

## 16. Signoff

Before launch, check off each item in the smoke-test list and confirm:

- environment is configured
- app is healthy
- domain is live
- webhook is verified
- Telnyx is verified
- backup and rollback are ready

Only then should production traffic be enabled.
