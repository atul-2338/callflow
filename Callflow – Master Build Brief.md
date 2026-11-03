# Callflow – Master Build Brief

Paste this whole document into your coding agent (Claude Code / Cline) at the start of a session. Work top to bottom. Stop and ask only at items marked **YOU**.

## 1. What Callflow is

Micro SaaS for US local businesses. A missed call forwards to a Telnyx number, a Dograh AI agent answers, the outcome is posted to our webhook, saved in the `calls` table, shown on the owner's dashboard and sent as an email alert.

**Stack (final, do not change):** Next.js (TypeScript), SQLite at `/var/data/callflow.db`, Telnyx (telephony), Dograh AI (voice agent), Dodo Payments (payments), Vultr VPS at `/srv/callflow` running `next start`, domain callflow.biz, Groq for transcription/summary.

**Pricing:** Solo plan only, 3-day free trial, $0 at signup, $49/mo after trial.

**Onboarding model:** fully self-serve in 3 steps: sign up, turn on forwarding, start trial. The system assigns each customer one number from a pre-stocked pool. Admin is never in the customer's path. No custom per-customer URLs.

## 2. Rules (non-negotiable)

- Do not add new tools, providers, libraries or paid services. Use what is already in the repo.
- No SMS, no WhatsApp, no native app, no FCM for now. Email alerts first.
- Do not change the working call flow or the `/api/webhooks/dograh` auth (`x-webhook-secret` header) unless a step below says so.
- Never print or commit secrets. Read env var names only. `.env` stays out of git.
- Commit after each completed step with a clear message. Make small changes; do not refactor unrelated code.
- After each step, run the build and fix errors before moving on.

**Working loop:** at the start of every session read this file and `PROGRESS.md`, then continue from the first unfinished step. After each step, run the build, fix any errors yourself, check the work against the Definition of done, then add one line to `PROGRESS.md` (step name, done, anything the owner must do). Ask the owner only at a **YOU** item or after two failed fixes on the same problem.

## 3. Step 0 – Audit first (no code changes)

Write `REPO_AUDIT.md` containing: file tree (no node\_modules), every API route and what it does, DB schema and migrations, auth/session logic, full code of `/api/webhooks/dograh`, env var names used, any leftover SignalWire / Plivo / TextBelt code, and a list of anything broken or unfinished. Then continue to Step 1 using what you found.

## 4. Fix list, in priority order

### Step 1 – Called number missing from webhook (core bug)

Problem: the Dograh end-of-call webhook returns 200 but the payload has no called number, so calls cannot be matched to a business and are not stored.

- Log one raw payload (secrets redacted) and inspect it for any field that identifies the number called or the workflow/run.
- If a to-number field exists, match it to `assignedNumber`.
- If not, try in this order: (a) add the called number as a variable in the Dograh webhook body template; (b) look the call up through Dograh's run/call details by run ID; (c) map workflow ID to business.
- Unmatched calls must be saved to the `calls` table with `business_id = NULL` and shown in the admin panel, never dropped.
- **YOU:** if option (a) is needed, edit the webhook node in Dograh as instructed.

### Step 2 – Self-serve onboarding (3 steps, no admin)

A visitor goes from landing page to a protected line in about five minutes, with no human involved. Admin only keeps the number pool stocked.

1. **Sign up (30 seconds).** Email, password, business name, owner mobile number, carrier dropdown (AT&T, Verizon, T-Mobile, Other). On submit the system creates the account and auto-assigns one free number from the pool. No approval, no waiting.
2. **Turn on forwarding (2 minutes).** The page shows the assigned number and a one-tap `tel:` link carrying the carrier's no-answer forwarding code. It then says: call your business number from another phone and let it ring. The page checks every 3 seconds and turns green when a forwarded call reaches the assigned number. That is the verification; no outbound test call.
3. **Start the free trial.** Dodo checkout, card on file, $0 today, $49/mo after 3 days. The trial clock starts when forwarding is verified. Then the dashboard opens.

Build rules:

- Pool: table `numbers` (number, status free/assigned, business\_id). Assignment is one atomic DB transaction so two signups never get the same number.
- Pre-configure every pool number once in Telnyx (same Call Control application) and Dograh (same inbound workflow). A new signup then needs zero setup in either dashboard, because the called number in the webhook (Step 1) is what links a call to the business.
- Pool empty: show a waitlist form and email the admin. Pool at 3 or fewer free numbers: email the admin to restock.
- Carrier codes: small lookup table for AT&T, Verizon and T-Mobile. Confirm each code on the carrier's own help page before shipping. "Other" shows one generic instruction line.
- Trial ends with no active subscription: the agent stops answering and the owner gets an email. Forwarded callers must never reach a dead line; use a short "unavailable" message.
- Confirm in Dodo docs that a trial subscription with card capture is supported. If not, start the trial without a card and email the checkout link on day 2.
- Remove the old `/setup` page, shared-number logic and the admin-creates-account flow.
- **YOU:** buy 5 to 10 Telnyx numbers, attach each to the Call Control app and Dograh workflow, and add them to the pool.

### Step 3 – Dashboard and minimal admin

- Owner dashboard: metric cards and call list for their own business only. Login is the email and password from signup.
- Trial validity comes from the server-side timestamp, never reset on reload.
- Admin panel (manager only): pool stock and status, all accounts with trial status, and all calls including unmatched ones (`business_id` NULL). View only; nothing in the customer flow waits on it.

### Step 4 – Email alerts

- On each saved call for a business, email the owner a short summary (caller number, time, outcome, transcript summary).
- Use SMTP with the support address atul@callflow.biz or a free-tier email API. Choose one and keep it simple. Failures must not break webhook saving.
- **YOU:** provide SMTP/API credentials in `.env` on the VPS.

### Step 5 – Dodo Payments

- Checkout (Dodo, test mode first) is step 3 of onboarding, not an admin action.
- Webhook verifies the signature, marks the account active on payment, and pauses it on failure or cancellation.
- Email the owner on day 2 of the trial with the charge date.
- **YOU:** add Dodo API keys and webhook secret to `.env` on the VPS.

### Step 6 – Clean-up

- Delete all SignalWire, Plivo and TextBelt code, routes, env references and dependencies.
- Rotate `WEBHOOK_SECRET` if the old one was ever pasted in chat, and update both `.env` and the Dograh webhook node.
- Remove unused mock data (`json-server`, `data/*.json`) if still present.

### Step 7 – City landing pages

- `/savannah` and `/austin`, each showing its own demo phone number, one clear call-to-action and the pricing line.
- Homepage embeds the \~20s demo video (**YOU** supply the file).

## 5. Definition of done

1. A new visitor signs up on callflow.biz and receives a number with no admin action.
2. After forwarding, a test call from another phone turns the onboarding page green and appears on their dashboard.
3. An email alert arrives for that call.
4. An unmatched call appears in admin, not lost.
5. Dodo test-mode checkout starts the trial and later activates the account. No dead provider code remains. Build passes.

When all five are true, stop building and start selling.

## 6. Not in scope

SMS, WhatsApp, push notifications, native apps, custom per-customer URLs, new telephony providers, new coding tools.
