# REPO_AUDIT - Callflow (build brief step 0)

Source of truth: the file `BUILD BRIEF.md` in the repo root ("the brief").
This audit was written before any code change. Everything found here is tracked
to a step in `PROGRESS.md`.

## 1. Repo layout

```
src/app
  (marketing)   page, onboarding, checkout/return, pricing, privacy,
                refund-policy, terms
  (app)         account, contacts, settings, setup-password
  app           dashboard shell + dashboard page
  admin         page, layout, login, (protected)/{audit,businesses,businesses/[id],
                calls,customers,leads,numbers,system}
  api           see table in section 3
  start         public lead capture page
src/components  admin, calls, dashboard, marketing, onboarding, owner,
                settings, billing, leads
src/lib         db, database, billing, dodo*, dograh*, telnyx, plivo, laml, sms,
                email, firebase, numbers-pool, phone, forwarding-codes,
                *-session, phone-number helpers, rate-limit, util
src/proxy.ts    Next 16 proxy (legacy middleware)
migrations      schema.sql (single idempotent schema applied at boot)
scripts         operator + one-off debug scripts (not shipped)
deploy          VPS deploy/backup scripts, systemd units, nginx config
```

No `node_modules`, no `json-server`, no `data/*.json` fixtures.

## 2. Database and migrations

- SQLite via `better-sqlite3`, opened lazily in `src/lib/database.ts`
  (`DATABASE_PATH`, default `./data/callflow.db`; VPS uses `/var/data/callflow.db`).
- `migrations/schema.sql` is the only schema file. It runs at boot with
  `CREATE TABLE/INDEX IF NOT EXISTS`, so there is no separate migrate command.
- `src/lib/database.ts` adds later columns with idempotent `ALTER TABLE`
  (`CALL_ADDED_COLUMNS`, `BUSINESS_ADDED_COLUMNS`) before the schema executes.
- Tables: `businesses`, `calls`, `contacts`, `activity_logs`, `settings`,
  `client_profile`, `admin_audit_log`, `leads`, `waitlist`, `dodo_webhook_events`,
  `owner_login_tokens`. Key columns: `businesses.assignedNumber` (the DID),
  `businesses.onboardingStep`, `businesses.subscriptionStatus`,
  `calls.dograhRunId` (idempotency key), `calls.businessId` (nullable).
- Historical columns still present: `calls.textBackSent`, `calls.textBackSentAt`,
  `calls.signalwireCallSid`, `businesses.smsVerificationCode`,
  `businesses.smsVerificationExpiresAt`.

## 3. API routes (method - purpose)

| Route | Purpose |
|---|---|
| `POST /api/auth/login` | owner sign-in (email + password) |
| `POST /api/auth/logout` | clear the owner session |
| `POST /api/auth/setup-password` | set a password from a one-time link |
| `POST /api/auth/change-password` | change the owner password |
| `GET /api/me` | current business + billing state |
| `POST /api/billing/signup` | start a trial signup and mint hosted checkout |
| `POST /api/billing/checkout` | new checkout session for a signed-in business |
| `POST /api/billing/portal` | Dodo customer portal link |
| `POST /api/billing/confirm` | confirm a checkout return |
| `POST /api/webhooks/dodo` | Dodo events (subscription lifecycle) |
| `POST /api/webhooks/dograh` | Dograh end-of-call webhook (section 4) |
| `GET /api/webhooks/dograh/health` | health probe |
| `POST /api/v1/telephony/telnyx/answer` | Telnyx inbound-call answer + transfer |
| `POST /api/plivo/answer` | legacy Plivo answer (unwired) |
| `GET/POST /api/onboarding/start` | save business info, assign a pool number |
| `POST /api/onboarding/step` | advance the linear onboarding step |
| `GET /api/onboarding/state` | onboarding state for the polling UI |
| `GET /api/calls` | owner call list (scoped to the session) |
| `POST /api/leads` | public lead capture |
| `GET/POST /api/settings` | owner settings (name, email, FCM token) |
| `GET /api/client` | business profile for the UI |
| `POST /api/waitlist` | waitlist signup |
| `/api/admin/*` | admin panel JSON endpoints (auth via admin session) |

## 4. Full code of `/api/webhooks/dograh`

Verbatim from the working tree at audit time, with punctuation normalised to
ASCII (see also `src/lib/dograh-webhook.ts` for the handler and
`src/lib/dograh.ts` for parsing/auth):

```ts
import { after } from "next/server";
import { NextResponse } from "next/server";
import {
  deliverOwnerEmail,
  deliverOwnerPush,
  handleDograhWebhook,
} from "@/lib/dograh-webhook";

/**
 * Receives Dograh workflow "send webhook" deliveries at end of call.
 *
 * Configure in the Dograh workflow editor:
 *   URL:     https://<your-host>/api/webhooks/dograh
 *   Method:  POST
 *   Header:  x-webhook-secret: <WEBHOOK_SECRET from .env>
 *   Body:    JSON with callId (required) - see README "Webhook contract".
 *
 * Responses: 200 {"ok":true} = stored/updated (stop retries); 401 = wrong or
 * missing secret; 400 = bad JSON or no callId. The owner push notification is
 * scheduled with after() so it runs after the response is sent and can never
 * delay it. Normal logging is one line per request - method, callId, status
 * code - and never includes the secret, headers, or body.
 *
 * An authenticated call whose dialled number matches no business is stored with
 * business_id NULL (it appears under /admin/calls -> "Unlinked only"); only
 * unauthenticated or callId-less payloads are rejected without a row.
 */

export async function POST(request: Request) {
  let body: unknown = null;
  let jsonInvalid = false;
  try {
    body = await request.json();
  } catch {
    jsonInvalid = true;
  }

  // The payload's SHAPE is logged by handleDograhWebhook when a call cannot be
  // attributed (key names only, never values), so no per-call debug line here.
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
      // Push runs after the response is flushed.
      after(() => deliverOwnerPush(plan));
    }
    if (result.alertPlan) {
      const plan = result.alertPlan;
      // Same for the owner email: SMTP latency never touches the webhook reply.
      after(() => deliverOwnerEmail(plan));
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


## 5. Auth / session logic

- **Owner session**: `callflow_business_session` cookie, HMAC-SHA256 signed with
  `BUSINESS_SESSION_SECRET`, HttpOnly + SameSite=Lax, 30 days
  (`src/lib/business-session.ts`). `businessIdFromCookieHeader()` is the server
  check used by API routes; pages use `cookies()`.
- **Admin session**: `callflow_admin_session`, signed with
  `ADMIN_SESSION_SECRET`, HttpOnly + SameSite=Strict, 8 hours; credential is the
  scrypt `ADMIN_PASSWORD_HASH`. `requireAdminApi()` guards `/api/admin/*`,
  `admin-page-guard.ts` guards the pages. Both env vars are required - when
  missing, admin surfaces answer 404 (fail closed).
- **Owner password**: `src/lib/business-password.ts` (scrypt), one-time setup
  tokens stored as SHA-256, `passwordHash` never included in API responses.
- **Webhook auth**: `x-webhook-secret` must match `WEBHOOK_SECRET` in constant
  time (sha256 + `timingSafeEqual`); missing on either side = 401.

## 6. Environment variables (names only)

Read at runtime: `DATABASE_PATH`, `DB_REQUIRE_PERSISTENT_PATH`, `NODE_ENV`,
`DEBUG`, `CORS_ORIGINS`, `APP_AUTH_TOKEN`, `PUBLIC_BASE_URL`,
`NUMBERS_POOL_PATH`, `BUSINESS_SESSION_SECRET`, `ADMIN_PASSWORD_HASH`,
`ADMIN_SESSION_SECRET`, `WEBHOOK_SECRET`, `FIREBASE_SERVICE_ACCOUNT`, `SMTP_HOST`,
`SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `LEADS_NOTIFY_EMAIL`,
`DODO_PAYMENTS_API_KEY`, `DODO_PAYMENTS_ENVIRONMENT`,
`DODO_PAYMENTS_WEBHOOK_SECRET`, `DODO_SOLO_PRODUCT_ID`,
`DODO_PAYMENTS_RETURN_URL`, `DODO_PAYMENTS_CANCEL_URL`, `TELNYX_API_KEY`,
`TELNYX_PUBLIC_KEY`, `TELNYX_NUMBER`, `TELNYX_FORWARD_TO`, plus legacy
`PLIVO_AUTH_ID`, `PLIVO_AUTH_TOKEN`, `PLIVO_NUMBER`.

Never printed; `.env*` files are git-ignored.

## 7. Leftover SignalWire / Plivo / TextBelt code

- `src/app/api/plivo/answer/route.ts` - Plivo answer webhook, not called by
  anything (Telnyx is the live answering path).
- `src/lib/plivo.ts`, `src/lib/plivo-signature.test.ts` - Plivo signature helper.
- `src/lib/laml.ts` - Plivo LAML/XML helper, used only by that route.
- `src/lib/sms.ts`, `src/lib/sms.test.ts` - SMS helper (TextBelt era).
- Legacy columns: `calls.textBackSent`, `calls.textBackSentAt`,
  `calls.signalwireCallSid`, `businesses.smsVerificationCode`,
  `businesses.smsVerificationExpiresAt`.
- `db.ts::getCallBySignalwireSid()` - exported, never called.
- `db.ts::getCallsBySignalwireSid`-style helpers and `ActivityLog.type === "sms"`.
- `PLIVO_*` in `.env.example`; Plivo wording in README, RUNBOOK, privacy page.

No TextBelt SDK, no `json-server`, no JSON fixtures remain.

## 8. Broken / unfinished at audit time

| # | Problem | Step |
|---|---|---|
| 1 | Unmatched Dograh calls were rejected with 200 and never stored, so `/admin/calls` could never show them | 1 |
| 2 | `sendCallAlertEmail()` existed but was never called - no email alerts at all | 4 |
| 3 | No day-2 trial email with the charge date (no scheduler exists) | 5 |
| 4 | `/setup` page still present as a redirect stub | 2 |
| 5 | Admin "Create customer" flow still present (brief says remove) | 2 |
| 6 | Number pool is a JSON file, not the `numbers` table the brief specifies | 2 |
| 7 | No `/savannah` or `/austin` city pages; homepage demo slots empty | 7 |
| 8 | Trial-expired businesses still reached the AI agent (no gate) | 2 |
| 9 | Debug logging in the Dograh route | 1 |

