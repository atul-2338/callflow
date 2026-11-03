# DEPLOY - CallFlow on the Vultr server

Plain-English runbook for `/srv/callflow` (server `root@45.76.252.174`,
service name `callflow`, live database `/var/data/callflow.db`).

Read this once before you start. Every command below is meant to be copied and
pasted exactly. Where a command prints something, the expected output is shown so
you can tell whether it worked.

**Ground rules**

- You never have to type a password or a secret: everything lives in
  `/srv/callflow/.env`, which you must never open, copy, or paste anywhere.
- The deploy script backs out automatically if the new code fails. Step 6 covers
  the manual rollback just in case.
- Never delete anything in `/var/data` or `/var/backups`. Nothing in this runbook
  deletes a database file.

---

## Step 1 - Log in to the server

On your own computer, open a terminal (or PowerShell) and run:

```
ssh root@45.76.252.174
```

You should land on a prompt showing `/srv/callflow` or `~`. Everything from here
happens ON the server, not on your laptop.

Check you are in the right place:

```
cd /srv/callflow && pwd
```

Expected output: `/srv/callflow`

## Step 2 - Back up the live database FIRST

This takes a few seconds and is safe to run while the site is live.

```
sudo bash /srv/callflow/deploy/backup.sh
```

Expected output: one line ending in a path, e.g.

```
==> /var/backups/callflow/daily/callflow-2026-11-03.zstd  (156K)
```

Write that path down (or leave it on screen). If you see
`No database at /var/data/callflow.db`, STOP - the database is missing and
something is wrong. Do not continue; ask for help.

Confirm the backup really exists and is not empty:

```
ls -lh /var/backups/callflow/daily/ | tail -5
```

The newest line must show a file with a size in KB, not 0.

## Step 3 - Check what is running now (before you change it)

```
cd /srv/callflow
runuser -u callflow -- git log --oneline -1
systemctl is-active callflow
```

Expected: one commit line (the current version) and then `active`.

Keep the commit line - Step 6 needs it if you have to roll back.

## Step 4 - Pull the new code, install, build, restart (one command)

This command does the rest of the work by itself:

```
sudo bash /srv/callflow/deploy/vps-deploy.sh
```

What it does, in order:

1. refuses to run if the server has uncommitted local edits (safe),
2. downloads the newest code from GitHub (`origin/main`),
3. installs dependencies (`npm ci`) and builds the app (`npm run build`),
4. restarts the `callflow` service,
5. checks the site is healthy and **automatically rolls back** if it is not.

It takes 2-5 minutes. Expected finish:

```
==> Restart callflow
    /pricing -> 200   /api/webhooks/dograh/health -> 200
==> Deployed 9e20577 successfully.
```

If instead you see `Build FAILED` or `Health check FAILED`, the script has already
rolled back to the previous version and the site is still up - go to Step 7 and
send me the log line it printed.

## Step 5 - Confirm the new version is healthy

Run these three checks.

```
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/pricing
```

Expected: `200` (the site is serving pages)

```
curl -sS http://127.0.0.1:3000/api/webhooks/dograh/health
```

Expected: `{"ok":true,"calls":N}` - the app can read the database.

```
systemctl is-active callflow
```

Expected: `active`

Optional, same checks through the public domain (proves Nginx + HTTPS):

```
curl -sS -o /dev/null -w '%{http_code}\n' https://callflow.biz/pricing
curl -sS -o /dev/null -w '%{http_code}\n' https://callflow.biz/api/webhooks/dograh/health
```

Both should print `200`.

### About database "migrations"

There is no separate migration command, and you never run SQL by hand. The app
applies `migrations/schema.sql` by itself every time it starts (it only adds what
is missing and never deletes data). That is why Step 4's restart is also the
migration step. The checks above prove it worked: if a new column or table failed
to apply, `/api/webhooks/dograh/health` would return `500` instead of `200`.

If you want to see which version is live:

```
cd /srv/callflow && runuser -u callflow -- git log --oneline -1
```

## Step 6 - Roll back (only if something is visibly broken)

**Code problems** (pages error, deploy printed FAILED): the deploy script in
Step 4 already rolled back on its own. First confirm:

```
cd /srv/callflow
runuser -u callflow -- git log --oneline -1
systemctl is-active callflow
```

If that commit is the OLD one from Step 3 and the service is `active`, you are
done - nothing else to do.

If you need to go back by hand, run these four commands with the OLD commit
short-hash you noted in Step 3 (replace `PASTE_OLD_SHA`):

```
cd /srv/callflow
runuser -u callflow -- git reset --hard PASTE_OLD_SHA
runuser -u callflow -- bash -c 'cd /srv/callflow && npm ci && npm run build'
systemctl restart callflow
```

Then re-run the three checks from Step 5.

**Database problems** (rare): only if the health check returns `500` *and* the
service logs show a database error that the rollback did not fix. Do NOT delete or
"reset" the database - take a fresh backup first (`sudo bash
/srv/callflow/deploy/backup.sh`) and then ask me before restoring anything from
`/var/backups/callflow/`. Restoring is a separate, deliberate step, and a wrong
copy is worse than a broken deploy.

## Step 7 - If anything fails: what to send me

Copy-paste these three outputs into our chat (they contain no secrets):

```
cd /srv/callflow && runuser -u callflow -- git log --oneline -3
journalctl -u callflow -n 60 --no-pager
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/pricing
```

## Step 8 - After a successful deploy: three owner-only checks

These are not code checks; they confirm the business side still works.

1. Open https://callflow.biz/pricing and https://callflow.biz/app - both load.
2. Sign in to https://callflow.biz/admin and confirm the Overview shows
   Businesses, Numbers available, Calls (with an "N unlinked" line) and Audit.
3. If you have just added email settings (`SMTP_*`) to `/srv/callflow/.env`, place
   one test call to a CallFlow number and check the owner inbox gets the alert.

## Notes for this specific deploy (the build-brief run)

- No new environment variables are required for this version. Email sending stays
  switched off until `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and
  `SMTP_FROM` exist in `/srv/callflow/.env` (owner task; never paste those values
  into chat or a file that goes to git).
- The database gains two nullable columns on boot (`businesses.trialEndedEmailAt`,
  `businesses.trialReminderEmailAt`). Nothing is dropped or rewritten.
- After deploying, rotating `WEBHOOK_SECRET` requires updating BOTH
  `/srv/callflow/.env` and the Dograh workflow's webhook node, then restarting
  (`systemctl restart callflow`). Do one at a time or calls will be rejected with
  401 in between.

