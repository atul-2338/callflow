/**
 * Page-side counterpart of requireAdminApi.
 *
 * /admin is the single admin entry point: adminPageSessionActive() reports
 * whether a valid admin session cookie is present (failing closed with
 * notFound() while the admin env vars are missing), and the /admin page itself
 * renders the sign-in form for signed-out visitors. requireAdminPage() adds
 * the redirect to /admin and is called once from the app/admin/(protected)/
 * layout so every sub-page in that group is guarded. /admin/login lives
 * outside the group too — it is only a permanent redirect to /admin for old
 * bookmarks.
 *
 * Lives in its own module so admin-session.ts stays importable from plain
 * Node tests: next/headers only works inside a request context.
 */
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import {
  ADMIN_SESSION_COOKIE_NAME,
  adminConfigured,
  verifyAdminSessionToken,
} from "./admin-session";

/**
 * Fail-closed page session probe: notFound() while ADMIN_PASSWORD_HASH or
 * ADMIN_SESSION_SECRET is missing (the whole admin area — including the
 * sign-in form on /admin — looks like it doesn't exist), otherwise true iff
 * a valid admin session cookie is present.
 */
export async function adminPageSessionActive(): Promise<boolean> {
  if (!adminConfigured()) {
    notFound();
  }
  const cookieStore = await cookies();
  // The cookie store hands back the raw token VALUE (no "name=" prefix), so
  // verify it directly — hasAdminSessionCookie() is for whole Cookie headers.
  return verifyAdminSessionToken(cookieStore.get(ADMIN_SESSION_COOKIE_NAME)?.value);
}

/**
 * Guard for every page in the app/admin/(protected)/ group: signed-out users
 * are sent to /admin, the single entry point (which shows the sign-in form).
 */
export async function requireAdminPage(): Promise<void> {
  if (!(await adminPageSessionActive())) {
    redirect("/admin");
  }
}