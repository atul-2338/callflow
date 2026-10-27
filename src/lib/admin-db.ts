/**
 * Admin-panel data access (Phase 4).
 *
 * Every query the /admin pages and /api/admin/* routes need lives here, so the
 * owner-facing src/lib/db.ts stays untouched and admin-specific queries can
 * never drift into owner code paths. Reads are admin-only views over the same
 * SQLite database opened by getDb(); the two writes (business create, call
 * assign) reuse the canonical db.ts creation path or run one explicit minimal
 * UPDATE, and their API-route callers must record the action via
 * logAdminAction().
 *
 * Audit/system detail payloads follow the admin-audit contract: ids, counts,
 * and entity keys only — never secrets, request headers, or raw bodies. The
 * system-info env report carries variable NAMES and a set/not-set boolean
 * only; values are never read into a returned structure.
 */
import { readFileSync, statSync } from "fs";
import path from "path";

import type { Business, Call, CallOutcome } from "./types";
import { CALL_OUTCOMES } from "./types";
import { getDb, getDbPath } from "./database";
import { normalizeEnvValue } from "./util";

// ---- Row mappers (SQLite rows are plain; booleans arrive as 0/1) ----

type BusinessRow = Omit<Business, "carrier" | "forwardingStatus"> & {
  carrier: string;
  forwardingStatus: string;
};

function mapBusiness(row: BusinessRow): Business {
  return {
    ...row,
    carrier: row.carrier as Business["carrier"],
    forwardingStatus: row.forwardingStatus as Business["forwardingStatus"],
  };
}

type CallRow = Omit<
  Call,
  "callStatus" | "textBackSent" | "outcome" | "followUpStatus"
> & {
  callStatus: string;
  textBackSent: number;
  outcome: string | null;
  followUpStatus: string;
};

function mapCall(row: CallRow): Call {
  return {
    ...row,
    callStatus: row.callStatus as Call["callStatus"],
    textBackSent: Boolean(row.textBackSent),
    outcome: CALL_OUTCOMES.includes(row.outcome as CallOutcome)
      ? (row.outcome as CallOutcome)
      : "other",
    followUpStatus: row.followUpStatus as Call["followUpStatus"],
  };
}

// ---- Counts (overview cards) ----

export async function adminCountBusinesses(): Promise<number> {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM businesses")
    .get() as { n: number };
  return row.n;
}

export async function adminCountCalls(): Promise<number> {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM calls")
    .get() as { n: number };
  return row.n;
}

/** Calls that have not been assigned to any business yet. */
export async function adminCountUnlinkedCalls(): Promise<number> {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM calls WHERE businessId IS NULL")
    .get() as { n: number };
  return row.n;
}

// ---- Businesses ----

export async function adminListBusinesses(): Promise<Business[]> {
  const rows = getDb()
    .prepare("SELECT * FROM businesses ORDER BY createdAt DESC")
    .all() as unknown as BusinessRow[];
  return rows.map(mapBusiness);
}

export interface AdminBusinessListRow extends Business {
  /** ISO timestamp of the business's most recent call, or null when none. */
  lastCallAt: string | null;
}

/**
 * Every business with its last-call timestamp (admin businesses list).
 * Number assignment is pool-driven (see src/lib/numbers-pool.ts and
 * /api/admin/businesses/[id]/assign), so this stays a pure read view.
 */
export async function adminListBusinessesWithLastCall(): Promise<
  AdminBusinessListRow[]
> {
  const rows = getDb()
    .prepare(
      `SELECT businesses.*,
              (SELECT MAX(callStartedAt) FROM calls
                WHERE calls.businessId = businesses.id) AS lastCallAt
       FROM businesses
       ORDER BY businesses.createdAt DESC`
    )
    .all() as unknown as Array<BusinessRow & { lastCallAt: string | null }>;
  return rows.map(({ lastCallAt, ...row }) => ({
    ...mapBusiness(row),
    lastCallAt,
  }));
}

// ---- Calls ----

/** A call row plus the linked business's display label (name or clientUid). */
export interface AdminCallListRow extends Call {
  businessLabel: string | null;
}

export interface AdminCallPage {
  calls: AdminCallListRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

/**
 * Paged, newest-first listing across ALL businesses (owner views are
 * per-business; this is the admin's cross-business view). `unlinkedOnly`
 * drives the /admin/calls UNLINKED filter. Page is clamped into range so a
 * stale ?page= after new inserts can never render an empty table.
 */
export async function adminListCalls(
  options: { page?: number; pageSize?: number; unlinkedOnly?: boolean } = {}
): Promise<AdminCallPage> {
  const pageSize = Math.min(Math.max(options.pageSize ?? 20, 1), 100);
  // Total must respect the active filter, so page math matches what the
  // UNLINKED tab shows.
  const { n: total } = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM calls ${options.unlinkedOnly ? "WHERE businessId IS NULL" : ""}`
    )
    .get() as { n: number };
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(options.page ?? 1, 1), pageCount);
  const offset = (page - 1) * pageSize;

  const where = options.unlinkedOnly ? "WHERE calls.businessId IS NULL" : "";
  const rows = getDb()
    .prepare(
      `SELECT calls.*, COALESCE(b.billingName, b.clientUid) AS businessLabel
       FROM calls
       LEFT JOIN businesses AS b ON b.id = calls.businessId
       ${where}
       ORDER BY calls.callStartedAt DESC
       LIMIT ? OFFSET ?`
    )
    .all(pageSize, offset) as unknown as Array<
    CallRow & { businessLabel: string | null }
  >;

  const calls = rows.map((row) => {
    const { businessLabel, ...callRow } = row;
    return { ...mapCall(callRow), businessLabel };
  });
  return { calls, total, page, pageSize, pageCount };
}

/** Recent calls for one business (admin business detail page). */
export async function adminListRecentCallsForBusiness(
  businessId: string,
  limit = 10
): Promise<AdminCallListRow[]> {
  const rows = getDb()
    .prepare(
      `SELECT calls.*, COALESCE(b.billingName, b.clientUid) AS businessLabel
       FROM calls
       LEFT JOIN businesses AS b ON b.id = calls.businessId
       WHERE calls.businessId = ?
       ORDER BY calls.callStartedAt DESC
       LIMIT ?`
    )
    .all(businessId, Math.min(Math.max(limit, 1), 100)) as unknown as Array<
    CallRow & { businessLabel: string | null }
  >;
  return rows.map((row) => {
    const { businessLabel, ...callRow } = row;
    return { ...mapCall(callRow), businessLabel };
  });
}

export type AdminAssignCallResult =
  | {
      ok: true;
      call: Call;
      previousBusinessId: string | null;
      businessClientUid: string | null;
    }
  | { ok: false; reason: "call_not_found" | "business_not_found" };

// Manual call→business assignment was removed with the shared-number routing:
// the Dograh webhook attributes every call by assignedNumber (the only match
// rule), so there is nothing left to reassign by hand.

// ---- Audit log ----

export interface AdminAuditEntry {
  id: string;
  action: string;
  target: string | null;
  details: string | null;
  ip: string;
  createdAt: string;
}

export interface AdminAuditPage {
  entries: AdminAuditEntry[];
  total: number;
  limit: number;
}

/** Newest-first audit trail for /admin/audit (and the overview's recent list). */
export async function adminListAuditEntries(
  limit = 200
): Promise<AdminAuditPage> {
  const capped = Math.min(Math.max(limit, 1), 500);
  const entries = getDb()
    .prepare(
      `SELECT id, action, target, details, ip, createdAt
       FROM admin_audit_log
       ORDER BY createdAt DESC, rowid DESC
       LIMIT ?`
    )
    .all(capped) as unknown as AdminAuditEntry[];
  const { n: total } = getDb()
    .prepare("SELECT COUNT(*) AS n FROM admin_audit_log")
    .get() as { n: number };
  return { entries, total, limit: capped };
}

// ---- System info (/admin/system) ----

export interface AdminEnvEntry {
  name: string;
  set: boolean;
}

export interface AdminDograhCall {
  id: string;
  callStatus: string;
  dograhRunId: string | null;
  dograhDisposition: string | null;
  outcome: string | null;
  callStartedAt: string;
}

export interface AdminSystemInfo {
  dbPath: string;
  dbFileBytes: number | null;
  nodeVersion: string;
  appVersion: string | null;
  versions: {
    next: string | null;
    react: string | null;
    betterSqlite3: string | null;
  } | null;
  envStatus: AdminEnvEntry[];
  dograhCallCount: number;
  recentDograhCalls: AdminDograhCall[];
}

/**
 * Environment variables the panel reports on. NAMES ONLY — the page shows
 * set/not-set badges and never reads a value into the returned structure, so
 * no secret can leak into HTML, logs, or the audit trail.
 */
const SYSTEM_ENV_NAMES = [
  "ADMIN_PASSWORD_HASH",
  "ADMIN_SESSION_SECRET",
  "WEBHOOK_SECRET",
  "DATABASE_PATH",
  "DB_REQUIRE_PERSISTENT_PATH",
  "FIREBASE_SERVICE_ACCOUNT",
  "DODO_PAYMENTS_API_KEY",
  "DODO_PAYMENTS_ENVIRONMENT",
  "DODO_SOLO_PRODUCT_ID",
  "TELNYX_API_KEY",
  "TELNYX_PUBLIC_KEY",
  "TELNYX_NUMBER",
  "TELNYX_FORWARD_TO",
  "APP_AUTH_TOKEN",
  "CORS_ORIGINS",
  "DEBUG",
] as const;

/**
 * Runtime/system snapshot for /admin/system. Webhook results are DERIVED from
 * the calls table (dograhRunId IS NOT NULL) rather than persisted anywhere:
 * the Dograh webhook handler is off-limits to admin changes, and the stored
 * rows already carry the status/disposition the panel needs.
 */
export async function adminSystemInfo(): Promise<AdminSystemInfo> {
  const dbPath = getDbPath();
  let dbFileBytes: number | null = null;
  try {
    dbFileBytes = statSync(dbPath).size;
  } catch {
    dbFileBytes = null;
  }

  let appVersion: string | null = null;
  let versions: AdminSystemInfo["versions"] = null;
  try {
    // database.ts already relies on process.cwd() being the project root, so
    // reading package.json from there is equally dependable at runtime.
    const pkg = JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf8")
    ) as {
      version?: unknown;
      dependencies?: Record<string, unknown>;
    };
    appVersion = typeof pkg.version === "string" ? pkg.version : null;
    const deps = pkg.dependencies ?? {};
    versions = {
      next: typeof deps.next === "string" ? deps.next : null,
      react: typeof deps.react === "string" ? deps.react : null,
      betterSqlite3:
        typeof deps["better-sqlite3"] === "string"
          ? deps["better-sqlite3"]
          : null,
    };
  } catch {
    versions = null;
  }

  const envStatus: AdminEnvEntry[] = SYSTEM_ENV_NAMES.map((name) => ({
    name,
    // normalizeEnvValue strips quotes/brackets the .env loader keeps, so an
    // empty or whitespace-only value counts as "not set".
    set: normalizeEnvValue(process.env[name]) !== "",
  }));

  const { n: dograhCallCount } = getDb()
    .prepare("SELECT COUNT(*) AS n FROM calls WHERE dograhRunId IS NOT NULL")
    .get() as { n: number };
  const recentDograhCalls = getDb()
    .prepare(
      `SELECT id, callStatus, dograhRunId, dograhDisposition, outcome, callStartedAt
       FROM calls
       WHERE dograhRunId IS NOT NULL
       ORDER BY callStartedAt DESC
       LIMIT 20`
    )
    .all() as unknown as AdminDograhCall[];

  return {
    dbPath,
    dbFileBytes,
    nodeVersion: process.version,
    appVersion,
    versions,
    envStatus,
    dograhCallCount,
    recentDograhCalls,
  };
}