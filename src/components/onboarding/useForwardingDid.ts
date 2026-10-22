"use client";

import { useEffect, useState } from "react";

/**
 * The CallFlow forwarding DID comes from the server (/api/setup/config reads
 * the CALLFLOW_FORWARDING_DID env), never from a hardcoded constant: changing
 * the number is a config change, not a code change.
 *
 * Shared by CarrierForwardingStep (dial-code cards) and OnboardingFlow (the
 * "You're all set!" screen). The module-level cache means the two consumers
 * together trigger exactly one fetch per browser session.
 */

/** Display form: "+1 (928) 331-9394" for +1 numbers, raw E.164 otherwise. */
function formatForwardingDid(e164: string): string {
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  if (match) return `+1 (${match[1]}) ${match[2]}-${match[3]}`;
  return e164;
}

let cached: string | null = null;

export function useForwardingDid() {
  const [forwardingDid, setForwardingDid] = useState<string | null>(cached);
  const [loading, setLoading] = useState(cached === null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (cached) return;
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch("/api/setup/config");
        const data = (await response.json()) as {
          forwardingDid?: string;
          error?: string;
        };
        if (!response.ok || !data.forwardingDid) {
          throw new Error(data.error || "Forwarding configuration missing");
        }
        cached = data.forwardingDid;
        if (!cancelled) setForwardingDid(data.forwardingDid);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Forwarding configuration missing"
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return {
    forwardingDid,
    display: forwardingDid ? formatForwardingDid(forwardingDid) : null,
    loading,
    error,
  };
}