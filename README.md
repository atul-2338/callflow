# CallFlow — Missed-Call Answering for Local Businesses

CallFlow forwards a business's missed calls to a Plivo number answered by a Dograh AI voice agent that books appointments. Call history, transcripts, and push notifications are stored/sent locally (SQLite + Firebase Cloud Messaging).

> **Status:** the legacy SignalWire IVR/SMS stack has been deleted. The **Dograh
> end-of-call webhook is live** (`POST /api/webhooks/dograh`, see [Call flow](#call-flow-plivo--dograh)),
> the **Dodo hosted-checkout billing path is live** (see [Billing](#billing-dodo-payments)),
> and the **self-serve forwarding wizard** (carrier dropdown, `tel:` link, silent
> test-call + SMS verification) is built. Remaining: live VPS deploy, live
> credentials for Plivo/Dograh/Dodo, and first customers.

## Tech stack

- **Next.js 16** (App Router, typed routes) + **React 19** + **TypeScript** (strict) + **Tailwind CSS 4**
- **Plivo** — forwarding number + test calls (REST API via `src/lib/plivo.ts`)
- **Telnyx** — inbound call forwarding to the Dograh agent (Call Control API via `src/lib/telnyx.ts`)
- **Dograh AI** — voice agent (webhook integration in Phase 4)
- **Firebase Admin** (`firebase-admin`) — push notifications via FCM
- **SQLite** (`better-sqlite3`) — persistent database (file location configurable via `DATABASE_PATH`)

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Environment variables

Copy `.env.example` to `.env.local` and fill in real values:

| Variable | Purpose |
|---|---|
| `PLIVO_AUTH_ID` | Plivo auth ID (forwarding test calls — Phase 3) |
| `PLIVO_AUTH_TOKEN` | Plivo auth token |
| `PLIVO_NUMBER` | Your Plivo number (E.164) that missed calls forward to |
| `TELNYX_API_KEY` | Telnyx API key (Call Control transfer commands) |
| `TELNYX_PUBLIC_KEY` | Telnyx webhook public key (Ed25519 signature verification) — Mission Control → API Keys → Public Key |
| `TELNYX_NUMBER` | Your Telnyx number (E.164) that missed calls forward to |
| `TELNYX_FORWARD_TO` | The Dograh agent number (E.164) that forwarded calls are transferred to |
| `CALLFLOW_FORWARDING_DID` | The CallFlow forwarding number (E.164) shown in the setup wizard — served by `GET /api/setup/config` and used to build the carrier dial codes. Must match the real `PLIVO_NUMBER`/`TELNYX_NUMBER` DID. Unset or invalid = the wizard shows an error state (the endpoint answers 503). |
| `WEBHOOK_SECRET` | Shared secret the Dograh webhook node sends to `/api/webhooks/dograh` in the `x-webhook-secret` header (name matched case-insensitively). Compared in constant time; a wrong or missing secret — on either side — fails closed with 401. |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase service account JSON — single-line or base64-encoded |

| `APP_AUTH_TOKEN` | *Optional.* Shared secret to protect write APIs (leave empty to keep APIs open) |
| `DATABASE_PATH` | Filesystem path to the SQLite database file. Defaults to `./data/callflow.db` — fine locally and on any host with a real disk. **Required on hosts that wipe the app disk on redeploy** (Render / Vercel / Fly / Heroku / Kubernetes, auto-detected) or whenever `DB_REQUIRE_PERSISTENT_PATH=1` is set — see [Deploying to a VPS](#deploying-to-a-vps-current-plan). |
| `DB_REQUIRE_PERSISTENT_PATH` | *Optional.* Set to `1` to arm the `DATABASE_PATH` guard on a host the app cannot auto-detect. `deploy/systemd/callflow.service` sets it, so the VPS fails loudly on a bad path. |
| `CORS_ORIGINS` | *Optional.* Comma-separated allowed origins for the API. Unset (or `*`) allows **any** origin. |
| `DEBUG` | *Optional.* Set to `1`/`true` to enable verbose `debugLog()` output from `src/lib`. Off by default. |

> `PUBLIC_BASE_URL` is read by `/api/onboarding/verify` to build the Plivo
> verification-call answer URL. Plivo must be able to reach it, so it cannot be
> `http://localhost:3000` — use your ngrok/tunnel host or `https://callflow.biz`.

Every variable above is read at **runtime**, never at build time. There are no
`NEXT_PUBLIC_*` variables, so nothing is baked into the client bundle and the
production build succeeds with no environment variables set at all.

## Database (SQLite)

CallFlow stores all data (contacts, settings, client profile, activity logs, calls) in a single SQLite database file using `better-sqlite3`.

- **Schema:** `migrations/schema.sql` (applied automatically at startup via `CREATE TABLE IF NOT EXISTS`).
- **Default location:** `./data/callflow.db`.
- **Override:** set `DATABASE_PATH` to point the database elsewhere. The app
  rejects a missing or project-local value **only where that would actually lose
  data** — on hosts that rebuild the app disk on every deploy (auto-detected) or
  when `DB_REQUIRE_PERSISTENT_PATH=1` is set. See
  [Why `DATABASE_PATH` must point to a persistent disk](#why-database_path-must-point-to-a-persistent-disk).

### Local setup

The schema is created automatically on first run — there is no manual migration step. (The legacy `data/*.json` mock files and the one-time JSON→SQLite import script have been removed; SQLite is the single source of truth.)

> The live `.db` file is gitignored — only `migrations/schema.sql` is committed. Never commit a database file.

## Call flow (Plivo + Telnyx + Dograh)

A business's carrier forwards missed calls to the CallFlow forwarding number
(Plivo or Telnyx); Dograh's AI agent answers and books appointments. At end of
call the workflow's **send webhook** node POSTs the result to Callflow, which
writes the `calls` row and pushes an FCM notification to the business owner.

### Telnyx call forwarding

The Telnyx number receives the business's forwarded missed calls. Telnyx
POSTs a `call.initiated` webhook to `/api/v1/telephony/telnyx/answer`; after
the Ed25519 signature is verified, the call is transferred to the Dograh agent
number (`TELNYX_FORWARD_TO`) via the Call Control API, with the original
caller's number as the caller ID.

Configure in Mission Control → Connections (the Call Control App behind the
forwarding number):

- **Webhook URL**: `https://<your-host>/api/v1/telephony/telnyx/answer`
- **Webhook API version**: `2`
- Do **not** auto-answer: the transfer is issued while the call is still
  ringing.

Signature verification follows the official SDK's standardwebhooks pattern:
the signed message is `timestamp|body` (headers `Telnyx-Signature-Ed25519` +
`Telnyx-Timestamp`), with a 5-minute replay window. `TELNYX_PUBLIC_KEY` is the
account public key from Mission Control → API Keys → Public Key. When it is
unset the endpoint is open (local dev only); in production it rejects every
webhook with 503 until the key is set.

Local smoke test (works only with `TELNYX_PUBLIC_KEY` unset — a real delivery
carries a signature only Telnyx's private key can produce):

```bash
node scripts/simulate-telnyx-call.mjs
```

### Webhook contract

- **Endpoint**: `POST /api/webhooks/dograh` — the one call webhook. Auth rides
  on the `x-webhook-secret` header (name matched case-insensitively) compared
  against `WEBHOOK_SECRET` in constant time. Wrong or missing secret — on
  either side — is rejected with **401**.
- **Body**: user-authored JSON in the webhook node. Required: `callId`.
  Optional: `status`, `duration`, `gathered.context.customer_name`, plus
  `caller_number` / `called_number` (used to link the call to its business).
  Everything else is ignored. Dograh's renderer **stringifies every value**, so
  nested dicts can arrive as JSON-encoded strings and numbers as strings — the
  parser (`src/lib/dograh.ts`) accepts both, plus the previous template's key
  aliases (`call_id`, `workflow_run_id`, `duration_seconds`,
  `gathered_context.customer_name`).
- **Validation**: bad JSON or a body without `callId` → **400**.
- **Persistence**: the call is upserted into the `calls` table — the same
  `callId` twice **updates** the existing row and never creates a duplicate
  (`callId` is stored in `dograhRunId`, guarded by a partial unique index in
  `migrations/schema.sql`). The exact payload is archived in
  `calls.rawPayload`.
- **Response**: `200 {"ok":true}` immediately. The owner push notification is
  scheduled with `after()` and runs after the response is sent (new calls
  only — replays never re-notify). Logging is one line per request: method,
  callId, status code; the secret, headers and body are never logged.
- **Probes**: `GET /api/webhooks/dograh/health` → `200 {"ok":true}` with no
  secret; `GET /api/webhooks/dograh` itself answers **405** (POST-only).

### Dograh workflow configuration

In the workflow's end-of-call **send webhook** node set:

- **URL**: `https://<your-host>/api/webhooks/dograh`
- **Method**: `POST`
- **Custom headers**: `x-webhook-secret: <WEBHOOK_SECRET>` (the same value as
  the server's `.env`/`.env.local`) and `Content-Type: application/json`
- **Body** — paste as-is (`callId` is the one required key):

```json
{
  "callId": "{{workflow_run_id}}",
  "status": "{{gathered_context.call_status}}",
  "duration": "{{cost_info.call_duration_seconds}}",
  "caller_number": "{{initial_context.caller_number}}",
  "called_number": "{{initial_context.called_number}}",
  "gathered": "{{gathered_context}}",
  "initial_context": "{{initial_context}}"
}
```

The renderer stringifies `gathered_context` / `initial_context` into
JSON-encoded strings; the parser reads `customer_name` out of
`gathered.context` (falling back to `gathered_context.customer_name` and a
flat `customer_name`), so the customer name reaches the dashboard as long as
the workflow actually gathered it — otherwise it stays empty and the dashboard
says "Not captured" instead of guessing. `status` values outside
`answered | missed | busy | failed | voicemail_left` are stored as `answered`
(an end-of-call delivery means the agent spoke). An older template that sends
`workflow_run_id` / `duration_seconds` keeps working through the key aliases.

### Caller details + follow-up workflow (MVP)

The dashboard (`/app`) and the full call log (`/calls`) show every call with
its captured details, transcript/recording, and an owner follow-up workflow:

- **Capture** — caller name/number, status, duration, and the customer name
  come from the Dograh webhook (above); the exact payload is archived in
  `calls.rawPayload`. Missing details are labeled "Not captured"; failed/missed
  calls say so explicitly.
- **Follow-up** — flag a call for follow-up, keep notes, and mark it resolved
  via `PATCH /api/calls/<id>` with JSON body
  `{ "followUpStatus": "needed" | "resolved" | "none", "followUpNotes": "…" }`
  (either field optional; notes capped at 2000 chars). Both list pages expose
  filter chips for follow-up state.

### Outcome mapping (historical)

The old `call_disposition` → outcome mapping is gone with the previous
contract: the webhook stores the delivered `status` (mapped onto
`answered | missed | busy | failed | voicemail_left`, defaulting to
`answered`) and leaves `calls.outcome` null, which the dashboard shows as
"other".

### Business matching (pilot)

Dograh sends `called_number` = the number the caller dialled (the DID). Calls
link to the business that owns that number:

1. exact hit on `businesses.phoneNumber` (normalized E.164) → that business;
2. no hit and exactly **one** business exists → that business;
3. otherwise the call is stored with `businessId = NULL` and a warning is
   logged — nothing is silently dropped.

### Testing without a real call

```bash
export WEBHOOK_SECRET="<value from .env.local or /srv/callflow/.env>"

# Liveness — no secret needed:
curl http://localhost:3000/api/webhooks/dograh/health            # 200 {"ok":true}

# Good call → 200 {"ok":true} (run twice → still ONE row, fields updated):
curl -X POST http://localhost:3000/api/webhooks/dograh \
  -H "Content-Type: application/json" -H "x-webhook-secret: $WEBHOOK_SECRET" \
  -d '{"callId":"test-probe-1","status":"answered","duration":91,"called_number":"+15550001111","gathered":{"context":{"customer_name":"Jo Caller"}}}'

# Wrong secret → 401 | no secret → 401 | bad JSON → 400 | no callId → 400
curl -X POST http://localhost:3000/api/webhooks/dograh \
  -H "Content-Type: application/json" -H "x-webhook-secret: wrong" \
  -d '{"callId":"test-probe-2"}'                                 # 401
curl -X POST http://localhost:3000/api/webhooks/dograh \
  -H "Content-Type: application/json" -d '{"callId":"test-probe-2"}'  # 401
curl -X POST http://localhost:3000/api/webhooks/dograh \
  -H "Content-Type: application/json" -H "x-webhook-secret: $WEBHOOK_SECRET" \
  -d 'not-json'                                                  # 400
curl -X POST http://localhost:3000/api/webhooks/dograh \
  -H "Content-Type: application/json" -H "x-webhook-secret: $WEBHOOK_SECRET" \
  -d '{"status":"answered"}'                                     # 400

# GET on the webhook → 405 (POST-only; use /health for liveness):
curl -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/webhooks/dograh

# Verify persistence (one row per callId) — then clean up the probe rows:
node scripts/last-calls.cjs   # direct SQLite read, no auth needed
npm run clear-test            # removes only rows whose callId starts with "test-"
```

`npm test` covers the same paths against a real temp SQLite
(`src/lib/dograh.test.ts`, `src/lib/dograh-webhook.test.ts`).


## Dashboard (`/app`)

The iOS-styled (light) pilot dashboard lives at **`/app`** — separate from the
legacy dark `(app)` screens until the Phase 5 rebuild retires them. It reads
`GET /api/calls` and shows:

- **Today at a glance** — booked / callback / voicemail counts for the current day;
- **Outcome filter pills** — all, booked, callback, voicemail, handled, other;
- **Call list** — customer name (from `gathered_context`) or caller number,
  friendly timestamp ("Today, 3:42 PM"), duration, colored outcome pill, and a
  tap-to-expand panel with the flattened transcript, recording link, and
  calendar event id.

`GET /api/calls` also accepts `?outcome=booked` (returns `400` for unknown
values) in addition to the existing `?status=` / `?since=` filters.

## Push notifications (FCM)

1. The business owner's FCM device token is stored via `POST /api/settings` (`fcmToken`).
2. On every call outcome the Dograh webhook pushes a notification to the owner
   (outcome-specific title + `{callId, outcome, callerNumber}` data) — see
   `src/lib/dograh-webhook.ts`.
3. If FCM rejects the token itself (`messaging/unregistered` — app uninstalled, token rotated), the webhook clears the stored token so later deliveries skip the push step; re-register the device via `POST /api/settings`. Transient FCM failures (network, quota) keep the token.

An FCM token is generated by the Firebase SDK running on a device/app. Until you build the mobile app, the fastest way to get one for testing is a small page using the Firebase Web SDK's `getToken()`.

## Forwarding wizard & verification (Phase 5)

The self-serve wizard (`src/components/onboarding/OnboardingFlow.tsx`) walks the
owner through: business number + carrier (saved as the Destination Number, no
calls forwarded yet) → carrier-specific forwarding dial code with `tel:` links
→ owner confirms they dialed the code → Dodo checkout. The carrier-side code
forwards only unanswered calls; nothing goes live until the owner confirms.
Confirmation (`/api/onboarding/complete`), either server-side verification
method, or the first live forwarded call that is successfully transferred to
the Dograh agent flips `forwardingStatus` to `active`:

| Route | Method | What it does |
|---|---|---|
| `/api/onboarding/start` | POST | Create/update the business row (`phone_number`, `carrier`) |
| `/api/onboarding/complete` | POST | Mark onboarding complete — owner attests they dialed the carrier dial code; flips `forwardingStatus` to `active` |
| `/api/onboarding/verify` | POST | Place a silent test call via Plivo; the answer URL verifies |
| `/api/plivo/answer` | POST/GET | Plivo answer URL — signature-verified, marks the business `active` |
| `/api/v1/telephony/telnyx/answer` | POST | Telnyx Call Control webhook — signature-verified transfer to the Dograh agent; a transfer Telnyx accepts (200 OK) marks the attributed business `active`, a failed transfer answers 500 and leaves it `pending` |
| `/api/onboarding/verify-sms` | POST | Send a 6-digit code to the business number via Plivo SMS |
| `/api/onboarding/confirm-sms` | POST | Consume the code and mark the business `active` |
| `/api/onboarding/status/[businessId]` | GET | Poll forwarding status (the wizard polls this after a test call) |

Plivo's `X-Plivo-Signature-V2` is verified on `/api/plivo/answer`
(`src/lib/plivo.ts`); with `PLIVO_AUTH_TOKEN` unset the check is skipped (local
dev only). SMS sending lives in `src/lib/sms.ts` and requires the carrier-side
toll-free verification / 10DLC registration before real US traffic.

The Telnyx transfer doubles as the end-to-end forwarding check: a call reaching
`/api/v1/telephony/telnyx/answer` arrived on the CallFlow number, and a `200
OK` from the Telnyx transfer command proves it reached the agent. Only then is
the attributed business (Dograh convention: direct match on the dialled number,
then the single-business fallback) marked `active` — a failed transfer answers
500 so Telnyx redelivers the event (the event-derived command id keeps the
retry a no-op once a transfer actually went through) and the status stays
`pending`.

Carrier dial codes (Verizon `*71` + 10-digit number; AT&T/T-Mobile/GSM
carriers `**61*` + 1 + number + `**11*15#`, with cancel codes) live in
`src/lib/forwarding-codes.ts`, tested in `src/lib/forwarding-codes.test.ts`.

## Waitlist (Phase 6)

`POST /api/waitlist` with `{ email }` records a landing-page signup
(idempotent per email). The landing page renders the form via
`src/components/marketing/WaitlistForm.tsx`.

## Testing

```bash
npm test             # unit tests (Vitest)
npm run lint         # ESLint
npm run test:build   # production build
```

## API routes

| Route | Method | Description |
|---|---|---|
| `/api/contacts` | GET/POST/PUT/DELETE | Contact CRUD |
| `/api/contacts/[id]/actions` | POST | `log-call` |
| `/api/contacts/[id]/activity` | GET | Per-contact activity log |
| `/api/settings` | GET/POST | Settings (reply template, FCM token) |
| `/api/calls` | GET | Call log (`?status=&since=&outcome=`) |
| `/api/webhooks/dograh` | POST | Dograh end-of-call webhook — upsert on `callId`, owner push after the response (auth: `x-webhook-secret` header vs `WEBHOOK_SECRET`; GET → 405) |
| `/api/webhooks/dograh/health` | GET | Webhook liveness probe (no secret) |
| `/api/webhooks/dodo` | POST | Dodo Payments webhook — signature-verified writer of `subscriptionStatus` |
| `/api/billing/signup` | POST | Create Dodo customer + hosted Checkout Session for the Solo plan |
| `/api/billing/portal` | POST | Open the Dodo customer portal (update card / cancel) |
| `/api/billing/confirm` | POST | Checkout-return verification: trusted billing state, plus a server-side status check against Dodo's API while the webhook is still pending |
| `/api/me` | GET | Signed-in business's billing state (polled by the dashboard and wizard) |
| `/api/onboarding/start` | POST | Create/update the business row for the forwarding wizard |
| `/api/onboarding/verify` | POST | Place the silent test-call verification |
| `/api/onboarding/verify-sms` | POST | Send the SMS verification code |
| `/api/onboarding/confirm-sms` | POST | Confirm the SMS code and mark the number verified |
| `/api/onboarding/status/[businessId]` | GET | Forwarding status (polled by the wizard) |
| `/api/plivo/answer` | POST/GET | Plivo answer URL for the silent test call (signature-verified) |
| `/api/v1/telephony/telnyx/answer` | POST | Telnyx Call Control webhook — transfers inbound calls to the Dograh agent; success confirms the attributed business's forwarding, failure answers 500 |
| `/api/waitlist` | POST | Landing-page waitlist signup (idempotent per email) |


## Auth

Write endpoints accept an optional bearer token: if `APP_AUTH_TOKEN` is set, a
matching `Authorization: Bearer <token>` header is required on writes. **If
`APP_AUTH_TOKEN` is unset or empty, every write endpoint is open to the public
internet** — `isAuthorized()` returns `true` unconditionally.

Call data (`GET /api/calls`, `PATCH /api/calls/<id>`) accepts either
credential: a **business session cookie** (set by checkout signup) scopes every
read/write to that business's rows only, otherwise the `APP_AUTH_TOKEN` bearer
applies. With the token unset (the launch configuration), call APIs are open
in this single-pilot deployment, same as the writes.

Other guards added with the MVP:

- `POST /api/billing/signup` mints the session cookie **only** for newly
  created businesses (typing an existing business's phone number alone no
  longer yields a session) and is rate-limited per IP and per phone number.
- The verification call/SMS endpoints (`/api/onboarding/verify`,
  `/api/onboarding/verify-sms`, `/api/onboarding/confirm-sms`) and
  `/api/onboarding/complete` are rate-limited per business and per IP, so the
  paid Plivo triggers cannot be abused.
- The SMS verification code is generated with the OS CSPRNG, and
  `GET /api/plivo/answer` no longer flips forwarding status (only the
  signature-verified POST does).

**Current launch decision:** ship with `APP_AUTH_TOKEN` unset, accepting open
write APIs, because of the client-side gap below. Revisit this when auth gets a
real UI.

> **Known gap before you enable this in production.** `src/lib/api.ts` reads the
> token from `localStorage` key `callflow_auth_token`, but no UI currently calls
> `setAuthToken()`. If you set `APP_AUTH_TOKEN`, the dashboard's own writes will
> start failing with `401` until you seed that key manually from the browser
> console:
>
> ```js
> localStorage.setItem("callflow_auth_token", "<your APP_AUTH_TOKEN>")
> ```

## Deploying to a VPS (current plan)

Any 2 GB / 1 vCPU Ubuntu 24.04 box. This replaced Render because Render's free
instance type has **no persistent disk**, and SQLite on an ephemeral filesystem
loses every contact, call, and settings row on the first redeploy. The Render
instructions below are kept as historical reference only.

Everything lives in `deploy/`:

| File | What it does |
|---|---|
| `vps-bootstrap.sh` | One-time: Node 24, `callflow` service user, `/var/data`, checkout at `/srv/callflow`, `.env` template, systemd + nginx units, 2 GB swap, UFW, nightly backup timer |
| `vps-deploy.sh` | Every later release: fetch, `npm ci`, build, restart, health-check, **auto-rollback** if the checks fail |
| `backup.sh` | `VACUUM INTO` snapshot (WAL-safe), daily/weekly retention |
| `systemd/callflow.service` | Runs `next start -H 127.0.0.1 -p 3000` as `callflow` |
| `systemd/callflow-backup.{service,timer}` | Nightly backup at 03:15, `Persistent=true` so a missed run catches up |
| `nginx/callflow.conf` | Port-80 reverse proxy **only** — certbot adds the TLS server block itself |

### Why systemd instead of PM2

PM2's own restart-on-crash is redundant (`Restart=always` does it), and keeping
PM2 alive across reboot requires `pm2 startup`, which generates a systemd unit
anyway — so systemd ends up being the supervisor either way, with a PM2 daemon
and a `~/.pm2/dump.pm2` process list in between that is easy to drift. A unit
file is also declarative and version-controlled here, whereas `pm2 save` state
is invisible to git. PM2's nicer logs are worth it for multi-app fleets; for one
app, `journalctl -u callflow -f` is enough.

`NODE_MAJOR` defaults to **24** to match `.node-version`; `package.json` requires
`node >=22`. Pin 22 with `sudo NODE_MAJOR=22 bash deploy/vps-bootstrap.sh`.

### Runbook

**1. DNS.** At your registrar, point both records at the server IP and wait for
them to resolve (`dig +short callflow.biz`):

```
A     @     <SERVER_IP>
A     www   <SERVER_IP>
```

**2. Lock down SSH before anything is exposed.** As root:

```bash
adduser deploy
usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy   # from your laptop
ufw allow OpenSSH
ufw enable
```

Confirm `ssh deploy@<SERVER_IP>` works, **then** disable root/password login:

```bash
sudoedit /etc/ssh/sshd_config      # PermitRootLogin no, PasswordAuthentication no
sudo systemctl restart ssh
```

Keep your existing root session open until the new one is proven to work.

**3. Provision.** Clone the repo and run the bootstrap (it re-clones into
`/srv/callflow` owned by the service user, so your clone location does not matter):

```bash
git clone https://github.com/atul-2338/callflow.git ~/callflow
cd ~/callflow
sudo bash deploy/vps-bootstrap.sh
```

For a private repo, export `REPO_URL` with a fine-grained PAT (read-only
Contents) before running it — see the note in the script's clone step.

The first run writes `/srv/callflow/.env` and **tells you to edit it**. Fill in
the Plivo/Firebase values (see [Required environment variables](#required-environment-variables)),
then re-run the same command; it is idempotent and will not overwrite your `.env`.

**4. TLS.** Only after DNS points here:

```bash
sudo certbot --nginx -d callflow.biz -d www.callflow.biz
```

Choose the redirect option. certbot edits `sites-available/callflow.conf` in
place, adding the HTTPS block — which is why that file ships HTTP-only.

**5. Verify.**

```bash
systemctl status callflow --no-pager
curl -i http://127.0.0.1:3000/pricing      # process is serving
curl -i http://127.0.0.1:3000/api/contacts # 200 + JSON [] → guard satisfied, DB opened
curl -I https://callflow.biz/pricing       # nginx + TLS end to end
systemctl list-timers callflow-backup.timer
```

A `500` on `/api/contacts` naming `DATABASE_PATH` means the env file is missing or
points inside the project directory — the systemd unit exports
`DB_REQUIRE_PERSISTENT_PATH=1`, so the guard is armed on this host even though a VPS
is not one of the auto-detected ephemeral platforms.

### Running production mode locally

`npm run build && npm start` needs **no** `DATABASE_PATH` and no extra flags: with
`NODE_ENV=production` on an unrecognised host the guard stays off, the app logs one
warning naming the file it chose, and everything serves from `./data/callflow.db`.
To rehearse the VPS behaviour (or Render's) on the same build, set the trigger
explicitly:

```bash
DB_REQUIRE_PERSISTENT_PATH=1 npm start   # VPS unit does this
RENDER=1 npm start                       # what Render's boot looks like
```

Either one makes every DB route return `500` until `DATABASE_PATH` points outside
the checkout — which is exactly the failure you want to see locally rather than on a
live deploy.

### Deploying a new version

```bash
sudo bash /srv/callflow/deploy/vps-deploy.sh
```

Refuses to run on a dirty tree, rebuilds, restarts, then gates on `/pricing` and
`/api/contacts` both returning 200 — rolling back to the previous commit and
rebuilding if either fails. Roll back by hand with
`git -C /srv/callflow reset --hard <sha> && npm run build && systemctl restart callflow`.

The `.env` and `/var/data/callflow.db` both survive every deploy: `.env` is
gitignored, and the database sits outside the checkout.

### Backups

`backup.sh` runs nightly via the timer into `/var/backups/callflow/{daily,weekly}`.
It uses SQLite's `VACUUM INTO` rather than copying the file, because the database
runs in WAL mode — a plain `cp` of `callflow.db` misses whatever is still in
`callflow.db-wal`, and restoring it later silently drops the most recent writes.

**A backup on the same disk as the database is not a backup.** A VPS has no
platform volume snapshots, so un-comment one of the rsync/S3/rclone lines at the
bottom of `backup.sh`. Restore with:

```bash
gunzip -c /var/backups/callflow/daily/callflow-<date>.gz > /var/data/callflow.db
sudo chown callflow:callflow /var/data/callflow.db && sudo systemctl restart callflow
```

## Deploying to Render (historical — not used)

Render's free tier cannot host this app, because it has no persistent disk to put
the SQLite file on. Everything in this section still describes the app's real
env-var needs and is kept for reference.

### Required environment variables

| Variable | Notes |
|---|---|
| `DATABASE_PATH` | **Required on Render.** Absolute path on the persistent disk mount (see below). Render sets `RENDER=1`, which arms the guard: if the value is omitted, relative, or inside the project directory, the app **refuses to open the database** and every DB route returns 500 with an explanatory error — no silent data loss. |
| `CORS_ORIGINS` | Comma-separated list of your own origins, e.g. `https://callflow.biz,https://www.callflow.biz`. **Unset means `*`** (any site may call the API). Origins must match exactly, no trailing slash; the app's own pages are same-origin so need no entry. Limits browser JS from other sites only — it is not a substitute for auth. |
| `APP_AUTH_TOKEN` | Leave **unset** at launch — setting it breaks dashboard writes until the client-side token gap is fixed. See [Auth](#auth). |
| `PLIVO_*` | Legacy — Plivo is not in use (the live provider is Telnyx); kept for old code, harmless if unset |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase service account JSON (single-line or base64) |
| `PUBLIC_BASE_URL` | Not read by any code yet — set it for future webhook use (Phases 3–4); harmless today |

### Why `DATABASE_PATH` must point to a persistent disk

Render's filesystem is **ephemeral** — anything written to the default project directory is wiped on every redeploy/restart. If the SQLite file stays at the default `./data/callflow.db`, your contacts/calls/settings will be **lost on every deploy**.

You must:

1. Attach a **persistent disk** to your Render service (Dashboard → your service → **Disks** → Add Disk). Mount it at e.g. `/var/data`.
2. Set `DATABASE_PATH=/var/data/callflow.db`.

The schema is created automatically on first boot — no manual migration step is required in production (there is no legacy JSON to import).

**Guard in place.** `dbPathPolicyError()` in `src/lib/database.ts` rejects any
configuration that would lose data — `DATABASE_PATH` unset, relative, or pointing
inside the project directory — and `requiresPersistentDbPath()` decides *when* that
rule is enforced: automatically when a platform that rebuilds the app disk is
detected (`RENDER`, `VERCEL`, `FLY_APP_NAME`, `DYNO`,
`KUBERNETES_SERVICE_HOST`), or manually via `DB_REQUIRE_PERSISTENT_PATH=1`.
Detection is deliberately positive, so an unknown host never fails at boot; that is
what makes a local `npm start` or a VPS work without the variable. Verified locally
against a production `npm start` build (same `.next` output, three boots):

| Boot config | `/`, `/pricing` | DB routes (`/api/contacts`, `/api/settings`, `/api/calls`) |
|---|---|---|
| `NODE_ENV=production`, unrecognised host, `DATABASE_PATH` unset | `200` | `200` from `./data/callflow.db`, plus one `[database] … guard is off` warning |
| `RENDER=1` (or `DB_REQUIRE_PERSISTENT_PATH=1`), `DATABASE_PATH` unset | `200` | `500`, plus `[database] DATABASE_PATH must be set in production…` in the service log |
| Guard armed + `DATABASE_PATH` absolute and outside the project dir | `200` | `200` — schema is auto-created on first access |

Two cases the guard cannot catch, so still verify after deploying:

- **Disk not attached / not mounted where you said** → `mkdirSync` throws on first
  access, so DB routes return **500** while marketing pages still return `200`.
  The deploy reports **green** either way (all API routes are dynamic and nothing
  touches SQLite during `next build`), so check the request log, not just the
  deploy status.
- **A writable path that is not the persistent disk** (e.g. `/tmp/callflow.db`) →
  passes the guard, and the data still vanishes on redeploy. Only you know which
  mount is durable.

Attach the disk **before** the first deploy, then confirm `callflow.db` (plus
`-wal`/`-shm`) appears under the mount after the first write.

### Order of operations (this is the trap to avoid)

Configuring the disk *after* the first deploy is what produces a service that looks
healthy while every DB route 500s. Render kicks off the initial deploy the moment
you click **Create**, so put the disk and the env vars in the **Advanced** section
of the creation form itself:

1. **New → Web Service**, connect the repo, pick the region closest to your users.
2. Compute plan: any **paid** plan (see the constraint table below), and keep
   instances at **1**.
3. **Advanced → Environment Variables**: add `DATABASE_PATH` and `CORS_ORIGINS`
   (values below) *before* creating. Env vars added later need a fresh deploy.
4. **Advanced → Persistent Disk**: mount path `/var/data`, smallest size you can
   pick (you can grow it later, but never shrink it).
5. **Create Web Service** — the first boot now has a durable path to write to.
6. **Advanced → Health check path** (optional): `/pricing`. It is static and never
   touches SQLite, so it cannot mask a DB problem — and it cannot fail for one
   either. Do **not** point a health check at an `/api/*` route.

If the service already exists and DB routes return 500: add the disk + env vars
under **Settings**, then **Trigger Deploy**. Nothing needs cleaning up — the guard
means the bad config never created a database inside the project directory.

### Disk & instance constraints (from Render's own docs)

| Constraint | Consequence for this app |
|---|---|
| Persistent disks attach only to **paid** services | Free tier has no disk option, so `DATABASE_PATH` has nowhere durable to point. Never launch on free. |
| Free instances wipe local files on redeploy **and** serve `Disallow: /` in `robots.txt` while spun down | Two independent reasons a free deploy is a build test only, not a live site. |
| A disk is reachable by **one instance only**, and not during the build | Matches SQLite WAL's single-writer rule. Nothing in this app touches the DB at build time (all DB routes are dynamic), which is why the build passes even with a broken DB path. |
| Attaching a disk disables zero-downtime deploys | A few seconds of unavailability per deploy; the swap exists to stop two versions writing one disk. |

Mount at `/var/data` — an absolute path outside the build directory
(`/opt/render/project/src`). Render validates the mount-path field in the
dashboard; if it ever refuses a path, pick another outside the build directory and
point `DATABASE_PATH` at it (our guard independently rejects any path *inside* the
project, since that directory is replaced on every deploy).

### Copy-paste env values for the first deploy

Only these two are needed to run the site. Everything else is optional and fails
soft when absent (Firebase is checked lazily and only affects push notifications,
never boot; Plivo is legacy and not in use):

```
DATABASE_PATH=/var/data/callflow.db
CORS_ORIGINS=https://callflow.biz,https://www.callflow.biz
```

- **Do not set `PORT`** — Render injects it (default `10000`) and `next start`
  honours it.
- **Leave `APP_AUTH_TOKEN` unset** at launch (see [Auth](#auth)).
- `www` is in the list because both hostnames will resolve to this one service;
  origins must match *exactly* (no trailing slashes). `http://localhost:3000` is
  deliberately **not** here: the dashboard calls `/api/...` on its own origin, so
  local dev is same-origin and needs no CORS entry. Add it only if you later run a
  separate local frontend against the production API, and remove it afterwards.

### Backups

Render takes daily disk snapshots, but a snapshot is only restorable to this
service's disk — and there is **no second copy** anywhere: `*.db` is gitignored, so
the database is never in the repository. Note also that SQLite in WAL mode keeps
live data in three files, so a snapshot must cover all of them, and copying only
`callflow.db` while `-wal` holds recent writes loses them:

```
/var/data/callflow.db
/var/data/callflow.db-wal
/var/data/callflow.db-shm
```



- Build command: `npm install && npm run build`
- Start command: `npm start`
- Node version: pinned by `.node-version` at the repo root, which **takes
  precedence over `engines` on Render**. `engines.node` is `>=22` (an unbounded
  range, which Render resolves to the newest available Node), so `.node-version`
  is what keeps production deterministic. `better-sqlite3` v13 uses N-API
  prebuilds (`linux-x64`, `linuxmusl-x64`), so no compiler/buildpack step is
  needed.
- `npm start` honours Render's injected `PORT` and binds all interfaces — no
  `-H`/`--hostname` flag or `HOSTNAME` variable is required.
- Keep the service at **one instance**. SQLite runs in WAL mode, which relies on
  a local `-shm` file and is unsafe across multiple instances sharing a disk.

### Public pages (pricing, refunds, terms, privacy)

The pages a payment provider's merchant review looks for live in the
`(marketing)` route group and are **fully static** — no client JS, no auth, and
no environment variables, so they build and serve even before Telnyx / Dograh /
Firebase / Dodo secrets exist:

| Route | File |
|---|---|
| `/pricing` | `src/app/(marketing)/pricing/page.tsx` |
| `/refund-policy` | `src/app/(marketing)/refund-policy/page.tsx` |
| `/terms` | `src/app/(marketing)/terms/page.tsx` |
| `/privacy` | `src/app/(marketing)/privacy/page.tsx` |

Shared header/footer come from `src/components/marketing/SiteChrome.tsx` (the
footer links all four pages and shows the support address
`atul@callflow.biz`); the legal body layout comes from
`src/components/marketing/PolicyPage.tsx`. Keep these links reachable from `/` —
reviewers crawl the homepage to find them.

### Custom domain (`callflow.biz`)

In the Render dashboard: **Your service → Settings → Custom Domains → Add
Custom Domain**, then enter `callflow.biz` and `www.callflow.biz`. Render shows
the exact target values; at the registrar:

| Host | Type | Value |
|---|---|---|
| `@` | A | `216.24.57.1` (Render's apex load balancer — confirm in dashboard) |
| `www` | CNAME | the `<service>.onrender.com` value Render displays |

Remove any existing `AAAA` records for `@` and `www` (Render's IPv6 addresses are
not usable as CNAME targets), leave TTL on auto/default, and let Render finish
issuing the certificate before pointing `PUBLIC_BASE_URL` at the domain.

### Webhooks (Telnyx + Dograh)

After deploy, point the Telnyx answer webhook (`/api/v1/telephony/telnyx/answer`)
and the Dograh end-of-call webhook (`/api/webhooks/dograh`, template + curl tests
above) at `https://<your-app-on-render>.onrender.com/...` (`PUBLIC_BASE_URL` must
match). Plivo is legacy and not wired to anything live.
