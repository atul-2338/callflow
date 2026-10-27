# Daily log

Newest entry on TOP. Add entries via `.clinerules/workflows/end-day.md`.

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

**Unfinished & stopped at:** staged file list shown to the owner; commit,
deploy (approved workflow) and the post-deploy curl matrix happen after
the owner's ok.

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

**Git state:** HEAD c134b8a (main == origin/main; deployed to VPS).
Uncommitted — this feature (16 code/test files) + the 2026-10-26
bookkeeping edits to BACKLOG.md/docs/DAILY_LOG.md; scratch
`scripts/wf-11661.ts` (M) + `scripts/wf-11658.ts` (??) and
`scripts/dodo-env-setup.sh` (??) stay unstaged (wf-* never committed;
dodo-env-setup.sh commits only on owner word).

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