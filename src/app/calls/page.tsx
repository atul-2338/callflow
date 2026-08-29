"use client";

import CallLogs from "@/components/CallLogs";
import OnboardingGate from "@/components/OnboardingGate";
import BackButton from "@/components/BackButton";

export default function CallsPage() {
  return (
    <OnboardingGate>
      {(profile) => (
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <BackButton />
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-white">Call Logs</h1>
            <p className="mt-1 text-sm text-slate-400">
              All inbound and missed calls for {profile.name}
            </p>
          </div>
          <CallLogs />
        </div>
      )}
    </OnboardingGate>
  );
}
