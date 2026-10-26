/**
 * POST /api/admin/businesses — create a business from the admin panel.
 *
 * Guarded like every /api/admin/* route (requireAdminApi first line). The
 * phone must normalize to valid E.164 and must not already be enrolled; the
 * creation goes through the canonical db.ts createBusiness path so the
 * permanent clientUid lifecycle matches owner-driven signups. Success is
 * audit-logged (ids only — the phone number is the business's own key, not a
 * secret; see the admin-audit contract).
 */
import { NextResponse } from "next/server";

import { adminCreateBusiness } from "@/lib/admin-db";
import { logAdminAction } from "@/lib/admin-audit";
import { requireAdminApi } from "@/lib/admin-session";
import { clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  const guard = requireAdminApi(request);
  if (guard) return guard;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  const phoneNumber =
    typeof body.phoneNumber === "string" ? body.phoneNumber : "";
  const billingName =
    typeof body.billingName === "string" ? body.billingName : undefined;
  const carrier = typeof body.carrier === "string" ? body.carrier : undefined;

  const result = await adminCreateBusiness({ phoneNumber, billingName, carrier });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.message },
      { status: result.reason === "duplicate_phone" ? 409 : 400 }
    );
  }

  logAdminAction({
    action: "business_create",
    target: result.business.id,
    details: {
      clientUid: result.business.clientUid,
      phoneNumber: result.business.phoneNumber,
      carrier: result.business.carrier,
    },
    ip: clientIp(request),
  });

  return NextResponse.json({ business: result.business }, { status: 201 });
}