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

2. **Step 3 follow-up — Dodo dashboard webhook registration.** Register
   https://callflow.biz/api/webhooks/dodo in the Dodo dashboard
   (Developer → Webhooks), subscribe to `subscription.*` and
   `payment.*` events, then run the checkout smoke test (test product,
   test_mode).
   First command: open https://dashboard.dodo.dev → Developer → Webhooks.

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

7. **Key rotation runbook** — documented rotate procedure for
   WEBHOOK_SECRET, BUSINESS_SESSION_SECRET, ADMIN_SESSION_SECRET
   (including the Dograh dashboard cutover order).
8. *Owner's week-1 list goes here (monitoring, backups, docs, …).*

## LATER (the rest)

9. **Dev-leftover cleanup (inert)** — `watchpack` dev-workaround dep in
    package.json (inert at runtime); `scripts/wf-*.ts` scratch files
    (never committed per rules).

## DONE

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
  tsc clean. Not committed/deployed — needs owner approval; then re-run a
  production trial signup through /setup to verify end-to-end.
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