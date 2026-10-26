# Daily log

Newest entry on TOP. Add entries via `.clinerules/workflows/end-day.md`.

## 2026-10-26

**Done:** BACKLOG rewritten as the owner's 7-step MVP list (NOW = steps
1–7, NEXT = week-1, LATER = the rest); derived webhook results on
/admin/system CONFIRMED by owner (Dograh handler untouched). Step 1
(stack-trace audit) DONE — read-only sweep of `journalctl -u callflow`
(3-day window: 556 lines, 104 error-matching, 7 distinct signatures;
quiet since Oct 24 05:18). Verdicts: 100× Server-Action probe noise
(app has zero "use server" — external scanner traffic rejected before
any route; no calls/checkout/page impact); 2× `[dodo-billing] signup
failed` = REAL checkout impact, cause is missing DODO_* env on the VPS
→ covered by NOW step 3, not a code bug; 2× one-off ENOENT
(.next/required-server-files.json + 500.html) during the Oct 24 05:18
deploy window (build raced a live server) — self-resolved, marked
harmless. No code changed.

**Unfinished & stopped at:** Step 1 complete, awaiting "next". Steps 2–7
order inferred from the old NOW/NEXT/LATER — owner to confirm or correct.

**Decisions:** derived webhook results CONFIRMED (owner, 2026-10-26).
DAILY_LOG uses the correct date from today onward.

**Problems found:** DODO_* missing on the VPS = the only real production
impact in the log (2 failed signups). Optional hardening (not scheduled):
nginx 403 for POSTs carrying a Next-Action header.

**Git state:** only memory files touched (BACKLOG.md, activeContext.md,
docs/DAILY_LOG.md); the pre-existing dirty tree (admin panel Phases 1–5
+ workflow files) unchanged; nothing committed, nothing deployed.

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