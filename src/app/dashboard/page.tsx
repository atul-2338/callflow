import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  businessSessionCookieName,
  verifyBusinessSessionToken,
} from "@/lib/business-session";
import { getBusinessById } from "@/lib/db";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "CallFlow — Dashboard",
};

/**
 * /dashboard — the URL owners now land on after signing in at /login.
 *
 * CallFlow already HAS an owner dashboard: `/app` (src/app/app/page.tsx), which
 * reads the business from the same HMAC session cookie, redirects to
 * /onboarding until businesses.onboardingStep is 'done', and renders the full
 * call feed. Rather than duplicate it, this route resolves the session and
 * hands over to /app, so the sign-in destination in the brief exists and the
 * data stays in exactly one place.
 *
 * The session check is defence in depth: src/proxy.ts already redirects
 * signed-out visitors here, but a page must never depend on that — this is the
 * same self-contained guard /app uses.
 *
 * Next up for this route (deliverable 5): the trial banner and the paywall that
 * blocks the dashboard once the 3-day window closes without a paid
 * subscription — computed from src/lib/billing.ts (describeBillingAccess /
 * trialEndsAt), not from a second, client-side day counter.
 */
export default async function DashboardRedirectPage() {
  const cookieStore = await cookies();
  const businessId = verifyBusinessSessionToken(
    cookieStore.get(businessSessionCookieName())?.value
  );
  const business = businessId ? await getBusinessById(businessId) : undefined;
  if (!business) redirect("/login");

  redirect("/app");
}
