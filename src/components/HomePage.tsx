"use client";

import ContactDashboard from "./ContactDashboard";
import OnboardingGate from "./OnboardingGate";

export default function HomePage() {
  return (
    <OnboardingGate>
      {(profile) => (
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-white">{profile.name}</h1>
            <p className="mt-1 text-sm text-slate-400">
              {[profile.phone, profile.address, profile.email].filter(Boolean).join(" · ")}
            </p>
          </div>

          <ContactDashboard />
        </div>
      )}
    </OnboardingGate>
  );
}
