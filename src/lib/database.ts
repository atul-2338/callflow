import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

// Path to the SQLite database file. Overridable via DATABASE_PATH so that
// production deployments can point it at a persistent disk mount. Defaults to
// ./data/callflow.db for local development.
const DEFAULT_DB_PATH = path.join(process.cwd(), "data", "callflow.db");
const SCHEMA_PATH = path.join(process.cwd(), "migrations", "schema.sql");

let db: Database.Database | null = null;

export function getDbPath(): string {
  return process.env.DATABASE_PATH?.trim() || DEFAULT_DB_PATH;
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
 * the database on storage that is destroyed by a redeploy, or `null` when it is
 * safe. Only hosts with ephemeral app storage hard-fail; running a production
 * build on a machine with a real disk (a laptop test behind a tunnel, a VPS)
 * must keep working with the default `./data/callflow.db`.
 */
export function dbPathPolicyError(input: DbPathPolicyInput): string | null {
  const { configuredPath, resolvedPath, nodeEnv, projectDir, requirePersistent } = input;

  if (nodeEnv !== "production" || !requirePersistent) return null;

  if (!configuredPath) {
    return (
      "DATABASE_PATH must be set in production. Without it the SQLite file " +
      `falls back to ${resolvedPath}, which lives on the ephemeral build disk ` +
      "and is destroyed on every redeploy. Point DATABASE_PATH at the " +
      "persistent disk mount, e.g. /var/data/callflow.db."
    );
  }

  if (!path.isAbsolute(configuredPath)) {
    return (
      `DATABASE_PATH must be an absolute path in production, got ` +
      `"${configuredPath}". Relative paths resolve against the build directory, ` +
      "which is wiped on every redeploy."
    );
  }

  if (isInsideDir(configuredPath, projectDir)) {
    return (
      `DATABASE_PATH ("${configuredPath}") is inside the project directory ` +
      `(${projectDir}), which is ephemeral in production and is wiped on every ` +
      "redeploy. Move the database onto the persistent disk mount, e.g. " +
      "/var/data/callflow.db."
    );
  }

  return null;
}

/** Throws with {@link dbPathPolicyError}'s message when a deploy would lose data. */
export function assertPersistentDbPath(dbPath: string): void {
  const configured = process.env.DATABASE_PATH?.trim();
  const requirePersistent = requiresPersistentDbPath();

  const error = dbPathPolicyError({
    configuredPath: configured,
    resolvedPath: dbPath,
    nodeEnv: process.env.NODE_ENV,
    projectDir: process.cwd(),
    requirePersistent,
  });
  if (error) throw new Error(`[database] ${error}`);

  if (configured) return;

  if (process.env.NODE_ENV === "production") {
    // Reached only when no ephemeral host was detected, so the safety net is
    // inactive here. Say so loudly instead of failing silently on a real deploy.
    console.warn(
      `[database] NODE_ENV=production without DATABASE_PATH; using ${dbPath}. ` +
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

export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = getDbPath();
  assertPersistentDbPath(dbPath);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const instance = new Database(dbPath);
  instance.pragma("journal_mode = WAL");
  instance.pragma("foreign_keys = ON");

  const schema = fs.readFileSync(SCHEMA_PATH, "utf-8");
  instance.exec(schema);

  db = instance;
  return instance;
}
