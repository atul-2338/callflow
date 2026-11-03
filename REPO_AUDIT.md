# REPO_AUDIT â€” Callflow (Build Brief Step 0)

Date: 2026-11-03 Â· Auditor: developer agent Â· No code was changed for this step.
Source of truth: `Callflow â€“ Master Build Brief.md` (referred to below as "the brief").

The repo is NOT greenfield: Steps 1â€“5 of the brief are largely built and live in
production (`callflow.biz`, Vultr VPS `/srv/callflow`, DB `/var/data/callflow.db`).
This audit therefore records what exists, then lists exactly which brief
requirements are still unmet â€” that list drives Steps 1â€“7.

---

## 1. File tree (no `node_modules`, no `.next`)

```
callflow/
â”œâ”€ Callflow â€“ Master Build Brief.md      brief (steps 0â€“7 + definition of done)
â”œâ”€ PROGRESS.md                           â† created by this run (step log)
â”œâ”€ REPO_AUDIT.md                         â† this file
â”œâ”€ BACKLOG.md  activeContext.md  RUNBOOK.md  README.md   project docs
â”œâ”€ AGENTS.md  CLAUDE.md                  agent rules (Next 16 note in AGENTS.md)
â”œâ”€ .clinerules/{focus,rules}.md          binding working rules
â”œâ”€ .clinerules/workflows/{deploy,end-day,start-day}.md
â”œâ”€ .env.example                          placeholders only (never .env*)
â”œâ”€ .gitattributes .gitignore .clineignore
â”œâ”€ eslint.config.mjs  next.config.ts  postcss.config.mjs  tsconfig.json
â”œâ”€ vitest.config.ts   package.json (Next 16.3.2, React 19, better-sqlite3)
â”œâ”€ audit-report*.html  project-status.log  worklog-*.md  (old artifacts)
â”œâ”€ data/                  dev DB files: callflow.db (+ -wal/-shm), .gitkeep
â”œâ”€ deploy/                vps-deploy.sh, vps-bootstrap.sh, backup.sh, systemd/, nginx/
â”œâ”€ docs/                  DAILY_LOG.md
â”œâ”€ dodo-agent-plugin/     third-party Dodo plugin copy (not used by the app)
â”œâ”€ migrations/            schema.sql (single idempotent schema, applied at boot)
â”œâ”€ public/                static assets (no demo video yet)
â”œâ”€ scripts/               ops + one-off scripts (*.cjs/*.mjs); wf-*.ts are
â”‚                         git-ignored workflow helpers â€” never committed
â”œâ”€ tools/                 legacy deploy/debug shell scripts (old /opt path)
â””â”€ src/
   â”œâ”€ proxy.ts (+ .test.ts)              Next 16 "Proxy" (was middleware)
   â”œâ”€ app/
   â”‚  â”œâ”€ layout.tsx globals.css favicon.ico robots.ts
   â”‚  â”œâ”€ (marketing)/  page.tsx  onboarding/  checkout/return/  pricing/
   â”‚  â”‚                privacy/  refund-policy/  terms/
   â”‚  â”œâ”€ (app)/        layout.tsx  account/  calls/  contacts/new/  settings/  setup/
   â”‚  â”œâ”€ app/          layout.tsx  page.tsx        (owner dashboard)
   â”‚  â”œâ”€ admin/        page.tsx  layout.tsx  login/  (protected)/{audit,businesses,
   â”‚  â”‚                businesses/[id],calls,customers,leads,numbers,system}
   â”‚  â”œâ”€ api/          see the route table below
   â”‚  â””â”€ dashboard/  start/  owner-login/  â€¦      (owner + public entry points)
   â”œâ”€ components/      admin/, call(s)/, marketing/, onboarding/, billing/,
   â”‚                   settings/, owner/, dashboard/, leads/, + shared files
   â”œâ”€ hooks/           useClientProfile.ts
   â””â”€ lib/             db.ts, database.ts, email.ts, firebase.ts, dograh.ts,
                       dograh-webhook.ts, telnyx.ts, numbers-pool.ts, email,
                       billing*.ts, dodo*.ts, *-session.ts, rate-limit.ts, â€¦
```

---

## 2. API routes and what each does

**Admin** (`/api/admin/*` â€” `requireAdminApi`; admin cookie only; 404 when the
admin env pair is missing):

| Route | Purpose |
|---|---|
| `POST /api/admin/login` | password-only admin sign-in; 5 attempts / 15 min / IP; audit-logged |
| `POST /api/admin/logout` | clears the admin cookie |
| `GET/POST /api/admin/numbers` | list the pool / add numbers (one per line, strict `+1`+10 digits) |
| `POST /api/admin/numbers/release` | return an assigned pool number to the pool |
| `GET /api/admin/leads`, `PATCH /api/admin/leads/[id]` | post-demo leads + status change |
| `POST /api/admin/customers` | admin "Create customer" (no payment, 3-day trial, one-time login link) |
| `POST /api/admin/customers/[id]/login-link` | mint a fresh one-time owner login link |
| `POST /api/admin/businesses/[id]/assign` | assign a specific pool number to a business |

**Auth / session:**

| Route | Purpose |
|---|---|
| `POST /api/auth/login` | owner email + password â†’ `callflow_business_session` cookie |
| `POST /api/auth/logout` | clear owner cookie |
| `POST /api/auth/setup-password` | finish a one-time setup link (sets password) |
| `POST /api/auth/change-password` | change / first-set password from `/account` |
| `GET /api/me` | the signed-in business's billing state (trial, entitlement) |

**Billing (Dodo):**

| Route | Purpose |
|---|---|
| `POST /api/billing/signup` | create account + hosted-checkout URL; session minted for NEW businesses only |
| `POST /api/billing/checkout` | fresh checkout session for the signed-in business (paywall "Subscribe") |
| `POST /api/billing/confirm` | post-redirect confirmation (handoff cookie / signed return param) |
| `POST /api/billing/portal` | Dodo customer-portal session (manage billing) |
| `POST /api/webhooks/dodo` | signature-verified Dodo events; ONLY writer of `subscriptionStatus`; assigns a pool number on `subscription.active` |

**Onboarding (owner cookie required):**

| Route | Purpose |
|---|---|
| `POST /api/onboarding/start` | step 1: save business name / owner phone / carrier, assign pool number |
| `POST /api/onboarding/step` | advance `2â†’3â†’4â†’done` (exact next step only) |
| `GET /api/onboarding/state` | resume state + step-4 poll (webhook sets `done`) |

**Telephony / webhooks:**

| Route | Purpose |
|---|---|
| `POST /api/webhooks/dograh` | Â§5 â€” end-of-call ingestion webhook (protected surface) |
| `GET /api/webhooks/dograh/health` | unauthenticated liveness + DB round-trip probe |
| `POST /api/v1/telephony/telnyx/answer` | Telnyx `call.initiated` â†’ Ed25519 verify â†’ transfer to the Dograh agent; also flips `forwardingStatus` to `active` (live forwarding proof) |
| `POST /api/plivo/answer` | **LEGACY Plivo answer URL â€” unused, delete in Step 6** |

**Owner data:**

| Route | Purpose |
|---|---|
| `GET /api/calls`, `GET/PATCH /api/calls/[id]` | dashboard call list / call detail + follow-up status |
| `GET/POST /api/contacts`, `[id]/actions`, `[id]/activity` | contacts CRUD helpers |
| `GET/POST /api/settings`, `GET /api/client` | owner settings (name, email, address, FCM token) / client profile |
| `POST /api/leads` | public lead intake from `/start`; emails the operator |
| `POST /api/waitlist` | landing-page waitlist signup (idempotent per email) |

---



## 3. DB schema and migrations

`migrations/schema.sql` is the whole schema. It is applied **idempotently at
boot** by `src/lib/database.ts` (`CREATE TABLE/INDEX IF NOT EXISTS`), so there is
no migration command â€” a deploy auto-migrates. Columns added after the first
release are ALTERed in by `CALL_ADDED_COLUMNS` / `BUSINESS_ADDED_COLUMNS` in
`src/lib/database.ts` *before* the schema exec (the indexes at the bottom of
schema.sql reference them). There is no `DATABASE_URL`: the app uses
`DATABASE_PATH` (default `./data/callflow.db`; `/var/data/callflow.db` on the VPS).

Tables:

| Table | Notes |
|---|---|
| `businesses` | the customer/account. `phoneNumber` (owner mobile), `assignedNumber` (the CallFlow DID â€” the ONE Dograh match key), `clientUid` (`TE-` + 8 hex), `carrier`, `forwardingStatus`, `onboardingStep` ('1'â†’'2'â†’'3'â†’'4'â†’'done'), billing (`billingName/Email/Country`, `trialStartedAt`, `subscriptionStatus`, `subscriptionPaymentId`, `dodoCustomerId/SubscriptionId/CheckoutSessionId`), alerts (`notificationEmail`), auth (`passwordHash`, `setupTokenHash/Expiry/UsedAt`), admin-only (`ownerName`), legacy (`smsVerificationCode/ExpiresAt`) |
| `calls` | one row per Dograh call: `callerNumber`, `businessNumber`, `callStatus`, `callStartedAt/EndedAt`, `durationSeconds`, `dograhRunId` (idempotency key), `dograhDeliveryId`, `dograhDisposition`, `outcome`, `customerName`, `callbackNumber`, `serviceRequested`, `urgency`, `preferredCallbackTime`, `rawPayload`, follow-up (`followUpStatus/Notes/UpdatedAt`), legacy (`textBackSent`, `textBackSentAt`, `signalwireCallSid`), `recordingUrl`, `transcript`, `transcriptUrl`, `calendarEventId`; **`businessId` is NULLABLE** (an unmatched call) |
| `contacts`, `activity_logs` | contact book + per-contact activity (owner UI) |
| `settings` | single row: `missedCallReplyTemplate`, `fcmToken` |
| `client_profile` | single-row legacy profile |
| `admin_audit_log` | one row per admin action (sign-in/out + writes); no secrets/headers/bodies |
| `leads` | public `/start` leads, status newâ†’contactedâ†’account_createdâ†’dead |
| `waitlist` | landing waitlist signups (unique email) |
| `dodo_webhook_events` | webhook-id idempotency for Dodo deliveries |
| `owner_login_tokens` | one-time owner login links (sha256 hash, single use, 7 d) |

Unique indexes of note: `calls.dograhRunId` and `calls.dograhDeliveryId` (partial),
`businesses.clientUid`, `businesses.dodoCustomerId`, `businesses.dodoSubscriptionId`,
`businesses.setupTokenHash` (partial). The number pool is a **JSON file**
(`data/phone_numbers.json`, path from `NUMBERS_POOL_PATH`), not a table â€” see Â§8
item 6.

---

## 4. Auth / session logic

- **Owner session** â€” `src/lib/business-session.ts` (protected surface). Cookie
  `callflow_business_session` = `<businessId>.<nonce>.<HMAC-SHA256>`, signed with
  `BUSINESS_SESSION_SECRET`, HttpOnly, SameSite=Lax, 30 days.
  `verifyBusinessSessionToken` returns the business id or null;
  `businessIdFromCookieHeader` is the route-level check; pages read it via
  `cookies()`.
- **Owner password** â€” `src/lib/business-password.ts` (scrypt in the
  `scrypt$N$r$p$salt$hash` format), one-time setup links, `/login`,
  `/setup-password`, `/api/auth/*`. Admin-created customers get a **login link**
  instead (owners have no password until they set one).
- **Admin session** â€” `src/lib/admin-session.ts`: separate cookie
  `callflow_admin_session` (HttpOnly, SameSite=Strict, 8 h) signed with
  `ADMIN_SESSION_SECRET`; password compared to `ADMIN_PASSWORD_HASH` (scrypt,
  constant time). Missing either env var â‡’ `/admin/*` and `/api/admin/*` answer
  404 (fail closed). `admin-page-guard.ts` + `admin/(protected)/layout.tsx` gate
  pages; `requireAdminApi` gates routes.
- **Owner page gate** â€” `src/proxy.ts` (Next 16 Proxy/middleware) redirects
  `/dashboard` and `/account` to `/login` when the owner cookie is invalid.
  `/app`, `/calls`, `/settings`, `/contacts` keep their own server-component /
  `OnboardingGate` checks. `/api/*` is not matched (routes guard themselves).
- **Webhook auth** â€” `src/lib/dograh.ts`: the `x-webhook-secret` header is
  compared to `WEBHOOK_SECRET` in constant time (sha256 + `timingSafeEqual`) and
  fails closed when the server value is empty. Telnyx: Ed25519 signature +
  timestamp, 503 in production when the public key is unset. Dodo:
  `standardwebhooks` signature with `DODO_PAYMENTS_WEBHOOK_SECRET`.


## 5. Full code of /api/webhooks/dograh

Source: src/app/api/webhooks/dograh/route.ts (protected surface - copied verbatim, not edited).

```ts
import { after } from "next/server";
import { NextResponse } from "next/server";
import { deliverOwnerPush, handleDograhWebhook } from "@/lib/dograh-webhook";

/**
 * Receives Dograh workflow "send webhook" deliveries at end of call.
 *
 * Configure in the Dograh workflow editor:
 *   URL:     https://<your-host>/api/webhooks/dograh
 *   Method:  POST
 *   Header:  x-webhook-secret: <WEBHOOK_SECRET from .env>
 *   Body:    JSON with callId (required) — see README "Webhook contract".
 *
 * Responses: 200 {"ok":true} = stored/updated (stop retries); 401 = wrong or
 * missing secret; 400 = bad JSON or no callId. The owner push notification is
 * scheduled with after() so it runs after the response is sent and can never
 * delay it. Normal logging is one line per request — method, callId, status
 * code — and never includes the secret, headers, or body.
 *
 * TEMP-DEBUG: while the "call arrives but is not stored" report is being
 * diagnosed, POST logs one "[DOGRAH-DEBUG]" line with the payload's top-level
 * field names, the dialled number and the caller number truncated to its first
 * 6 digits, and handleDograhWebhook logs the value the parser extracted. Remove
 * BOTH logs and this note once the called-number field of the live Dograh
 * template is confirmed.
 */

export async function POST(request: Request) {
  let body: unknown = null;
  let jsonInvalid = false;
  try {
    body = await request.json();
  } catch {
    jsonInvalid = true;
  }

  // TODO: TEMP-DEBUG — remove before production
  // Runs BEFORE any header validation or DB lookup, so one live call shows
  // exactly what the template sent. NOTE: `to: ""` (rather than NOT_FOUND) means
  // the key arrived but the Dograh template rendered it EMPTY.
  const debugBody = (body ?? {}) as Record<string, unknown>;
  // First non-empty string among the aliases the parser accepts for the caller.
  const debugFrom = (["from", "caller", "caller_number", "from_number"] as const)
    .map((key) => debugBody[key])
    .find(
      (value): value is string => typeof value === "string" && value.length > 0
    );
  console.log(
    "[DOGRAH-DEBUG]",
    JSON.stringify({
      fields: Object.keys(debugBody),
      to:
        debugBody.to ??
        debugBody.to_number ??
        debugBody.called_number ??
        debugBody.destination ??
        "NOT_FOUND",
      from_masked: debugFrom ? `${debugFrom.slice(0, 6)}****` : "NOT_FOUND",
    })
  );

  let status = 500;
  let callId: string | undefined;
  try {
    const result = await handleDograhWebhook({
      body,
      headers: request.headers,
      jsonInvalid,
    });
    status = result.status;
    callId = result.callId;
    if (result.pushPlan) {
      const plan = result.pushPlan;
      // Push runs after the response is flushed — the caller gets {"ok":true} fast.
      after(() => deliverOwnerPush(plan));
    }
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error("[dograh-webhook] handler failed:", error);
    return NextResponse.json(
      { error: "internal error processing webhook" },
      { status: 500 }
    );
  } finally {
    console.log(`[dograh-webhook] POST callId=${callId ?? "-"} -> ${status}`);
  }
}
```

Behind the route (`src/lib/dograh-webhook.ts` + `src/lib/dograh.ts`): auth →
parse (`callId` required; `calledNumber` from `called_number`,
`initial_context.called_number`, then the `to` / `to_number` / `called` aliases
at top level, in `initial_context`, or inside a nested `call` object) → match
(`assignedNumber` only, normalized) → upsert into `calls` keyed by `dograhRunId`
→ owner push plan (FCM, run via `after()`), and `onboardingStep '4'` becomes
`done` on the business's first attributed call.

**Gap (Step 1):** an unmatched call returns `200 {"ok":true}` and **no row is
written** ("an unmatched call is never stored"). The brief requires saving it
with `business_id = NULL` and showing it in admin — and `/admin/calls?filter=unlinked`
plus `adminCountUnlinkedCalls()` already exist and can never show data.

---

## 6. Env var names used (names only — no values were read)

Read by the app: `DATABASE_PATH`, `DB_REQUIRE_PERSISTENT_PATH`, `NODE_ENV`,
`DEBUG`, `CORS_ORIGINS`, `APP_AUTH_TOKEN`, `PUBLIC_BASE_URL`, `NUMBERS_POOL_PATH`,
`BUSINESS_SESSION_SECRET`, `ADMIN_PASSWORD_HASH`, `ADMIN_SESSION_SECRET`,
`WEBHOOK_SECRET`, `FIREBASE_SERVICE_ACCOUNT`, `SMTP_USER`, `SMTP_PASS`,
`SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, `DODO_PAYMENTS_API_KEY`,
`DODO_PAYMENTS_ENVIRONMENT`, `DODO_PAYMENTS_WEBHOOK_SECRET`, `DODO_SOLO_PRODUCT_ID`,
`DODO_PAYMENTS_RETURN_URL`, `DODO_PAYMENTS_CANCEL_URL`, `TELNYX_API_KEY`,
`TELNYX_PUBLIC_KEY`, `TELNYX_NUMBER`, `TELNYX_FORWARD_TO`, plus the legacy
`PLIVO_AUTH_ID` / `PLIVO_AUTH_TOKEN` / `PLIVO_NUMBER` (see §7). Script-only vars
(documented in `.env.example`, never read by the server): `BASE_URL`,
`CALLFLOW_BASE_URL`, `DOGRAH_API_BASE`, `DOGRAH_API_KEY`, `DOGRAH_MCP_URL`,
`DOGRAH_WORKFLOW_ID`, `CHROME_PATH`, `LEADS_NOTIFY_EMAIL`.

`/admin/system` reports NAMES with a set/not-set badge only
(`admin-db.ts::SYSTEM_ENV_NAMES`); values are never read into a returned struct.

---

## 7. Leftover SignalWire / Plivo / TextBelt code (Step 6 targets)

- `src/app/api/plivo/answer/route.ts` — legacy Plivo answer URL (silent test-call
  verification). Unwired.
- `src/lib/plivo.ts` + `src/lib/plivo-signature.test.ts` — Plivo signature helper.
- `src/lib/laml.ts` — Plivo LAML/XML helper, used only by that route.
- `src/lib/sms.ts` + `src/lib/sms.test.ts` — SMS helper (TextBelt era); no live
  caller in `src/`.
- `businesses.smsVerificationCode` / `businesses.smsVerificationExpiresAt`
  columns and the `ActivityLog.type === "sms"` value: legacy, no writer.
- `calls.textBackSent`, `calls.textBackSentAt`, `calls.signalwireCallSid`
  columns and `db.ts::getCallBySignalwireSid()` (exported, unused).
- Env refs: `PLIVO_*` (and `CALLFLOW_FORWARDING_DID`) in `.env.example`, README,
  RUNBOOK, `src/app/(marketing)/privacy/page.tsx` ("Plivo — provisions your
  dedicated number"), `scripts/browser-test-setup.mjs`, `audit-report*.html`.
- **No `json-server`, no `data/*.json` mock data** — only `data/*.db` + `.gitkeep`.
- Not in Step 6 scope but noted: `firebase-admin` / FCM push is still wired into
  the webhook and `/api/settings` (the brief says "no FCM for now", but Step 6
  names only SignalWire/Plivo/TextBelt). Left alone.

---

## 8. Broken / unfinished, mapped to brief steps

1. **Call-alert email is never sent** — `sendCallAlertEmail()` in
   `src/lib/email.ts` has zero callers; `dograh-webhook.ts` only does an FCM push
   (and `.env.example` says email is "NOT used by the Dograh webhook"). → Step 4.
2. **Unmatched calls are dropped** (see §5). → Step 1.
3. **Day-2 trial email with the charge date** does not exist anywhere (no
   cron/scheduler in the repo). → Step 5.
4. **`/setup` still exists** as a `redirect("/onboarding")` stub
   (`src/app/(app)/setup/page.tsx`); the brief says remove the old `/setup`. → Step 2.
5. **Admin-creates-account flow still exists** (`/admin/customers` +
   `/api/admin/customers`). Brief Step 2 says remove it, but the owner has an open
   decision on retiring self-serve vs. admin-create (`activeContext.md` "Next").
   → Step 2, **NEEDS OWNER**; not removed here.
6. **No `numbers` table** — the brief specifies a pool table
   (`numbers(number, status, business_id)`); the repo uses a JSON file
   (`data/phone_numbers.json`) with a read-modify-write. `assignNumber` reuses
   `businesses.assignedNumber`, so one business can never hold two numbers, but it
   is not one SQLite transaction across two signups. Changing it is a live-DB data
   migration: recorded as a deviation, not silently rewritten.
7. **City landing pages `/savannah` and `/austin` do not exist**, and the homepage
   demo slots are empty by design (`src/lib/siteConfig.ts`: `DEMO_PHONE_DISPLAY`,
   `DEMO_PHONE_TEL`, `DEMO_AUDIO_SRC`). → Step 7 (numbers/video = **NEEDS OWNER**).
8. **TEMP-DEBUG logging** in `/api/webhooks/dograh` (one `[DOGRAH-DEBUG]` line per
   delivery) is still in production. → Step 1 cleanup.
9. **Trial-expiry handling** ("the agent stops answering, callers hear a short
   unavailable message, owner gets an email") is only partly present:
   `describeBillingAccess` + the `/app` paywall block the *dashboard*, but the
   Telnyx answer route transfers every inbound call regardless of
   `subscriptionStatus`, and no expiry email is sent. → Step 2/5 (noted).
10. **Owner entry points overlap** — `/app` (primary), `/dashboard` (legacy,
    kept alive by `proxy.ts`) and `(app)/setup` (redirect stub). Intentional today.
11. **No demo line configured**, so no marketing page can show a real demo number.

