/**
 * Page-side counterpart of requireAdminApi. Called once from the
 * app/admin/(protected)/ layout so every page in that group is guarded;
 * app/admin/login deliberately lives OUTSIDE the group so it stays reachable
 * to authenticate.
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

export async function requireAdminPage(): Promise<void> {
  if (!adminConfigured()) {
    // Fail closed: with ADMIN_PASSWORD_HASH / ADMIN_SESSION_SECRET missing the
    // whole admin area — including the login page — looks like it doesn't
    // exist.
    notFound();
  }
  const cookieStore = await cookies();
  // The cookie store hands back the raw token VALUE (no "name=" prefix), so
  // verify it directly — hasAdminSessionCookie() is for whole Cookie headers.
  if (!verifyAdminSessionToken(cookieStore.get(ADMIN_SESSION_COOKIE_NAME)?.value)) {
    redirect("/admin/login");
  }
}