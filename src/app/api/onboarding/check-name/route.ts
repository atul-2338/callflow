import { NextResponse } from "next/server";
import { applyCors, corsPreflightResponse, handlePreflight } from "@/lib/cors";
import { BUSINESS_NAME_TAKEN_ERROR } from "@/lib/billing";
import { getBusinessByName } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function OPTIONS(request: Request) {
  return corsPreflightResponse(request);
}

// Wizard Step-1 pre-check: tells the owner their business name is already
// taken BEFORE they fill the rest of the form and get bounced through the
// Dodo redirect. Best-effort only — the authoritative check lives in
// createBillingSignup (/api/billing/signup), which re-runs it atomically
// against the same table before creating anything.
export async function POST(request: Request) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  // Cheap abuse guard: this endpoint runs a name lookup on every wizard
  // submit, so cap it per client IP like the other public onboarding routes.
  const limit = rateLimit(`check-name:ip:${clientIp(request)}`, 60, 60 * 60 * 1000);
  if (!limit.allowed) {
    return applyCors(
      NextResponse.json(
        { error: "Too many requests. Try again later." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
      ),
      request
    );
  }

  let name = "";
  try {
    const body = (await request.json()) as { name?: unknown };
    name = typeof body.name === "string" ? body.name.trim() : "";
  } catch {
    return applyCors(
      NextResponse.json(
        { error: "Request body must be valid JSON." },
        { status: 400 }
      ),
      request
    );
  }

  // Mirrors the wizard's own Step-1 validation; a shorter name never reaches
  // the lookup, so an empty name is a client bug rather than a "taken" hit.
  if (name.length < 2) {
    return applyCors(
      NextResponse.json(
        { error: "Enter your business name.", available: false },
        { status: 400 }
      ),
      request
    );
  }

  const clash = await getBusinessByName(name);
  if (clash) {
    return applyCors(
      NextResponse.json(
        {
          error: BUSINESS_NAME_TAKEN_ERROR,
          available: false,
          code: "business_name_taken",
        },
        { status: 400 }
      ),
      request
    );
  }

  return applyCors(NextResponse.json({ available: true }), request);
}