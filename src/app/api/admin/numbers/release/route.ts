/**
 * POST /api/admin/numbers/release — give an assigned pool number back.
 *
 * Guarded like every /api/admin/* route (requireAdminApi first line). The body
 * is `{ businessId: string }`: the pool entry returns to `available` and the
 * business's assignedNumber is cleared (the business becomes pending_number by
 * definition). Success is audit-logged with the released number.
 */
import { NextResponse } from "next/server";

import { releaseNumber } from "@/lib/numbers-pool";
import { logAdminAction } from "@/lib/admin-audit";
import { requireAdminApi } from "@/lib/admin-session";
import { getBusinessById } from "@/lib/db";
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

  const businessId =
    typeof body.businessId === "string" ? body.businessId.trim() : "";
  if (!businessId) {
    return NextResponse.json({ error: "businessId is required." }, { status: 400 });
  }

  const business = await getBusinessById(businessId);
  if (!business) {
    return NextResponse.json({ error: "Business not found" }, { status: 404 });
  }

  const releasedNumber = business.assignedNumber;
  const found = await releaseNumber(businessId);
  logAdminAction({
    action: "business_number_released",
    target: businessId,
    details: {
      clientUid: business.clientUid,
      releasedNumber,
      poolEntryFound: found,
    },
    ip: clientIp(request),
  });

  return NextResponse.json({ ok: true, releasedNumber });
}