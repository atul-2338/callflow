/**
 * Audit trail for admin-panel actions (Phase 3).
 *
 * Every admin action that changes something — and admin sign-in/sign-out
 * (security events, recorded too so the trail shows who was in the panel and
 * when) — appends one row to `admin_audit_log` (created by
 * migrations/schema.sql, applied idempotently at boot).
 *
 * Contract for `details`: caller-built JSON with the minimum context needed to
 * reconstruct what changed (ids, counts, outcomes). NEVER include secrets
 * (ADMIN_PASSWORD_HASH, ADMIN_SESSION_SECRET, passwords), request headers, or
 * raw request bodies.
 *
 * Failure policy: audit logging must never break the admin action it observes
 * (same philosophy as the owner-notification email in the webhook handler), so
 * logAdminAction swallows insert failures after a loud console.warn. The
 * realistic failure mode is a broken database, which would fail the write
 * itself anyway.
 */

import { randomUUID } from "crypto";

import { getDb } from "./database";

/** Serialized details longer than this are truncated to bound row size. */
const MAX_DETAILS_CHARS = 2000;

export interface AdminAuditInput {
  /** Short snake_case verb, e.g. "admin_login", "business_create" (Phase 4). */
  action: string;
  /** Primary object the action acted on (business id, call id, ...), if any. */
  target?: string | null;
  /** Caller-built JSON-serializable context — ids/counts only, never secrets. */
  details?: Record<string, unknown> | null;
  /** Client IP the request came from ("" when unknown). */
  ip?: string;
}

export function logAdminAction(input: AdminAuditInput): void {
  const createdAt = new Date().toISOString();

  let details: string | null = null;
  if (input.details !== undefined && input.details !== null) {
    try {
      const serialized = JSON.stringify(input.details);
      details =
        serialized && serialized.length > MAX_DETAILS_CHARS
          ? `${serialized.slice(0, MAX_DETAILS_CHARS)}[truncated]`
          : serialized;
    } catch {
      // Non-serializable details (e.g. a circular structure): record the
      // action without details rather than throwing past the caller.
      details = null;
    }
  }

  try {
    getDb()
      .prepare(
        `INSERT INTO admin_audit_log (id, action, target, details, ip, createdAt)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        input.action,
        input.target ?? null,
        details,
        input.ip ?? "",
        createdAt
      );
  } catch (error) {
    console.warn(`[admin-audit] failed to record ${input.action}:`, error);
  }
}