# PROGRESS — Callflow build brief

Running log for `Callflow – Master Build Brief.md` (steps 0–7).
Working loop: read the brief + this file, continue at the first unfinished step,
run the build after every step, fix errors, commit with a clear message, add one
line here. Ask the owner only at a **YOU** item (those are collected under
NEEDS OWNER at the bottom).

Started: 2026-11-03 · Branch: `main` (deploys are a separate, owner-approved task)

---

## Step log

| Step | Status | What was done |
|---|---|---|
| 0 — Audit first | DONE 2026-11-03 | Wrote `REPO_AUDIT.md`: the file tree (no `node_modules`), every API route + purpose, schema + migrations, auth/session logic, the full `route.ts` of `/api/webhooks/dograh`, env var names (names only), the leftover Plivo/SignalWire/TextBelt inventory, and a prioritised broken/unfinished list mapped to Steps 1–7. No code changed. Commit `08ec18e`. |
| 1 — Called number missing from webhook | DONE 2026-11-03 | The parser already read `called_number` and the `to` / `to_number` / `called` aliases, so *matching* worked; the real gap was that an unmatched call was dropped. Now every authenticated delivery is persisted: unmatched calls are written with `businessId = NULL` (row is created, `created: true`, no owner push), logged once as `Storing call … UNLINKED` with payload KEY NAMES only, and they show up in `/admin/calls?filter=unlinked` (`adminCountUnlinkedCalls` already existed). Removed the per-call `[DOGRAH-DEBUG]` block from the route and its TEMP-DEBUG twin in the handler. Tests updated to assert the stored-unlinked behaviour (398/398 pass), `tsc` clean, build green. |

