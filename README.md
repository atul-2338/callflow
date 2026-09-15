# CallFlow — Missed-Call Answering for Local Businesses

CallFlow forwards a business's missed calls to a Plivo number answered by a Dograh AI voice agent that books appointments. Call history, transcripts, and push notifications are stored/sent locally (SQLite + Firebase Cloud Messaging).

> **Migration in progress (build brief Phase 1):** the legacy SignalWire IVR/SMS stack has been deleted. The **Dograh end-of-call webhook is live** (`POST /api/webhooks/dograh`, see [Call flow](#call-flow-plivo--dograh)); Plivo forwarding verification and the rest of the Phase 5 UI are still landing.

## Tech stack

- **Next.js 16** (App Router, typed routes) + **React 19** + **TypeScript** (strict) + **Tailwind CSS 4**
- **Plivo** — forwarding number + test calls (REST API via `src/lib/plivo.ts`)
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
| `DOGRAH_WEBHOOK_SECRET` | Shared secret the Dograh webhook node sends to `/api/webhooks/dograh` (header `X-Callflow-Secret`, `Authorization: Bearer`, or `?key=`). Unset = endpoint is open. |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase service account JSON — single-line or base64-encoded |

| `APP_AUTH_TOKEN` | *Optional.* Shared secret to protect write APIs (leave empty to keep APIs open) |
| `DATABASE_PATH` | Filesystem path to the SQLite database file. Defaults to `./data/callflow.db` — fine locally and on any host with a real disk. **Required on hosts that wipe the app disk on redeploy** (Render / Vercel / Fly / Heroku / Kubernetes, auto-detected) or whenever `DB_REQUIRE_PERSISTENT_PATH=1` is set — see [Deploying to a VPS](#deploying-to-a-vps-current-plan). |
| `DB_REQUIRE_PERSISTENT_PATH` | *Optional.* Set to `1` to arm the `DATABASE_PATH` guard on a host the app cannot auto-detect. `deploy/systemd/callflow.service` sets it, so the VPS fails loudly on a bad path. |
| `CORS_ORIGINS` | *Optional.* Comma-separated allowed origins for the API. Unset (or `*`) allows **any** origin. |
| `DEBUG` | *Optional.* Set to `1`/`true` to enable verbose `debugLog()` output from `src/lib`. Off by default. |

> `PUBLIC_BASE_URL` is still listed in `.env.example` but is **not read by any
> code yet** — the webhook URLs that need it land with Plivo/Dograh in Phases
> 3–4. Setting it today has no effect.

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

## Call flow (Plivo + Dograh)

A business's carrier forwards missed calls to the Plivo number; Dograh's AI
agent answers and books appointments. At end of call the workflow's **send
webhook** node POSTs the result to Callflow, which writes the `calls` row and
pushes an FCM notification to the business owner.

### Webhook contract (verified against Dograh source)

- The body is a **user-authored template** in the webhook node — Dograh's
  renderer **stringifies every value**, so nested dicts arrive as JSON-encoded
  strings and numbers as strings. Callflow's parser (`src/lib/dograh.ts`)
  accepts both forms.
- Delivery is durable and **retried up to 5×** with backoff, then
  dead-lettered. Each retry regenerates `X-Dograh-Delivery-Id` while the run id
  stays stable, so Callflow dedupes on both (`dograhRunId` /
  `dograhDeliveryId`, backed by partial unique indexes in `migrations/schema.sql`).
- The webhook node supports **custom headers** → auth rides on
  `X-Callflow-Secret`; `Authorization: Bearer` and `?key=` also work.
- Telephony runs carry `caller_number` / `called_number` / `direction` in
  `initial_context`; outcomes in `gathered_context` (`call_disposition`, plus
  the platform-normalized `mapped_call_disposition`).
- `recording_url` / `transcript_url` are Dograh public-download links (302 to
  signed storage URLs). The transcript is a JSON file; Callflow flattens it to
  `Caller:` / `Agent:` lines and stores it in `calls.transcript`.

### Dograh workflow configuration

In the workflow's end-of-call **send webhook** node set:

- **URL**: `https://<your-host>/api/webhooks/dograh`
- **Method**: `POST`
- **Custom headers**: `X-Callflow-Secret: <DOGRAH_WEBHOOK_SECRET>` and `Content-Type: application/json`
- **Body** — paste as-is (every key is optional; the parser falls back to the
  nested contexts):

```json
{
  "workflow_run_id": "{{workflow_run_id}}",
  "workflow_name": "{{workflow_name}}",
  "call_time": "{{call_time}}",
  "direction": "{{initial_context.direction}}",
  "caller_number": "{{initial_context.caller_number}}",
  "called_number": "{{initial_context.called_number}}",
  "call_disposition": "{{gathered_context.call_disposition}}",
  "mapped_call_disposition": "{{gathered_context.mapped_call_disposition}}",
  "duration_seconds": "{{cost_info.call_duration_seconds}}",
  "recording_url": "{{recording_url}}",
  "transcript_url": "{{transcript_url}}",
  "customer_name": "{{gathered_context.customer_name}}",
  "calendar_event_id": "{{gathered_context.calendar_event_id}}",
  "initial_context": "{{initial_context}}",
  "gathered_context": "{{gathered_context}}"
}
```

### Disposition → outcome mapping

| Dograh disposition (case/space/dash-insensitive) | Callflow `outcome` |
|---|---|
| `appointment_booked`, `api_booked`, `booking_confirmed` | `booked` |
| `callback_requested`, `request_callback` | `callback` |
| `voicemail_detected`, `voicemail_left` | `voicemail` (`callStatus: voicemail_left`) |
| `answered`, `information_provided`, `transferred`, … | `handled` |
| anything unknown / future codes | `other` (never rejected) |

### Business matching (pilot)

Forwarded calls arrive with `called_number` = the **Plivo number**, not the
business's own line, so matching is deliberately conservative:

1. exact hit on `businesses.phoneNumber` (normalized) → that business;
2. exactly **one** business exists and either `PLIVO_NUMBER` is unset or equals
   `called_number` → that business;
3. otherwise the call is stored with `businessId = NULL` — nothing is silently
   dropped, and responses show `matchedBusiness: false`.

### Testing without a real call

```bash
# Full pipeline (parse → dedupe → match → DB write → push) via fixtures:
curl -X POST http://localhost:3000/api/webhooks/dograh/test \
  -H "Content-Type: application/json" -d '{"fixture":"booked"}'
# fixtures: booked | callback | voicemail | handled | unmatched

# Idempotency proof — run twice, second response has "duplicate": true:
curl -X POST http://localhost:3000/api/webhooks/dograh/test \
  -H "Content-Type: application/json" \
  -d '{"fixture":"booked","workflow_run_id":"replay-1"}'
```

The response echoes `callId`, `matchedBusiness`, `outcome`, `transcriptStored`
and the `push` result (e.g. `{"sent":false,"error":"No FCM token configured"}`)
— verify persistence with `GET /api/calls`. `npm test` covers the same paths
against a real temp SQLite (`src/lib/dograh.test.ts`,
`src/lib/dograh-webhook.test.ts`).


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

1. The business owner's FCM device token is stored via `POST /api/settings` (`fcmToken`); the new Settings surface ships in Phase 5.
2. On a missed call, the owner receives a push notification (wired to the Dograh webhook in Phase 4).

An FCM token is generated by the Firebase SDK running on a device/app. Until you build the mobile app, the fastest way to get one for testing is a small page using the Firebase Web SDK's `getToken()`.

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
| `/api/calls` | GET | Call log (`?status=&since=`) |
| `/api/webhooks/dograh` | POST | Dograh end-of-call webhook (auth via `DOGRAH_WEBHOOK_SECRET`) |
| `/api/webhooks/dograh/test` | POST | Fire the full webhook pipeline with a fixture payload (auth via `APP_AUTH_TOKEN`) |


## Auth

Write endpoints accept an optional bearer token: if `APP_AUTH_TOKEN` is set, a
matching `Authorization: Bearer <token>` header is required on writes. **If
`APP_AUTH_TOKEN` is unset or empty, every write endpoint is open to the public
internet** — `isAuthorized()` returns `true` unconditionally.

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
| `PLIVO_AUTH_ID` / `PLIVO_AUTH_TOKEN` | Plivo credentials (Phase 3+) |
| `PLIVO_NUMBER` | The Plivo number that receives forwarded missed calls |
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
soft when absent (Plivo and Firebase are checked lazily and only affect calls and
push notifications, never boot):

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
no environment variables, so they build and serve even before Plivo / Dograh /
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

### Plivo / Dograh webhooks

After deploy, point the Plivo answer webhook and the Dograh end-of-call webhook at
`https://<your-app-on-render>.onrender.com/...` (exact routes are wired in Phases 3–4; `PUBLIC_BASE_URL` must match).
