# CallFlow — BACKLOG

Maintained by `.clinerules/workflows/end-day.md` (finished → DONE with the
date; NOW/NEXT re-ordered). Newest DONE on top. Every NOW item carries its
first exact command. NEVER put secret values in this file.
## Session goal (owner, 2026-10-26)

**Finish the MVP so the owner can start promoting within about a day.**
Session rules: ONE step at a time → show the result → wait for "next".
Never print secret values (names/prefixes only); any secret the owner
must enter uses a hidden prompt (`read -s`) so it never appears on
screen. No `git commit`/`git push` without owner approval. Dograh
webhook, billing code, and owner session stay untouched unless a step
requires it — and any such diff is shown first. Keep changes small.

**Decision CONFIRMED (owner, 2026-10-26):** derived webhook results on
`/admin/system` are read from `calls WHERE dograhRunId IS NOT NULL` —
implemented; Dograh handler untouched. Closed; no longer open.

*Note: steps 2–7 keep the previous NOW/NEXT/LATER items in MVP priority
order (inferred) — owner to confirm or correct.*

## NOW (MVP — one at a time, show result, wait for "next")

1. **Step 2 — Admin panel Phase 6: finish the live test.** Env vars +
   deploy already shipped (b7737fb, 2026-10-26; `/admin` renders the
   sign-in form — the fail-closed 404 did not trigger). Remaining:
   owner live-tests https://callflow.biz/admin — sign-in, overview,
   create-business roundtrip, logout; optional nginx IP-allow block.
   First command: open https://callflow.biz/admin in a browser.

2. **Off-site backup destination (owner — the push step is written and
   validated but inert until configured).** Install rclone (or point
   `OFFSITE_DEST` at a mounted NAS / S3 bucket), write
   `/etc/callflow/backup.env` (root:root 600, `OFFSITE_REQUIRED=1` once
   proven), then `sudo bash /srv/callflow/deploy/backup.sh` and look for
   `offsite: pushed with '<tool>' → <dest>`. See RUNBOOK §13.3. The
   script is live (e815fbb, 2026-10-28); the unit still needs a reinstall.
   First command: `ssh root@45.76.252.174 "ls -l /etc/callflow/backup.env 2>&1"`

3. **Step 4 — Clean 64-char WEBHOOK_SECRET.** Canonical secret is 48
   chars (`4b33…`); replace with a clean 64-char value and update the
   Dograh dashboard webhook header to match (mind the cutover order).
   First command: `openssl rand -hex 32` — paste the value straight into the ssh stdin-append; never print it in chat

4. **Step 5 — Firebase push (FCM) setup.** Service-account key + FCM
   wiring for owner push (webhook currently logs "no FCM token
   registered").
   First command: `ssh root@45.76.252.174 "grep -Ec '^FIREBASE_|^FCM_|^GOOGLE_' /srv/callflow/.env || true"`
   (prints a count only)

5. **Step 6 — Recording + transcript in the dashboard.** Surface the
   recording link and full transcript per call in `/app`.
   First command: `grep -rn "recording" src/app src/lib migrations/schema.sql | head -30`
   (map what already exists before coding)

6. **Step 7 — Scope contacts + settings per business.** Contacts and
   settings tables are single-row globals; scope them per business
   (multi-tenant correctness before promoting).
   First command: `grep -n "contacts" migrations/schema.sql`
   (see the current single-row shape)

## NEXT (week-1 — owner to confirm/add)

7. **Reinstall the backup unit (its code is already live)** — `deploy/backup-offsite.sh` +
   `deploy/backup.sh` + `deploy/systemd/callflow-backup.service`
   (`EnvironmentFile=-/etc/callflow/backup.env`) via
   `.clinerules/workflows/deploy.md`, then reinstall the unit
   (`daemon-reload`) — the scripts themselves already shipped to
   prod on 2026-10-28 (`e815fbb`). Unblocks NOW item 2.
8. **Retire the `/opt/callflow` decoy (NEEDS EXPLICIT OWNER OK — archive,
   never delete).** Old install + `/opt/callflow/data` + 16 decoy backups in
   `/opt/callflow/backups` + the `/etc/cron.d/callflow-backup` entry that
   keeps writing them. Live tree is `/srv/callflow`; live DB
   `/var/data/callflow.db`.
   First command: `ssh root@45.76.252.174 "cat /etc/cron.d/callflow-backup"`
9. **Key rotation runbook** — documented rotate procedure for
   WEBHOOK_SECRET, BUSINESS_SESSION_SECRET, ADMIN_SESSION_SECRET
   (including the Dograh dashboard cutover order).
10. *Owner's week-1 list goes here (monitoring, backups, docs, …).*
11. **Admin "Create customer" follow-ups (owner decisions, none blocking).**
    (a) number-pool dropdown for the assigned-number field (today: plain E.164
    text, strict `+1` + 10 digits); (b) decide whether the admin-entered owner
    email should keep filling `notificationEmail` (it now does, so call alerts
    work immediately) or stay billing-only like self-signup; (c) decide when to
    remove the self-serve path — still present and untouched: `/onboarding`
    wizard + `POST /api/billing/signup`, `/setup` (redirect only),
    `/api/onboarding/{start,state,step}`, `/checkout/return`, `/pricing`.
    **Nothing gets deleted without explicit owner approval.**

## LATER (the rest)

9. **Dev-leftover cleanup (inert)** — `watchpack` dev-workaround dep in
    package.json (inert at runtime); `scripts/wf-*.ts` scratch files
    (never committed per rules).

## DONE

- **2026-10-28** — **Deployed the admin create-customer work: LIVE at `bb338ab`.**
  Owner-approved `deploy.md` run. Feature commit `6fd29c9`, docs commit
  `bb338ab`, pushed `e815fbb..bb338ab`. Detached VPS run logged to
  `/var/log/callflow-deploy-bb338ab.log` → dirty-tree check ok → `npm ci` +
  `next build` → restart → health gate `/pricing` 200 + dograh health 200 →
  `Deployed bb338ab successfully` (no rollback). Live DB migrated itself at
  boot: `owner_login_tokens` + `businesses.ownerName` present — **no migration
  command needed**. Prod checks: anon `/admin/customers` 307, anon
  `POST /api/admin/customers` 401, `/owner-login?token=…` bad token 400.
  Webhook matrix all as expected (405/401/401/400/400/200, replay delta 0) with
  `calls` 11 → 11 — the probe number matches no `assignedNumber` so nothing was
  stored, i.e. **no test rows to clean**. Follow-up noticed: the pre-commit hook
  wants gitleaks on PATH (currently skipped with a warning).

- **2026-10-28** — **Admin "Create customer" (admin-only, no payment; nothing
  pushed).** New page `/admin/customers` (nav link added) + "Create customer"
  form → `POST /api/admin/customers` → `src/lib/admin-customers.ts`
  `createAdminCustomer()`: one synchronous SQLite transaction writes the
  business (same columns/defaults as `createBusiness` in `db.ts`, so the row is
  identical to a self-signed-up one) **and** the one-time login token
  (`owner_login_tokens`, sha256 hash only). Trial starts now (3 days, same as
  `activate-pilot.cjs`: `subscriptionStatus='active'`, `trialStartedAt=now`,
  `dodoSubscriptionId='sub_local_pilot_<ts>_<hex>'`), `onboardingStep='done'`
  (so the login lands on /app, not the wizard), `assignedNumber` from the typed
  E.164 number (409 if another business uses it; pool entry claimed/release-able
  afterwards). Login is a **link, not a password**: `GET /owner-login?token=…`
  consumes it once, mints the existing `callflow_business_session` cookie
  (business-session.ts untouched) and redirects to /app; 7-day expiry. Schema
  additions: `businesses.ownerName` (nullable, `BUSINESS_ADDED_COLUMNS`) +
  `owner_login_tokens` (created at boot by `migrations/schema.sql`, so **no
  migration command**). Verified end-to-end on a throwaway DB: 201 create,
  409s (number / name / owner phone), 400s (field + format), 307→/app with the
  session cookie, second use of the same link 400, anon 401/307→/admin, owner
  cookie can't open /admin, `/api/me` = `trialing`/entitled. Gates:
  `tsc --noEmit` exit 0, `eslint` 0 errors, `npm test` 303/303, `npm run build`
  exit 0. Dograh webhook, call logging and `assignedNumber` routing untouched.

- **2026-10-28** — **Production deploy of the 6 pending commits: LIVE at
  `e815fbb`.** Owner-approved 4-step run. Pre-deploy backup
  `callflow-pre-deploy-20261028-061208.db` (155,648 B, `integrity_check` ok,
  calls=11 / businesses=14, `600 callflow:callflow` — matches the two existing
  pre-deploy dumps). Push `4c50580..e815fbb` (all 6 in order:
  `38fbef9`→`5bf4f3b`→`ca9ecab`→`b89a724`→`0d50364`→`e815fbb`); parity restored
  (`origin/main..HEAD` = 0). `deploy/vps-deploy.sh` → `Deployed e815fbb
  successfully`, no rollback, its gate `/pricing -> 200`,
  `/api/webhooks/dograh/health -> 200`. Post-deploy checks: `/pricing` 200,
  health `{"ok":true,"calls":11}` (public https + localhost), `/onboarding`
  200, Numbers route compiled into the build
  (`admin/(protected)/numbers/page.js`) behind the `/admin/numbers` 307 auth
  gate; `/setup` now 307→`/onboarding`. Pre-flight gates re-run green
  (`npm test` 303/303 — yesterday's `telnyx-answer` flake did not recur —
  and `npm run build` exit 0). Remainder: reinstall `callflow-backup.service`
  with `EnvironmentFile=` (NEXT 7) so the nightly off-site push activates.
- **2026-10-27** — **Pre-deploy repo cleanup (deploy held on owner's call —
  no push, no deploy, no DB backup taken).** Tree before: 4 unpushed commits
  (`38fbef9`→`b89a724`), a staged-but-orphaned settings WIP (4 files,
  +208/−260: `saveClientSettings` loses `address`, SettingsPanel rewritten,
  `tsc` clean, no settings tests exist), modified tracked `scripts/wf-11661.ts`,
  and 7 untracked scratch scripts. Actions: stashed the settings WIP
  (`stash@{0}`, recoverable — `git stash pop`), restored `scripts/wf-11661.ts`
  (copy kept at `%TEMP%\wf-11661.ts.bak`), added `/scripts/wf-*` to
  `.gitignore`, committed the off-site backup work locally as `0d50364`
  (deploy/backup-offsite.sh + backup.sh + backup unit + RUNBOOK §13) and
  `.gitignore` as `e815fbb`. `origin/main` still `4c50580` — **6 commits now
  await an approved push**. Residual dirt: `BACKLOG.md`/`docs/DAILY_LOG.md`
  (housekeeping) + untracked `scripts/dodo-env-setup.sh` (unclassified).
  Pre-flight note: full `npm test` flaked once on `telnyx-answer.test.ts`
  (beforeAll >10s hook timeout under 33-suite load; 6/6 standalone in 7.1s,
  no assertion failed) — re-run at go-time.
- **2026-10-27** — **Production audit + off-site backups (plan items 1+2):**
  read-only SSH probe confirmed service active (`NRestarts=0`), nginx, TLS to
  2027-01-20, `/pricing` 200, dograh health `{"ok":true,"calls":11}`, live DB
  `integrity_check` ok (11 calls / 14 businesses, last call 2026-10-27T07:58Z),
  `assignedNumber` column live, backup timer green, disk 22% used. Off-site gap
  closed in code: new `deploy/backup-offsite.sh` (auto|rclone|aws|rsync|cp;
  `OFFSITE_DEST` / `OFFSITE_REQUIRED` / `OFFSITE_PRUNE`; credentials in a
  root-only `/etc/callflow/backup.env` loaded by the unit's
  `EnvironmentFile=-`), invoked as the last step of `deploy/backup.sh`;
  RUNBOOK §13.1–13.3 (snapshot layout, restore, off-site setup table).
  Validated on the VPS from a /tmp copy: real DB → 8900-byte zstd snapshot →
  cp push exit 0; the pushed copy `integrity_check` ok; unset dest = notice +
  exit 0; missing/unknown tool and missing backup root exit 1 only under
  `OFFSITE_REQUIRED=1`; production `/var/backups/callflow` md5 unchanged.
  Two footguns found and written into activeContext.md: the live DB is
  `/var/data/callflow.db` (NOT `/opt/callflow/data`), and a leftover
  `/etc/cron.d/callflow-backup` still backs up that dead `/opt` DB daily.
  Not committed, not deployed (script + unit install ride the next approved
  deploy).
- **2026-10-27** — **Dodo dashboard webhook registration: CLOSED** (was NOW
  item 2). The VPS journal shows `subscription.updated` applied at
  2026-10-27 10:54 UTC, so the production endpoint is registered and firing;
  no dashboard-side work remains.
- **2026-10-27** — **Per-business assigned CallFlow numbers:** nullable
  `businesses.assignedNumber` (schema.sql + BUSINESS_ADDED_COLUMNS
  migration + types.ts + db.ts create/update); admin PATCH
  `/api/admin/businesses/[id]` (E.164 validation, 409 vs any OTHER
  business's assignedNumber OR phoneNumber, self re-save allowed, empty
  value clears, audit-logged `business_assigned_number_set`) +
  EditBusinessForm + detail-page row; `/api/setup/config` serves the
  signed-in owner's assigned number first, shared-DID fallback unchanged;
  CarrierForwardingStep shows the owner's number on the instruction card
  (variant A). Protected Dograh surface changed with explicit owner
  approval ONLY in matchDograhBusiness: assignedNumber matched FIRST,
  then the unchanged phoneNumber match and single-business fallback; the
  Telnyx answer route inherits via the shared function. Tests: 10
  PATCH-route, 4 matcher, 3 setup-config, guard-safety covers PATCH.
  Full suite 317/317; tsc clean; next build green. Deployed same day with
  owner approval + conditions: pre-deploy sqlite3 .backup to
  /var/backups/callflow/callflow-20261027-053441.db (144 KiB, 600,
  callflow-owned, integrity ok), commit 4c50580 pushed, vps-deploy.sh
  green, post-deploy roundtrip proved both match paths live
  (assignedNumber → throwaway test-biz-rt-1; shared DID → CallFlow row
  TE-0ed336c7), then all test-% call rows + the throwaway deleted
  (businesses 13→14→13; calls 9→11→7 — the −2 are the old test-deploy
  probes; real calls untouched at 7). All checks green.
- **2026-10-26** — **Checkout-401 fix (pre-created businesses):** the
  /setup flow pre-creates the business row in Step 1, so
  /api/billing/signup treated it as "existing" and minted no session →
  /api/billing/confirm returned 401 right after a successful payment.
  Fixed with a signed checkout-bound handoff cookie (new
  `src/lib/signup-handoff.ts`: HMAC-SHA256 over BUSINESS_SESSION_SECRET,
  domain-separated, 30-min expiry): signup sets it only for an existing,
  not-yet-subscribed business, bound to the fresh checkout session;
  confirm accepts it only when it still matches the row's stored checkout
  session (and Dodo's redirect `session_id`), and converts it into a real
  session only after the webhook has linked a subscription — the phone
  number alone still grants nothing. 21/21 tests green (new
  signup-handoff + signup-route + confirm-route suites); lint 0 errors;
  tsc clean. Deployed same day with owner approval: full suite 300/300 +
  local build green → commit c134b8a pushed → vps-deploy.sh (npm ci,
  build clean, restart, health gate green). Post-deploy on the VPS:
  service active at c134b8a; unauthenticated POST /api/billing/confirm
  still 401 with the byte-identical body; Dograh matrix
  405/401/401/400/400/200, fresh insert calls 7→8, replay delta 0.
  Remaining: owner re-runs a production trial signup through /setup to
  verify end-to-end.
- **2026-10-26** — **Step 3 — Dodo keys on the VPS:** owner ran
  `bash scripts/dodo-env-setup.sh` (Git Bash only; WSL-shim gotcha
  documented in the header). Hidden prompts for API key + webhook
  secret, visible for product ID — values never on screen, in argv, or
  in chat. Timestamped backup → old `^DODO_` lines wiped → 5 vars
  appended unquoted with `$`→`\$` (loader-proven) →
  `callflow:callflow`/600 → restart gated on count==5 → smoke green:
  service active, /pricing 200, dograh health 200. Script untracked
  (commit only on owner word). Follow-up tracked as NOW item 2:
  register https://callflow.biz/api/webhooks/dodo in the Dodo
  dashboard + checkout smoke test.
- **2026-10-26** — **Step 1 — Stack-trace audit:** 3-day journalctl
  sweep, 7 distinct error signatures; only real production impact was
  the missing DODO_* env (2 failed signups) — fixed by Step 3 above;
  rest probe noise / one-off ENOENTs, marked harmless, no code changed.
- **2026-10-26** — MVP session started: BACKLOG rewritten as the 7-step
  priority list (NOW = steps 1–7); derived webhook results on
  /admin/system CONFIRMED by owner (Dograh handler untouched).
- **2026-10-23** — Admin panel Phases 1–5 complete (env + session, login
  page, APIs, pages, safety tests; 31 files / 275 tests green; zero
  owner-side files touched).
- **2026-10-23** — Dograh webhook rebuilt as ONE hardened endpoint
  (WEBHOOK_SECRET rename, constant-time auth, idempotent upsert keyed on
  dograhRunId, header-casing hardening).
- **2026-10-23** — VPS `.env` repair: 3 broken DOGRAH_WEBHOOK_SECRET lines
  replaced with the canonical 48-char key; systemd (not pm2) identified as
  the supervisor; `fix-and-deploy.bat` + `deploy/vps-deploy.sh` validated
  as the deploy path.