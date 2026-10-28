# Daily log

Newest entry on TOP. Add entries via `.clinerules/workflows/end-day.md`.

## 2026-10-28 (task 7 — deploy of the admin create-customer work: LIVE at `bb338ab`)

**Owner-approved** (`.clinerules/workflows/deploy.md` run; the approval covered
the `git push`). Two local commits: **`6fd29c9`** `feat(admin): create customer
+ one-time owner login link (no payment, 3-day trial)` (12 files: the 6 new
source files, `migrations/schema.sql`, 3 additive lib edits + the admin nav
link) and **`bb338ab`** `docs: log the admin create-customer task and refresh
NOW/NEXT`. Staged by explicit path only — `scripts/dodo-env-setup.sh` left
untracked, no `.env*`, no `data/`. Pre-flight gates before committing: `npm test`
**303/303**, `npm run build` **ok**, and the tracked-diff secret scan clean (the
pre-commit hook warned `gitleaks not found on PATH. Skipping secret scan.` — the
manual scan stood in for it; treat this as a follow-up: install gitleaks).

**Push:** `e815fbb..bb338ab -> origin/main`.

**VPS run** (launched detached, then polled — a deploy outlives one tool call):
`ssh root@45.76.252.174 "sudo nohup bash /srv/callflow/deploy/vps-deploy.sh >
/var/log/callflow-deploy-bb338ab.log 2>&1 < /dev/null &"`. Log: dirty-tree check
passed → `fetch` + `reset --hard origin/main` → `npm ci` → `next build` ok →
restart → health gate `/pricing` 200 **and** `/api/webhooks/dograh/health` 200 →
**`==> Deployed bb338ab successfully.`** (no rollback).

**Post-deploy checks on the VPS:** `systemctl is-active callflow` = active;
`git -C /srv/callflow rev-parse --short HEAD` = `bb338ab`; local health
`{"ok":true,"calls":11}`; `https://callflow.biz/api/webhooks/dograh/health` 200
(nginx + TLS).

**Schema migrated itself on the live DB** (`/var/data/callflow.db`) — no manual
command: `.tables` now lists `businesses`, `calls`, `owner_login_tokens`;
`pragma table_info(businesses)` contains `ownerName`;
`owner_login_tokens` = `id, businessId, tokenHash, createdAt, expiresAt, usedAt`
(unique `tokenHash`, index on `businessId`).

**New surfaces reachable on prod:** anon `/admin/customers` → **307** (`/admin`
login), anon `POST /api/admin/customers` → **401**, `/owner-login?token=deadbeef`
→ **400** (unknown token, no session minted).

**Webhook matrix (secret read from `/srv/callflow/.env` into a shell var; value
never printed — only `len=65`):** GET → **405**, POST no secret → **401**, wrong
secret → **401**, bad JSON → **400**, missing `callId` → **400**, good payload →
**200**; identical replay → **200** with **replay delta 0**. `calls` stayed
**11 → 11**: the probe's `called_number=+15550001111` matches no
`assignedNumber`, so the webhook correctly declined to store it — **zero junk
rows**, and `clear-test.cjs` consequently deleted 0. Nothing to clean up.
Journal tail clean (only the two restarts + the probe lines).

**Not done, on purpose:** no admin-authenticated create was run against prod
(that would write a real business row) — the owner does that in the UI; no DB
writes beyond the matrix; no nginx/`/opt/callflow` touching. Uncommitted after
this entry: **nothing** (this entry is committed and pushed in `origin/main`,
so `origin/main` is one docs commit ahead of the deployed `bb338ab` — code
parity is exact, docs never ship).

## 2026-10-28 (task 6 — admin "Create customer", admin-only, no payment)

**Done:** admin page `/admin/customers` (nav link added to AdminPanelShell) with
a "Create customer" form (business name, owner name, owner email, owner phone,
assigned number as plain E.164 text) and a list below it (business name +
clientUid + owner name, assigned number, trial end, last call, "Copy new login
link" per row).

**How it reuses onboarding:** inspected the self-serve path first —
`POST /api/billing/signup` → `createBillingSignup()` (`src/lib/billing.ts`) →
`createBusiness()` (`src/lib/db.ts`) is the ONLY place a business row is born.
There is **no `users` table and no owner password**: an owner session is the
HMAC-signed `callflow_business_session` cookie minted by that route. So
`src/lib/admin-customers.ts` writes the same row in the same table (mirroring
`createBusiness`'s INSERT column-for-column, with `onboardingStep='done'`
because the admin-created customer already has a number), sets `assignedNumber`
from the typed number, and starts the 3-day trial exactly like
`scripts/activate-pilot.cjs` (`subscriptionStatus='active'`,
`trialStartedAt=now`, local `sub_local_pilot_<ts>_<hex>` marker — never a real
Dodo id). No payment, no Dodo call.

**Decisions (owner asked which):** chose the **one-time login link**, not a
temporary password — the link mints the existing session cookie, so no new
credential machinery was invented. Link: `/owner-login?token=…`, 256-bit random
token stored **sha256-hashed only**, single use (atomic conditional UPDATE),
7-day expiry, redirects to the owner dashboard `/app`. Re-minting never
invalidates an older unexpired link. Atomicity: business row + login token in
ONE `db.transaction(...).immediate()`; the duplicate-number check is repeated
inside it, so concurrent creates cannot double-assign. The pool FILE is synced
after the commit (mirrors onboarding's "row first, then pool"; a failure is
logged loudly and never fails the create, since Dograh routes by
`businesses.assignedNumber`).

**Schema:** added `businesses.ownerName` (nullable, via `BUSINESS_ADDED_COLUMNS`)
because the requested owner name had no column; new table `owner_login_tokens`.
`migrations/schema.sql` is exec'd at boot, so **no migration command** — a
restart applies it (verified on a fresh DB: table present).

**Problems found / avoided:** (1) `authorize`-free `VACUUM`-style shortcuts —
n/a, but note the pre-check + in-transaction check duplication is intentional;
(2) strict E.164 for the assigned number (`+1` + 10 digits) while the owner
phone stays lenient (`normalizeOwnerPhone`), matching the pool/onboarding split;
(3) an owner's personal phone number can never be assigned as a CallFlow number
(`findNumberOwner` checks `phoneNumber` too, mirroring `addNumbers`).

**Verified (throwaway DB via `next start` on :3100, temp `DATABASE_PATH` /
`NUMBERS_POOL_PATH`, removed afterwards; real `data/callflow.db` untouched):**
create → 201 (`TE-44a0c478`, `+15550100001`, trial now → +3 d, phone
`(928) 331-9394` → `+19283319394`, email lowercased); 409 on number / name
(case-insensitive) / owner phone; 400 on bad number, bad email, missing owner
name; `/admin/customers` 200 with the row, anon 307→`/admin`, API without the
admin cookie 401; owner cookie cannot open `/admin` (307); link use #1 →
307 `/app` + `callflow_business_session`, use #2 → 400, bogus token → 400;
`/app` 200 (no onboarding redirect) and `/api/me` = `{"state":"trialing",
"entitled":true}`; DB shows exactly 1 business (rejects wrote nothing), token
hashes 64 hex chars with the consumed one carrying `usedAt`; pool file holds the
number as `assigned`. Gates: `tsc --noEmit` exit 0, `eslint` 0 errors (15
pre-existing warnings), `npm test` 303/303, `npm run build` exit 0.

**Untouched by design:** Dograh webhook, call logging, `assignedNumber` routing,
`src/lib/business-session.ts` (its existing helpers are used, never modified),
the Dodo billing path, and the whole self-serve onboarding flow — nothing was
deleted.

**Git state:** nothing committed or pushed; uncommitted: `migrations/schema.sql`,
`src/lib/database.ts`, `src/lib/types.ts`, `src/lib/numbers-pool.ts`,
`src/lib/admin-customers.ts`, `src/components/admin/{AdminPanelShell,
CreateCustomerForm,NewLoginLinkButton}.tsx`,
`src/app/admin/(protected)/customers/page.tsx`,
`src/app/api/admin/customers/**`, `src/app/owner-login/route.ts`,
plus the memory files (`BACKLOG.md`, `docs/DAILY_LOG.md`); pre-existing
untracked `scripts/dodo-env-setup.sh` untouched.

## 2026-10-28 (task 5 — prod DB test-data cleanup, data only)

**Done:** removed test data from the LIVE database only — `/var/data/callflow.db`
on `root@45.76.252.174`. Predicate (case-insensitive): `id` / `clientUid` /
`billingName` contains `test` or `demo`. **`billingEmail` was deliberately
EXCLUDED from the predicate** — three real pilot rows have emails ending in
`@test.com` (`Alex Plumbing` alex@test.com, `Dynamic Plumbers` dyna@test.com,
`Rex Plumbing` rex@test.com, the last with `subscriptionStatus=active` and a
live `assignedNumber=+17373014448`), and matching on email would have deleted
them.

Order of operations: (1) pre-op snapshot
`sqlite3 /var/data/callflow.db "VACUUM INTO /var/backups/callflow/callflow-pre-testdata-clean-20261028-075624.db"`
→ 155,648 B (`chmod 600`, root:root, matching the existing pre-deploy dumps),
snapshot `integrity_check` = `ok`, snapshot counts businesses=14 / calls=11 —
proving the 486 KB WAL was captured; (2) scope guard that **aborts unless
exactly 1 business and 0 calls match**; (3) the delete, as the app user, in one
transaction: `sudo -u callflow sqlite3 -cmd ".timeout 5000" "$DB" "BEGIN
IMMEDIATE; DELETE FROM calls WHERE <call pred> OR businessId IN (SELECT id FROM
businesses WHERE <biz pred>); DELETE FROM businesses WHERE <biz pred>; COMMIT;"`.

**Before → after:** `businesses` **14 → 13**, `calls` **11 → 11** (no call row
ever existed for the removed business; zero calls matched the predicate).
Removed exactly one row: `090c2d05-64c0-4761-9a2e-8692b48df58c` /
`TE-0926c702` / "Test Plumbers" / test@test.com / `pending_checkout`, no Dodo
ids, no `assignedNumber`. Post-checks: live `PRAGMA integrity_check` = `ok`,
0 leftover rows matching the predicate, all 13 remaining rows intact (incl. the
3 active subscriptions above), `/var/data/callflow.db*` still owned
`callflow:callflow`, and `GET /api/webhooks/dograh/health` →
`{"ok":true,"calls":11}`.

**Unfinished & stopped at:** the local dev DB (`f:\callflow\data\callflow.db`)
was NOT touched by owner's choice — it still holds 6 test/demo businesses out of
41 ("Test Co" + 5× "Browser Test"). No code, schema, or config change.

**Problems found:** the first attempt died at the snapshot —
`VACUUM INTO` run as `sudo -u callflow` returned `unable to open database … (14)`
because `/var/backups/callflow` is `root:root 0755`. `set -e` aborted the script
DURING the snapshot step, i.e. **before** any delete, so nothing was removed;
re-ran the snapshot as root. Second finding: `businesses` has no `name` column —
`billingName` is the display name, and matching "name" loosely (email included)
is dangerous on this DB.

**Git state:** memory files only (this log + activeContext.md); nothing staged
or committed.

## 2026-10-28 (task 4 — production deploy: the 6 pending commits are LIVE)

**Done:** all four approved steps, in order. (1) **DB backup** — the owner's
exact command: `sqlite3 /var/data/callflow.db ".backup
/var/backups/callflow/callflow-pre-deploy-20261028-061208.db"` → the new
155,648-byte dump (live main file is 147,456 B, so the 486 KB WAL was captured:
`calls=11 businesses=14`, `PRAGMA integrity_check` = `ok`), then `chmod 600` +
`chown callflow:callflow` to match the two existing pre-deploy dumps.
(2) **Push** — `git push origin main` sent all 6 commits in order
(`38fbef9` → `5bf4f3b` → `ca9ecab` → `b89a724` → `0d50364` → `e815fbb`);
`4c50580..e815fbb  main -> main`, and `origin/main..HEAD` is now 0.
(3) **Deploy** — `bash /srv/callflow/deploy/vps-deploy.sh` logged
`HEAD is now at e815fbb` … `==> Deployed e815fbb successfully.` — the script's
own gate printed `/pricing -> 200   /api/webhooks/dograh/health -> 200`;
**no rollback**. (4) **Four health checks** — `/pricing` 200,
`/api/webhooks/dograh/health` `{"ok":true,"calls":11}` (both on the public
https URL and 127.0.0.1:3000), `/onboarding` 200, Numbers section present in
the deployed build (`/srv/callflow/.next/server/app/admin/(protected)/numbers/page.js`)
behind its auth gate `/admin/numbers` → 307 → `/admin`. Pre-flight gates were
re-run first: `npm test` **33/33 files, 303/303 passed** (the 2026-10-27
`telnyx-answer` flake did **not** reproduce) and `npm run build` exit 0.

**Unfinished & stopped at:** the off-site backup **unit** on the box still
`ExecStart=/usr/bin/bash /srv/callflow/deploy/backup.sh` with no
`EnvironmentFile=` (the systemd file in `/etc` is only replaced on reinstall),
so tonight's 03:15 UTC run executes the new `backup.sh` + `backup-offsite.sh`
but stays inert ("not configured", timer green). Reinstalling the unit is the
only remainder of NEXT item 7 — no other follow-up.

**Decisions:** took the dump exactly as the owner specified rather than via
`deploy/backup.sh` (produces a plain `.db` like the two existing pre-deploy
dumps, and `.backup` uses the SQLite backup API so it is WAL-safe on the live
file); ran the deploy detached (`nohup … > /var/log/cf-deploy.log`) and polled
the log, because `npm ci` + `next build` on the VPS outlives a single tool call;
`scripts/dodo-env-setup.sh` and `scripts/wf-11661.ts` deliberately left as-is
(owner: neither blocks anything).

**Verification:** prod HEAD `e815fbb`, `git status` clean, `callflow` active,
`callflow-backup.timer` active, journal tail shows a clean restart
(`Ready in 196ms`, then only the normal `[database] using DATABASE_PATH=` lines
— no errors); `/setup` now 307-redirects to `/onboarding`, confirming the new
flow replaced the legacy path. Scratch `/var/log/cf-deploy.log` and the local
`%TEMP%\cf*.log` captures removed. Local residual dirt: `BACKLOG.md` +
`docs/DAILY_LOG.md` (housekeeping) + untracked `scripts/dodo-env-setup.sh`.


## 2026-10-27 (task 3 — pre-deploy cleanup; deploy ON HOLD at owner's request)

**Done:** cleaned the tree so the pending push is safe, without pushing or
deploying anything. Stashed the orphaned settings WIP (staged, 4 files,
+208/−260) as `stash@{0}` — recoverable with `git stash pop`, nothing lost.
Restored the tracked scratch file `scripts/wf-11661.ts` (backup kept at
`%TEMP%\wf-11661.ts.bak` before the restore). Added `/scripts/wf-*` to
`.gitignore` — the 5 `wf-deploy-*.sh` + `wf-11658.ts` scratch files vanished
from `git status` (they were never committable). Committed the off-site backup
work locally as `0d50364` (deploy/backup-offsite.sh, deploy/backup.sh, the
backup unit's `EnvironmentFile=`, RUNBOOK §13) and `.gitignore` as `e815fbb`.

**Unfinished & stopped at:** nothing pushed, nothing deployed, no prod DB
backup taken — the deploy itself is the next approved task. `origin/main` is
still `4c50580`; local `main` is **6 commits ahead** (4 pre-existing + the 2
new), which is the exact list to push when approved.

**Decisions:** settings WIP → stash (not commit, not discard) because it
compiles (`tsc` exit 0) but is unreviewed and unrelated to the 4 commits on
deck; `scripts/wf-11661.ts` → restore (rules forbid committing `wf-*`, and a
stash of a never-committable file invites losing it); `.gitignore` rule rather
than `git rm --cached`, so the tracked `wf-11661.ts` stays put until someone
decides its fate. `/health` does **not** exist as a route — the real probe is
`/api/webhooks/dograh/health`; the Numbers section is `/admin/numbers` and the
new flow is `/onboarding`.

**Verification:** staged exactly the intended 4 paths (`git diff --cached
--name-only`) — no `.env*`, no `wf-*`; `git ls-files --eol` shows `deploy/**`
as `i/lf w/lf` with `attr/text eol=lf` (RUNBOOK.md is `i/lf w/crlf`, i.e. the
blob is LF and the working tree CRLF is normal for `.md` under
`core.autocrlf=true` — RUNBOOK staged as 92 changed lines, not 496, so there
is no line-ending churn); secret scan of both new commits = the only hit is
the RUNBOOK table row naming `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`
(placeholders, no values); `stash@{0}` confirmed to hold all 4 settings files;
prod untouched (`git -C /srv/callflow status --porcelain` empty, HEAD
`4c50580`).

**Git state:** HEAD `e815fbb` (local only). Ahead of `origin/main`
(`4c50580`): `38fbef9`, `5bf4f3b`, `ca9ecab`, `b89a724`, `0d50364`, `e815fbb`.
Dirty: `BACKLOG.md`, `docs/DAILY_LOG.md`. Untracked: `scripts/dodo-env-setup.sh`.

## 2026-10-27 (task 2 — production audit + off-site backup)

**Done:** plan items 1 and 2, in order. (1) Durable findings written into
`activeContext.md`: live DB is `/var/data/callflow.db` (from `DATABASE_PATH`),
NOT `/srv/callflow/data` and NOT the dead `/opt/callflow/data/callflow.db`;
backups are the systemd timer @ 03:15 UTC → `/var/backups/callflow/{daily,weekly}`
zstd (crontab empty by design); a leftover `/etc/cron.d/callflow-backup` still
snapshots that dead `/opt` DB into 16 decoy files in `/opt/callflow/backups`
daily; prod HEAD `4c50580` is 3 commits behind local `main` `89a724`
(`/onboarding`, Numbers page, assignedNumber-first matcher undeployed);
benign journal noise (stale Server-Action IDs, FCM "no token"). Also added the
CRLF-for-new-files and "never touch `/opt/callflow`" rules. (2) Off-site backup
gap closed in code: new `deploy/backup-offsite.sh` — tool-agnostic
(`auto|rclone|aws|rsync|cp`, auto-picked from the `OFFSITE_DEST` shape), reads
`OFFSITE_DEST`/`OFFSITE_REQUIRED`/`OFFSITE_PRUNE`, credentials never in the
repo — called as the last step of `deploy/backup.sh`; the unit gains
`EnvironmentFile=-/etc/callflow/backup.env` + an explicit
`PATH` and its stale "no secrets are read" comment was corrected; RUNBOOK §13
rewritten to 13.1 snapshot layout / 13.2 restore (incl. the "never restore from
`/opt/callflow/backups`" warning) / 13.3 off-site setup table + proof line;
smoke-checklist item and §15 commands updated.

**Unfinished & stopped at:** verified but NOT deployed — `deploy/*` changes sit
uncommitted; installing them (`/srv/callflow/deploy/*` + the unit +
`daemon-reload`) rides the next approved deploy. Owner-side completion of item 2
is NOW item 2 in BACKLOG (create the remote, write
`/etc/callflow/backup.env`, prove the push).

**Decisions:** off-site push is tool-agnostic with rclone recommended (single
static binary, speaks B2/S3/R2/SFTP, none of these tools is installed on the
box today); unconfigured dest must NOT fail the nightly unit (notice + exit 0),
`OFFSITE_REQUIRED=1` is the opt-in tripwire once the destination is proven;
`OFFSITE_PRUNE` defaults OFF so off-site copies survive a local-retention
mistake; credentials live in a root-only env file rather than root's shell env
(the old script comment suggested the latter). `/opt/callflow` + the decoy cron
were NOT touched — that needs explicit owner approval (NEXT item 8).

**Problems found:** the live-vs-dead DB-path confusion and the decoy backup set
(above) — both now documented; `/opt/callflow/backups/*.db` are October-era
snapshots of a DB that is no longer in use, and their existence next to the real
set is a plausible "restored the wrong file" trap. Everything else on the box
was healthy (service `NRestarts=0`, TLS to 2027-01-20, `/pricing` 200, health
`{"ok":true,"calls":11}`, live DB `integrity_check` ok, disk 22%).

**Verification:** `bash -n` clean on both scripts; LF confirmed on every
`deploy/**` file (the editor wrote the new script CRLF — converted before
staging, `.gitattributes` pins LF for `deploy/**`, `*.sh`, `*.service`); 10-case
run on the VPS from `/tmp/cf-bk-test` (removed afterwards): real live DB →
8900-byte `.zstd` snapshot → `cp` push exit 0; the off-site copy decompressed,
`PRAGMA integrity_check` = ok, calls=8 / businesses=12 (the 03:15 snapshot);
dest unset = notice + exit 0; rclone missing = exit 0 (`REQUIRED=0`) / exit 1
(`REQUIRED=1`); unknown tool + missing root = exit 1; `OFFSITE_PRUNE=1` on the
`cp` path = exit 0; production `/var/backups/callflow` unchanged (3 files,
original sizes/mtimes, md5 identical). No secret value printed at any point.

**Tomorrow's first 3:** (1) owner: /admin live-test roundtrip (closes Step 2);
(2) owner: off-site backup destination + prove the push (NOW item 2, needs the
code deployed — NEXT item 7); (3) owner: re-run a production trial signup
through `/setup`.

**Git state:** HEAD `89a724` (main; VPS is on `4c50580` — undeployed).
Uncommitted: `deploy/backup-offsite.sh` (new), `deploy/backup.sh` (M),
`deploy/systemd/callflow-backup.service` (M), `RUNBOOK.md` (M), plus memory
files `activeContext.md`, `BACKLOG.md`, `docs/DAILY_LOG.md`, and the earlier
`settings/**` edits. Nothing staged, nothing committed.

## 2026-10-27

**Done:** per-business assigned CallFlow numbers implemented (owner ok +
variant A + explicit approval for the protected Dograh matcher only).
Nullable `businesses.assignedNumber` (migrations/schema.sql +
BUSINESS_ADDED_COLUMNS in src/lib/database.ts, types.ts, db.ts
create/update). Admin PATCH /api/admin/businesses/[id]: E.164 via
toE164InternationalPhone; 409 when the value collides with any OTHER
business's assignedNumber OR phoneNumber (self allowed — the CallFlow row
can re-save its DID-as-phoneNumber); empty string clears to NULL; audit
row `business_assigned_number_set` with previousAssignedNumber. New
EditBusinessForm + "Assigned CallFlow number" row on the admin detail
page; guard-safety.test.ts covers the real-guard 401s for the new route.
/api/setup/config resolves the owner via businessIdFromCookieHeader
(read-only import from the protected business-session.ts) and serves the
business's assignedNumber when set (leading "+" re-checked), else the
unchanged shared-CALLFLOW_FORWARDING_DID path; CarrierForwardingStep
renders the owner's number on the instruction card via the now-exported
formatForwardingDid (variant A). Dograh (explicit approval, matcher only):
matchDograhBusiness matches called_number against assignedNumber FIRST
(normalizePhone, same normalization as the legacy path), then the
untouched getBusinessByPhone phoneNumber match, then the untouched
single-business fallback; auth/parse/idempotency/push/response codes
untouched; the Telnyx answer route calls the same function so it inherits
the two-step match (only its comments updated). New tests: 4 matcher
cases (assigned match; two businesses route independently; empty
called_number unlinked with several businesses; legacy behavior unchanged
when no assignedNumber anywhere), 10 PATCH-route cases, 3 setup-config
cases. Verification: npx tsc --noEmit clean; npm test 35/35 files,
317/317 green; npm run build green (/api/admin/businesses/[id] in the
route manifest; the Turbopack tracing warning on database.ts is
pre-existing).

**Unfinished & stopped at:** deployed and verified (see below); the
remaining proof for real attribution is admin assigning actual DIDs per
business.

**Deploy (owner-approved, 4 conditions, all met):** docs scanned for
secrets/tokens/keys/phone numbers pre-commit — 0 hits across 8 pattern
classes in both files. Pre-deploy sqlite3 `.backup` of the live DB →
`/var/backups/callflow/callflow-20261027-053441.db` (147456 bytes, mode
600, callflow:callflow, integrity ok; 13 businesses / 9 calls at that
moment). Commit 4c50580 pushed (18 files, +846/−44; local gitleaks hook
absent — manual scan was the secret gate). vps-deploy.sh green
(reset --hard → npm ci → build → restart; /pricing 200, dograh health
200 TLS + local, service active). Post-restart: `assignedNumber` column
present (pragma_table_info), /admin 200 (sign-in form),
/admin/businesses/[id] 307 → /admin signed-out (guard engages; route
exists — authenticated render awaits the owner's live-test). Roundtrip
(throwaway only — no real business touched): INSERT test-biz-rt-1
(clientUid TE-TEST0001, assignedNumber +15555550123, a 555-01xx fake);
callId test-assigned-rt-1 with called_number +15555550123 → 200 and
businessId=test-biz-rt-1 (assignedNumber-first branch live); callId
test-shared-rt-1 with the shared DID → 200 and businessId=CallFlow row
86ea3ad5 (TE-0ed336c7) — legacy shared-number linkage intact. FCM tokens
registered = 0 → no push side effects; webhook sends no email by design.
Cleanup: npm run clear-test (as callflow user, DATABASE_PATH pinned)
deleted 4 test rows (the 2 roundtrip + 2 old test-deploy probes from
2026-10-26), throwaway business deleted by exact id → businesses
13→14→13, calls 9→11→7 (7 real call rows unchanged before/after; the −2
versus the 9 baseline are the old test-deploy probes — every test-% row
now gone, 0 remaining in calls and businesses). journalctl clean (boot
Ready 196ms, both test POSTs logged 200, push-skip notice = known Step 5
item).

**Decisions:** empty PATCH value clears the assignment (natural inverse,
kept minimal); 409 compares against both assignedNumber and phoneNumber of
other businesses per owner instruction; no new DB index (matching already
full-scans 13 rows); the operator warning in matchDograhBusiness now
points at assignedNumber first.

**Problems found:** two unrelated files hit vitest timeouts under
full-suite parallel load on the first run (setup-config first test +
telnyx-answer beforeAll — Windows cold-transform contention); both passed
in isolation and on the full rerun; no code cause.

**Tomorrow's first 3:** (1) owner ok → commit + deploy via the approved
workflow + post-deploy curl matrix (Dograh 405/401/401/400/200 + an
assigned-number roundtrip through the admin UI); (2) admin assigns real
DIDs per business; the CallFlow row's phoneNumber correction stays a
separate approved task; (3) owner-side NOW items unchanged (trial signup
re-run, Dodo dashboard webhook, /admin live test).

**Git state:** HEAD 4c50580 (main == origin/main; deployed to VPS,
health gate green). Uncommitted — this deploy's bookkeeping edits to
BACKLOG.md/docs/DAILY_LOG.md; scratch `scripts/wf-11661.ts` (M),
`scripts/wf-11658.ts` (??), `scripts/wf-deploy-*.sh` (?? — this deploy's
scratch) and `scripts/dodo-env-setup.sh` (??) stay unstaged (wf-* never
committed; dodo-env-setup.sh commits only on owner word).

## 2026-10-26

**Done:** BACKLOG rewritten as the owner's 7-step MVP list (NOW = steps
1–7, NEXT = week-1, LATER = the rest); derived webhook results on
/admin/system CONFIRMED by owner (Dograh handler untouched). Step 1
(stack-trace audit) DONE — read-only sweep of `journalctl -u callflow`
(3-day window: 556 lines, 104 error-matching, 7 distinct signatures;
quiet since Oct 24 05:18). Verdicts: 100× Server-Action probe noise
(no "use server" — rejected before any route); 2× `[dodo-billing] signup
failed` = REAL checkout impact (missing DODO_* env — fixed later today,
see Step 3); 2× one-off ENOENT in the Oct 24 05:18 deploy window —
self-resolved, harmless. No code changed.

Step 2 shipped (owner-approved deploy run): b7737fb pushed to origin and
deployed — dirty-check OK, `npm ci` 627 pkgs, build clean, systemd
restart, health gate green (/pricing 200, dograh health 200).
ADMIN_PASSWORD_HASH + ADMIN_SESSION_SECRET present on the VPS
(`/admin` renders the sign-in form; no fail-closed 404); `/admin/login`
308 as designed; Dograh curl matrix as expected (405 / 401 no-secret /
401 wrong-secret / 400 bad JSON / 200 ok, replay idempotent, calls
3→4 delta 0). Remaining for Step 2: owner live-test roundtrip
(sign-in, overview, create-business, logout) + optional nginx allowlist.

Step 3 DONE — owner ran `bash scripts/dodo-env-setup.sh` (Git Bash;
2 hidden `read -s` prompts + 1 visible; values never on screen, in
argv, or in chat): timestamped backup → old `^DODO_` lines wiped → 5
vars appended unquoted with `$`→`\$` (@next/env strips quotes before
dotenv-expand, so `\$` is the only safe escape) → `callflow:callflow`
/600 → restart gated on count==5 → smoke green: service active,
pricing 200, dograh health 200. Script validation: `bash -n` clean,
LF/no-BOM, 10/10 dummy-value self-tests; bare `bash` in PowerShell
resolves to the WSL shim (no distro) — documented in the script header,
fix is `"C:\Program Files\Git\bin\bash.exe" scripts/dodo-env-setup.sh`.

Checkout-401 fix DONE (owner task): POST /api/billing/confirm returned
401 {"error":"Unauthorized"} during signup/3-day-trial checkout whenever
the business row pre-existed — /setup pre-creates it in
/api/onboarding/start, and /api/billing/signup deliberately mints its
session cookie only for newly created rows (the earlier F-02 anti-takeover
fix). Fix: signed checkout-bound handoff cookie — new
`src/lib/signup-handoff.ts` (HMAC-SHA256 over BUSINESS_SESSION_SECRET,
domain-separated, 30-min expiry, HttpOnly/SameSite=Lax); signup sets it
only for an existing not-yet-subscribed business, bound to the fresh
checkout session; confirm accepts session OR handoff, requiring the
token's business + checkout session to match the row (and Dodo's redirect
`session_id` when the browser sends it), and mints the full session only
after the webhook write path has linked a subscription — then clears the
handoff. CheckoutReturn sends the redirect `session_id` in the confirm
POST body. Webhook stays the source of truth; `?status=` grants nothing;
business-session.ts, the Dodo webhook route, and src/lib/dodo.ts
untouched. Tests 21/21 green (signup-handoff.test.ts,
signup/route.test.ts, confirm/route.test.ts; Dodo SDK mocked in the
signup suite); npm run lint 0 errors (21 pre-existing warnings in files
untouched by this change); npx tsc --noEmit clean. Owner approved deploy
same day: full suite 300/300 + local next build green → commit c134b8a
(9 files, +965/−66) pushed to origin/main → vps-deploy.sh: npm ci 627
pkgs, build clean, systemd restart, health gate green. Post-deploy on
the VPS: service active at c134b8a, /pricing 200, dograh health 200 (TLS
too), unauthenticated POST /api/billing/confirm → 401 with the
byte-exact body; Dograh matrix 405 / 401 no-secret / 401 wrong-secret /
400 bad JSON / 400 missing callId; GOOD 200 — test-deploy-3 upserted the
existing probe row (calls stayed 7); fresh test-deploy-4 insert moved
calls 7→8 and its replay stayed 8 → delta 0 (idempotent upsert proven).
journalctl tail clean (no errors; probe rows stored UNLINKED as
expected; "no FCM token" notice is the known Step 5 item). Probe rows
test-* remain in the DB, cleanable later via the repo clear-test script
run as the callflow user.

**Unfinished & stopped at:** checkout-401 fix deployed (c134b8a) and
verified via the health matrix; the production end-to-end proof is the
owner re-running a trial signup through /setup. Step 2 still open at the
owner live-test roundtrip; Dodo dashboard webhook registration (NOW item
2) is owner-side.

**Decisions:** derived webhook results CONFIRMED (owner, 2026-10-26).
DAILY_LOG uses the correct date from today onward. Step 3 delivered as
an owner-run script so secrets are typed only by the owner.

**Problems found:** DODO_* missing on the VPS → RESOLVED today (root
cause of the 2 `[dodo-billing] signup failed` lines; expect no new
occurrences). Checkout-401 root cause: pre-created business row → no
session cookie → confirm 401 — FIXED (above). Out of scope, kept open:
phone rows stored without the leading "+" never match signup's E.164
lookup (audit F-09 duplicate-row bug). Optional hardening (not
scheduled): nginx 403 for POSTs carrying a Next-Action header.

**Tomorrow's first 3:** (1) owner: re-run a production trial signup
through /setup end-to-end (fix is live as c134b8a — the checkout return
page should go green and land on the dashboard); (2) owner: register
https://callflow.biz/api/webhooks/dodo in the Dodo dashboard
(Developer → Webhooks; subscribe `subscription.*` + `payment.*`) and run
the checkout smoke test; (3) owner: /admin live-test roundtrip to close
Step 2 — then Step 4 (clean 64-char WEBHOOK_SECRET + Dograh dashboard
header cutover, mind the order).

**Git state:** HEAD c134b8a (main == origin/main; deployed to VPS —
includes the checkout-401 fix; committed with owner approval via the
deploy workflow). Uncommitted leftovers:
`scripts/dodo-env-setup.sh` (new, untracked — commit only on owner word),
scratch `scripts/wf-11661.ts` (M) + `scripts/wf-11658.ts` (??) —
`scripts/wf-*.ts` never committed per rules — plus today's memory-file
edits (BACKLOG.md, docs/DAILY_LOG.md, activeContext.md).

## 2026-10-23

**Done:** Daily automation set up (no app code touched): `.clinerules/`
folder now holds `rules.md` (secrets, git, workflow, protected-surface
rules) next to the existing `focus.md`; new `workflows/start-day.md`,
`workflows/end-day.md`, `workflows/deploy.md`; `BACKLOG.md` created with
NOW/NEXT/LATER/DONE; this log started.

**Unfinished & stopped at:** automation setup complete; awaiting "next".

**Decisions:** start-day is strictly read-only, end-day is the only writer
besides the user's own tasks; deploy workflow requires explicit approval
and that approval covers the `git push` it needs; derived-deliveries
decision (webhook results on /admin/system read from
`calls WHERE dograhRunId IS NOT NULL`, Dograh handler untouched) still
pending user confirmation.

**Problems found:** none new. Open from before: 48-char WEBHOOK_SECRET
should be 64; DODO_* missing on the VPS; stack trace in the VPS journalctl.

**Tomorrow's first 3:** (1) admin Phase 6 deploy via
`.clinerules/workflows/deploy.md` after approval; (2) Dodo keys on the
VPS; (3) clean 64-char WEBHOOK_SECRET + Dograh header update.

**Git state:** all admin-panel work (Phases 1–5) plus today's workflow
files are uncommitted working-tree changes; nothing deployed; HEAD
unchanged.