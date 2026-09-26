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
- [ ] Trigger an FCM push notification to the owner on a missed call
- [ ] Manually forward one pilot business's number by hand (no wizard yet)
- [ ] Run the full loop live with that one real business and confirm it works

## Phase 3 — Dashboard & data
- [ ] Build the owner dashboard: metric cards + call list, reading from the `calls` table
- [ ] Migrate `data/*.json` mock data into SQLite

## Phase 4 — Deploy
- [ ] Move the app off the local machine onto the Hostinger VPS
- [ ] Point callflow.biz + HTTPS at the VPS
- [ ] Switch the Dodo webhook endpoint from the ngrok URL to callflow.biz

## Phase 5 — Onboarding & scale
- [ ] Build the self-serve forwarding wizard (carrier dropdown, tel: link, silent test-call verification)
- [ ] Add SMS: toll-free verification first, then full 10DLC registration
- [ ] Add WhatsApp via a BSP
- [ ] Decide whether a native mobile push app is still needed alongside the web wizard

## Phase 6 — Launch
- [ ] Confirm the Solo plan ($49/mo, 3-day trial) checkout is fully live end-to-end
- [ ] Start tester acquisition: content/social + landing page waitlist
- [ ] Onboard first real paying customers
