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

import type { Business, Call, CallOutcome, Carrier } from "./types";
import { CALL_OUTCOMES, CARRIERS } from "./types";
import { getDb, getDbPath } from "./database";
import { createBusiness, getBusinessByPhone } from "./db";
import {
  isValidInternationalPhone,
  normalizeEnvValue,
  toE164InternationalPhone,
} from "./util";

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

export interface AdminCreateBusinessInput {
  phoneNumber: string;
  billingName?: string | null;
  carrier?: string | null;
}

export type AdminCreateBusinessResult =
  | { ok: true; business: Business }
  | { ok: false; reason: "invalid_phone"; message: string }
  | { ok: false; reason: "duplicate_phone"; message: string }
  | { ok: false; reason: "invalid_carrier"; message: string };

/**
 * Create a business from the admin panel.
 *
 * Validation matches the billing path's strictness on purpose: the number must
 * normalize to a valid E.164 value (same helpers the Dodo signup uses), the
 * carrier must be a known CARRIERS entry, and the phone must not already be
 * enrolled. Creation itself goes through the canonical db.ts createBusiness so
 * the clientUid lifecycle (assigned once, never rotated) is identical to
 * owner-driven signups.
 */
export async function adminCreateBusiness(
  input: AdminCreateBusinessInput
): Promise<AdminCreateBusinessResult> {
  const rawPhone =
    typeof input.phoneNumber === "string" ? input.phoneNumber.trim() : "";
  if (!rawPhone) {
    return {
      ok: false,
      reason: "invalid_phone",
      message: "A business phone number is required.",
    };
  }

  let e164: string;
  try {
    e164 = toE164InternationalPhone(rawPhone);
  } catch (error) {
    return {
      ok: false,
      reason: "invalid_phone",
      message:
        error instanceof Error
          ? error.message
          : "Enter a valid international phone number with country code.",
    };
  }
  if (!isValidInternationalPhone(e164)) {
    return {
      ok: false,
      reason: "invalid_phone",
      message:
        "Business phone number must be a valid international number with country code (e.g. +1 555 123 4567).",
    };
  }

  const carrier =
    input.carrier == null || input.carrier === "" ? "other" : input.carrier;
  if (!(CARRIERS as readonly string[]).includes(carrier)) {
    return {
      ok: false,
      reason: "invalid_carrier",
      message: `carrier must be one of: ${CARRIERS.join(", ")}`,
    };
  }

  const existing = await getBusinessByPhone(e164);
  if (existing) {
    return {
      ok: false,
      reason: "duplicate_phone",
      message: `A business with this phone number already exists (${
        existing.clientUid ?? existing.id
      }).`,
    };
  }

  const billingName =
    typeof input.billingName === "string"
      ? input.billingName.trim().slice(0, 200)
      : "";

  const business = await createBusiness({
    phoneNumber: e164,
    carrier: carrier as Carrier,
    forwardingStatus: "not_started",
    lastVerifiedAt: null,
    pendingVerificationFor: null,
    pendingVerificationExpiresAt: null,
    billingName: billingName || null,
  });
  return { ok: true, business };
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

/**
 * Link an existing call to a business (admin calls page). Deliberately
 * permissive about reassignment: the previous businessId is returned so the
 * caller's audit entry records what changed. Only businessId/updatedAt are
 * touched — follow-up state, transcripts, and webhook fields are never
 * modified from the admin panel.
 */
export async function adminAssignCallToBusiness(
  callId: string,
  businessId: string
): Promise<AdminAssignCallResult> {
  const db = getDb();
  const callRow = db
    .prepare("SELECT * FROM calls WHERE id = ?")
    .get(callId) as CallRow | undefined;
  if (!callRow) return { ok: false, reason: "call_not_found" };

  const businessRow = db
    .prepare("SELECT id, clientUid FROM businesses WHERE id = ?")
    .get(businessId) as { id: string; clientUid: string | null } | undefined;
  if (!businessRow) return { ok: false, reason: "business_not_found" };

  const now = new Date().toISOString();
  db.prepare("UPDATE calls SET businessId = ?, updatedAt = ? WHERE id = ?").run(
    businessId,
    now,
    callId
  );

  const updatedRow = db
    .prepare("SELECT * FROM calls WHERE id = ?")
    .get(callId) as CallRow;
  return {
    ok: true,
    call: mapCall(updatedRow),
    previousBusinessId: callRow.businessId,
    businessClientUid: businessRow.clientUid,
  };
}

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
  "CALLFLOW_FORWARDING_DID",
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