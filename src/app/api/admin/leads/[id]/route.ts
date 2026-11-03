/**
 * PATCH /api/admin/leads/[id] — move one lead along new → contacted →
 * account_created → dead (the status select on /admin/leads).
 *
 * Guarded like every /api/admin/* route: the admin cookie only, and the route
 * answers 401 before touching the database when it is missing or forged. The
 * status is validated against the shared LEAD_STATUSES enum (src/lib/types.ts)
 * — the same list the schema comment and the select render — so an unknown
 * value can never reach the table. An unknown id is a 404, not a silent
 * success, and the change is recorded in the admin audit trail by id and status
 * only (no lead PII is copied into the audit row).
 */
import { NextResponse } from "next/server";

import { logAdminAction } from "@/lib/admin-audit";
import { requireAdminApi } from "@/lib/admin-session";
import { setLeadStatus } from "@/lib/db";
import { clientIp } from "@/lib/rate-limit";
import { LEAD_STATUSES, type LeadStatus } from "@/lib/types";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(
  request: Request,
  context: RouteContext
): Promise<NextResponse> {
  const guard = requireAdminApi(request);
  if (guard) return guard;

  const { id } = await context.params;

  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = await request.json();
    if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const status = typeof body.status === "string" ? body.status.trim() : "";
  if (!LEAD_STATUSES.includes(status as LeadStatus)) {
    return NextResponse.json(
      { error: `status must be one of: ${LEAD_STATUSES.join(", ")}` },
      { status: 400 }
    );
  }

  const lead = await setLeadStatus(id, status as LeadStatus);
  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  logAdminAction({
    action: "lead_status_updated",
    target: id,
    details: { status: lead.status },
    ip: clientIp(request),
  });

  return NextResponse.json({ lead });
}
