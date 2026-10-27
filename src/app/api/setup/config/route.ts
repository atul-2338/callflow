import { NextResponse } from "next/server";
import { businessIdFromCookieHeader } from "@/lib/business-session";
import { getBusinessById } from "@/lib/db";
import { isValidInternationalPhone, normalizeEnvValue } from "@/lib/util";

// The CallFlow forwarding number (E.164) that business phones forward missed
// calls to — the DID the onboarding wizard's carrier dial codes target. Served
// to the client by GET /api/setup/config (consumed by
// src/components/onboarding/useForwardingDid.ts) so the UI never hardcodes it:
// changing the number is a .env change, not a code change.
//
// Resolution order: a signed-in owner's business with an admin-assigned
// CallFlow number (businesses.assignedNumber) is served first — a per-business
// DID must never be replaced by the shared one; every business without its own
// assigned number gets the shared CALLFLOW_FORWARDING_DID.
//
// It must be the same carrier-facing number as PLIVO_NUMBER / TELNYX_NUMBER
// (the DID that actually receives forwarded calls) — keep them in sync. It is
// NOT businesses.phoneNumber: that row stores the business owner's own number
// (the Dograh attribution key, see /api/onboarding/start).
//
// Fail closed: when the variable is missing or invalid there is no correct
// number to show, so the endpoint answers 503 and the wizard renders an error
// state instead of dial codes that would forward calls to a dead DID.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // Per-business first: the owner's own DID when one is assigned. Admin-set
  // values are E.164 at write time; the leading "+" is re-checked here so a
  // malformed legacy row can never render as carrier dial codes.
  const businessId = businessIdFromCookieHeader(request.headers.get("cookie"));
  if (businessId) {
    const business = await getBusinessById(businessId);
    const assigned = business?.assignedNumber;
    if (assigned && assigned.startsWith("+")) {
      return NextResponse.json({ forwardingDid: assigned });
    }
  }

  const forwardingDid = getForwardingDid();

  if (!forwardingDid) {
    console.error(
      "[setup-config] CALLFLOW_FORWARDING_DID is missing or not a valid E.164 number — the setup wizard cannot show carrier dial codes. Add CALLFLOW_FORWARDING_DID=\"+1xxxxxxxxxx\" to .env.local."
    );
    return NextResponse.json(
      { error: "Forwarding configuration missing" },
      { status: 503 }
    );
  }

  return NextResponse.json({ forwardingDid });
}

/**
 * Reads CALLFLOW_FORWARDING_DID and normalizes it to E.164. Tolerates common
 * formatted values ("+1 928 331-9394" works); requires the leading "+" so a
 * bare national number is rejected rather than guessed at. Returns null when
 * unset or unparsable.
 */
function getForwardingDid(): string | null {
  const raw = normalizeEnvValue(process.env.CALLFLOW_FORWARDING_DID);
  if (!raw || !raw.startsWith("+")) return null;
  const e164 = `+${raw.replace(/[^\d]/g, "")}`;
  return isValidInternationalPhone(e164) ? e164 : null;
}