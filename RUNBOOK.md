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
- Plivo call forwarding
- Firebase Cloud Messaging push notifications
- backup + rollback

Before launch, the app must be fully configured and verified for:

- production env values
- persistent database path
- service startup
- reverse proxy + TLS
- live webhook verification
- real Plivo call validation
- FCM device registration

---

## 2. Required preflight

### 2.1 Confirm access

You need:

- SSH access to the target VPS as root or with sudo privileges
- DNS set for the production domain
- the production domain name, for example `callflow.biz`
- access to the GitHub repo or deployment target
- valid Plivo credentials
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
PLIVO_AUTH_ID=...
PLIVO_AUTH_TOKEN=...
PLIVO_NUMBER=+1...
DOGRAH_WEBHOOK_SECRET=...
FIREBASE_SERVICE_ACCOUNT={...}
APP_AUTH_TOKEN=...
```

Notes:

- `DATABASE_PATH` must point to a persistent disk
- `DOGRAH_WEBHOOK_SECRET` must match the secret configured in the Dograh workflow webhook node
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

Test the flow with the live fixture endpoint:

```bash
curl -sS -X POST http://localhost:3111/api/webhooks/dograh/test \
  -H "Content-Type: application/json" \
  -d '{"fixture":"booked","workflow_run_id":"launch-smoke-1"}'
```

Expected result:

- `webhookStatus: 200`
- `outcome: "booked"`
- push result indicates success or a clean “no token configured” message if not configured yet

---

## 10. Validate the Dograh webhook path

The real webhook endpoint is:

```text
POST /api/webhooks/dograh
```

Required headers or query auth:

- `X-Callflow-Secret: <DOGRAH_WEBHOOK_SECRET>`
- `Authorization: Bearer <DOGRAH_WEBHOOK_SECRET>`
- or `?key=<DOGRAH_WEBHOOK_SECRET>`

Verify the endpoint:

1. configure the exact secret in Dograh
2. set the public URL in the Dograh workflow
3. trigger a test call or replay payload
4. confirm the app writes a `calls` row
5. confirm the call is matched or explicitly marked as unmatched
6. confirm the transcript is stored and the outcome is mapped correctly

---

## 11. Validate the Plivo path

Before a production launch, confirm all Plivo values are valid:

```bash
PLIVO_AUTH_ID
PLIVO_AUTH_TOKEN
PLIVO_NUMBER
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
- [ ] backup job is enabled
- [ ] rollback plan is documented

---

## 13. Backup and rollback

The server-side deployment process is already scripted in:

- `deploy/vps-deploy.sh`
- `deploy/backup.sh`
- `deploy/systemd/callflow-backup.service`
- `deploy/systemd/callflow-backup.timer`

To test the backup flow:

```bash
sudo systemctl status callflow-backup.timer
sudo journalctl -u callflow-backup.service -n 50 --no-pager
```

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
- Plivo forwarding is validated in a real call
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
```

---

## 16. Signoff

Before launch, check off each item in the smoke-test list and confirm:

- environment is configured
- app is healthy
- domain is live
- webhook is verified
- Plivo is verified
- backup and rollback are ready

Only then should production traffic be enabled.
