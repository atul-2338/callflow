/**
 * POST /api/admin/calls/[id]/assign — link a call to a business from the
 * admin panel's calls page.
 *
 * Guarded like every /api/admin/* route (requireAdminApi first line). Only
 * calls.businessId/updatedAt change; follow-up state, transcripts, and
 * webhook fields are never touched from the admin panel. Success is
 * audit-logged with the previous businessId so reassignments are
 * reconstructable from the trail.
 */
import { NextResponse } from "next/server";

import { adminAssignCallToBusiness } from "@/lib/admin-db";
import { logAdminAction } from "@/lib/admin-audit";
import { requireAdminApi } from "@/lib/admin-session";
import { clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(
  request: Request,
  context: RouteContext
): Promise<NextResponse> {
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
    return NextResponse.json(
      { error: "businessId is required." },
      { status: 400 }
    );
  }

  const { id } = await context.params;
  const result = await adminAssignCallToBusiness(id, businessId);
  if (!result.ok) {
    if (result.reason === "call_not_found") {
      return NextResponse.json({ error: "Call not found" }, { status: 404 });
    }
    return NextResponse.json(
      { error: "Business not found" },
      { status: 400 }
    );
  }

  logAdminAction({
    action: "call_assign",
    target: id,
    details: {
      businessId,
      businessClientUid: result.businessClientUid,
      previousBusinessId: result.previousBusinessId,
    },
    ip: clientIp(request),
  });

  return NextResponse.json({ call: result.call });
}