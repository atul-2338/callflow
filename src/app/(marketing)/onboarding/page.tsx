import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import OnboardingWizard from "@/components/onboarding/OnboardingWizard";
import OwnerOnboarding from "@/components/onboarding/OwnerOnboarding";
import {
  businessSessionCookieName,
  verifyBusinessSessionToken,
} from "@/lib/business-session";
import { getBusinessById } from "@/lib/db";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Get started — CallFlow",
  description:
    "Tell us about your business, get your dedicated Callflow number, turn on forwarding — one linear flow.",
};

/**
 * ONE linear flow at /onboarding:
 * - signed-out visitor → the signup/checkout wizard (Dodo billing),
 * - signed-in owner with onboardingStep != 'done' → the 4-step flow,
 *   resuming exactly where they left off,
 * - signed-in owner who finished → straight to the dashboard.
 */
export default async function OnboardingPage() {
  const cookieStore = await cookies();
  const businessId = verifyBusinessSessionToken(
    cookieStore.get(businessSessionCookieName())?.value
  );
  const business = businessId ? await getBusinessById(businessId) : undefined;

  if (business && business.onboardingStep !== "done") {
    return (
      <OwnerOnboarding
        business={{
          id: business.id,
          name: business.billingName,
          ownerPhone: business.phoneNumber,
          carrier: business.carrier,
          assignedNumber: business.assignedNumber,
          onboardingStep: business.onboardingStep,
        }}
      />
    );
  }

  if (business) redirect("/app");

  return <OnboardingWizard />;
}
