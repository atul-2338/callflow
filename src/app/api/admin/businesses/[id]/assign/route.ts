/**
 * POST /api/admin/businesses/[id]/assign — assign the next available pool
 * number to a business (admin "Assign number" button).
 *
 * Guarded like every /api/admin/* route (requireAdminApi first line). The
 * owner's phone (businesses.phoneNumber) drives the area-code preference.
 * Answers 503 with a clear message when the pool is empty; assignNumber is
 * idempotent, so re-clicking never double-assigns. Success is audit-logged.
 */
import { NextResponse } from "next/server";

import { assignNumber } from "@/lib/numbers-pool";
import { logAdminAction } from "@/lib/admin-audit";
import { requireAdminApi } from "@/lib/admin-session";
import { getBusinessById } from "@/lib/db";
import { clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(
  request: Request,
  context: RouteContext
): Promise<NextResponse> {
  const guard = requireAdminApi(request);
  if (guard) return guard;

  const { id } = await context.params;
  const business = await getBusinessById(id);
  if (!business) {
    return NextResponse.json({ error: "Business not found" }, { status: 404 });
  }

  const result = await assignNumber(id, business.phoneNumber);
  if (result.pending) {
    return NextResponse.json(
      {
        error:
          "The number pool is empty — add numbers on the Numbers page, then assign again.",
      },
      { status: 503 }
    );
  }

  logAdminAction({
    action: "business_number_assigned",
    target: id,
    details: {
      clientUid: business.clientUid,
      assignedNumber: result.assignedNumber,
      previousAssignedNumber: business.assignedNumber,
    },
    ip: clientIp(request),
  });

  return NextResponse.json({ assignedNumber: result.assignedNumber });
}