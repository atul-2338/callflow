# PROGRESS â€” Callflow build brief

Running log for `Callflow â€“ Master Build Brief.md` (steps 0â€“7).
Working loop: read the brief + this file, continue at the first unfinished step,
run the build after every step, fix errors, commit with a clear message, add one
line here. Ask the owner only at a **YOU** item (those are collected under
NEEDS OWNER at the bottom).

Started: 2026-11-03 Â· Branch: `main` (deploys are a separate, owner-approved task)

---

## Step log

| Step | Status | What was done |
|---|---|---|
| 0 â€” Audit first | DONE 2026-11-03 | Wrote `REPO_AUDIT.md`: the file tree (no `node_modules`), every API route + purpose, schema + migrations, auth/session logic, the full `route.ts` of `/api/webhooks/dograh`, env var names (names only), the leftover Plivo/SignalWire/TextBelt inventory, and a prioritised broken/unfinished list mapped to Steps 1â€“7. No code changed. Commit `08ec18e`. |
| 1 â€” Called number missing from webhook | DONE 2026-11-03 | The parser already read `called_number` and the `to` / `to_number` / `called` aliases, so *matching* worked; the real gap was that an unmatched call was dropped. Now every authenticated delivery is persisted: unmatched calls are written with `businessId = NULL` (row is created, `created: true`, no owner push), logged once as `Storing call â€¦ UNLINKED` with payload KEY NAMES only, and they show up in `/admin/calls?filter=unlinked` (`adminCountUnlinkedCalls` already existed). Removed the per-call `[DOGRAH-DEBUG]` block from the route and its TEMP-DEBUG twin in the handler. Tests updated to assert the stored-unlinked behaviour (398/398), `tsc` clean, build green. Commit `722a330`. |
| 2 â€” Self-serve onboarding | PARTIAL 2026-11-03 | The flow already exists end to end (signup â†’ Dodo checkout â†’ `/onboarding` steps 1â€“4 with pool assignment, carrier `tel:` forwarding instructions and the 3-second verify poll). Delivered in this step: **deleted the legacy `/setup` page**; **low-pool alert** (â‰¤3 free numbers â‡’ console + operator email via `LEADS_NOTIFY_EMAIL`/SMTP_FROM); **trial-expired gate** â€” once `onboardingStep='done'` and `describeBillingAccess(...).entitled` is false, the Telnyx answer route speaks a short "not available" line instead of transferring to the agent (fails open to a transfer if Telnyx rejects the command, so a caller is never stranded), plus a one-shot owner email (`businesses.trialEndedEmailAt` stamp, auto-migrated at boot). Tests 400/400, `tsc` clean, build green. Deviations + owner items: see "Step 2 notes" below. |
| 3 — Dashboard and minimal admin | DONE 2026-11-03 | Verified against the brief, one gap fixed. **Owner dashboard** (`/app`): server-resolved billing state + trial countdown (`describeBillingAccess` / `trialEndsAt` — trial validity is never client-side), owner sign-in via `/login`, and `GET /api/calls` returns only `getCallsForBusiness(businessId)` rows. **Admin** (`/admin`): pool counts with low-stock warning, businesses list with number + phone + trial/status per row, calls list across ALL businesses with an "Unlinked only" tab (works now that Step 1 stores those rows), numbers page for stock, audit + system pages. Fixed: the overview computed the unlinked-call count but never displayed it — the Calls card now shows `N unlinked` (no nested links). View-only for the customer flow: nothing in signup/onboarding/calls waits on admin. Build green. |


### Step 2 notes (deviations + owner items)

- **Signup shape.** The brief asks for email + password + business name + owner
  mobile + carrier in the signup form. The live flow is: email + business name +
  mobile + country → Dodo hosted checkout → `/onboarding` step 1 asks for
  business name + owner mobile + carrier, step 2 shows the number, step 3 the
  `tel:` forwarding code, step 4 polls every 3 s until a forwarded call arrives.
  It is self-serve and admin-free, which is what the step is for, so it was NOT
  rebuilt (rebuilding means touching the Dodo signup route, which is protected).
  Owners authenticate with a password they set, or a one-time login link.
- **Number pool is a JSON file, not a `numbers` table.** Assignment is idempotent
  per business (`assignNumber` reuses `assignedNumber`), but it is not one SQLite
  transaction. Converting it is a live-DB data migration — not done here.
- **Empty pool = "your number is being prepared" + operator email**, not a
  form. The public waitlist form exists (`WaitlistForm` → `POST /api/waitlist`)
  but is not wired to the empty-pool state.
- **Admin "Create customer" still exists** (`/admin/customers`). The brief says
  remove it; the owner has an open decision on retiring it → see NEEDS OWNER.
  Nothing in the customer flow depends on it.
- **Trial-ended call handling** (new): the caller hears one spoken line and is
  not transferred; the call is not stored as a row (there is no Dograh webhook
  for a call that never reached the agent). If the `speak` command fails the
  call is transferred anyway (fail-open) and the failure is logged.



