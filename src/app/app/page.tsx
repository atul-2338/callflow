import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import DashboardClient from "@/components/dashboard/DashboardClient";
import {
  businessSessionCookieName,
  verifyBusinessSessionToken,
} from "@/lib/business-session";
import { getBusinessById } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Owner dashboard. The linear onboarding flow is mandatory: until
 * businesses.onboardingStep is "done" the owner is sent to /onboarding (a
 * signed-out visitor ends up there too, at the signup step).
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
  return <DashboardClient />;
}