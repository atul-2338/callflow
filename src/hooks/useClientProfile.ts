"use client";

import { useEffect, useState } from "react";
import type { ClientProfile } from "@/lib/types";

export function useClientProfile() {
  const [profile, setProfile] = useState<ClientProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/client")
      .then((res) => res.json())
      .then((data) => setProfile(data))
      .catch(() => setProfile(null))
      .finally(() => setLoading(false));
  }, []);

  return { profile, loading, setProfile };
}
