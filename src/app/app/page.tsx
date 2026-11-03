import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";

import BillingNotice from "@/components/billing/BillingNotice";
import DashboardClient from "@/components/dashboard/DashboardClient";
import { describeBillingAccess, trialEndsAt } from "@/lib/billing";
import { daysUntil } from "@/lib/billing-display";
import {
  businessSessionCookieName,
  verifyBusinessSessionToken,
} from "@/lib/business-session";
import { getBusinessById } from "@/lib/db";
import { maybeSendTrialReminder } from "@/lib/trial-reminder";

export const dynamic = "force-dynamic";

/**
 * Owner dashboard. The linear onboarding flow is mandatory: until
 * businesses.onboardingStep is "done" the owner is sent to /onboarding (a
 * signed-out visitor ends up there too, at the signup step).
 *
 * Billing state is resolved HERE, on the server, with the same
 * `describeBillingAccess()` the API routes use (src/lib/billing.ts) — never in
 * the browser, so the paywall cannot be talked out of blocking. An entitled
 * business sees the dashboard with a trial/payment banner above it; a business
 * with no access gets the paywall instead of the dashboard, whose only way
 * forward is a server-minted Dodo checkout (or the portal, when a subscription
 * already exists).
 */
export default async function DashboardPage() {
  const cookieStore = await cookies();
  const businessId = verifyBusinessSessionToken(
    cookieStore.get(businessSessionCookieName())?.value
  );
  const business = businessId ? await getBusinessById(businessId) : undefined;
  if (!business || business.onboardingStep !== "done") {
    redirect("/onboarding");
  }

  const access = describeBillingAccess(business);
  const trialEnd = business.trialStartedAt ? trialEndsAt(business.trialStartedAt) : null;
  // Countdown computed on the server (via a helper, so React's purity rule is
  // respected) — the client component only formats the number it is handed, so
  // the first paint and the hydration can never disagree.
  const trialDaysLeft = daysUntil(trialEnd);

  // Day-2 trial email (build brief step 5). Fires at most once per business; the
  // helper re-checks every condition against the stored timestamps, so a page
  // refresh can never double-send. after() keeps SMTP off the render path.
  if (access.state === "trialing") {
    after(() => maybeSendTrialReminder(business));
  }

  return (
    <div className="space-y-6">
      <BillingNotice
        variant={access.entitled ? "banner" : "paywall"}
        state={access.state}
        trialDaysLeft={trialDaysLeft}
        hasSubscription={!!business.dodoSubscriptionId}
      />
      {access.entitled ? <DashboardClient /> : null}
    </div>
  );
}
