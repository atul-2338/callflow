# PROGRESS - Callflow build brief

Running log for `Callflow - Master Build Brief.md` (steps 0-7).
Working loop: read the brief + this file, continue at the first unfinished step,
run the build after every step, fix errors, commit with a clear message, add one
line here. Ask the owner only at a **YOU** item; those are collected under
"NEEDS OWNER" at the bottom.

Started: 2026-11-03 - Branch: `main` (deploys are a separate, owner-approved task)
Conventions used here: ASCII only, one row per step, commit sha recorded.

---

## Step log

| Step | Status | What was done |
|---|---|---|
| 0 - Audit first | DONE 2026-11-03 | Wrote `REPO_AUDIT.md`: file tree (no `node_modules`), every API route and its purpose, schema + migrations, auth/session logic, the full `route.ts` of `/api/webhooks/dograh`, env var NAMES only, the leftover Plivo/SignalWire/TextBelt inventory, and a prioritised broken/unfinished list mapped to steps 1-7. No code changed. Commit `08ec18e`. |
| 1 - Called number missing from webhook | DONE 2026-11-03 | The parser already read `called_number` plus the `to` / `to_number` / `called` aliases, so matching worked; the real gap was that unmatched calls were dropped. Now every authenticated delivery is persisted: an unmatched call is written with `businessId = NULL` (`created: true`, no owner push, one `Storing call ... UNLINKED` log with payload KEY NAMES only) and shows up in `/admin/calls?filter=unlinked`, which already existed. Removed the per-call `[DOGRAH-DEBUG]` block from the route and its twin in the handler. Tests 398/398, tsc clean, build green. Commit `722a330`. |
| 2 - Self-serve onboarding | PARTIAL 2026-11-03 | The flow already exists end to end (signup -> Dodo checkout -> `/onboarding` steps 1-4: pool assignment, carrier `tel:` forwarding code, 3-second verify poll). Delivered here: deleted the legacy `/setup` page; low-pool alert (3 or fewer free numbers -> console + operator email to `LEADS_NOTIFY_EMAIL`, else SMTP_FROM); trial-expired gate - once `onboardingStep='done'` and `describeBillingAccess().entitled` is false, the Telnyx answer route speaks one "not available" line instead of transferring to the agent (fails open to a transfer if Telnyx rejects the command) and sends the owner a one-shot email stamped by the new `businesses.trialEndedEmailAt` column (auto-migrated at boot). Tests 400/400, tsc clean, build green. Deviations + owner items: see "Step 2 notes". Commit `22736c9`. |
| 3 - Dashboard and minimal admin | DONE 2026-11-03 | Verified against the brief, one gap fixed. Owner dashboard `/app`: billing state and trial countdown resolved on the server (`describeBillingAccess` / `trialEndsAt`), owner sign-in at `/login`, and `GET /api/calls` returns only `getCallsForBusiness(businessId)` rows. Admin `/admin`: pool counts with a low-stock warning, businesses list with number + owner phone + trial/status per row, calls list across ALL businesses with an "Unlinked only" tab (useful now that step 1 stores those rows), numbers page for stock, audit + system pages. Fixed: the overview computed the unlinked count but never displayed it - the Calls card now shows `N unlinked` (plain text, no nested links). Nothing in the customer flow waits on admin. Build green. Commit `263ad50`. |

| 4 - Email alerts | DONE 2026-11-03 | `sendCallAlertEmail()` existed but had zero callers. Now the Dograh webhook builds an `OwnerAlertPlan` for every NEW, ATTRIBUTED call and the route sends it with `after()`, so SMTP can never delay or fail the 200. Recipient: `notificationEmail`, else `billingEmail`; no email on file -> one warning and the call is still saved. Redeliveries never re-send; unlinked calls have no owner. The email gained an optional `Outcome:` line ("answered (42s)"). Failures are logged only. Tests 403/403, tsc clean, build green. |

---



## Step 4 notes (email alerts)

- One summary email per NEW call, sent after the response (`after()`), so a slow
  SMTP server can never delay or fail the webhook reply. Recipient is
  `businesses.notificationEmail`, falling back to `billingEmail`.
- Content: caller name/number, callback number, call time (UTC), outcome
  (`answered (42s)`), dashboard CTA. `reason`/`urgency`/`recordingUrl` stay null
  because the webhook does not parse those fields yet.
- Transcript summary is NOT included: the repo has no transcription/summary step
  (the brief lists Groq in the stack, but nothing in this codebase calls it and
  adding a provider is out of scope). Noted under "left to do".

---

## Step 2 notes (deviations + owner-facing consequences)

- **Signup shape.** The brief lists email + password + business name + owner
  mobile + carrier at signup. The live flow is email + business name + mobile +
  country -> Dodo hosted checkout -> `/onboarding` step 1 (business name, owner
  mobile, carrier), step 2 (your number), step 3 (carrier `tel:` forwarding code),
  step 4 (poll every 3 s until a forwarded call arrives). It is self-serve and
  admin-free, which is what the step is for, so it was NOT rebuilt: rebuilding it
  means touching the Dodo signup route, which is protected surface. Owners
  authenticate with a password they set, or with a one-time login link.
- **Number pool is a JSON file, not a `numbers` table.** Assignment is idempotent
  per business (`assignNumber` reuses `assignedNumber`), but it is not one SQLite
  transaction. Converting it is a live-DB data migration, not done here.
- **Empty pool** shows "your number is being prepared" and emails the owner; the
  public waitlist form (`WaitlistForm` -> `POST /api/waitlist`) is not wired to
  that state.
- **Admin "Create customer"** (`/admin/customers`) still exists. The brief says
  remove it; the owner's decision on retiring it is pending -> NEEDS OWNER.
  Nothing in the customer flow depends on it.
- **Trial-ended calls** are answered with one spoken line instead of the agent,
  and no `calls` row is written (the call never reaches Dograh, so no webhook
  fires). Deliberate; flagged for the definition-of-done review.
