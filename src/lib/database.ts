import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

import { generateClientUid } from "./util";

// Path to the SQLite database file. Overridable via DATABASE_PATH so that
// production deployments can point it at a persistent disk mount. Defaults to
// ./data/callflow.db for local development.
const DEFAULT_DB_PATH = path.join(process.cwd(), "data", "callflow.db");
const SCHEMA_PATH = path.join(process.cwd(), "migrations", "schema.sql");

let db: Database.Database | null = null;

export function getDbPath(): string {
  const configured = process.env.DATABASE_PATH?.trim();
  // A relative DATABASE_PATH (e.g. "./data/callflow.db") must never depend on
  // whichever directory the server process happened to boot from: resolve it
  // against the project cwd once, here, so the file the app opens is always
  // the file the operator configured (and the ephemeral-host guard below
  // inspects the real destination, not a cwd-relative guess).
  return configured ? path.resolve(process.cwd(), configured) : DEFAULT_DB_PATH;
}

/** True when `child` is `parent` itself or lives underneath it. */
function isInsideDir(child: string, parent: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Inputs for {@link dbPathPolicyError}, injectable so the rule can be unit
 * tested without mutating `process.env` (which Next's type definitions mark
 * read-only, and which `next build` type-checks).
 */
export interface DbPathPolicyInput {
  /** Raw `process.env.DATABASE_PATH`, trimmed. */
  configuredPath: string | undefined;
  /** Effective database file the app would open. */
  resolvedPath: string;
  nodeEnv: string | undefined;
  projectDir: string;
  /**
   * Whether the host's app filesystem is wiped by a redeploy. The policy only
   * hard-fails when this is true — see {@link requiresPersistentDbPath}.
   */
  requirePersistent: boolean;
}

/**
 * Env vars that only exist on hosts which rebuild the app filesystem from
 * scratch on every deploy (Render, Vercel, Fly.io, Heroku, Kubernetes). Their
 * presence is what turns an ephemeral database path into silent data loss.
 */
const EPHEMERAL_PLATFORM_ENV = [
  "RENDER",
  "VERCEL",
  "FLY_APP_NAME",
  "DYNO",
  "KUBERNETES_SERVICE_HOST",
] as const;

function isTruthyEnv(value: string | undefined): boolean {
  const v = value?.trim();
  return !!v && v.toLowerCase() !== "false";
}

/**
 * True when this process is known to run on storage that a redeploy destroys,
 * so the database must live on an explicit persistent mount.
 *
 * Detection is deliberately positive: an unrecognised host is treated as
 * ordinary storage rather than failing the app at boot. Set
 * `DB_REQUIRE_PERSISTENT_PATH=1` to enforce the rule on a host that is not
 * auto-detected (for example the VPS, whose path lives outside the repo but
 * which should still fail loudly if misconfigured).
 */
export function requiresPersistentDbPath(
  env: Record<string, string | undefined> = process.env
): boolean {
  if (isTruthyEnv(env.DB_REQUIRE_PERSISTENT_PATH)) return true;
  return EPHEMERAL_PLATFORM_ENV.some((key) => isTruthyEnv(env[key]));
}

/**
 * Returns an actionable error message when the given configuration would put
 * the database on storage that is destroyed by a redeploy, or `null` when it
 * is safe. Only hosts with ephemeral app storage hard-fail; running a production
 * build on a machine with a real disk (a laptop test behind a tunnel, a VPS)
 * must keep working with the default `./data/callflow.db`.
 */
export function dbPathPolicyError(input: DbPathPolicyInput): string | null {
  const { configuredPath, resolvedPath, nodeEnv, projectDir, requirePersistent } = input;

  if (nodeEnv !== "production" || !requirePersistent) return null;

  if (!configuredPath) {
    return (
      "[database] DATABASE_PATH must be set in production: this host's app " +
      "filesystem is wiped on every deploy, so the default ./data path would " +
      "silently lose every business, call, and billing record. Point " +
      "DATABASE_PATH at a persistent mount (e.g. /var/data/callflow.db)."
    );
  }

  if (!path.isAbsolute(resolvedPath)) {
    return (
      "[database] DATABASE_PATH must be an absolute path in production so the " +
      "database cannot land inside the app directory that a redeploy wipes " +
      `(got: ${resolvedPath}).`
    );
  }

  if (isInsideDir(resolvedPath, projectDir)) {
    return (
      "[database] DATABASE_PATH must live outside the app directory in " +
      "production: this host's app filesystem is ephemeral, so a database at " +
      `${resolvedPath} would be destroyed on every deploy.`
    );
  }

  return null;
}

export function assertPersistentDbPath(dbPath: string): void {
  const error = dbPathPolicyError({
    configuredPath: process.env.DATABASE_PATH?.trim() || undefined,
    resolvedPath: dbPath,
    nodeEnv: process.env.NODE_ENV,
    projectDir: process.cwd(),
    requirePersistent: requiresPersistentDbPath(),
  });
  if (error) throw new Error(error);

  if (process.env.NODE_ENV !== "production") return;

  if (process.env.DATABASE_PATH?.trim()) {
    // Explicitly configured in production on an unknown host. The path policy
    // above already rejected known-bad shapes (relative / inside the app dir);
    // here we can only trust the operator chose a durable mount.
    console.log(`[database] using DATABASE_PATH=${dbPath}`);
    return;
  }

  if (requiresPersistentDbPath()) {
    // Unreachable in practice: dbPathPolicyError already hard-failed the
    // unset-DATABASE_PATH case for ephemeral hosts. Kept as a safety net so a
    // future policy change can never silently downgrade to the local default.
    console.warn(
      `[database] production without DATABASE_PATH; using ${dbPath}. ` +
        "No known-ephemeral platform was detected, so the DATABASE_PATH guard is " +
        "off. Set DB_REQUIRE_PERSISTENT_PATH=1 to enforce it on this host."
    );
    return;
  }

  console.warn(
    `[database] DATABASE_PATH is not set; using the local default ${dbPath}. ` +
      "This path is wiped on every deploy — set DATABASE_PATH in production."
  );
}

/**
 * Columns added to `calls` after the initial release. `CREATE TABLE IF NOT
 * EXISTS` in schema.sql never patches an existing table, and the Dograh
 * idempotency indexes at the bottom of schema.sql reference these columns —
 * so on a pre-existing database they must be ALTERed in *before* the schema is
 * exec'd. On a fresh database (no `calls` table yet) this is a no-op and
 * schema.sql creates the complete table.
 */
const CALL_ADDED_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ["dograhRunId", "TEXT"],
  ["dograhDeliveryId", "TEXT"],
  ["dograhDisposition", "TEXT"],
  ["outcome", "TEXT"],
  ["customerName", "TEXT"],
  ["callbackNumber", "TEXT"],
  ["calendarEventId", "TEXT"],
  ["transcriptUrl", "TEXT"],
  ["serviceRequested", "TEXT"],
  ["urgency", "TEXT"],
  ["preferredCallbackTime", "TEXT"],
  ["followUpStatus", "TEXT NOT NULL DEFAULT 'none'"],
  ["followUpNotes", "TEXT NOT NULL DEFAULT ''"],
  ["followUpUpdatedAt", "TEXT"],
  ["rawPayload", "TEXT"],
];

// Same pattern as CALL_ADDED_COLUMNS, for the businesses table. `clientUid`
// must be ALTERed in before the schema exec because the client-UID unique
// index in schema.sql references the column.
const BUSINESS_ADDED_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ["clientUid", "TEXT"],
  ["billingName", "TEXT"],
  ["billingEmail", "TEXT"],
  ["billingCountry", "TEXT"],
  ["trialStartedAt", "TEXT"],
  ["dodoCustomerId", "TEXT"],
  ["dodoSubscriptionId", "TEXT"],
  ["dodoCheckoutSessionId", "TEXT"],
  ["subscriptionStatus", "TEXT NOT NULL DEFAULT 'not_started'"],
  ["subscriptionPaymentId", "TEXT"],
  ["smsVerificationCode", "TEXT"],
  ["smsVerificationExpiresAt", "TEXT"],
  ["notificationEmail", "TEXT"],
  ["address", "TEXT"],
];

function migrateCallsTable(db: Database.Database): void {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'calls'")
    .get();
  if (!table) return;
  const existing = new Set(
    (db.pragma("table_info(calls)") as Array<{ name: string }>).map((c) => c.name)
  );
  for (const [name, type] of CALL_ADDED_COLUMNS) {
    if (!existing.has(name)) {
      db.exec(`ALTER TABLE calls ADD COLUMN ${name} ${type}`);
    }
  }
}

function migrateBusinessesTable(db: Database.Database): void {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'businesses'")
    .get();
  if (!table) return;

  const existing = new Set(
    (db.pragma("table_info(businesses)") as Array<{ name: string }>).map((c) => c.name)
  );
  for (const [name, type] of BUSINESS_ADDED_COLUMNS) {
    if (!existing.has(name)) {
      db.exec(`ALTER TABLE businesses ADD COLUMN ${name} ${type}`);
    }
  }
}

/**
 * Assign permanent client UIDs ("TE-xxxxxxxx") to business rows created before
 * the column existed. Runs on every cold start, after the schema exec (which
 * has already created the partial unique index): a NULL clientUid is filled
 * exactly once, existing values are never rewritten, so a UID a customer was
 * already given can never change. Uniqueness is checked in-process while
 * filling; the index is the storage-level backstop.
 */
export function backfillBusinessClientUids(db: Database.Database): void {
  const pending = db
    .prepare("SELECT id FROM businesses WHERE clientUid IS NULL")
    .all() as Array<{ id: string }>;
  if (!pending.length) return;

  const used = new Set(
    (
      db
        .prepare("SELECT clientUid FROM businesses WHERE clientUid IS NOT NULL")
        .all() as Array<{ clientUid: string }>
    ).map((row) => row.clientUid)
  );
  const update = db.prepare("UPDATE businesses SET clientUid = ? WHERE id = ?");
  for (const row of pending) {
    let clientUid = generateClientUid();
    while (used.has(clientUid)) clientUid = generateClientUid();
    update.run(clientUid, row.id);
    used.add(clientUid);
  }
}

export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = getDbPath();
  assertPersistentDbPath(dbPath);
  // Always log the resolved ABSOLUTE path once per boot: a webhook row "not
  // appearing" is almost always a path/cwd mismatch, and this line makes the
  // mismatch visible immediately in dev output or `journalctl -u callflow`.
  console.log(`[database] opening SQLite database at ${dbPath}`);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const instance = new Database(dbPath);
  instance.pragma("journal_mode = WAL");
  instance.pragma("foreign_keys = ON");

  migrateCallsTable(instance);
  migrateBusinessesTable(instance);

  const schema = fs.readFileSync(SCHEMA_PATH, "utf-8");
  instance.exec(schema);

  backfillBusinessClientUids(instance);

  db = instance;
  return db;
}