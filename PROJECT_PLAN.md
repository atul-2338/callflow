# Callflow — Build Plan

Status key: `[ ]` not started · `[~]` in progress · `[x]` done

Work through phases in order. Do not skip ahead to a later phase until every item in the current one is checked. After finishing an item, update its checkbox in this file and tell me what you did before moving to the next one.

## Phase 1 — Finish payment testing
- [x] Register the ngrok/live URL as the Dodo Payments webhook endpoint
- [x] Test signup flow: $0 due at signup, trial start timestamp saved server-side
- [x] Test trial-to-paid transition: $49 charge fires correctly and is logged
- [x] Confirm the `calls`/user table shows correct subscription status after each step

## Phase 2 — Core call loop (pilot)
- [x] Wire the Dograh end-of-call webhook to POST to `/api/webhooks/dograh`
- [x] Save call outcome + transcript into the `calls` table
- [x] Trigger an FCM push notification to the owner on a missed call
  - Evidence: `src/lib/dograh-webhook.ts` sends a push for every call outcome
    (outcome-specific title + `{callId, outcome, callerNumber}` data) via
    `sendPushNotification`; dead tokens are cleared automatically. Covered by
    `src/lib/dograh-webhook.test.ts` (push token lifecycle).
- [~] Manually forward one pilot business's number by hand (no wizard yet)
  - Tooling ready: `scripts/forward-pilot.mjs` seeds the pilot business row and
    prints the exact phone-settings steps. The live forwarding step needs real
    Plivo/Dograh credentials.
- [~] Run the full loop live with that one real business and confirm it works
  - Blocked on live credentials (Plivo number, Dograh workflow run, FCM token).

## Phase 3 — Dashboard & data
- [x] Build the owner dashboard: metric cards + call list, reading from the `calls` table
  - Evidence: `src/app/app/page.tsx` — "Today" metric cards (Booked / Callbacks /
    Voicemails) + outcome-filtered call list with transcript/recording expansion,
    all fed by `/api/calls` → `calls` table.
- [x] Migrate `data/*.json` mock data into SQLite
  - Evidence: `migrations/schema.sql` + `src/lib/database.ts` (idempotent
    `CREATE TABLE IF NOT EXISTS` + ALTER-based column backfills); `data/` holds
    only `callflow.db`, no JSON mocks remain.

## Phase 4 — Deploy
- [~] Move the app off the local machine onto the Hostinger VPS
  - Tooling ready: `deploy/` (systemd unit, nginx, vps-bootstrap.sh, deploy.sh,
    backup.sh). Needs VPS access to execute.
- [~] Point callflow.biz + HTTPS at the VPS
  - Needs DNS + cert access.
- [~] Switch the Dodo webhook endpoint from the ngrok URL to callflow.biz
  - Needs Dodo dashboard access; the endpoint itself (`/api/webhooks/dodo`) is live.

## Phase 5 — Onboarding & scale
- [x] Build the self-serve forwarding wizard (carrier dropdown, tel: link, silent test-call verification)
  - Evidence: `src/components/onboarding/OnboardingFlow.tsx` (carrier dropdown in
    step 1, `tel:` test-call link + "Call me now" / "Text me a code" verification
    in step 2); `/api/onboarding/verify` places the silent test call and
    `/api/plivo/answer` (signature-verified) flips the business to `active`.
- [~] Add SMS: toll-free verification first, then full 10DLC registration
  - Code flow built: `/api/onboarding/verify-sms` sends a 6-digit code via Plivo,
    `/api/onboarding/confirm-sms` consumes it and marks the number verified
    (`src/lib/sms.ts`, `src/lib/db.ts`). Carrier-side toll-free verification /
    10DLC registration is an external step with the carriers.
- [x] Decide whether a native mobile push app is still needed alongside the web wizard
  - Decision: **no native app for the pilot.** The web wizard + FCM push (token
    stored in Settings, delivered by `src/lib/firebase.ts`) covers the pilot;
    a native app is deferred until owners show they need it. Revisit after the
    first paying customers.

## Phase 6 — Launch
- [~] Confirm the Solo plan ($49/mo, 3-day trial) checkout is fully live end-to-end
  - Code complete and committed (Dodo hosted Checkout Sessions, webhook-driven
    entitlement, `/checkout/return` polling page). Live-mode confirmation needs
    Dodo live credentials + a real card test.
- [~] Start tester acquisition: content/social + landing page waitlist
  - Waitlist built: `waitlist` table + `/api/waitlist` + landing-page form
    (`src/components/marketing/WaitlistForm.tsx`). Content/social is an ongoing
    marketing task.
- [ ] Onboard first real paying customers
  - Business task; needs the live checkout + VPS deploy above.

