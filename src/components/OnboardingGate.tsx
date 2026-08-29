"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import Onboarding from "./Onboarding";
import type { ClientProfile } from "@/lib/types";

export default function OnboardingGate({
  children,
}: {
  children: (profile: ClientProfile) => React.ReactNode;
}) {
  const [profile, setProfile] = useState<ClientProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/client")
      .then((res) => res.json())
      .then((data) => setProfile(data))
      .catch(() => setProfile(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gold-400" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Onboarding onComplete={setProfile} />
      </div>
    );
  }

  return <>{children(profile)}</>;
}
