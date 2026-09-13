import OnboardingWizard from "@/components/onboarding/OnboardingWizard";

export const metadata = {
  title: "Get started — CallFlow",
  description:
    "Set up CallFlow in two minutes: tell us about your business, then start your 3-day free trial.",
};

export default function OnboardingPage() {
  return <OnboardingWizard />;
}
