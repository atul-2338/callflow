/**
 * GET /api/admin/leads — every post-demo lead, newest first (admin Leads tab).
 *
 * Guarded like every /api/admin/* route (requireAdminApi on the first line, and
 * the owner's callflow_business_session cookie is never accepted here). Read
 * only: status changes go through PATCH /api/admin/leads/[id], which is what
 * the audit trail records.
 */
import { NextResponse } from "next/server";

import { adminListLeads } from "@/lib/admin-db";
import { requireAdminApi } from "@/lib/admin-session";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  const guard = requireAdminApi(request);
  if (guard) return guard;

  return NextResponse.json({ leads: await adminListLeads() });
}
