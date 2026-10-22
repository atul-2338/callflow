import { getExpectedAuthToken } from "./auth";
import { businessIdFromCookieHeader } from "./business-session";

export interface CallAccess {
  /**
   * When set (signed-in business session), every call read or write must
   * belong to this business — the tenant boundary for dashboard data.
   */
  businessId: string | null;
  /** False when there is no valid session and no valid bearer token. */
  authorized: boolean;
}

/**
 * Auth for dashboard call data.
 *
 * - A signed-in business (session cookie from checkout signup) is always
 *   authorized, and every query is scoped to that business's rows.
 * - Without a session, the legacy single-tenant flows may present the shared
 *   `APP_AUTH_TOKEN` bearer: accepted only when the env var is set AND the
 *   header matches it. When `APP_AUTH_TOKEN` is unset there is nothing to
 *   match against, so the request is unauthorized — the API never falls back
 *   to open access.
 */
export function resolveCallAccess(request: Request): CallAccess {
  const businessId = businessIdFromCookieHeader(
    request.headers.get("cookie")
  );
  if (businessId) return { businessId, authorized: true };

  const expected = getExpectedAuthToken();
  if (!expected) return { businessId: null, authorized: false };

  const authHeader = request.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return { businessId: null, authorized: false };
  }
  return {
    businessId: null,
    authorized: authHeader.slice(7).trim() === expected,
  };
}

export function unauthorizedCallResponse(): Response {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}