# Daily log

Newest entry on TOP. Add entries via `.clinerules/workflows/end-day.md`.

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
untouched by this change); npx tsc --noEmit clean. On disk only — no
commit/push (rules); deploy needs owner approval.

**Unfinished & stopped at:** checkout-401 fix complete on disk, awaiting
owner approval to deploy (then a /setup trial re-run on production to
verify end-to-end). Step 2 still open at the owner live-test roundtrip;
Dodo dashboard webhook registration (NOW item 2) is owner-side.

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

**Tomorrow's first 3:** (1) owner: approve/deploy the checkout-401 fix
(`.clinerules/workflows/deploy.md` or fix-and-deploy.bat), then re-run a
production trial signup through /setup end-to-end; (2) owner: register
https://callflow.biz/api/webhooks/dodo in the Dodo dashboard
(Developer → Webhooks; subscribe `subscription.*` + `payment.*`) and run
the checkout smoke test; (3) owner: /admin live-test roundtrip to close
Step 2 — then Step 4 (clean 64-char WEBHOOK_SECRET + Dograh dashboard
header cutover, mind the order).

**Git state:** HEAD b7737fb (main == origin/main; deployed to VPS).
Uncommitted — checkout-401 fix (needs owner-approved deploy): new
`src/lib/signup-handoff.ts` + `src/lib/signup-handoff.test.ts`; modified
`src/app/api/billing/signup/route.ts` + new `route.test.ts`,
`src/app/api/billing/confirm/route.ts` + new `route.test.ts`,
`src/components/onboarding/CheckoutReturn.tsx`. Also pre-existing:
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