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

## NOW (MVP steps 1–7 — one at a time, show result, wait for "next")

1. **Step 1 — Stack trace (15 min).** Find the error stack trace in the
   VPS log; report the first line of each distinct error, how often it
   happens, and whether it affects calls, checkout, or pages. Fix only
   if it is a small, clear bug. Done when: identified AND fixed or
   marked harmless.
   First command: `ssh root@45.76.252.174 "journalctl -u callflow --since '3 days ago' --no-pager | grep -n -i -B2 -A8 error | head -120"`

2. **Step 2 — Admin panel Phase 6: deploy guide + ship to
   https://callflow.biz.** Mint ADMIN_PASSWORD_HASH locally; append
   ADMIN_PASSWORD_HASH + ADMIN_SESSION_SECRET to `/srv/callflow/.env`
   via ssh stdin (backup → append → `chown callflow:callflow` →
   `chmod 600`, values never printed); deploy via
   `.clinerules/workflows/deploy.md` after approval; live-test
   `/admin/login` sign-in, overview, create-business roundtrip, logout;
   optional nginx IP-allow block from Phase 5.
   First command: `npm run admin:hash` (local; hidden prompts, hash only to stdout)

3. **Step 3 — Dodo keys on the VPS.** DODO_* env vars are missing from
   `/srv/callflow/.env`, so billing is inert in production.
   First command: `ssh root@45.76.252.174 "grep -c '^DODO_' /srv/callflow/.env || true"`
   (prints a count only), then the ssh stdin-append pattern (backup →
   append → chown → chmod 600).

4. **Step 4 — Clean 64-char WEBHOOK_SECRET.** Canonical secret is 48
   chars (`4b33…`); replace with a clean 64-char value and update the
   Dograh dashboard webhook header to match (mind the cutover order).
   First command: `openssl rand -hex 32` — paste the value straight into the ssh stdin-append; never print it in chat

5. **Step 5 — Firebase push (FCM) setup.** Service-account key + FCM
   wiring for owner push (webhook currently logs "no FCM token
   registered").
   First command: `ssh root@45.76.252.174 "grep -Ec '^FIREBASE_|^FCM_|^GOOGLE_' /srv/callflow/.env || true"`
   (prints a count only)

6. **Step 6 — Recording + transcript in the dashboard.** Surface the
   recording link and full transcript per call in `/app`.
   First command: `grep -rn "recording" src/app src/lib migrations/schema.sql | head -30`
   (map what already exists before coding)

7. **Step 7 — Scope contacts + settings per business.** Contacts and
   settings tables are single-row globals; scope them per business
   (multi-tenant correctness before promoting).
   First command: `grep -n "contacts" migrations/schema.sql`
   (see the current single-row shape)

## NEXT (week-1 — owner to confirm/add)

8. **Key rotation runbook** — documented rotate procedure for
   WEBHOOK_SECRET, BUSINESS_SESSION_SECRET, ADMIN_SESSION_SECRET
   (including the Dograh dashboard cutover order).
9. *Owner's week-1 list goes here (monitoring, backups, docs, …).*

## LATER (the rest)

10. **Dev-leftover cleanup (inert)** — `watchpack` dev-workaround dep in
    package.json (inert at runtime); `scripts/wf-*.ts` scratch files
    (never committed per rules).

## DONE

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