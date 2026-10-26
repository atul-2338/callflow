/**
 * Session + guards for the app-manager admin panel.
 *
 * Deliberately a separate world from the owner session (business-session.ts):
 * different cookie name, different secret env var, different token shape, and
 * the guards never consult the owner cookie. Nothing in this file imports
 * business-session.ts.
 *
 * Fail closed: when ADMIN_PASSWORD_HASH or ADMIN_SESSION_SECRET is missing,
 * the admin area is unreachable — /admin/* pages 404 (see admin-page-guard.ts)
 * and /api/admin/* routes answer 404, so nobody can log in at all.
 */
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { normalizeEnvValue } from "./util";

export const ADMIN_SESSION_COOKIE_NAME = "callflow_admin_session";
/** 8 hours — one workday; the owner session lives 30 days by comparison. */
export const ADMIN_SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

export function adminPasswordHashFromEnv(
  env: Record<string, string | undefined> = process.env
): string {
  return normalizeEnvValue(env.ADMIN_PASSWORD_HASH);
}

function adminSessionSecretFromEnv(
  env: Record<string, string | undefined> = process.env
): string {
  return normalizeEnvValue(env.ADMIN_SESSION_SECRET);
}

/** The admin area exists only when both credentials are configured. */
export function adminConfigured(
  env: Record<string, string | undefined> = process.env
): boolean {
  return (
    adminPasswordHashFromEnv(env).length > 0 && adminSessionSecretFromEnv(env).length > 0
  );
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

/**
 * HMAC-signed admin session token:
 *   admin.v1.<expiresAtMs>.<nonce>.<hmac>
 *
 * The "admin" scope marker is part of the signed value, so an admin token is
 * structurally distinguishable from the owner token (biz.<nonce>.<hmac>) even
 * under a shared-secret mistake, and the expiry is actually verified.
 */
export function createAdminSessionToken(
  options: { now?: number; ttlSeconds?: number; secret?: string } = {}
): string {
  const secret = options.secret ?? adminSessionSecretFromEnv();
  if (!secret) throw new Error("ADMIN_SESSION_SECRET must be configured");
  const issuedAt = options.now ?? Date.now();
  const ttlSeconds = options.ttlSeconds ?? ADMIN_SESSION_MAX_AGE_SECONDS;
  const expiresAt = issuedAt + ttlSeconds * 1000;
  const nonce = randomBytes(16).toString("base64url");
  const value = `admin.v1.${expiresAt}.${nonce}`;
  return `${value}.${sign(value, secret)}`;
}

export function verifyAdminSessionToken(
  token: string | undefined | null,
  options: { now?: number; secret?: string } = {}
): boolean {
  if (!token) return false;
  const secret = options.secret ?? adminSessionSecretFromEnv();
  if (!secret) return false; // Fail closed with no secret configured.

  const parts = token.split(".");
  if (parts.length !== 5) return false;
  const [scope, version, expiresAt, nonce, signature] = parts;
  if (scope !== "admin" || version !== "v1" || !expiresAt || !nonce || !signature) {
    return false;
  }

  const expires = Number(expiresAt);
  if (!Number.isInteger(expires) || expires <= (options.now ?? Date.now())) return false;

  const expected = Buffer.from(sign(`${scope}.${version}.${expiresAt}.${nonce}`, secret));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return false;
  }
  return true;
}

/**
 * Cookie for the admin session. Path=/ rather than Path=/admin: the browser
 * would otherwise not send the cookie to /api/admin/* (cookie paths are
 * prefix-matched), which is exactly where requireAdminApi needs it. Isolation
 * from the owner session comes from the distinct name/secret, SameSite=Strict
 * and the 8-hour lifetime — not from the path.
 */
export function adminSessionCookie(token: string, secure: boolean): string {
  return `${ADMIN_SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${ADMIN_SESSION_MAX_AGE_SECONDS}${
    secure ? "; Secure" : ""
  }`;
}

/** Clearing variant used by /api/admin/logout. */
export function clearedAdminSessionCookie(secure: boolean): string {
  return `${ADMIN_SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${
    secure ? "; Secure" : ""
  }`;
}

/**
 * Verifies the admin cookie inside a raw Cookie header (multiple cookies
 * tolerated, matching business-session.ts's header parsing).
 */
export function hasAdminSessionCookie(
  cookieHeader: string | null | undefined,
  options: { now?: number; secret?: string } = {}
): boolean {
  if (!cookieHeader) return false;
  for (const rawPart of cookieHeader.split(";")) {
    const separator = rawPart.indexOf("=");
    if (separator === -1) continue;
    const name = rawPart.slice(0, separator).trim();
    const value = rawPart.slice(separator + 1).trim();
    if (name === ADMIN_SESSION_COOKIE_NAME && verifyAdminSessionToken(value, options)) {
      return true;
    }
  }
  return false;
}

/**
 * Shared guard for every /api/admin/* route handler. Returns the response to
 * send when the request must be stopped, or null to continue.
 *
 * 404 (not 401) when the admin area is unconfigured so the endpoints are
 * indistinguishable from URLs that don't exist; 401 when configured but the
 * caller has no valid admin session.
 */
export function requireAdminApi(request: Request): NextResponse | null {
  if (!adminConfigured()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!hasAdminSessionCookie(request.headers.get("cookie"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}